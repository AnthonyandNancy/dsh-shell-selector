/**
 * Pure resolution logic for the shell-selector configuration.
 *
 * This module mirrors the boot expressions (`./boot/expressions.ts`) in
 * TypeScript so the host runtime can report exactly what the composition did
 * and what the next boot will do. `tests/expressions.test.ts` evaluates the
 * real expression strings against the same inputs and asserts agreement.
 *
 * @module dsh-shell-selector/resolver
 */
/** Shell identifiers a user may pin, when the platform offers them. */
export const SHELL_IDS = ['bash', 'pwsh', 'powershell'];
/** Configuration modes. */
export const MODES = ['default', 'fallback', 'explicit'];
/** Availability of nothing — used to construct platform-default decisions. */
const NO_SHELLS = { bash: false, pwsh: false, powershell: false };
/**
 * Resolve one configuration against one platform and one availability
 * snapshot. Strictly mirrors `dshSsrEffective` in the boot expressions.
 *
 * @param config - the persisted configuration.
 * @param platform - `process.platform`.
 * @param availability - live detection results.
 */
export function resolveEffective(config, platform, availability) {
    if (config.mode === 'default') {
        return { kind: 'platform', reason: 'platform-default' };
    }
    if (platform === 'win32') {
        if (config.mode === 'fallback') {
            // Strict order: Bash → PowerShell 7 → Windows PowerShell.
            if (availability.bash)
                return { kind: 'bash', reason: 'fallback' };
            if (availability.pwsh)
                return { kind: 'pwsh', reason: 'fallback' };
            if (availability.powershell)
                return { kind: 'powershell', reason: 'fallback' };
            return { kind: 'platform', reason: 'fallback-unavailable' };
        }
        if (config.shell === 'bash') {
            return availability.bash
                ? { kind: 'bash', reason: 'explicit', shell: 'bash' }
                : { kind: 'platform', reason: 'explicit-unavailable', shell: 'bash' };
        }
        if (config.shell === 'pwsh') {
            return availability.pwsh
                ? { kind: 'pwsh', reason: 'explicit', shell: 'pwsh' }
                : { kind: 'platform', reason: 'explicit-unavailable', shell: 'pwsh' };
        }
        if (config.shell === 'powershell') {
            return availability.powershell
                ? { kind: 'powershell', reason: 'explicit', shell: 'powershell' }
                : { kind: 'platform', reason: 'explicit-unavailable', shell: 'powershell' };
        }
        return { kind: 'platform', reason: 'platform-default' };
    }
    // POSIX: the first release supports Bash only.
    if (config.mode === 'explicit' && config.shell === 'bash') {
        return { kind: 'bash', reason: 'explicit', shell: 'bash' };
    }
    return { kind: 'platform', reason: 'platform-default' };
}
/**
 * Resolve "what would the platform rule do" — the baseline every decision
 * compares against. Windows: PowerShell family (pwsh preferred, Windows
 * PowerShell as the executor's own fallback); POSIX: Bash.
 */
export function platformDefaultKind(platform) {
    return platform === 'win32' ? 'pwsh' : 'bash';
}
/**
 * The shell a decision actually composes: `platform` resolves through the
 * platform rule (Bash on POSIX, PowerShell family on Windows).
 */
export function resolvedShellKind(decision, platform) {
    return decision.kind === 'platform' ? platformDefaultKind(platform) : decision.kind;
}
/**
 * Semantic equality of two decisions for `restartRequired` computation.
 *
 * Decisions compare on the RESOLVED shell, never on raw configuration
 * strings: `default` on Windows and `explicit: pwsh` both compose the
 * PowerShell executor, so switching between them requires no restart.
 */
export function decisionsEqual(left, right, platform) {
    return resolvedShellKind(left, platform) === resolvedShellKind(right, platform);
}
/**
 * Whether a restart would change the effective shell.
 *
 * @param booted - the immutable snapshot decision from this process start.
 * @param configured - the current (possibly just-saved) configuration.
 * @param platform - `process.platform`.
 * @param availability - detection results as of now.
 */
export function restartRequired(booted, configured, platform, availability) {
    const next = resolveEffective(configured, platform, availability);
    return !decisionsEqual(booted, next, platform);
}
/** The availability snapshot when nothing can be probed (safe defaults). */
export function emptyAvailability() {
    return { ...NO_SHELLS };
}
//# sourceMappingURL=resolver.js.map