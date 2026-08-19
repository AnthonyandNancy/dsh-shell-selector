/**
 * The `shell-selector` settings namespace.
 *
 * The namespace is registered host-side only; it is intentionally absent from
 * the Web client's settings exposure whitelist, so the browser reads and
 * writes it through this plugin's own HTTP endpoint (`./web.ts`), never
 * through the settings RPC.
 *
 * @module dsh-shell-selector/settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ShellId, ShellSelectorMode } from './resolver.js'

/** The settings namespace (lowercase kebab, per `settingsNamespace()`). */
export const SHELL_SELECTOR_SETTINGS_NAMESPACE = settingsNamespace('shell-selector')

/**
 * Schemastery schema for the namespace. Note the v3 API: fields are optional
 * unless `.required()` is set, `undefined` values are dropped, and there is
 * no `.parse()` — validation goes through the Standard Schema
 * `~standard.validate` surface.
 */
export const ShellSelectorSchema = z.object({
  mode: z.union(['default', 'fallback', 'explicit']).default('default'),
  shell: z.union(['bash', 'pwsh', 'powershell']),
})

/** The persisted configuration value. */
export interface ShellSelectorSettings {
  mode: ShellSelectorMode
  shell?: ShellId
}

/** Validation outcome. */
export type ValidationResult =
  | { ok: true; value: ShellSelectorSettings }
  | { ok: false; issues: string[] }

/**
 * Validate an unknown payload against the namespace schema. Schemastery v3
 * implements the Standard Schema interface; validation may be async. The
 * non-object guard exists because schemastery's object schema maps `null`
 * to the empty value — the endpoint contract must reject that instead of
 * silently writing the defaults.
 */
export async function validateConfig(input: unknown): Promise<ValidationResult> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: ['expected an object with mode/shell'] }
  }
  const result = await ShellSelectorSchema['~standard'].validate(input)
  if (typeof result === 'object' && result !== null && Array.isArray((result as { issues?: unknown }).issues)) {
    const issues = (result as { issues: readonly { message: string }[] }).issues
    return { ok: false, issues: issues.map((issue) => issue.message) }
  }
  return { ok: true, value: (result as { value: ShellSelectorSettings }).value }
}

/**
 * Normalize a validated configuration: `shell` only survives when mode is
 * `explicit`.
 */
export function normalizeConfig(input: ShellSelectorSettings): ShellSelectorSettings {
  if (input.mode !== 'explicit') {
    return { mode: input.mode }
  }
  return { mode: input.mode, ...(input.shell === undefined ? {} : { shell: input.shell }) }
}

/** Validate one shell id against the allowlist. */
export function isShellId(value: unknown): value is ShellId {
  return value === 'bash' || value === 'pwsh' || value === 'powershell'
}

/** Validate one mode against the allowlist. */
export function isMode(value: unknown): value is ShellSelectorMode {
  return value === 'default' || value === 'fallback' || value === 'explicit'
}
