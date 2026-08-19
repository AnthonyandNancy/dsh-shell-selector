/**
 * A fake rc.6 agent host for the adaptation tests.
 *
 * It reproduces the layer semantics observed empirically against the installed
 * `@deepseek-ai/dsh@0.1.0-rc.6` tree (see `probe/rc6-scope.mjs`):
 *
 *  - a scope sees INHERITED tools (from its preset's standing layer) plus the
 *    tools its OWN layer registered;
 *  - `restrict()` accepts only inherited names — a scope cannot restrict a tool
 *    it registered itself;
 *  - `ctx.plugin()` activates asynchronously, so the tool is not visible until
 *    the returned fiber resolves;
 *  - a same-named prompt section on the agent scope shadows the inherited one;
 *  - registrations on the agent scope never reach the global layer, and they
 *    disappear when the agent's scope is disposed.
 *
 * Every mutation is timestamped into `order` and `catalogTimeline`, so tests can
 * assert the ADD-BEFORE-REMOVE ordering and prove the catalog is never empty.
 */

import { vi } from 'vitest'
import type { AgentLike } from '../../src/agent-shell.js'
import type { Rc6PromptSection, Rc6ToolPlugin, ShellToolName } from '../../src/compat/rc6-agent.js'

export interface FakeHostOptions {
  /** Tools the preset's standing layer contributes. */
  inherited: string[]
  /** Fail the target plugin's activation (simulates a broken mount). */
  mountFails?: boolean
  /** Fail resolution of the official package. */
  loadFails?: boolean
  /** Make `restrict()` silently not hide anything (forces final verify to fail). */
  breakRestrict?: boolean
  /** Present only so a test can prove it is never read. */
  presetName?: string
}

export interface FakeHost {
  agent: AgentLike
  loadToolPlugin: ReturnType<typeof vi.fn<(tool: ShellToolName) => Promise<Rc6ToolPlugin>>>
  /** Tool names the agent scope currently resolves. */
  visible(): Set<string>
  /** Tool names the GLOBAL layer resolves (must stay empty). */
  globalVisible(): Set<string>
  /** Targets whose official plugin was mounted, in order. */
  mounted: ShellToolName[]
  /** For each mount, whether it landed on the agent's own context. */
  mountedOnAgentScope: boolean[]
  /** Every `restrict()` call's denied names. */
  restrictions: string[][]
  /** Restrictions still in force (not rolled back). */
  liveRestrictions(): string[][]
  /** Every shadowed prompt section. */
  shadowedSections: Rc6PromptSection[]
  /** Shadows still in force (not rolled back). */
  liveShadows(): Rc6PromptSection[]
  /** Ordered log of mutations: `mount:x`, `restrict:x`, `shadow:x`. */
  order: string[]
  /** The visible catalog after each mutation. */
  catalogTimeline: string[][]
  /** Preset names the code under test inspected (must stay empty). */
  inspectedPresetNames: string[]
  /** Dispose the agent's scope, releasing its own registrations. */
  disposeAgent(): void
}

export function fakeAgentHost(options: FakeHostOptions): FakeHost {
  const inherited = new Set(options.inherited)
  const own = new Set<string>()
  const denied = new Set<string>()
  const activeRestrictions: string[][] = []
  const activeShadows: Rc6PromptSection[] = []

  const host: FakeHost = {
    agent: undefined as unknown as AgentLike,
    loadToolPlugin: vi.fn(),
    visible: () => {
      const names = new Set<string>()
      for (const name of inherited) if (!denied.has(name)) names.add(name)
      for (const name of own) names.add(name)
      return names
    },
    globalVisible: () => new Set<string>(),
    mounted: [],
    mountedOnAgentScope: [],
    restrictions: [],
    liveRestrictions: () => activeRestrictions,
    shadowedSections: [],
    liveShadows: () => activeShadows,
    order: [],
    catalogTimeline: [],
    inspectedPresetNames: [],
    disposeAgent: () => {
      own.clear()
      denied.clear()
      activeRestrictions.length = 0
      activeShadows.length = 0
    },
  }

  const snapshot = (): void => {
    host.catalogTimeline.push([...host.visible()].sort())
  }

  const definitionOf = (name: string): { name: string; description: string; parameters: unknown } => ({
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
  })

  const view = (): {
    visible: Map<string, ReturnType<typeof definitionOf>>
    knownNames: Set<string>
    restrictableNames: Set<string>
  } => {
    const visible = new Map<string, ReturnType<typeof definitionOf>>()
    for (const name of host.visible()) visible.set(name, definitionOf(name))
    return {
      visible,
      knownNames: new Set([...inherited, ...own]),
      // rc.6: only inherited contributions are restrictable.
      restrictableNames: new Set(inherited),
    }
  }

  const tools = {
    view,
    restrict: (filter: { allow?: string[]; deny?: string[] }) => {
      const names = filter.deny ?? []
      host.restrictions.push(names)
      activeRestrictions.push(names)
      if (options.breakRestrict !== true) for (const name of names) denied.add(name)
      host.order.push(`restrict:${names.join(',')}`)
      snapshot()
      return () => {
        for (const name of names) denied.delete(name)
        const index = activeRestrictions.indexOf(names)
        if (index >= 0) activeRestrictions.splice(index, 1)
      }
    },
    modeFor: () => 'native',
  }

  const systemPrompt = {
    section: (section: Rc6PromptSection) => {
      host.shadowedSections.push(section)
      activeShadows.push(section)
      host.order.push(`shadow:${section.name}`)
      snapshot()
      return () => {
        const index = activeShadows.indexOf(section)
        if (index >= 0) activeShadows.splice(index, 1)
      }
    },
  }

  const agentCtx = {
    tools,
    systemPrompt,
    // rc.6 `ctx.plugin()` returns a fiber and activates asynchronously.
    plugin: (plugin: Rc6ToolPlugin) => {
      const toolName = String(plugin.name ?? '').replace(/^tool-/u, '') as ShellToolName
      return {
        await: async () => {
          await Promise.resolve()
          if (options.mountFails === true) throw new Error('boom: cannot register')
          own.add(toolName)
          host.mounted.push(toolName)
          host.mountedOnAgentScope.push(true)
          host.order.push(`mount:${toolName}`)
          snapshot()
        },
        dispose: () => {
          own.delete(toolName)
          const index = host.mounted.indexOf(toolName)
          if (index >= 0) host.mounted.splice(index, 1)
        },
      }
    },
  }

  host.agent = { id: 'fake-agent', ctx: agentCtx as unknown as AgentLike['ctx'] }
  host.loadToolPlugin = vi.fn(async (tool: ShellToolName): Promise<Rc6ToolPlugin> => {
    if (options.loadFails === true) throw new Error('MODULE_NOT_FOUND')
    return { name: `tool-${tool}`, apply: () => undefined }
  })

  snapshot()
  return host
}
