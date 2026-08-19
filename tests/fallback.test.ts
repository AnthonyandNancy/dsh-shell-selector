/**
 * Fallback-mode tests: the strict bash → pwsh → powershell order on Windows
 * and the mode's inertness on POSIX.
 */

import { describe, expect, it } from 'vitest'
import { resolveEffective, resolvedShellKind, type ShellAvailability } from '../src/resolver.js'

const ALL: ShellAvailability = { bash: true, pwsh: true, powershell: true }
const NONE: ShellAvailability = { bash: false, pwsh: false, powershell: false }

describe('fallback ordering on Windows', () => {
  it('prefers bash over every PowerShell', () => {
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', ALL), 'win32')).toBe('bash')
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', { bash: true, pwsh: true, powershell: false }), 'win32')).toBe('bash')
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', { bash: true, pwsh: false, powershell: true }), 'win32')).toBe('bash')
  })

  it('falls back to pwsh only when bash is absent', () => {
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', { bash: false, pwsh: true, powershell: true }), 'win32')).toBe('pwsh')
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', { bash: false, pwsh: true, powershell: false }), 'win32')).toBe('pwsh')
  })

  it('uses Windows PowerShell only when both bash and pwsh are absent', () => {
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', { bash: false, pwsh: false, powershell: true }), 'win32')).toBe('powershell')
  })

  it('recovers to the platform default when nothing is available (no crash, no wrong shell)', () => {
    expect(resolvedShellKind(resolveEffective({ mode: 'fallback' }, 'win32', NONE), 'win32')).toBe('pwsh')
  })
})

describe('fallback on POSIX', () => {
  it('is inert: the platform rule (bash) applies regardless of availability', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'linux', ALL).reason).toBe('platform-default')
    expect(resolveEffective({ mode: 'fallback' }, 'darwin', NONE).reason).toBe('platform-default')
  })
})

describe('fallback reasons', () => {
  it('labels the fallback path for the UI', () => {
    expect(resolveEffective({ mode: 'fallback' }, 'win32', ALL).reason).toBe('fallback')
    expect(resolveEffective({ mode: 'fallback' }, 'win32', NONE).reason).toBe('fallback-unavailable')
  })
})
