/**
 * Web-profile endpoint: the Settings page's read/write surface.
 *
 * The plugin speaks over its own same-origin JSON endpoint instead of the
 * settings API, because the page needs more than a form: the immutable boot
 * snapshot, the live detection sweep, and the restart verdict. The write side
 * is still the settings service — `ctx.settings.replace(entryId, section,
 * revision)` — so the value lands on the `shell-selector` profile row (the
 * document the boot expressions read) with conflict detection intact.
 *
 * DSH 0.1.7-rc.1 reconciles that entry after a write, which re-enters the
 * plugin's `apply()` with the new configuration; THIS process keeps the shell
 * it booted with, because the executor row was decided at startup.
 *
 * @module dsh-shell-selector/web
 */
import { normalizeConfig, validateConfig } from './settings.js';
import { detect, detectSync } from './detector.js';
import { decisionsEqual, resolveEffective } from './resolver.js';
/** Exact route serving the Settings page's state. */
export const STATE_ROUTE = '/_dsh/shell-selector/state';
/** Exact route accepting save / re-detect actions. */
export const ACTION_ROUTE = '/_dsh/shell-selector/action';
function responseJson(res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.writeHead(status);
    res.end(bytes);
}
function requestError(res, status, code, message) {
    responseJson(res, status, { ok: false, error: { code, message } });
}
async function readJson(req, maxBytes = 64 * 1024) {
    const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json')
        throw new TypeError('Content-Type must be application/json');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += part.length;
        if (bytes > maxBytes)
            throw new RangeError(`request body exceeds ${maxBytes} bytes`);
        chunks.push(part);
    }
    if (chunks.length === 0)
        throw new TypeError('request body is empty');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Build the full state the Settings page renders.
 *
 * @param backend - the live runtime facts.
 * @param configuredOverride - the configuration to report; defaults to the one
 *   this fiber was composed with. A save passes the freshly written value,
 *   because reconciling the entry disposes this fiber before it could observe
 *   that value itself.
 */
export function buildState(backend, configuredOverride) {
    const configured = configuredOverride ?? backend.settings.get();
    const availability = backend.availability();
    const next = resolveEffective(configured, backend.platform, availability);
    const activeMissing = !availability[backend.snapshot.kind];
    const configuredMissing = next.reason === 'explicit-unavailable';
    const restartRequired = !decisionsEqual(backend.snapshotDecision, next, backend.platform);
    return {
        schemaVersion: 1,
        platform: backend.platform,
        pluginVersion: backend.pluginVersion,
        active: backend.snapshot,
        configured: { mode: configured.mode, ...(configured.shell === undefined ? {} : { shell: configured.shell }) },
        detected: backend.detected(),
        restartRequired,
        activeMissing,
        configuredMissing,
        settingsRevision: backend.revision(),
        writable: backend.writable(),
    };
}
function handleState(backend, res) {
    try {
        responseJson(res, 200, { ok: true, value: buildState(backend) });
    }
    catch (error) {
        requestError(res, 500, 'state-failed', error instanceof Error ? error.message : String(error));
    }
}
async function handleAction(backend, req, res) {
    let payload;
    try {
        payload = await readJson(req);
    }
    catch (error) {
        requestError(res, 400, 'bad-request', error instanceof Error ? error.message : String(error));
        return;
    }
    if (!isRecord(payload) || typeof payload['action'] !== 'string') {
        requestError(res, 400, 'bad-request', 'payload must be an object with an "action" string');
        return;
    }
    try {
        if (payload['action'] === 'detect') {
            await backend.refreshDetection();
            responseJson(res, 200, { ok: true, value: buildState(backend) });
            return;
        }
        if (payload['action'] === 'save') {
            const expectedRevision = typeof payload['expectedRevision'] === 'number' ? payload['expectedRevision'] : undefined;
            const validated = await validateConfig({ mode: payload['mode'], shell: payload['shell'] });
            if (!validated.ok) {
                requestError(res, 400, 'invalid-config', validated.issues.join('; '));
                return;
            }
            const normalized = normalizeConfig(validated.value);
            await backend.settings.replace(normalized, expectedRevision);
            responseJson(res, 200, { ok: true, value: buildState(backend, normalized) });
            return;
        }
        requestError(res, 400, 'bad-request', `unknown action ${JSON.stringify(payload['action'])}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && error.name === 'SettingsConflictError') {
            requestError(res, 409, 'settings-conflict', message);
            return;
        }
        requestError(res, 500, 'action-failed', message);
    }
}
/** Install the two routes on the web server. Returns a disposer. */
export function installShellSelectorWeb(ctx, backend) {
    const disposers = [];
    const register = (path, handler) => {
        const dispose = ctx.webServer.register({
            kind: 'exact',
            path,
            handler,
        });
        disposers.push(dispose);
    };
    register(STATE_ROUTE, (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            requestError(res, 405, 'method-not-allowed', 'GET only');
            return;
        }
        handleState(backend, res);
    });
    register(ACTION_ROUTE, (req, res) => {
        if (req.method !== 'POST') {
            requestError(res, 405, 'method-not-allowed', 'POST only');
            return;
        }
        // Returned, not dropped: the caller can await the write, and a rejected
        // promise can never escape as an unhandled rejection.
        return handleAction(backend, req, res);
    });
    return () => {
        for (const dispose of disposers.splice(0))
            dispose();
    };
}
/** Background detection keeper: sync availability immediately, versions later. */
export class DetectionCache {
    availabilityValue;
    detectedValue;
    sweeping = Promise.resolve();
    constructor(platform) {
        this.detectedValue = detectSync(platform);
        this.availabilityValue = {
            bash: this.detectedValue.some((entry) => entry.kind === 'bash'),
            pwsh: this.detectedValue.some((entry) => entry.kind === 'pwsh'),
            powershell: this.detectedValue.some((entry) => entry.kind === 'powershell'),
        };
    }
    availability() {
        return this.availabilityValue;
    }
    detected() {
        return this.detectedValue;
    }
    refresh(platform) {
        this.sweeping = this.sweeping
            .catch(() => void 0)
            .then(async () => {
            const detected = await detect(platform);
            this.detectedValue = detected;
            this.availabilityValue = {
                bash: detected.some((entry) => entry.kind === 'bash'),
                pwsh: detected.some((entry) => entry.kind === 'pwsh'),
                powershell: detected.some((entry) => entry.kind === 'powershell'),
            };
        });
        return this.sweeping;
    }
}
//# sourceMappingURL=web.js.map