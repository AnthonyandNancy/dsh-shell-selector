/**
 * The ONE place that speaks to DSH runtime internals.
 *
 * DSH does not ship `.d.ts` files for `@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/dsh-system-prompt`, or `@deepseek-ai/dsh-agent`, and it does
 * not export the agent-scope tool/prompt surfaces as public types. Rather than
 * scatter `as Context & { ... }` casts through the business logic, every
 * structural assumption about the host runtime lives here, each one annotated
 * with the empirical observation that justifies it. When a DSH release changes
 * an interface, this file is the only one that moves.
 *
 * Verified against `@deepseek-ai/dsh-app-boot@0.2.2-rc.1` in the installed
 * tree, with 0.1.7-rc.1 behaviour kept where the two agree.
 *
 * ## The 0.2.2-rc.1 prompt-assembly change
 *
 * `SystemPrompt.assemble()` used to build `{ sections, tools, variables }` and
 * hand that object to the `system-prompt/assemble` waterfall. 0.2.2-rc.1
 * rebuilt it around tool providers: the registry now owns the model-facing
 * schema through `ctx.systemPrompt.tools(provider)`, `assemble()` builds
 * `{ sections, contexts, variables }`, and `tools` is attached only AFTER the
 * waterfall returns:
 *
 *     const assembly = { sections, contexts, variables }
 *     const transformed = await this.ctx.waterfall(..., 'system-prompt/assemble', assembly, ...)
 *     return { ...transformed, tools }        // ← added on the way OUT
 *
 * A waterfall listener therefore receives an assembly with **no `tools` key at
 * all** — the fallback `assembly` object, not the returned one. Reading
 * `assembly.tools.filter(...)` there is `TypeError: Cannot read properties of
 * undefined (reading 'filter')`, which is the crash this module now prevents.
 *
 * Tool removal is consequently no longer a prompt concern: `tools.restrict()`
 * is what removes a tool from the model-facing schema, because the provider
 * re-derives `definitions(scope, toolSet)` from the live registry on every
 * assembly. The prompt listener only has to drop the opposite guidance section.
 *
 * ## The 0.2.2-rc.1 agent-announcement change
 *
 * `agent/created` moved from a fire-and-forget `emit` to `ctx.serial(...)`,
 * which AWAITS every listener. A rejected listener now rejects agent creation
 * instead of being logged, and `announce()` reports that to its caller. The
 * adaptation must therefore never reject from inside the listener.
 *
 * @module dsh-shell-selector/compat/rc6-agent
 */

import type { Context } from '@deepseek-ai/cordis'

/** The model-facing name of a standard one-shot shell tool. */
export type ShellToolName = 'bash' | 'pwsh'

/**
 * The npm package that provides each shell tool.
 *
 * These are the OFFICIAL tool plugins. Shell Selector never implements a shell
 * tool itself: mounting the official plugin is what preserves `ctx.shell`, the
 * sandbox and `sandbox_permissions`, user approval, jobs and background
 * execution, timeout and cancellation, `shellEnv`, result rendering and the
 * terminal UI presentation.
 */
export const SHELL_TOOL_PACKAGE: Readonly<Record<ShellToolName, string>> = {
  bash: '@deepseek-ai/dsh-tool-bash',
  pwsh: '@deepseek-ai/dsh-tool-pwsh',
}

/**
 * The prompt section each official shell tool contributes.
 *
 * Verified in the host: `dsh-tool-bash` registers `tool:bash` and
 * `dsh-tool-pwsh` registers `tool:pwsh`. Prompt work is done by SECTION
 * IDENTITY through these names — never by string-replacing prose.
 */
export function shellPromptSection(tool: ShellToolName): string {
  return `tool:${tool}`
}

/**
 * Order of the `tool:*` guidance sections, read from the host's own registry.
 *
 * 0.2.1 and earlier hard-coded `105`. The host now owns a single
 * `SECTION_ORDERS` table (`TOOL_BASH: 1000`, `TOOL_PWSH: 1010`, …) and exposes
 * it as `systemPrompt.getSectionOrder(name)`, so the value is read through that
 * call and only this fallback stays pinned. A shadowing section only has to
 * match the name, so the order only affects placement if the host ever renders
 * it — which it does not, because the section is empty.
 */
export const SHELL_PROMPT_SECTION_ORDER = 105

/** The `SECTION_ORDERS` key for each shell tool's guidance section. */
export const SHELL_SECTION_ORDER_NAME: Readonly<Record<ShellToolName, string>> = {
  bash: 'TOOL_BASH',
  pwsh: 'TOOL_PWSH',
}

/** A Cordis plugin object, as the official tool packages export it. */
export interface Rc6ToolPlugin {
  name?: string
  inject?: unknown
  apply(ctx: Context, config?: unknown): unknown
}

/** One tool as the registry stores it (`tools.view().visible` values). */
export interface Rc6ToolDefinition {
  name: string
  description: string
  parameters: unknown
}

/** The result of `tools.view(scope)`. */
export interface Rc6ToolView {
  /** Tools this scope resolves, after every layer's restrictions. */
  visible: Map<string, Rc6ToolDefinition>
  /** Registrations behind `visible`, carrying the step-activation condition. */
  registrations?: Map<string, { definition: Rc6ToolDefinition; when?: unknown }>
  /** Every name this scope knows, restricted or not. */
  knownNames: Set<string>
  /** Names `tools.restrict()` will accept — INHERITED contributions only. */
  restrictableNames: Set<string>
}

/**
 * The `ctx.tools` service, narrowed to what this plugin uses.
 *
 * `restrict()` is scope-only: it throws when called on an unscoped context, and
 * it refuses names outside `view(scope).restrictableNames` — notably a tool the
 * SAME scope registered is NOT restrictable by that scope. Both behaviours are
 * load-bearing for the adaptation algorithm.
 *
 * `modeFor()` was REMOVED in 0.2.2-rc.1 (the native/PTC split became a
 * per-agent tool-executor plugin). Nothing in the current surface replaces it
 * with the same meaning, so the optional member stays declared for two reasons:
 * code that must ask "is this a native tool wire?" reads it when present, and
 * its absence is itself the 0.2.2 answer — the executor provider decides.
 */
export interface Rc6ToolsService {
  view(scope?: unknown): Rc6ToolView
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void
  /** Model-facing schemas after scoped shadowing and restrictions. */
  definitions?(scope?: unknown, toolSet?: unknown): Rc6ToolDefinition[]
  /** Schemas projected onto the allowlisted model-facing fields. */
  schemas?(scope?: unknown, toolSet?: unknown): Rc6ToolDefinition[]
  /** Removed in 0.2.2-rc.1; present on 0.1.7-rc.1 and earlier. */
  modeFor?(scope?: unknown): string
}

/** A prompt section as the host accepts it. */
export interface Rc6PromptSection {
  name: string
  order: number
  text: string
}

/** The `ctx.systemPrompt` service, narrowed to what this plugin uses. */
export interface Rc6SystemPromptService {
  section(section: Rc6PromptSection): () => void
  /** Centrally owned placement for a repository section (0.2.1+). */
  getSectionOrder?(name: string): number
}

/** One assembled prompt section (`assembly.sections` entries). */
export interface Rc6AssembledSection {
  name: string
  text: string
}

/** One assembled tool declaration (`assembly.tools` entries, when present). */
export interface Rc6AssembledTool {
  name: string
  description: string
  parameters: unknown
}

/**
 * The prompt assembly a `system-prompt/assemble` listener receives.
 *
 * `sections`, `contexts` and `variables` are always present. **`tools` is NOT**
 * part of the incoming assembly on 0.2.2-rc.1 — the registry attaches it after
 * the waterfall. It is declared optional here so every reader is forced to
 * handle its absence; see the module header for the exact host code path.
 */
export interface Rc6PromptAssembly {
  sections: Rc6AssembledSection[]
  contexts?: unknown[]
  variables?: Record<string, unknown>
  tools?: Rc6AssembledTool[]
  [key: string]: unknown
}

/** The agent object carried by `agent/created`. */
export interface Rc6Agent {
  id?: string
  ctx: Context
}

/**
 * The scope key the host filters tool layers and prompt layers by.
 *
 * `tools.view(scope)` and `systemPrompt.assemble({ scope })` both key on the
 * agent object itself (the scope carrier), which is what `agent/created` hands
 * us. Passing the agent is the supported addressing.
 */
export function agentScope(agent: Rc6Agent): unknown {
  return agent
}

/** Read `ctx.tools`, or `undefined` when no tool runtime is composed. */
export function toolsOf(ctx: Context): Rc6ToolsService | undefined {
  const service = (ctx as Context & { tools?: unknown }).tools
  if (service === null || typeof service !== 'object') return undefined
  const candidate = service as Partial<Rc6ToolsService>
  if (typeof candidate.view !== 'function' || typeof candidate.restrict !== 'function') return undefined
  return service as Rc6ToolsService
}

/** Read `ctx.systemPrompt`, or `undefined` when no prompt service is composed. */
export function systemPromptOf(ctx: Context): Rc6SystemPromptService | undefined {
  const service = (ctx as Context & { systemPrompt?: unknown }).systemPrompt
  if (service === null || typeof service !== 'object') return undefined
  const candidate = service as Partial<Rc6SystemPromptService>
  if (typeof candidate.section !== 'function') return undefined
  return service as Rc6SystemPromptService
}

/** Whether a scope currently resolves a given tool name as visible. */
export function isToolVisible(tools: Rc6ToolsService, scope: unknown, name: string): boolean {
  return tools.view(scope).visible.has(name)
}

/** Whether `restrict()` would accept a name for this scope. */
export function isToolRestrictable(tools: Rc6ToolsService, scope: unknown, name: string): boolean {
  return tools.view(scope).restrictableNames.has(name)
}

/**
 * The tool names one scope resolves — the "catalog" the Agent Router reads.
 */
export function visibleToolNames(tools: Rc6ToolsService, scope: unknown): Set<string> {
  return new Set(tools.view(scope).visible.keys())
}

/**
 * The model-facing tool schema for one scope, read from the live registry.
 *
 * This is the 0.2.2-rc.1 replacement for the removed `assembly.tools` input:
 * the registry is the single source of truth, so a listener never needs the
 * waterfall snapshot to know what the model will be offered.
 *
 * @returns the visible definitions, or `undefined` when the host exposes no
 *   way to read them (no `definitions`/`schemas` method).
 */
export function modelFacingTools(
  tools: Rc6ToolsService,
  scope: unknown,
): Rc6AssembledTool[] | undefined {
  if (typeof tools.definitions === 'function') {
    return tools.definitions(scope, undefined).map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    }))
  }
  if (typeof tools.schemas === 'function') {
    return tools.schemas(scope, undefined).map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    }))
  }
  const view = tools.view(scope)
  if (view.visible === undefined) return undefined
  return [...view.visible.values()].map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }))
}

/**
 * Whether the scope's tool wire is the native one.
 *
 * 0.2.2-rc.1 removed `tools.modeFor()`; the native/PTC decision became a
 * per-agent tool-executor plugin (`tools.setExecutor`). When the probe is gone
 * this reports `true`, which is the conservative answer: appending the target
 * schema to a native wire is a no-op when it is already there, and the registry
 * is authoritative anyway — the reconcile step no longer rewrites `tools`.
 */
export function isNativeToolWire(tools: Rc6ToolsService, scope: unknown): boolean {
  return (tools.modeFor?.(scope) ?? 'native') === 'native'
}

/** A Cordis fiber, as `ctx.plugin()` returns it. */
interface Rc6Fiber {
  await(): Promise<unknown>
  dispose(): unknown
}

/**
 * Mount a plugin on a context and WAIT for activation.
 *
 * `ctx.plugin()` is asynchronous — the tool is NOT visible synchronously after
 * the call and becomes visible one microtask later. The returned fiber's
 * `await()` is the only correct completion signal, and it REJECTS when the
 * plugin's `apply()` throws, leaving the scope untouched.
 *
 * The returned disposer removes the mount, which is what makes the adaptation
 * transactional.
 */
export async function mountPlugin(
  ctx: Context,
  plugin: Rc6ToolPlugin,
  config?: unknown,
): Promise<() => void> {
  const fiber = (ctx as Context & { plugin(p: unknown, c?: unknown): Rc6Fiber }).plugin(plugin, config)
  await fiber.await()
  return () => {
    fiber.dispose()
  }
}

/**
 * Register a scoped `system-prompt/assemble` listener.
 *
 * Registered through the AGENT's context, so the host scope-filters the
 * dispatch to that agent and disposes the listener with it. Because a preset's
 * own listener is registered on the standing scope BEFORE the agent scope
 * exists, an agent-scope listener always runs NESTED INSIDE it — so what this
 * listener returns is what the preset's `next()` observes. That nesting is what
 * lets the fix reach a router that picks its platform shell from the catalog.
 *
 * The listener's `next` is typed loosely because 0.2.2-rc.1 changed the
 * assembly shape between the waterfall entry and its return value.
 */
export function onPromptAssemble(
  ctx: Context,
  listener: (
    assembly: Rc6PromptAssembly,
    context: unknown,
    next: () => Promise<Rc6PromptAssembly>,
  ) => Promise<Rc6PromptAssembly>,
): () => void {
  const events = ctx as Context & {
    on(event: string, listener: unknown): () => void
  }
  return events.on('system-prompt/assemble', listener)
}

/**
 * Subscribe to `agent/created`.
 *
 * 0.2.2-rc.1 dispatches this through `ctx.serial(...)`, which AWAITS every
 * listener and propagates a rejection to the caller (`registry.announce`).
 * A listener that throws therefore fails agent creation, so callers must not
 * let an adaptation error escape from here.
 */
export function onAgentCreated(ctx: Context, listener: (agent: Rc6Agent) => void): () => void {
  const events = ctx as Context & {
    on(event: string, listener: (payload: { agent: Rc6Agent }) => void): () => void
  }
  return events.on('agent/created', (payload) => {
    listener(payload.agent)
  })
}

/**
 * Import an official tool plugin from the HOST's runtime.
 *
 * A bare dynamic import resolves through the host installation, so the plugin
 * mounts the same module instance the host composed. Shell Selector must never
 * bundle its own copy of a DSH runtime.
 */
export async function importShellToolPlugin(tool: ShellToolName): Promise<Rc6ToolPlugin> {
  const specifier = SHELL_TOOL_PACKAGE[tool]
  const module = (await import(specifier)) as { default?: unknown; apply?: unknown; name?: unknown }
  const candidate = (typeof module.apply === 'function' ? module : module.default) as
    | Rc6ToolPlugin
    | undefined
  if (candidate === undefined || typeof candidate.apply !== 'function') {
    throw new Error(`${specifier} does not export a Cordis plugin with apply()`)
  }
  return candidate
}
