/**
 * The probe that reports which shell the host ACTUALLY composed.
 *
 * `ctx.shell` is a single-implementation service: exactly one of
 * `@deepseek-ai/dsh-bash-sandbox` and `@deepseek-ai/dsh-pwsh-sandbox` provides
 * it. Which one won is a fact about the composition, and it can contradict what
 * the plugin's own configuration predicted (for example when this plugin's
 * bundle patch never loaded because the package is not registered in
 * `dsh.profile.bundles`).
 *
 * The plugin must adapt to the composed shell, so this module reads the service
 * rather than re-deriving a decision from configuration.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { detectComposedShell } from '../src/compat/executor-probe.js'

/** Stand-in for `@deepseek-ai/dsh-pwsh-sandbox`'s `SandboxPwshExecutor`. */
class SandboxPwshExecutor {
  get pwshPath(): string {
    return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  }
}

/** Stand-in for `@deepseek-ai/dsh-pwsh-local`'s `PwshLocalExecutor`. */
class PwshLocalExecutor {
  get pwshPath(): string {
    return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  }
}

/** Stand-in for `@deepseek-ai/dsh-bash-sandbox`'s `SandboxBashExecutor`. */
class SandboxBashExecutor {
  readonly shell = 'bash'
}

/** A context carrying only what the probe reads. */
function ctxWith(shell: unknown): Context {
  return { shell } as unknown as Context
}

describe('detectComposedShell', () => {
  it('reports bash for the bash executor', () => {
    expect(detectComposedShell(ctxWith(new SandboxBashExecutor()))).toBe('bash')
  })

  it('reports pwsh for the PowerShell 7 executor', () => {
    expect(detectComposedShell(ctxWith(new SandboxPwshExecutor()))).toBe('pwsh')
  })

  it('reports powershell when the pwsh executor is pinned to powershell.exe', () => {
    // PowerShell 7 and Windows PowerShell share ONE executor class and ONE
    // model-facing tool; only the resolved executable tells them apart.
    expect(detectComposedShell(ctxWith(new PwshLocalExecutor()))).toBe('powershell')
  })

  it('reports undefined when no shell service is composed', () => {
    expect(detectComposedShell(ctxWith(undefined))).toBeUndefined()
  })

  it('reports undefined for an unrecognised provider instead of guessing', () => {
    // A wrong guess is what produced `tool-pwsh ... waiting for shell`.
    expect(detectComposedShell(ctxWith({ constructor: { name: 'SomethingElse' } }))).toBeUndefined()
  })

  it('reports pwsh when the pwshPath getter throws', () => {
    // `pwshPath` is a getter that resolves the executable; it must never turn a
    // working executor into "unknown" just because resolution failed. The class
    // name is the RECOGNISED one on purpose: an unknown name must stay unknown
    // (previous case), so an unrecognised stand-in would never reach the getter
    // and could not test the swallow.
    class SandboxPwshExecutor {
      get pwshPath(): string {
        throw new Error('cannot resolve pwsh')
      }
    }
    expect(detectComposedShell(ctxWith(new SandboxPwshExecutor()))).toBe('pwsh')
  })

  it('reports bash for a bare object never produced by the host', () => {
    // Defensive: an object with bash's class name still counts as bash.
    const fake = Object.create({ constructor: { name: 'SandboxBashExecutor' } }) as object
    expect(detectComposedShell(ctxWith(fake))).toBe('bash')
  })
})
