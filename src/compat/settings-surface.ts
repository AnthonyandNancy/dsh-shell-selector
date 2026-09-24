/**
 * The host `ctx.settings` surface this plugin uses, isolated from the package.
 *
 * DSH 0.1.7-rc.1 reshaped settings around Config projections: `SettingsForms`
 * (formerly `SettingsProvider`) is keyed by PROFILE ENTRY ID rather than by a
 * registered namespace, `describe()` reports one row per configurable entry,
 * and a form write only touches VOLATILE fields of that entry's Config. The
 * `settingsNamespace()` brand and `register()` are gone, so the plugin reads
 * and writes through this smallest possible surface and never imports the
 * package: a runtime upgrade cannot break the plugin's module graph again.
 *
 * @module dsh-shell-selector/compat/settings-surface
 */

import type { Context } from '@deepseek-ai/cordis'

/** One configurable entry as `describe()` reports it. */
export interface SettingsEntryDescriptor {
  /** Profile entry id — the row id in `cordis.patch.yml`. */
  ns: string
  /** Revision for save-with-conflict-detection. */
  revision: number
}

/** The settings service, narrowed to what this plugin uses. */
export interface SettingsSurface {
  describe(): readonly SettingsEntryDescriptor[]
  /** Reset the entry's live fields to the supplied ones; absent keys re-inherit. */
  replace(ns: string, section: unknown, expectedRevision?: number): Promise<void>
  /** Whether the active profile accepts form edits. */
  readonly writable?: boolean
}

/** Read `ctx.settings`, or `undefined` when no settings service is composed. */
export function settingsOf(ctx: Context): SettingsSurface | undefined {
  const service = (ctx as Context & { settings?: unknown }).settings
  if (service === null || typeof service !== 'object') return undefined
  const candidate = service as Partial<SettingsSurface>
  if (typeof candidate.describe !== 'function' || typeof candidate.replace !== 'function') return undefined
  return service as SettingsSurface
}