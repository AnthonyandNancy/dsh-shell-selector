/**
 * Tool/prompt alignment tests.
 *
 * In DSH the tool schema and the system prompt are two INDEPENDENT composition
 * inputs. Hiding the `pwsh` tool does not remove the `tool:pwsh` guidance, so an
 * agent could be handed a Bash tool alongside PowerShell instructions. These
 * tests pin that the two always agree, and that the plugin achieves it through
 * section IDENTITY rather than by rewriting prompt prose.
 */

import { describe, expect, it } from 'vitest'
import { adaptAgentShell, reconcileAssembly } from '../src/agent-shell.js'
import { toolsOf, type Rc6PromptAssembly } from '../src/compat/rc6-agent.js'
import { fakeAgentHost } from './helpers/fake-agent-host.js'

const BASH_GUIDANCE = 'Check the [exit code: N] marker on every bash result; investigate a non-zero exit.'
const PWSH_GUIDANCE = 'Non-zero exits are reported as `[exit code: N]` markers; inspect them.'

function assemblyWith(tools: string[], sections: Array<[string, string]>): Rc6PromptAssembly {
  return {
    sections: sections.map(([name, text]) => ({ name, text })),
    tools: tools.map((name) => ({ name, description: `${name} description`, parameters: {} })),
  }
}

/** rc.6 drops empty sections when rendering, so this mirrors the real prompt. */
function renderPrompt(assembly: Rc6PromptAssembly): string {
  return assembly.sections
    .filter((section) => section.text.trim() !== '')
    .map((section) => section.text)
    .join('\n\n')
}

describe('Bash mode prompt alignment', () => {
  it('keeps tool:bash guidance and drops tool:pwsh guidance', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })

    const assembly = assemblyWith(
      ['bash', 'pwsh'],
      [
        ['harness:identity', 'You are an AI agent powered by DeepSeek Harness.'],
        ['tool:pwsh', PWSH_GUIDANCE],
        ['tool:bash', BASH_GUIDANCE],
      ],
    )
    const reconciled = reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)
    const prompt = renderPrompt(reconciled)

    expect(prompt).toContain(BASH_GUIDANCE)
    expect(prompt).not.toContain(PWSH_GUIDANCE)
    expect(reconciled.tools.map((tool) => tool.name)).toEqual(['bash'])
  })

  it('registers an EMPTY same-named section rather than editing prose', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    await adaptAgentShell(host.agent, 'bash', { loadToolPlugin: host.loadToolPlugin })
    expect(host.shadowedSections).toEqual([{ name: 'tool:pwsh', order: 105, text: '' }])
    // Nothing that looks like a search-and-replace over the prompt text.
    for (const section of host.shadowedSections) {
      expect(section.text).toBe('')
      expect(section.text).not.toContain('Bash')
      expect(section.text).not.toContain('PowerShell')
    }
  })
})

describe('PowerShell mode prompt alignment', () => {
  it.each(['pwsh', 'powershell'] as const)(
    'keeps tool:pwsh guidance and drops tool:bash guidance for %s',
    async (active) => {
      const host = fakeAgentHost({ inherited: ['bash'] })
      const outcome = await adaptAgentShell(host.agent, active, {
        loadToolPlugin: host.loadToolPlugin,
      })

      const assembly = assemblyWith(
        ['bash', 'pwsh'],
        [
          ['harness:identity', 'You are an AI agent powered by DeepSeek Harness.'],
          ['tool:pwsh', PWSH_GUIDANCE],
          ['tool:bash', BASH_GUIDANCE],
        ],
      )
      const reconciled = reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)
      const prompt = renderPrompt(reconciled)

      expect(prompt).toContain(PWSH_GUIDANCE)
      expect(prompt).not.toContain(BASH_GUIDANCE)
      expect(reconciled.tools.map((tool) => tool.name)).toEqual(['pwsh'])
      expect(host.shadowedSections).toEqual([{ name: 'tool:bash', order: 105, text: '' }])
    },
  )
})

describe('assembly reconciliation', () => {
  it('repairs a stale snapshot that predates the mount', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })

    // rc.6 computes `tools` and `sections` BEFORE the waterfall, so a listener
    // can be handed a pre-adaptation snapshot. It must still be corrected.
    const stale = assemblyWith(
      ['pwsh'],
      [
        ['harness:identity', 'identity'],
        ['tool:pwsh', PWSH_GUIDANCE],
      ],
    )
    const reconciled = reconcileAssembly(stale, outcome, toolsOf(host.agent.ctx)!, host.agent)

    expect(reconciled.tools.map((tool) => tool.name)).toEqual(['bash'])
    expect(renderPrompt(reconciled)).not.toContain(PWSH_GUIDANCE)
  })

  it('leaves a no-capability agent entirely untouched', async () => {
    const host = fakeAgentHost({ inherited: ['read'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const assembly = assemblyWith(['read'], [['tool:read', 'READ GUIDANCE']])
    expect(reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)).toBe(assembly)
  })

  it('preserves non-shell tools and sections', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh', 'read', 'str_replace_editor'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const assembly = assemblyWith(
      ['pwsh', 'read', 'str_replace_editor'],
      [
        ['harness:identity', 'identity'],
        ['tool:pwsh', PWSH_GUIDANCE],
        ['tool:read', 'READ GUIDANCE'],
      ],
    )
    const reconciled = reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)
    const names = reconciled.tools.map((tool) => tool.name)
    expect(names).toContain('read')
    expect(names).toContain('str_replace_editor')
    expect(names).toContain('bash')
    expect(names).not.toContain('pwsh')
    expect(reconciled.sections.map((section) => section.name)).toEqual([
      'harness:identity',
      'tool:read',
    ])
  })

  it('does not inject a shell tool into the Code Mode wire surface', async () => {
    // In Code Mode the wire carries `run_code` and the shells live in the SDK,
    // so the reconciliation must not append `bash` to the wire schema.
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const tools = toolsOf(host.agent.ctx)!
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const codeTools = { ...tools, view: tools.view.bind(tools), modeFor: () => 'code' }
    const assembly = assemblyWith(['run_code'], [['tool:pwsh', PWSH_GUIDANCE]])
    const reconciled = reconcileAssembly(assembly, outcome, codeTools, host.agent)

    expect(reconciled.tools.map((tool) => tool.name)).toEqual(['run_code'])
    // The SDK-facing catalog still followed the selector...
    expect(host.visible()).toEqual(new Set(['bash']))
    // ...and the PowerShell guidance is still gone from the prompt.
    expect(renderPrompt(reconciled)).not.toContain(PWSH_GUIDANCE)
  })
})
