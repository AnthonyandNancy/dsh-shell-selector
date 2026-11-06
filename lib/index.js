/**
 * dsh-shell-selector — the host plugin.
 *
 * Product contract (see ARCHITECTURE.md): configuration changes are PERSISTED
 * and take effect on the NEXT process start. This plugin never replaces
 * `ctx.shell`, never unloads/reloads `tool-bash`/`tool-pwsh`, never restarts
 * anything. The shell swap happens at boot, in the composition layer, via the
 * bundle patch expressions (`cordis.patch.yml`).
 *
 * DSH 0.1.7-rc.1 owns configuration differently from rc.6: the plugin declares
 * a Config schema (`./settings.ts`), the Loader passes the resolved profile row
 * to `apply()`, and `ctx.settings` edits that row. A save reconciles the entry,
 * so this function runs again with the new config. The boot facts — what THIS
 * process actually composed — are therefore frozen on the first apply of the
 * process and never recomputed: "currently active" stays a statement about the
 * running process and `restartRequired` remains honest.
 *
 * `apply()` only: freezes boot facts, prepares the Bash PATH for Git for
 * Windows, installs the per-agent Shell Tool adaptation, serves the Settings
 * endpoint, and reports the restart requirement.
 *
 * @module dsh-shell-selector
 */
import { readFileSync } from 'node:fs';
import { dirname, delimiter } from 'node:path';
import { SHELL_SELECTOR_ENTRY_ID, configFromEntry } from './settings.js';
import { settingsOf } from './compat/settings-surface.js';
import { detectComposedShell } from './compat/executor-probe.js';
import { bashAvailability, pwshAvailability, windowsPowerShellAvailability } from './detector.js';
import { resolveEffective, resolvedShellKind } from './resolver.js';
import { createRuntimeSnapshot } from './runtime-snapshot.js';
import { DetectionCache, installShellSelectorWeb } from './web.js';
import { installAgentShellAdaptation } from './agent/install.js';
/** Stable Cordis plugin name (the bundle patch inserts a row with this package). */
export const name = 'shell-selector';
/** The settings service must exist before this plugin reads or writes its row. */
export const inject = ['settings'];
/** The Loader's Config schema — also the Settings form projection. */
export { Config } from './settings.js';
/**
 * Process-lifetime boot facts.
 *
 * Module scope, not context scope: reconciling a saved configuration re-enters
 * `apply()` on the same process, and the new call must NOT redefine what this
 * process booted with. ESM caches this module per process, so the first apply
 * wins.
 */
let bootFacts;
/** Whether the composition mismatch has already been reported in this process. */
let warnedCompositionMismatch = false;
/** Drop the frozen boot facts (tests; a running application never calls this). */
export function resetBootFacts() {
    bootFacts = undefined;
    warnedCompositionMismatch = false;
}
function readPluginVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Resolve the executable the ACTIVE executor uses, for the snapshot.
 *
 * Keyed on the composed shell rather than on the decision: when the two
 * disagree the snapshot has to describe the process that is running.
 */
function snapshotExecutable(platform, activeKind, bashPath, pwshPath, powershellPath) {
    if (activeKind === 'bash')
        return bashPath;
    if (activeKind === 'pwsh')
        return pwshPath;
    if (activeKind === 'powershell')
        return powershellPath;
    // Unreachable: `resolvedShellKind` never returns 'platform'. Kept total so a
    // future ShellId cannot silently produce an undefined executable.
    return platform === 'win32' ? pwshPath : bashPath;
}
/** Capture the boot facts once per process. */
function captureBootFacts(platform, config, detection, composed) {
    const decision = resolveEffective(config, platform, detection.availability());
    const expectedKind = resolvedShellKind(decision, platform);
    const activeKind = composed ?? expectedKind;
    const snapshot = createRuntimeSnapshot({
        platform,
        config,
        decision,
        kind: activeKind,
        executable: snapshotExecutable(platform, activeKind, bashAvailability(platform).path, pwshAvailability().path, windowsPowerShellAvailability(platform).path),
    });
    return { config, decision, activeKind, composed, snapshot };
}
/**
 * Correct the frozen shell identity the first time the real `ctx.shell` becomes
 * visible.
 *
 * The facts are frozen so a settings save (which re-enters `apply()`) cannot
 * redefine what this process booted with. That freeze is about the
 * CONFIGURATION; the composed shell is a different fact, and it can become
 * observable one apply later than the first. This upgrades exactly once —
 * `composed` is set afterwards, so later applies leave the facts alone.
 *
 * @param platform - `process.platform`.
 * @param composed - the shell `ctx.shell` reports, when it is recognisable.
 */
function upgradeBootFacts(platform, composed) {
    if (composed === undefined)
        return;
    if (bootFacts === undefined || bootFacts.composed !== undefined)
        return;
    bootFacts = {
        ...bootFacts,
        activeKind: composed,
        composed,
        snapshot: createRuntimeSnapshot({
            platform,
            config: bootFacts.config,
            decision: bootFacts.decision,
            kind: composed,
            executable: snapshotExecutable(platform, composed, bashAvailability(platform).path, pwshAvailability().path, windowsPowerShellAvailability(platform).path),
        }),
    };
}
/**
 * When the active shell is Bash on Windows and the resolved Bash is a Git for
 * Windows installation that is not already on PATH, prepend its directory to
 * the current process PATH. This is the only supported way to make the
 * official `bash-local`/`bash-sandbox` executor (which spawns `bash`) reach a
 * Git Bash that was never manually added to PATH. The change is process-local
 * and never writes the registry or user environment.
 */
function prepareBashPath(platform, activeKind) {
    if (platform !== 'win32' || activeKind !== 'bash')
        return;
    const bash = bashAvailability(platform);
    if (!bash.available || bash.path === undefined)
        return;
    const dir = dirname(bash.path);
    const current = process.env.PATH ?? '';
    if (current.split(delimiter).some((part) => part.trim().toLowerCase() === dir.toLowerCase()))
        return;
    process.env.PATH = `${dir}${delimiter}${current}`;
    process.env.DSH_SHELL_SELECTOR_BASH_PATH = bash.path;
}
/**
 * Plugin apply: freeze the boot facts, prepare the Bash PATH, install the
 * per-agent Shell Tool adaptation, install the Web endpoint, and start
 * background detection.
 *
 * @param ctx - the plugin context.
 * @param rawConfig - the Loader-resolved `shell-selector` profile row config.
 */
export function apply(ctx, rawConfig) {
    const pluginVersion = readPluginVersion();
    const platform = process.platform;
    const configured = configFromEntry(rawConfig);
    const detection = new DetectionCache(platform);
    // What the host composed, when it is already visible. On a healthy install it
    // is NOT yet: this plugin's row is inserted before the executor rows, so the
    // first apply runs before `ctx.shell` exists. The configured decision is then
    // the only available answer, and the observation below corrects it.
    const composed = detectComposedShell(ctx);
    bootFacts ??= captureBootFacts(platform, configured, detection, composed);
    upgradeBootFacts(platform, composed);
    const facts = bootFacts;
    /**
     * Report "configuration predicted one shell, host composed another".
     *
     * This is a deployment mistake (the package is missing from
     * `dsh.profile.bundles`, or it was installed through a `link:` spec), not a
     * per-save event, so it is reported at most once per process.
     */
    const reportMismatch = () => {
        const current = bootFacts;
        if (current === undefined || current.composed === undefined)
            return;
        if (warnedCompositionMismatch)
            return;
        const expectedKind = resolvedShellKind(current.decision, platform);
        if (expectedKind === current.activeKind)
            return;
        warnedCompositionMismatch = true;
        ctx.logger.warn('dsh-shell-selector: the boot patch did not take effect (configuration expects %s, the host composed %s). ' +
            'Running with the host shell; add this package to dsh.profile.bundles so the selection applies, then restart.', expectedKind, current.activeKind);
    };
    reportMismatch();
    // `ctx.shell` appears one composition step after this plugin loads, so observe
    // it rather than reading it once. The effect disposes with the plugin.
    ctx.inject(['shell'], (shellCtx) => {
        shellCtx.effect(() => {
            upgradeBootFacts(platform, detectComposedShell(shellCtx));
            reportMismatch();
            return () => { };
        }, 'dsh-shell-selector: observe the composed shell');
    });
    // Read the corrected facts: an upgrade may already have run above, and a
    // Windows process whose composed shell is bash must still get Git Bash on
    // PATH even though the first prediction was the platform default.
    prepareBashPath(platform, bootFacts?.activeKind ?? facts.activeKind);
    // Agent plane: each preset's composition decides WHETHER an agent holds the
    // standard Shell capability; this adaptation decides WHICH dialect it speaks.
    // It adds the target tool before removing the mismatched one, keeps the tool
    // schema and the prompt in step, and fails the session loudly rather than
    // letting an agent reach the model with a wrong or empty shell surface.
    // A getter: the composed shell may be corrected by the `ctx.shell`
    // observation above before any agent exists, and each agent must adapt to
    // that corrected shell rather than to the prediction frozen at load.
    installAgentShellAdaptation(ctx, () => bootFacts?.activeKind ?? facts.activeKind);
    const settings = settingsOf(ctx);
    const revisionOf = () => {
        const descriptor = settings?.describe().find((row) => row.ns === SHELL_SELECTOR_ENTRY_ID);
        return descriptor?.revision ?? 0;
    };
    const backend = {
        pluginVersion,
        platform,
        // Read through `bootFacts` rather than the `facts` local: a late
        // `ctx.inject(['shell'])` corrects the process-wide facts, and these routes
        // were registered before that observation could run.
        snapshot: () => bootFacts?.snapshot ?? facts.snapshot,
        snapshotDecision: () => bootFacts?.decision ?? facts.decision,
        settings: {
            // The live value is the row the Loader last resolved for THIS fiber; a
            // save reconciles the entry and re-enters apply() with the new value.
            get: () => configured,
            replace: async (section, expectedRevision) => {
                if (settings === undefined)
                    throw new Error('the settings service is not composed');
                await settings.replace(SHELL_SELECTOR_ENTRY_ID, section, expectedRevision);
            },
        },
        availability: () => detection.availability(),
        detected: () => detection.detected(),
        refreshDetection: () => detection.refresh(platform),
        revision: revisionOf,
        writable: () => settings?.writable ?? true,
    };
    // Web routes only when a web server is present (web profile); the fiber is
    // owned by the plugin's dispose tree, so route cleanup happens through
    // `webCtx.effect`.
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => installShellSelectorWeb(webCtx, backend), 'dsh-shell-selector: web routes');
    });
    // Kick the version probe in the background; state stays available immediately.
    void detection.refresh(platform).catch(() => { });
    const logged = bootFacts?.snapshot ?? facts.snapshot;
    ctx.logger.info('dsh-shell-selector: active shell %s (mode %s)%s; restartRequired on next settings change.', logged.kind, logged.mode, logged.shell === undefined ? '' : `, shell ${logged.shell}`);
    return () => {
        // dispose() on the plugin tears down the inject fiber and its effects.
    };
}
//# sourceMappingURL=index.js.map