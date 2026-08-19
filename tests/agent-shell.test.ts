/**
 * Agent-scoped Shell Tool adaptation tests.
 *
 * These encode the one rule the plugin exists to enforce:
 *
 *   **Preset determines WHETHER. Selector determines WHICH.**
 *
 * The predecessor of this file asserted that a Windows agent exposing only
 * `pwsh` should end up with `pwsh` restricted while `bash` was never
 * registered — a zero-shell agent, which is precisely the defect that produced
 * `router-bootstrap: no platform shell in catalog`. That expectation is gone;
 * the full state table below replaces it.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  activeShellTool,
  adaptAgentShell,
  inspectShellCapability,
  oppositeShellTool,
  ShellSelectorAgentAdaptationError,
  verifyAgentShell,
  type AgentLike,
} from '../src/agent-shell.js'
import { toolsOf } from '../src/compat/rc6-agent.js'
import { fakeAgentHost, type FakeHost } from './helpers/fake-agent-host.js'

/** Sugar: adapt and return the resulting visible catalog. */
async function adapt(host: FakeHost, active: Parameters<typeof adaptAgentShell>[1]) {
  const outcome = await adaptAgentShell(host.agent, active, { loadToolPlugin: host.loadToolPlugin })
  return { outcome, visible: host.visible() }
}

describe('activeShellTool / oppositeShellTool', () => {
  it('maps bash to the bash tool and every PowerShell kind to the single pwsh tool', () => {
    // PowerShell 7 and Windows PowerShell share ONE model-facing tool; the
    // difference lives in the host executor, not in a second tool name.
    expect(activeShellTool('bash')).toBe('bash')
    expect(activeShellTool('pwsh')).toBe('pwsh')
    expect(activeShellTool('powershell')).toBe('pwsh')
  })

  it('pairs each target with the other dialect', () => {
    expect(oppositeShellTool('bash')).toBe('pwsh')
    expect(oppositeShellTool('pwsh')).toBe('bash')
  })
})

describe('inspectShellCapability', () => {
  it('reports the preset grant read BEFORE any modification', () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const tools = toolsOf(host.agent.ctx)
    expect(tools).toBeDefined()
    expect(inspectShellCapability(tools!, host.agent)).toEqual({
      hadBash: false,
      hadPwsh: true,
      shellCapable: true,
    })
  })

  it('reports no capability for a preset with neither shell tool', () => {
    const host = fakeAgentHost({ inherited: ['read', 'write', 'edit'] })
    const tools = toolsOf(host.agent.ctx)
    expect(inspectShellCapability(tools!, host.agent)).toEqual({
      hadBash: false,
      hadPwsh: false,
      shellCapable: false,
    })
  })
})

// ── The complete state table from the specification (cases A-G) ──
describe('adaptAgentShell state table', () => {
  it('A. no shell + Bash selector → still no shell (never grants capability)', async () => {
    const host = fakeAgentHost({ inherited: ['read', 'write', 'edit'] })
    const { outcome, visible } = await adapt(host, 'bash')
    expect(outcome.kind).toBe('noop-no-capability')
    expect(visible.has('bash')).toBe(false)
    expect(visible.has('pwsh')).toBe(false)
    expect(host.mounted).toEqual([])
    expect(host.restrictions).toEqual([])
  })

  it('B. pwsh-only + Bash selector → bash-only (the router-bootstrap case)', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { outcome, visible } = await adapt(host, 'bash')
    expect(outcome.kind).toBe('adapted')
    expect(visible.has('bash')).toBe(true)
    expect(visible.has('pwsh')).toBe(false)
  })

  it('C. bash-only + Bash selector → bash-only', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const { visible } = await adapt(host, 'bash')
    expect(visible.has('bash')).toBe(true)
    expect(visible.has('pwsh')).toBe(false)
  })

  it('D. both + Bash selector → bash-only', async () => {
    const host = fakeAgentHost({ inherited: ['bash', 'pwsh'] })
    const { visible } = await adapt(host, 'bash')
    expect(visible.has('bash')).toBe(true)
    expect(visible.has('pwsh')).toBe(false)
  })

  it('E. bash-only + PowerShell selector → pwsh-only', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const { visible } = await adapt(host, 'pwsh')
    expect(visible.has('pwsh')).toBe(true)
    expect(visible.has('bash')).toBe(false)
  })

  it('F. pwsh-only + PowerShell selector → pwsh-only', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const { visible } = await adapt(host, 'pwsh')
    expect(visible.has('pwsh')).toBe(true)
    expect(visible.has('bash')).toBe(false)
  })

  it('G. both + PowerShell selector → pwsh-only', async () => {
    const host = fakeAgentHost({ inherited: ['bash', 'pwsh'] })
    const { visible } = await adapt(host, 'pwsh')
    expect(visible.has('pwsh')).toBe(true)
    expect(visible.has('bash')).toBe(false)
  })

  it('treats Windows PowerShell exactly like PowerShell 7 (one pwsh tool)', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const { visible } = await adapt(host, 'powershell')
    expect(visible.has('pwsh')).toBe(true)
    expect(visible.has('bash')).toBe(false)
    // No second, invented model-facing "powershell" tool.
    expect([...visible]).not.toContain('powershell')
  })
})

describe('adaptAgentShell mechanics', () => {
  it('does not register the target again when it is already correct', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const { outcome } = await adapt(host, 'bash')
    expect(outcome.kind === 'adapted' && outcome.mountedTarget).toBe(false)
    expect(host.mounted).toEqual([])
    expect(host.loadToolPlugin).not.toHaveBeenCalled()
  })

  it('mounts the official target package on the agent scope, not the root', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adapt(host, 'bash')
    expect(host.loadToolPlugin).toHaveBeenCalledWith('bash')
    expect(host.mounted).toEqual(['bash'])
    expect(host.mountedOnAgentScope).toEqual([true])
    // Nothing leaked into the shared/global layer.
    expect(host.globalVisible()).toEqual(new Set())
  })

  it('ADDS BEFORE REMOVING: the target is registered before the opposite is denied', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adapt(host, 'bash')
    expect(host.order).toEqual(['mount:bash', 'restrict:pwsh', 'shadow:tool:pwsh'])
  })

  it('never lets the catalog pass through an empty state', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adapt(host, 'bash')
    // Recorded after every mutation, including intermediate states.
    for (const snapshot of host.catalogTimeline) {
      expect(snapshot.length, `empty catalog at step ${snapshot.join()}`).toBeGreaterThan(0)
    }
  })

  it('shadows the opposite prompt section by identity, not by rewriting prose', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adapt(host, 'bash')
    expect(host.shadowedSections).toEqual([{ name: 'tool:pwsh', order: 105, text: '' }])
  })

  it('is a no-op when the host composes no tool runtime', async () => {
    const agent = { ctx: {} } as unknown as AgentLike
    await expect(adaptAgentShell(agent, 'bash')).resolves.toEqual({ kind: 'noop-no-capability' })
  })

  it('never consults preset names', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], presetName: 'standard' })
    await adapt(host, 'bash')
    for (const call of host.loadToolPlugin.mock.calls) {
      expect(call).not.toContain('standard')
    }
    expect(host.inspectedPresetNames).toEqual([])
  })
})

describe('adaptAgentShell is transactional', () => {
  it('rolls back and reports clearly when the target cannot be registered', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], mountFails: true })
    await expect(adaptAgentShell(host.agent, 'bash', { loadToolPlugin: host.loadToolPlugin })).rejects.toThrow(
      ShellSelectorAgentAdaptationError,
    )
    // The critical guarantee: the opposite was NEVER restricted, so the agent
    // still has a working shell instead of none.
    expect(host.restrictions).toEqual([])
    expect(host.visible().has('pwsh')).toBe(true)
    expect(host.shadowedSections).toEqual([])
  })

  it('names the target tool and the real cause in the error message', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], mountFails: true })
    const error = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    }).catch((caught: unknown) => caught as ShellSelectorAgentAdaptationError)
    expect(error).toBeInstanceOf(ShellSelectorAgentAdaptationError)
    expect(error.message).toContain('dsh-shell-selector')
    expect(error.message).toContain('bash')
    expect(error.message).toContain('could not be registered')
    // Never the downstream, second-order symptom.
    expect(error.message).not.toContain('no platform shell in catalog')
  })

  it('reports clearly when the official package cannot be loaded', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'], loadFails: true })
    const error = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    }).catch((caught: unknown) => caught as ShellSelectorAgentAdaptationError)
    expect(error).toBeInstanceOf(ShellSelectorAgentAdaptationError)
    expect(error.message).toContain('@deepseek-ai/dsh-tool-bash')
    expect(host.restrictions).toEqual([])
  })

  it('rolls back the restriction and the shadow when the final verification fails', async () => {
    const host = fakeAgentHost({ inherited: ['bash', 'pwsh'], breakRestrict: true })
    await expect(adaptAgentShell(host.agent, 'bash', { loadToolPlugin: host.loadToolPlugin })).rejects.toThrow(
      ShellSelectorAgentAdaptationError,
    )
    // Rolled back to the preset's original surface — no half-adapted scope.
    expect(host.visible()).toEqual(new Set(['bash', 'pwsh']))
    expect(host.liveRestrictions()).toEqual([])
    expect(host.liveShadows()).toEqual([])
  })
})

describe('verifyAgentShell', () => {
  it('accepts exactly "target visible, opposite hidden"', () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const tools = toolsOf(host.agent.ctx)!
    expect(() => verifyAgentShell(tools, host.agent, 'bash', 'pwsh')).not.toThrow()
  })

  it('rejects an empty catalog and says so', () => {
    const host = fakeAgentHost({ inherited: [] })
    const tools = toolsOf(host.agent.ctx)!
    expect(() => verifyAgentShell(tools, host.agent, 'bash', 'pwsh')).toThrow(/catalog: \(empty\)/)
  })

  it('rejects a surviving opposite tool', () => {
    const host = fakeAgentHost({ inherited: ['bash', 'pwsh'] })
    const tools = toolsOf(host.agent.ctx)!
    expect(() => verifyAgentShell(tools, host.agent, 'bash', 'pwsh')).toThrow(/still visible/)
  })
})

describe('two agents in parallel', () => {
  it('adapts each agent independently with no cross-registration', async () => {
    const first = fakeAgentHost({ inherited: ['pwsh'] })
    const second = fakeAgentHost({ inherited: ['pwsh'] })
    await Promise.all([adapt(first, 'bash'), adapt(second, 'bash')])
    expect(first.visible()).toEqual(new Set(['bash']))
    expect(second.visible()).toEqual(new Set(['bash']))
    // Each mounted its own scoped copy exactly once; neither saw the other's.
    expect(first.mounted).toEqual(['bash'])
    expect(second.mounted).toEqual(['bash'])
    expect(first.globalVisible()).toEqual(new Set())
    expect(second.globalVisible()).toEqual(new Set())
  })

  it('releases the scoped tool when an agent is disposed', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adapt(host, 'bash')
    expect(host.visible()).toEqual(new Set(['bash']))
    host.disposeAgent()
    expect(host.visible()).toEqual(new Set(['pwsh']))
  })
})

describe('no-shell presets are never escalated', () => {
  it.each(['bash', 'pwsh', 'powershell'] as const)(
    'leaves a read/write/edit preset without a shell when the selector is %s',
    async (active) => {
      const host = fakeAgentHost({ inherited: ['read', 'write', 'edit'] })
      const { visible } = await adapt(host, active)
      expect(visible).toEqual(new Set(['read', 'write', 'edit']))
      expect(host.loadToolPlugin).not.toHaveBeenCalled()
      expect(host.mounted).toEqual([])
    },
  )
})
