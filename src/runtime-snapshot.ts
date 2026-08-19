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

import type { EffectiveDecision, ShellId, ShellSelectorMode } from './resolver.js'
import type { ActiveShell } from './types.js'

/** Inputs available at snapshot time. */
export interface SnapshotInput {
  platform: string
  /** The configuration this process booted with (settings as of plugin load). */
  config: { mode: ShellSelectorMode; shell?: ShellId }
  /** The boot decision (resolved from the boot config). */
  decision: EffectiveDecision
  /** Executable the active executor resolves to, when known. */
  executable?: string | undefined
}

/**
 * Build the immutable snapshot. Called exactly once per process (plugin
 * apply); the returned object must never be mutated afterwards.
 *
 * `available` is deliberately NOT part of the snapshot: whether the active
 * executable still exists is a live fact (the user may uninstall a shell
 * mid-run), so the state builder checks it on every read.
 */
export function createRuntimeSnapshot(input: SnapshotInput): ActiveShell {
  const { decision } = input
  const kind: ShellId = decision.kind === 'platform'
    ? (input.platform === 'win32' ? 'pwsh' : 'bash')
    : decision.kind
  return {
    kind,
    mode: input.config.mode,
    ...(input.config.shell === undefined ? {} : { shell: input.config.shell }),
    reason: decision.reason,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
  }
}
