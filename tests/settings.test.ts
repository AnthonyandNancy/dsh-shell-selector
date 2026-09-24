/**
 * Settings tests: allowlists, normalization, the row-config reader, and the
 * schemastery semantics this plugin relies on.
 *
 * DSH 0.1.7-rc.1 projects a plugin's Config into the settings form and only
 * accepts writes to VOLATILE fields, so the volatile marker is part of this
 * plugin's contract with the host — it is asserted here to keep a refactor from
 * silently making the Shell Selector row read-only. A volatile field resolves
 * to a REFERENCE rather than to its value, in `apply()`'s config and in
 * `~standard.validate()`'s output alike — the cases at the end of this file pin
 * that both readers project the value out of the reference.
 */

import { describe, expect, it } from 'vitest'
import {
  Config,
  SHELL_SELECTOR_ENTRY_ID,
  configFromEntry,
  isMode,
  isShellId,
  normalizeConfig,
  validateConfig,
} from '../src/settings.js'
import { volatileRef, volatileRefWithoutReader } from './helpers/volatile-ref.js'

/** The object schema's field table (`schema.dict` in schemastery v3). */
const dictOf = (schema: unknown): Record<string, { meta?: Record<string, unknown> }> =>
  (schema as { dict?: Record<string, { meta?: Record<string, unknown> }> }).dict ?? {}

describe('configuration row', () => {
  it('is addressed by its profile entry id', () => {
    expect(SHELL_SELECTOR_ENTRY_ID).toBe('shell-selector')
  })

  it('marks every field live, or the host settings form could not edit it', () => {
    const dict = dictOf(Config)
    expect(dict['mode']?.meta?.['volatile']).toBe(true)
    expect(dict['shell']?.meta?.['volatile']).toBe(true)
  })
})

describe('allowlists', () => {
  it('accepts only the three shell ids', () => {
    expect(isShellId('bash')).toBe(true)
    expect(isShellId('pwsh')).toBe(true)
    expect(isShellId('powershell')).toBe(true)
    expect(isShellId('cmd')).toBe(false)
    expect(isShellId('sh')).toBe(false)
    expect(isShellId(undefined)).toBe(false)
    expect(isShellId('Bash')).toBe(false)
  })

  it('accepts only the three modes', () => {
    expect(isMode('default')).toBe(true)
    expect(isMode('fallback')).toBe(true)
    expect(isMode('explicit')).toBe(true)
    expect(isMode('auto')).toBe(false)
  })
})

describe('validateConfig', () => {
  it('accepts a valid explicit config', async () => {
    const result = await validateConfig({ mode: 'explicit', shell: 'bash' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ mode: 'explicit', shell: 'bash' })
  })

  it('accepts mode-only configs', async () => {
    expect((await validateConfig({ mode: 'default' })).ok).toBe(true)
    expect((await validateConfig({ mode: 'fallback' })).ok).toBe(true)
  })

  it('rejects unknown shells', async () => {
    const result = await validateConfig({ mode: 'explicit', shell: 'cmd' })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown modes', async () => {
    const result = await validateConfig({ mode: 'auto' })
    expect(result.ok).toBe(false)
  })

  it('rejects non-object payloads', async () => {
    expect((await validateConfig('bash')).ok).toBe(false)
    expect((await validateConfig(null)).ok).toBe(false)
  })
})

describe('configFromEntry', () => {
  it('reads a valid row configuration', () => {
    expect(configFromEntry({ mode: 'explicit', shell: 'pwsh' })).toEqual({ mode: 'explicit', shell: 'pwsh' })
  })

  it('drops a shell the mode does not own', () => {
    expect(configFromEntry({ mode: 'default', shell: 'bash' })).toEqual({ mode: 'default' })
    expect(configFromEntry({ mode: 'fallback', shell: 'bash' })).toEqual({ mode: 'fallback' })
  })

  it('falls back to the default mode on unknown or missing input', () => {
    expect(configFromEntry(undefined)).toEqual({ mode: 'default' })
    expect(configFromEntry(null)).toEqual({ mode: 'default' })
    expect(configFromEntry('bash')).toEqual({ mode: 'default' })
    expect(configFromEntry({ mode: 'auto', shell: 'cmd' })).toEqual({ mode: 'default' })
  })
})

describe('normalizeConfig', () => {
  it('keeps shell only for explicit mode', () => {
    expect(normalizeConfig({ mode: 'explicit', shell: 'pwsh' })).toEqual({ mode: 'explicit', shell: 'pwsh' })
    expect(normalizeConfig({ mode: 'default', shell: 'pwsh' })).toEqual({ mode: 'default' })
    expect(normalizeConfig({ mode: 'fallback', shell: 'bash' })).toEqual({ mode: 'fallback' })
  })

  it('preserves an explicit config without shell (platform fallback at boot)', () => {
    expect(normalizeConfig({ mode: 'explicit' })).toEqual({ mode: 'explicit' })
  })
})

describe('volatile field references', () => {
  it('reads the value out of the reference the Loader delivers', () => {
    expect(configFromEntry({ mode: volatileRef('explicit'), shell: volatileRef('pwsh') })).toEqual({
      mode: 'explicit',
      shell: 'pwsh',
    })
    expect(configFromEntry({ mode: volatileRef('fallback') })).toEqual({ mode: 'fallback' })
  })

  it('treats a reference that carries no value as an absent field', () => {
    expect(configFromEntry({ mode: volatileRef(undefined), shell: volatileRef(undefined) })).toEqual({ mode: 'default' })
    expect(configFromEntry({ mode: volatileRefWithoutReader() })).toEqual({ mode: 'default' })
  })

  it('drops a shell a reference-backed mode does not own', () => {
    expect(configFromEntry({ mode: volatileRef('default'), shell: volatileRef('bash') })).toEqual({ mode: 'default' })
  })

  it('projects validated fields into values a settings write accepts', async () => {
    const result = await validateConfig({ mode: 'explicit', shell: 'pwsh' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ mode: 'explicit', shell: 'pwsh' })
    // dsh-settings refuses a write carrying a function, with the reference's
    // reader as the reported path: `Config $.mode.get contains a function`.
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
  })
})