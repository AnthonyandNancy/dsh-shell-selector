/**
 * Client-side wire types: the browser mirror of the host endpoint contract.
 *
 * @module dsh-shell-selector/client/types
 */

export type ShellKind = 'bash' | 'pwsh' | 'powershell'
export type ShellSelectorMode = 'default' | 'fallback' | 'explicit'
export type ShellId = ShellKind

export type ShellSource = 'path' | 'git-for-windows' | 'well-known' | 'system'

export interface DetectedShell {
  kind: ShellKind
  name: string
  path?: string
  version?: string
  source?: ShellSource
}

export interface ActiveShell {
  kind: ShellKind
  mode: ShellSelectorMode
  shell?: ShellId
  reason: string
  executable?: string
}

export interface ShellSelectorState {
  schemaVersion: 1
  platform: string
  pluginVersion: string
  active: ActiveShell
  configured: { mode: ShellSelectorMode; shell?: ShellId }
  detected: DetectedShell[]
  restartRequired: boolean
  activeMissing: boolean
  configuredMissing: boolean
  settingsRevision: number
  writable: boolean
}

export interface ApiSuccess<T> {
  ok: true
  value: T
}

export interface ApiFailure {
  ok: false
  error: { code: string; message: string }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
