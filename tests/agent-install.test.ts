/**
 * Lifecycle wiring tests for the agent adaptation.
 *
 * Two rc.6 behaviours make the barrier necessary, both verified against the
 * installed runtime:
 *
 *  - `agent/created` dispatches through a fire-and-forget `emit`, so a rejected
 *    async listener is only logged — it cannot fail agent creation by itself;
 *  - `system-prompt/assemble` is an AWAITED, scope-filtered waterfall that runs
 *    before every model request and produces both the tool schema and the
 *    prompt, so it is the correct enforcement point.
 *
 * These tests drive the installer through a fake event surface and assert that
 * no agent can reach a model request with an unadapted or mis-adapted shell.
 */

import { describe, expect, it, vi } from 'vitest'
import { installAgentShellAdaptation } from '../src/agent/install.js'
import { ShellSelectorAgentAdaptationError } from '../src/agent-shell.js'
import type { Rc6PromptAssembly } from '../src/compat/rc6-agent.js'
import { fakeAgentHost, type FakeHost } from './helpers/fake-agent-host.js'

type AssembleListener = (
  assembly: Rc6PromptAssembly,
  context: unknown,
  next: () => Promise<Rc6PromptAssembly>,
) => Promise<Rc6PromptAssembly>

/** A fake plugin context that records the lifecycle listeners installed on it. */
function fakeHostCtx() {
  const created: Array<(payload: { agent: unknown }) => void> = []
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ctx = {
    logger,
    on: (event: string, listener: (payload: { agent: unknown }) => void) => {
      if (event === 'agent/created') created.push(listener)
      return () => {}
    },
  }
  return { ctx, created, logger }
}

/** Attach the installer to a fake agent and return that agent's barrier. */
function announce(host: FakeHost, active: 'bash' | 'pwsh' | 'powershell') {
  const { ctx, created, logger } = fakeHostCtx()
  const barriers: AssembleListener[] = []
  const agentCtx = host.agent.ctx as unknown as { on?: unknown }
  agentCtx.on = (event: string, listener: AssembleListener) => {
    if (event === 'system-prompt/assemble') barriers.push(listener)
    return () => {}
  }

  installAgentShellAdaptation(ctx as never, active, { loadToolPlugin: host.loadToolPlugin })
  for (const listener of created) listener({ agent: host.agent })
  return { barriers, logger }
}

const assembly = (names: string[]): Rc6PromptAssembly => ({
  sections: names.map((name) => ({ name: `tool:${name}`, text: `${name.toUpperCase()} GUIDANCE` })),
  tools: names.map((name) => ({ name, description: `${name} desc`, parameters: {} })),
})

describe('installAgentShellAdaptation', () => {
  it('registers a prompt-assembly barrier on the agent scope', () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { barriers } = announce(host, 'bash')
    expect(barriers).toHaveLength(1)
  })

  it('completes the adaptation before the assembly the model request is built from', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { barriers } = announce(host, 'bash')

    // Enter the barrier IMMEDIATELY, i.e. worst case: the mount is still in
    // flight. The barrier must still hand back an adapted surface.
    const stale = assembly(['pwsh'])
    const result = await barriers[0]!(stale, {}, async () => stale)

    expect(host.visible()).toEqual(new Set(['bash']))
    expect(result.tools.map((tool) => tool.name)).toEqual(['bash'])
    // The mismatched guidance is gone. The target's own guidance is contributed
    // by the official plugin's section and appears from the next assembly on; a
    // snapshot taken before the mount cannot contain it. What matters is that
    // the model is never shown guidance for a shell it does not have.
    expect(result.sections.map((section) => section.name)).not.toContain('tool:pwsh')
  })

  it('carries the target guidance once the assembly postdates the mount', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { barriers } = announce(host, 'bash')
    const stale = assembly(['pwsh'])
    await barriers[0]!(stale, {}, async () => stale)

    // The steady state: every later assembly sees both the mounted tool and its
    // section, and the barrier only has to drop the opposite.
    const fresh = assembly(['bash', 'pwsh'])
    const result = await barriers[0]!(fresh, {}, async () => fresh)
    expect(result.tools.map((tool) => tool.name)).toEqual(['bash'])
    expect(result.sections.map((section) => section.name)).toEqual(['tool:bash'])
  })

  it('throws the adaptation error at the barrier, before any model request', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], mountFails: true })
    const { barriers } = announce(host, 'bash')
    const next = vi.fn(async () => assembly(['pwsh']))

    await expect(barriers[0]!(assembly(['pwsh']), {}, next)).rejects.toThrow(
      ShellSelectorAgentAdaptationError,
    )
    // The prompt was never completed, so no request could be issued...
    expect(next).not.toHaveBeenCalled()
    // ...and the failure did not strip the agent's working shell.
    expect(host.visible()).toEqual(new Set(['pwsh']))
  })

  it('does not swallow the failure into a warning and carry on', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], mountFails: true })
    const { barriers, logger } = announce(host, 'bash')
    await barriers[0]!(assembly(['pwsh']), {}, async () => assembly(['pwsh'])).catch(() => {})
    // The old behaviour logged a warning and let the agent run anyway.
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('passes a no-capability agent straight through', async () => {
    const host = fakeAgentHost({ inherited: ['read', 'write'] })
    const { barriers } = announce(host, 'bash')
    const original = assembly(['read', 'write'])
    const result = await barriers[0]!(original, {}, async () => original)
    expect(result).toBe(original)
    expect(host.visible()).toEqual(new Set(['read', 'write']))
  })

  it('returns the host assembly untouched for a dialect mismatch', async () => {
    // The composed executor is pwsh but the adapter was told bash: it must
    // perform zero changes AND leave the two-tool assembly exactly as the host
    // produced it, including the pwsh guidance the mismatch guard protects.
    const host = fakeAgentHost({ inherited: ['bash', 'pwsh'] })
    ;(host.agent.ctx as unknown as Record<string, unknown>)['shell'] = Object.create({
      constructor: { name: 'SandboxPwshExecutor' },
      pwshPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    })
    const { barriers } = announce(host, 'bash')

    const hostAssembly = assembly(['bash', 'pwsh'])
    const next = vi.fn(async () => hostAssembly)
    const result = await barriers[0]!(assembly([]), {}, next)

    expect(result).toBe(hostAssembly)
    expect(host.mounted).toEqual([])
    expect(host.restrictions).toEqual([])
    expect(host.shadowedSections).toEqual([])
  })

  it('is idempotent across repeated assemblies (one adaptation per agent)', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { barriers } = announce(host, 'bash')
    const stale = assembly(['pwsh'])
    await barriers[0]!(stale, {}, async () => stale)
    await barriers[0]!(stale, {}, async () => stale)
    await barriers[0]!(stale, {}, async () => stale)
    // The official plugin was mounted exactly once, not once per step.
    expect(host.loadToolPlugin).toHaveBeenCalledTimes(1)
    expect(host.mounted).toEqual(['bash'])
    expect(host.restrictions).toHaveLength(1)
  })

  it('resolves the active kind when an agent is created, after a late correction', async () => {
    // On a healthy boot this plugin's row loads BEFORE the executor rows, so
    // the composed shell is still unknown at install time. The one-time
    // correction lands before any agent is created; the adapter must use it,
    // not the prediction captured when the plugin loaded.
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { ctx, created } = fakeHostCtx()
    const bars: AssembleListener[] = []
    ;(host.agent.ctx as unknown as { on?: unknown }).on = (event: string, listener: AssembleListener) => {
      if (event === 'system-prompt/assemble') bars.push(listener)
      return () => {}
    }
    let corrected = false
    const activeKind = (): 'bash' => {
      // Reading at install time would freeze the pre-correction prediction.
      if (!corrected) throw new Error('active kind read before the boot facts were corrected')
      return 'bash'
    }
    installAgentShellAdaptation(ctx as never, activeKind as never, { loadToolPlugin: host.loadToolPlugin })

    // The executor row activates and the boot facts are corrected before the
    // agent exists.
    corrected = true
    for (const listener of created) listener({ agent: host.agent })
    await bars[0]!(assembly(['pwsh']), {}, async () => assembly(['pwsh']))

    // It adapted to the CORRECTED kind: bash mounted, pwsh removed.
    expect(host.mounted).toEqual(['bash'])
    expect(host.visible()).toEqual(new Set(['bash']))
  })
})
