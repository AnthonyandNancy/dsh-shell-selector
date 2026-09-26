/**
 * The immutable per-process runtime snapshot.
 *
 * `dsh-shell-selector` never hot-swaps the shell: the process starts with the
 * composition it booted, and keeps it until restart. This module captures
 * that fact once, at plugin load, so the Settings page can always tell
 * "currently active" apart from "configured for next boot".
 *
 * @module dsh-shell-selector/runtime-snapshot
 */
/**
 * Build the immutable snapshot. Called exactly once per process (plugin
 * apply); the returned object must never be mutated afterwards.
 *
 * `available` is deliberately NOT part of the snapshot: whether the active
 * executable still exists is a live fact (the user may uninstall a shell
 * mid-run), so the state builder checks it on every read.
 */
export function createRuntimeSnapshot(input) {
    const { decision } = input;
    const kind = decision.kind === 'platform'
        ? (input.platform === 'win32' ? 'pwsh' : 'bash')
        : decision.kind;
    return {
        kind,
        mode: input.config.mode,
        ...(input.config.shell === undefined ? {} : { shell: input.config.shell }),
        reason: decision.reason,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
    };
}
//# sourceMappingURL=runtime-snapshot.js.map