/**
 * Regression tests for `router-bootstrap: no platform shell in catalog`.
 *
 * The failure was never a bug in the Agent Router. A router preset picks its
 * platform shell out of the assembled catalog:
 *
 *   const available = new Set(assembled.tools.map((t) => t.name))
 *   const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
 *   if (shell === null) throw new Error(`${name}: no platform shell in catalog`)
 *
 * On Windows the preset exposed `pwsh` only. The old adaptation restricted
 * `pwsh` because the selector said Bash, without ever registering `bash` — so
 * the catalog collapsed to `[]` and the router threw. These tests reproduce that
 * exact router logic and pin the corrected behaviour.
 */

import { describe, expect, it } from 'vitest'
import { adaptAgentShell, reconcileAssembly } from '../src/agent-shell.js'
import { toolsOf, type Rc6PromptAssembly } from '../src/compat/rc6-agent.js'
import { fakeAgentHost } from './helpers/fake-agent-host.js'

/** The real preset's selection logic, copied verbatim in spirit. */
function platformShell(catalog: Set<string>): 'pwsh' | 'bash' {
  const shell = catalog.has('pwsh') ? 'pwsh' : catalog.has('bash') ? 'bash' : null
  if (shell === null) throw new Error('router-bootstrap: no platform shell in catalog')
  return shell
}

function assemblyOf(names: string[]): Rc6PromptAssembly {
  return {
    sections: [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      ...names.map((name) => ({ name: `tool:${name}`, text: `${name.toUpperCase()} GUIDANCE` })),
    ],
    tools: names.map((name) => ({ name, description: `${name} description`, parameters: {} })),
  }
}

describe('router bootstrap regression', () => {
  it('does not leave a shell-capable agent without a platform shell', async () => {
    // The exact reported shape: a Windows preset exposing pwsh only, with the
    // Shell Selector resolved to Bash.
    const host = fakeAgentHost({ inherited: ['pwsh', 'str_replace_editor'] })
    expect(host.visible().has('bash')).toBe(false)
    expect(host.visible().has('pwsh')).toBe(true)

    await adaptAgentShell(host.agent, 'bash', { loadToolPlugin: host.loadToolPlugin })

    const catalog = host.visible()
    expect(catalog.has('bash') || catalog.has('pwsh')).toBe(true)
    expect(() => platformShell(catalog)).not.toThrow()
    expect(platformShell(catalog)).toBe('bash')
  })

  it('gives the router the corrected catalog through the reconciled assembly', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh', 'str_replace_editor'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })

    // A stale snapshot, as rc.6 would hand a listener that entered while the
    // mount was still in flight: it still says "pwsh only".
    const stale = assemblyOf(['pwsh', 'str_replace_editor'])
    const reconciled = reconcileAssembly(stale, outcome, toolsOf(host.agent.ctx)!, host.agent)

    const catalog = new Set(reconciled.tools.map((tool) => tool.name))
    expect(() => platformShell(catalog)).not.toThrow()
    expect(platformShell(catalog)).toBe('bash')
    expect(catalog.has('pwsh')).toBe(false)
  })

  it.each([
    { inherited: ['pwsh'], active: 'bash' as const, expected: 'bash' },
    { inherited: ['bash'], active: 'pwsh' as const, expected: 'pwsh' },
    { inherited: ['bash'], active: 'powershell' as const, expected: 'pwsh' },
    { inherited: ['bash', 'pwsh'], active: 'bash' as const, expected: 'bash' },
    { inherited: ['bash', 'pwsh'], active: 'pwsh' as const, expected: 'pwsh' },
  ])(
    'router finds $expected for preset $inherited with selector $active',
    async ({ inherited, active, expected }) => {
      const host = fakeAgentHost({ inherited })
      await adaptAgentShell(host.agent, active, { loadToolPlugin: host.loadToolPlugin })
      expect(platformShell(host.visible())).toBe(expected)
    },
  )

  it('a failed adaptation does not degrade into "no platform shell in catalog"', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], mountFails: true })
    await expect(
      adaptAgentShell(host.agent, 'bash', { loadToolPlugin: host.loadToolPlugin }),
    ).rejects.toThrow(/failed to adapt agent shell to bash/)

    // The opposite was never restricted, so even in the failure case the
    // catalog still satisfies the router's precondition.
    expect(() => platformShell(host.visible())).not.toThrow()
    expect(platformShell(host.visible())).toBe('pwsh')
  })

  it('a no-shell preset is not given a shell to satisfy a router', async () => {
    const host = fakeAgentHost({ inherited: ['read', 'write', 'edit'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })
    expect(outcome.kind).toBe('noop-no-capability')
    // Such a preset is simply not shell-capable; the selector must not paper
    // over that by escalating its permissions.
    expect(() => platformShell(host.visible())).toThrow(/no platform shell in catalog/)
  })
})
