/**
 * restartRequired semantics: the comparison is on the RESOLVED shell, so
 * configuration wording changes that keep the same shell need no restart,
 * and availability shifts can force one.
 */

import { describe, expect, it } from 'vitest'
import { resolveEffective, restartRequired, type ShellAvailability } from '../src/resolver.js'

const ALL: ShellAvailability = { bash: true, pwsh: true, powershell: true }
const NONE: ShellAvailability = { bash: false, pwsh: false, powershell: false }
const ONLY_PWSH: ShellAvailability = { bash: false, pwsh: true, powershell: false }

describe('restartRequired — no-op configurations', () => {
  it('same mode, same shell', () => {
    expect(restartRequired(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL), { mode: 'explicit', shell: 'bash' }, 'win32', ALL)).toBe(false)
  })

  it('default → default', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', ALL), { mode: 'default' }, 'win32', ALL)).toBe(false)
  })

  it('default (pwsh) → explicit pwsh: same resolved shell, no restart', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', ONLY_PWSH), { mode: 'explicit', shell: 'pwsh' }, 'win32', ONLY_PWSH)).toBe(false)
  })

  it('explicit pwsh → fallback with pwsh first missing but powershell present: both resolve pwsh on win32', () => {
    // booted: explicit pwsh (available). configured: fallback; bash absent, pwsh present → pwsh.
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'pwsh' }, 'win32', ONLY_PWSH),
        { mode: 'fallback' },
        'win32',
        { bash: false, pwsh: true, powershell: true },
      ),
    ).toBe(false)
  })

  it('explicit bash → default on POSIX: both bash', () => {
    expect(
      restartRequired(resolveEffective({ mode: 'explicit', shell: 'bash' }, 'linux', ALL), { mode: 'default' }, 'linux', ALL),
    ).toBe(false)
  })
})

describe('restartRequired — real changes', () => {
  it('pwsh → bash', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', ALL), { mode: 'explicit', shell: 'bash' }, 'win32', ALL)).toBe(true)
  })

  it('bash → powershell', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL),
        { mode: 'explicit', shell: 'powershell' },
        'win32',
        ALL,
      ),
    ).toBe(true)
  })

  it('default (pwsh) → fallback resolving bash', () => {
    expect(
      restartRequired(resolveEffective({ mode: 'default' }, 'win32', ONLY_PWSH), { mode: 'fallback' }, 'win32', ALL),
    ).toBe(true)
  })
})

describe('restartRequired — availability shifts', () => {
  it('configured bash vanished: next boot recovers to platform (pwsh) — restart changes the shell', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL),
        { mode: 'explicit', shell: 'bash' },
        'win32',
        NONE,
      ),
    ).toBe(true)
  })

  it('no availability anywhere on win32: every decision resolves to platform → default stays default', () => {
    expect(restartRequired(resolveEffective({ mode: 'default' }, 'win32', NONE), { mode: 'default' }, 'win32', NONE)).toBe(false)
  })
})

describe('restartRequired — gating', () => {
  it('gated by another preset: override decisions are inert, boot was already gated → no restart', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL, true),
        { mode: 'explicit', shell: 'pwsh' },
        'win32',
        ALL,
        true,
      ),
    ).toBe(false)
  })

  it('gated now but not at boot: next boot differs → restart required', () => {
    expect(
      restartRequired(
        resolveEffective({ mode: 'explicit', shell: 'bash' }, 'win32', ALL, false),
        { mode: 'explicit', shell: 'bash' },
        'win32',
        ALL,
        true,
      ),
    ).toBe(true)
  })
})
