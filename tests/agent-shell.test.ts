/**
 * Agent-scoped Shell Tool adaptation tests: the selector hides the shell tool
 * that does not match the active executor, without inspecting preset names and
 * without ever granting a shell to an agent that has no shell tools.
 */

import { describe, expect, it, vi } from 'vitest'
import { activeShellTool, adaptAgentShell, type AgentLike } from '../src/agent-shell.js'

function fakeAgent(visible: string[]): { agent: AgentLike; restrict: ReturnType<typeof vi.fn> } {
  const restrict = vi.fn()
  const view = { visible: { has: (name: string) => visible.includes(name) } }
  const ctx = {
    tools: {
      view: () => view,
      restrict,
    },
  } as unknown as AgentLike['ctx'] & { tools: { view(): unknown; restrict: typeof restrict } }
  return { agent: { ctx }, restrict }
}

describe('activeShellTool', () => {
  it('maps bash to tool-bash and every PowerShell kind to tool-pwsh', () => {
    expect(activeShellTool('bash')).toBe('bash')
    expect(activeShellTool('pwsh')).toBe('pwsh')
    expect(activeShellTool('powershell')).toBe('pwsh')
  })
})

describe('adaptAgentShell', () => {
  it('hides pwsh when Bash is active and both shell tools are present', () => {
    const { agent, restrict } = fakeAgent(['bash', 'pwsh'])
    adaptAgentShell(agent, 'bash')
    expect(restrict).toHaveBeenCalledWith({ deny: ['pwsh'] })
  })

  it('hides bash when PowerShell is active and both shell tools are present', () => {
    const { agent, restrict } = fakeAgent(['bash', 'pwsh'])
    adaptAgentShell(agent, 'pwsh')
    expect(restrict).toHaveBeenCalledWith({ deny: ['bash'] })
  })

  it('does nothing for an agent with no shell tools (no capability grant)', () => {
    const { agent, restrict } = fakeAgent([])
    adaptAgentShell(agent, 'bash')
    expect(restrict).not.toHaveBeenCalled()
  })

  it('hides the only mismatched tool rather than exposing a wrong dialect', () => {
    const { agent, restrict } = fakeAgent(['pwsh'])
    adaptAgentShell(agent, 'bash')
    expect(restrict).toHaveBeenCalledWith({ deny: ['pwsh'] })
  })

  it('never consults preset names', () => {
    const { agent, restrict } = fakeAgent(['bash', 'pwsh'])
    adaptAgentShell(agent, 'bash')
    expect(restrict).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(agent)).not.toContain('standard')
    expect(JSON.stringify(agent)).not.toContain('code')
  })
})
