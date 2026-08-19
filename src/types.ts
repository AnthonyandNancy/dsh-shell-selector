/**
 * Shared wire types: the contract between the host plugin, its HTTP endpoint
 * (`/_dsh/shell-selector/...`) and the browser client.
 *
 * @module dsh-shell-selector/types
 */

import type { ShellId, ShellSelectorMode } from './resolver.js'

/** One detected shell installation on the current machine. */
export interface DetectedShell {
  kind: ShellId
  /** Human-readable label, e.g. `PowerShell 7`. */
  name: string
  /** Absolute path of the executable, when one was resolved. */
  path?: string
  /** Version string, best-effort (`--version` probe), when available. */
  version?: string
}

/** The immutable per-process snapshot of what the composition actually did. */
export interface ActiveShell {
  /** The shell this process runs commands with. */
  kind: ShellId
  /** The configuration the process booted with. */
  mode: ShellSelectorMode
  shell?: ShellId
  /** How the boot decision came to be. */
  reason: string
  /** Absolute executable path the executor uses, when known. */
  executable?: string
}

/** The full state served to the Settings page. */
export interface ShellSelectorState {
  schemaVersion: 1
  platform: string
  pluginVersion: string
  /** This process's immutable boot snapshot. */
  active: ActiveShell
  /** The persisted configuration; editable at runtime, effective next boot. */
  configured: { mode: ShellSelectorMode; shell?: ShellId }
  /** Live detection results. */
  detected: DetectedShell[]
  /** True when the current process shell differs from what the next boot composes. */
  restartRequired: boolean
  /** True when the active shell's executable can no longer be found. */
  activeMissing: boolean
  /** True when the configured shell cannot be found on this machine. */
  configuredMissing: boolean
  /** True when the configured shell is inert because another preset is default. */
  gatedByPreset: boolean
  /** The agent preset the next session would compose from, when known. */
  defaultAgentPreset?: string
  /** Settings namespace revision, for save-with-conflict-detection. */
  settingsRevision: number
  writable: boolean
}

/** Save request body. */
export interface SavePayload {
  action: 'save'
  mode: ShellSelectorMode
  shell?: ShellId
  expectedRevision: number
}

/** Re-detect request body. */
export interface DetectPayload {
  action: 'detect'
}

export type ShellSelectorAction = SavePayload | DetectPayload
