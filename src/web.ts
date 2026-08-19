/**
 * Web-profile endpoint: the Settings page's read/write surface.
 *
 * The `shell-selector` settings namespace is deliberately NOT exposed through
 * the settings RPC (the Web exposure list is owned by the host api-proxy), so
 * the browser talks to this plugin through its own same-origin JSON endpoint,
 * exactly like `dsh-vision-cloud` does. Every write is validated against the
 * schemastery schema and committed through the settings service, which
 * persists to `$DSH_HOME/settings.yaml`; the running process's executor stack
 * is never touched — changes take effect on the next boot.
 *
 * @module dsh-shell-selector/web
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { normalizeConfig, validateConfig, type ShellSelectorSettings } from './settings.js'
import { detect, detectSync } from './detector.js'
import { decisionsEqual, resolveEffective, type EffectiveDecision, type ShellAvailability } from './resolver.js'
import type { ActiveShell, DetectedShell, ShellSelectorState } from './types.js'

/** Exact route serving the Settings page's state. */
export const STATE_ROUTE = '/_dsh/shell-selector/state'

/** Exact route accepting save / re-detect actions. */
export const ACTION_ROUTE = '/_dsh/shell-selector/action'

/** Runtime facts the endpoint closes over. */
export interface ShellSelectorBackend {
  pluginVersion: string
  platform: string
  snapshot: ActiveShell
  snapshotDecision: EffectiveDecision
  settings: {
    get(): ShellSelectorSettings
    replace(section: ShellSelectorSettings, expectedRevision?: number): Promise<void>
  }
  /** Live availability cache, refreshed in the background and on demand. */
  availability(): ShellAvailability
  /** Live detected list (with versions once the background probe settles). */
  detected(): DetectedShell[]
  /** Kick a fresh detection sweep; resolves when the sweep settles. */
  refreshDetection(): Promise<void>
  /** The gate: another agent preset explicitly chosen by the user. */
  isGated(): boolean
  /** The user-chosen default agent preset id, when known. */
  defaultAgentPreset(): string | undefined
  /** Settings revision, for save-with-conflict-detection. */
  revision(): number
  writable(): boolean
}

interface JsonSuccess<T> {
  ok: true
  value: T
}

interface JsonFailure {
  ok: false
  error: { code: string; message: string }
}

type JsonResponse<T> = JsonSuccess<T> | JsonFailure

function responseJson<T>(res: ServerResponse, status: number, body: JsonResponse<T>): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res: ServerResponse, status: number, code: string, message: string): void {
  responseJson(res, status, { ok: false, error: { code, message } })
}

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build the full state the Settings page renders. */
export function buildState(backend: ShellSelectorBackend): ShellSelectorState {
  const configured = backend.settings.get()
  const availability = backend.availability()
  const gated = backend.isGated()
  const next = resolveEffective(configured, backend.platform, availability, gated)
  const activeMissing = !availability[backend.snapshot.kind]
  const configuredMissing = next.reason === 'explicit-unavailable'
  const restartRequired = !decisionsEqual(backend.snapshotDecision, next, backend.platform)
  const defaultAgentPreset = backend.defaultAgentPreset()
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
    gatedByPreset: gated,
    ...(defaultAgentPreset === undefined ? {} : { defaultAgentPreset }),
    settingsRevision: backend.revision(),
    writable: backend.writable(),
  }
}

function handleState(backend: ShellSelectorBackend, res: ServerResponse): void {
  try {
    responseJson(res, 200, { ok: true, value: buildState(backend) })
  } catch (error) {
    requestError(res, 500, 'state-failed', error instanceof Error ? error.message : String(error))
  }
}

async function handleAction(backend: ShellSelectorBackend, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: unknown
  try {
    payload = await readJson(req)
  } catch (error) {
    requestError(res, 400, 'bad-request', error instanceof Error ? error.message : String(error))
    return
  }
  if (!isRecord(payload) || typeof payload['action'] !== 'string') {
    requestError(res, 400, 'bad-request', 'payload must be an object with an "action" string')
    return
  }
  try {
    if (payload['action'] === 'detect') {
      await backend.refreshDetection()
      responseJson(res, 200, { ok: true, value: buildState(backend) })
      return
    }
    if (payload['action'] === 'save') {
      const expectedRevision = typeof payload['expectedRevision'] === 'number' ? payload['expectedRevision'] : undefined
      const validated = await validateConfig({ mode: payload['mode'], shell: payload['shell'] })
      if (!validated.ok) {
        requestError(res, 400, 'invalid-config', validated.issues.join('; '))
        return
      }
      const normalized = normalizeConfig(validated.value)
      await backend.settings.replace(normalized, expectedRevision)
      responseJson(res, 200, { ok: true, value: buildState(backend) })
      return
    }
    requestError(res, 400, 'bad-request', `unknown action ${JSON.stringify(payload['action'])}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && error.name === 'SettingsConflictError') {
      requestError(res, 409, 'settings-conflict', message)
      return
    }
    requestError(res, 500, 'action-failed', message)
  }
}

/** Install the two routes on the web server. Returns a disposer. */
export function installShellSelectorWeb(ctx: Context, backend: ShellSelectorBackend): () => void {
  const disposers: (() => void)[] = []
  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path,
      handler,
    })
    disposers.push(dispose)
  }
  register(STATE_ROUTE, (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      requestError(res, 405, 'method-not-allowed', 'GET only')
      return
    }
    handleState(backend, res)
  })
  register(ACTION_ROUTE, (req, res) => {
    if (req.method !== 'POST') {
      requestError(res, 405, 'method-not-allowed', 'POST only')
      return
    }
    void handleAction(backend, req, res)
  })
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/** Background detection keeper: sync availability immediately, versions later. */
export class DetectionCache {
  private availabilityValue: ShellAvailability
  private detectedValue: DetectedShell[]
  private sweeping: Promise<void> = Promise.resolve()

  constructor(platform: string) {
    this.detectedValue = detectSync(platform)
    this.availabilityValue = {
      bash: this.detectedValue.some((entry) => entry.kind === 'bash'),
      pwsh: this.detectedValue.some((entry) => entry.kind === 'pwsh'),
      powershell: this.detectedValue.some((entry) => entry.kind === 'powershell'),
    }
  }

  availability(): ShellAvailability {
    return this.availabilityValue
  }

  detected(): DetectedShell[] {
    return this.detectedValue
  }

  refresh(platform: string): Promise<void> {
    this.sweeping = this.sweeping
      .catch(() => void 0)
      .then(async () => {
        const detected = await detect(platform)
        this.detectedValue = detected
        this.availabilityValue = {
          bash: detected.some((entry) => entry.kind === 'bash'),
          pwsh: detected.some((entry) => entry.kind === 'pwsh'),
          powershell: detected.some((entry) => entry.kind === 'powershell'),
        }
      })
    return this.sweeping
  }
}
