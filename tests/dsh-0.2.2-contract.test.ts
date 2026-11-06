/**
 * DSH 0.2.2-rc.1 contract tests.
 *
 * 0.2.2-rc.1 moved the model-facing tool schema from the prompt assembly to a
 * tool provider. `SystemPrompt.assemble()` now builds
 * `{ sections, contexts, variables }`, runs the `system-prompt/assemble`
 * waterfall, and only THEN attaches `tools` to the value it returns:
 *
 *     const assembly = { sections, contexts, variables };
 *     const transformed = await this.ctx.waterfall(..., 'system-prompt/assemble', assembly, ...);
 *     return { ...transformed, tools };
 *
 * A waterfall listener therefore receives an assembly with NO `tools` key. The
 * previous `reconcileAssembly()` did `assembly.tools.filter(...)`, which is the
 * reported `TypeError: Cannot read properties of undefined (reading 'filter')`.
 * It surfaced as a failed model step for every shell-capable agent, because the
 * listener runs at the prompt-assembly barrier.
 *
 * These tests pin the fix: reconcile must tolerate the 0.2.2 shape, must not
 * regress the 0.1.7 shape, and must never mutate its input.
 */

import { describe, expect, it } from 'vitest'
import { adaptAgentShell, reconcileAssembly } from '../src/agent-shell.js'
import {
  isNativeToolWire,
  modelFacingTools,
  toolsOf,
  type Rc6PromptAssembly,
} from '../src/compat/rc6-agent.js'
import { fakeAgentHost } from './helpers/fake-agent-host.js'

const PWSH_GUIDANCE = 'Non-zero exits are reported as `[exit code: N]` markers; inspect them.'
const BASH_GUIDANCE = 'Check the [exit code: N] marker on every bash result.'

/**
 * The exact assembly 0.2.2-rc.1 hands to `system-prompt/assemble`: built from
 * sections/contexts/variables only. `tools` is deliberately absent.
 */
function assembly022(sections: Array<[string, string]>): Rc6PromptAssembly {
  return {
    sections: sections.map(([name, text]) => ({ name, text })),
    contexts: [],
    variables: {},
  }
}

/** The 0.1.7-rc.1 shape, which carried `tools` into the waterfall. */
function assembly017(tools: string[], sections: Array<[string, string]>): Rc6PromptAssembly {
  return {
    sections: sections.map(([name, text]) => ({ name, text })),
    tools: tools.map((name) => ({ name, description: `${name} description`, parameters: {} })),
  }
}

describe('0.2.2-rc.1 prompt assembly without `tools`', () => {
  it('does not throw the "Cannot read properties of undefined (reading filter)" crash', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const outcome = await adaptAgentShell(host.agent, 'pwsh', {
      loadToolPlugin: host.loadToolPlugin,
    })

    const assembly = assembly022([
      ['harness:identity', 'identity'],
      ['tool:bash', BASH_GUIDANCE],
      ['tool:pwsh', PWSH_GUIDANCE],
    ])

    // The regression: this call used to throw a TypeError.
    const reconciled = reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)

    expect(reconciled.sections.map((section) => section.name)).toEqual([
      'harness:identity',
      'tool:pwsh',
    ])
  })

  it('leaves `tools` absent instead of fabricating an empty array', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const outcome = await adaptAgentShell(host.agent, 'pwsh', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const reconciled = reconcileAssembly(
      assembly022([['tool:bash', BASH_GUIDANCE]]),
      outcome,
      toolsOf(host.agent.ctx)!,
      host.agent,
    )

    // 0.2.2 attaches `tools` AFTER the waterfall, so a listener must not
    // pretend to own that field: writing `tools: []` would make the host's
    // later `{ ...transformed, tools }` — and every snapshot copy — ambiguous.
    expect('tools' in reconciled).toBe(false)
    expect(Object.keys(reconciled).sort()).toEqual(['contexts', 'sections', 'variables'])
  })

  it('preserves contexts and variables untouched', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const outcome = await adaptAgentShell(host.agent, 'pwsh', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const assembly = assembly022([['tool:bash', BASH_GUIDANCE]])
    assembly.contexts = [{ name: 'runtime:cwd', text: '/work' }]
    assembly.variables = { cwd: '/work' }

    const reconciled = reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)

    expect(reconciled.contexts).toEqual([{ name: 'runtime:cwd', text: '/work' }])
    expect(reconciled.variables).toEqual({ cwd: '/work' })
  })

  it('never mutates the incoming assembly', async () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const outcome = await adaptAgentShell(host.agent, 'pwsh', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const assembly = assembly022([
      ['harness:identity', 'identity'],
      ['tool:bash', BASH_GUIDANCE],
    ])
    const before = JSON.parse(JSON.stringify(assembly)) as Rc6PromptAssembly

    reconcileAssembly(assembly, outcome, toolsOf(host.agent.ctx)!, host.agent)

    expect(assembly).toEqual(before)
  })
})

describe('0.1.7-rc.1 assembly is still reconciled', () => {
  it('rewrites `tools` when the host supplied them', async () => {
    const host = fakeAgentHost({ inherited: ['pwsh'] })
    const outcome = await adaptAgentShell(host.agent, 'bash', {
      loadToolPlugin: host.loadToolPlugin,
    })
    const reconciled = reconcileAssembly(
      assembly017(['pwsh'], [['tool:pwsh', PWSH_GUIDANCE]]),
      outcome,
      toolsOf(host.agent.ctx)!,
      host.agent,
    )

    expect(reconciled.tools?.map((tool) => tool.name)).toEqual(['bash'])
    expect(reconciled.sections.map((section) => section.name)).toEqual([])
  })
})

describe('removed 0.2.2-rc.1 surface', () => {
  it('treats a registry without modeFor as a native wire', () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const tools = toolsOf(host.agent.ctx)!
    // 0.2.2-rc.1 has no `modeFor` anywhere; the probe must not throw.
    const withoutModeFor = { view: tools.view.bind(tools), restrict: tools.restrict.bind(tools) }
    expect(isNativeToolWire(withoutModeFor, host.agent)).toBe(true)
  })

  it('reads the model-facing schema from the live registry', () => {
    const host = fakeAgentHost({ inherited: ['bash'] })
    const tools = toolsOf(host.agent.ctx)!
    const schemas = modelFacingTools(tools, host.agent)
    expect(schemas?.map((tool) => tool.name)).toEqual(['bash'])
  })
})
