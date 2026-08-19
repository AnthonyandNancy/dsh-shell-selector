/**
 * Settings schema tests: allowlists, normalization, and the exact
 * schemastery v3 semantics this plugin relies on.
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESETS_SETTINGS_NAMESPACE,
  isMode,
  isShellId,
  normalizeConfig,
  SHELL_SELECTOR_PRESET_ID,
  SHELL_SELECTOR_SETTINGS_NAMESPACE,
  validateConfig,
} from '../src/settings.js'

describe('namespaces', () => {
  it('is a lowercase kebab namespace', () => {
    expect(String(SHELL_SELECTOR_SETTINGS_NAMESPACE)).toBe('shell-selector')
    expect(String(AGENT_PRESETS_SETTINGS_NAMESPACE)).toBe('agent-presets')
  })

  it('names the preset id', () => {
    expect(SHELL_SELECTOR_PRESET_ID).toBe('shell-selector')
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
