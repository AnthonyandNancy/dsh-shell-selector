/**
 * Resolver unit tests: the pure decision logic shared by the boot expressions
 * and the host runtime.
 */

import { describe, expect, it } from 'vitest'
import { decisionsEqual, platformDefaultKind, resolveEffective, resolvedShellKind, restartRequired, type ShellAvailability } from '../src/resolver.js'

const ALL: ShellAvailability = { bash: true, pwsh: true, powershell: true }
const NONE: ShellAvailability = { bash: false, pwsh: false, powershell: false }
const ONLY_BASH: ShellAvailability = { bash: true, pwsh: false, powershell: false }
const ONLY_PWSH: ShellAvailability = { bash: false, pwsh: true, powershell: false }
const ONLY_POWERSHELL: ShellAvailability = { bash: false, pwsh: false, powershell: true }

describe('platform defaults', () => {
  it('Windows defaults to the PowerShell family', () => {
    expect(platformDefaultKind('win32')).toBe('pwsh')
  })

  it('POSIX defaults to Bash', () => {
    expect(platformDefaultKind('linux')).toBe('bash')
    expect(platformDefaultKind('darwin')).toBe('bash')
  })
})

describe('mode=default', () => {
  it('always resolves to the platform rule regardless of availability', () => {
    expect(resolveEffective({ mode: 'default' }, 'win32', ALL)).toEqual({ kind: 'platform', reason: 'platform-default' })
    expect(resolveEffective({ mode: 'default' }, 'linux', NONE)).toEqual({ kind: 'platform', reason: 'platform-default' })
  })
})

describe('mode=fallback (Windows)', () => {
  it('picks bash first in the strict order', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'win32', ALL)).toEqual({ kind: 'bash', reason: 'fallback' })
    expect(resolveEffective({ mode: 'fallback' }, 'win32', ONLY_BASH)).toEqual({ kind: 'bash', reason: 'fallback' })
  })

  it('falls back to pwsh when bash is missing', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'win32', ONLY_PWSH)).toEqual({ kind: 'pwsh', reason: 'fallback' })
  })

  it('falls back to Windows PowerShell when bash and pwsh are missing', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'win32', ONLY_POWERSHELL)).toEqual({ kind: 'powershell', reason: 'fallback' })
  })

  it('recovers to the platform rule when nothing is available', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'win32', NONE)).toEqual({ kind: 'platform', reason: 'fallback-unavailable' })
  })

  it('is inert on POSIX (treats as platform rule)', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'linux', ALL)).toEqual({ kind: 'platform', reason: 'platform-default' })
  })
})

describe('mode=explicit', () => {
  it('honors an available explicit choice', () => {
    expect(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ONLY_BASH)).toEqual({
      kind: 'bash',
      reason: 'explicit',
      shell: 'bash',
    })
    expect(resolveEffective({ mode: 'explicit', shell: 'pwsh' }, 'win32', ONLY_PWSH)).toEqual({
      kind: 'pwsh',
      reason: 'explicit',
      shell: 'pwsh',
    })
    expect(resolveEffective({ mode: 'explicit', shell: 'powershell' }, 'win32', ONLY_POWERSHELL)).toEqual({
      kind: 'powershell',
      reason: 'explicit',
      shell: 'powershell',
    })
  })

  it('never falls back to another shell when the explicit choice is missing', () => {
    expect(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ONLY_PWSH)).toEqual({
      kind: 'platform',
      reason: 'explicit-unavailable',
      shell: 'bash',
    })
  })

  it('supports explicit bash on POSIX', () => {
    expect(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'linux', { bash: true, pwsh: false, powershell: false })).toEqual({
      kind: 'bash',
      reason: 'explicit',
      shell: 'bash',
    })
  })

  it('does not support explicit PowerShell on POSIX in v1', () => {
    expect(resolveEffective({ mode: 'explicit', shell: 'pwsh' }, 'linux', ALL)).toEqual({ kind: 'platform', reason: 'platform-default' })
  })

  it('rejects an empty explicit choice as platform', () => {
    expect(resolveEffective({ mode: 'explicit' }, 'win32', ALL)).toEqual({ kind: 'platform', reason: 'platform-default' })
  })
})

describe('gating by agent preset', () => {
  it('makes any override inert when another preset is the default', () => {
    expect(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ONLY_BASH, true)).toEqual({
      kind: 'platform',
      reason: 'gated-by-preset',
    })
  })
})

describe('resolvedShellKind', () => {
  it('resolves the platform rule to the actual shell', () => {
    expect(resolvedShellKind({ kind: 'platform', reason: 'platform-default' }, 'win32')).toBe('pwsh')
    expect(resolvedShellKind({ kind: 'platform', reason: 'platform-default' }, 'linux')).toBe('bash')
    expect(resolvedShellKind({ kind: 'bash', reason: 'explicit' }, 'win32')).toBe('bash')
  })
})

describe('decisionsEqual (semantic, not string)', () => {
  it('treats platform-default and explicit pwsh as the same on Windows', () => {
    const booted = resolveEffective({ mode: 'default' }, 'win32', ONLY_PWSH)
    const configured = resolveEffective({ mode: 'explicit', shell: 'pwsh' }, 'win32', ONLY_PWSH)
    expect(resolvedShellKind(booted, 'win32')).toBe('pwsh')
    expect(resolvedShellKind(configured, 'win32')).toBe('pwsh')
    expect(decisionsEqual(booted, configured, 'win32')).toBe(true)
  })

  it('treats explicit bash as different from explicit pwsh', () => {
    expect(
      decisionsEqual(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL),
        resolveEffective({ mode: 'explicit', shell: 'pwsh' }, 'win32', ALL),
        'win32',
      ),
    ).toBe(false)
  })
})

describe('restartRequired', () => {
  it('is false when nothing changed', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', ONLY_PWSH), { mode: 'default' }, 'win32', ONLY_PWSH)).toBe(false)
  })

  it('is false for default → explicit pwsh on Windows (same resolved shell)', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'default' }, 'win32', ONLY_PWSH),
        { mode: 'explicit', shell: 'pwsh' },
        'win32',
        ONLY_PWSH,
      ),
    ).toBe(false)
  })

  it('is true for pwsh → bash', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'default' }, 'win32', ALL),
        { mode: 'explicit', shell: 'bash' },
        'win32',
        ALL,
      ),
    ).toBe(true)
  })

  it('is true when the configured shell disappeared (the next boot recovers to a different shell)', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ONLY_BASH),
        { mode: 'explicit', shell: 'bash' },
        'win32',
        NONE,
      ),
    ).toBe(true)
  })

  it('is false for default → default even when gated', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', ALL), { mode: 'default' }, 'win32', ALL, true)).toBe(false)
  })
})
