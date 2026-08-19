/**
 * Agent-scoped Shell Tool adaptation.
 *
 * ONE RULE: **Preset determines WHETHER. Selector determines WHICH.**
 *
 * A preset's composition decides whether an agent holds the standard one-shot
 * Shell capability. The Shell Selector only decides which dialect that
 * capability speaks. It therefore never grants a shell to an agent that has
 * none, and — the bug this module exists to prevent — never leaves a
 * shell-capable agent with zero shells.
 *
 * The algorithm is a transaction in a fixed order, **ADD BEFORE REMOVE**:
 *
 *   1. inspect capability   — read the PRE-adaptation tool view
 *   2. ensure target        — mount the official tool for the active shell
 *   3. verify target        — refuse to continue unless it is really visible
 *   4. hide opposite        — restrict the other dialect's tool
 *   5. shadow opposite      — blank its `tool:*` prompt section by identity
 *   6. verify final         — target visible, opposite hidden, catalog non-empty
 *
 * Removing before adding is what produced `router-bootstrap: no platform shell
 * in catalog`: on a Windows preset exposing only `pwsh`, restricting `pwsh`
 * while `bash` had never been registered collapsed the catalog to nothing. Any
 * failure rolls the whole transaction back, so a partial scope is impossible.
 *
 * @module dsh-shell-selector/agent-shell
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ShellId } from './resolver.js'
import {
  SHELL_PROMPT_SECTION_ORDER,
  SHELL_TOOL_PACKAGE,
  agentScope,
  importShellToolPlugin,
  isToolRestrictable,
  isToolVisible,
  mountPlugin,
  shellPromptSection,
  systemPromptOf,
  toolsOf,
  visibleToolNames,
  type Rc6Agent,
  type Rc6PromptAssembly,
  type Rc6SystemPromptService,
  type Rc6ToolPlugin,
  type Rc6ToolsService,
  type ShellToolName,
} from './compat/rc6-agent.js'

/** The agent-shaped object exposed by `agent/created` events. */
export type AgentLike = Rc6Agent

/** Raised when the agent's shell surface could not be brought to its target. */
export class ShellSelectorAgentAdaptationError extends Error {
  override readonly name = 'ShellSelectorAgentAdaptationError'
  /** The tool the active shell required. */
  readonly target: ShellToolName
  constructor(target: ShellToolName, detail: string, options?: { cause?: unknown }) {
    super(`dsh-shell-selector: failed to adapt agent shell to ${target}: ${detail}`, options)
    this.target = target
  }
}

/** The model-facing tool name for a resolved shell kind. */
export function activeShellTool(activeKind: ShellId): ShellToolName {
  // PowerShell 7 and Windows PowerShell share ONE model-facing tool (`pwsh`);
  // they differ only in which executable the host executor spawns.
  return activeKind === 'bash' ? 'bash' : 'pwsh'
}

/** The other standard shell tool. */
export function oppositeShellTool(target: ShellToolName): ShellToolName {
  return target === 'bash' ? 'pwsh' : 'bash'
}

/** What the agent's composition granted BEFORE the selector touched it. */
export interface ShellCapability {
  /** `tool-bash` was visible pre-adaptation. */
  hadBash: boolean
  /** `tool-pwsh` was visible pre-adaptation. */
  hadPwsh: boolean
  /**
   * The preset granted the standard Shell capability in some dialect.
   *
   * This is the ONLY gate on granting a shell. It is read before any
   * modification, because the adaptation itself changes what is visible.
   */
  shellCapable: boolean
}

/** Read the pre-adaptation shell capability of one agent scope. */
export function inspectShellCapability(tools: Rc6ToolsService, scope: unknown): ShellCapability {
  const hadBash = isToolVisible(tools, scope, 'bash')
  const hadPwsh = isToolVisible(tools, scope, 'pwsh')
  return { hadBash, hadPwsh, shellCapable: hadBash || hadPwsh }
}

/** How the target tool came to be present. */
export interface EnsureTargetResult {
  /** True when this call mounted the official plugin (false = already there). */
  mounted: boolean
  /** Undo the mount; `undefined` when nothing was mounted. */
  dispose?: () => void
}

/**
 * Make the target shell tool present on the AGENT's own scope.
 *
 * Reuses the OFFICIAL rc.6 tool plugin (`@deepseek-ai/dsh-tool-bash` /
 * `@deepseek-ai/dsh-tool-pwsh`) so the agent keeps `ctx.shell`, the sandbox and
 * `sandbox_permissions`, approval, jobs, background execution, timeouts,
 * cancellation, `shellEnv`, result rendering and the terminal presentation.
 * Shell Selector never spawns a child process of its own.
 *
 * Mounting on `agent.ctx` (not the root context) keeps the registration inside
 * the agent's lifetime, so two agents cannot pollute each other and the tool is
 * released when the agent is disposed.
 */
export async function ensureTargetShellTool(
  agentCtx: Context,
  tools: Rc6ToolsService,
  scope: unknown,
  target: ShellToolName,
  loadToolPlugin: (tool: ShellToolName) => Promise<Rc6ToolPlugin>,
): Promise<EnsureTargetResult> {
  if (isToolVisible(tools, scope, target)) return { mounted: false }

  let plugin: Rc6ToolPlugin
  try {
    plugin = await loadToolPlugin(target)
  } catch (error) {
    throw new ShellSelectorAgentAdaptationError(
      target,
      `the official tool package ${SHELL_TOOL_PACKAGE[target]} could not be loaded from the host runtime`,
      { cause: error },
    )
  }

  try {
    const dispose = await mountPlugin(agentCtx, plugin)
    return { mounted: true, dispose }
  } catch (error) {
    throw new ShellSelectorAgentAdaptationError(
      target,
      `target tool "${target}" could not be registered on the agent scope`,
      { cause: error },
    )
  }
}

/**
 * Hide the shell tool that does not match the active executor.
 *
 * Only called AFTER the target is verified present, so the catalog can never
 * transit through an empty state. Returns `undefined` when the opposite was not
 * there to begin with.
 */
export function hideOppositeShellTool(
  agentCtx: Context,
  tools: Rc6ToolsService,
  scope: unknown,
  opposite: ShellToolName,
): (() => void) | undefined {
  if (!isToolVisible(tools, scope, opposite)) return undefined
  const agentTools = toolsOf(agentCtx)
  if (agentTools === undefined) return undefined
  if (!isToolRestrictable(agentTools, scope, opposite)) {
    // rc.6 only lets a scope restrict INHERITED contributions. A visible but
    // unrestrictable opposite means our own scope registered it — which this
    // module never does — so the assumption behind the fix is broken.
    throw new Error(`opposite tool "${opposite}" is visible but not restrictable from the agent scope`)
  }
  return agentTools.restrict({ deny: [opposite] })
}

/**
 * Blank the opposite tool's guidance section for this agent.
 *
 * A same-named section registered on the agent scope SHADOWS the inherited one,
 * and rc.6 drops empty sections when rendering the prompt — so the opposite
 * dialect's guidance never reaches the model. This works on SECTION IDENTITY;
 * the plugin never rewrites prompt prose with string or regex replacement.
 */
export function shadowOppositeShellPrompt(
  prompt: Rc6SystemPromptService,
  opposite: ShellToolName,
): () => void {
  return prompt.section({
    name: shellPromptSection(opposite),
    order: SHELL_PROMPT_SECTION_ORDER,
    text: '',
  })
}

/**
 * Assert the post-adaptation invariant, the one the Agent Router depends on.
 *
 * @throws ShellSelectorAgentAdaptationError when the surface is not exactly
 *   "target visible, opposite hidden".
 */
export function verifyAgentShell(
  tools: Rc6ToolsService,
  scope: unknown,
  target: ShellToolName,
  opposite: ShellToolName,
): void {
  const visible = visibleToolNames(tools, scope)
  if (!visible.has(target)) {
    throw new ShellSelectorAgentAdaptationError(
      target,
      `target tool "${target}" is not visible after adaptation (catalog: ${describeCatalog(visible)})`,
    )
  }
  if (visible.has(opposite)) {
    throw new ShellSelectorAgentAdaptationError(
      target,
      `opposite tool "${opposite}" is still visible after adaptation (catalog: ${describeCatalog(visible)})`,
    )
  }
}

function describeCatalog(visible: Set<string>): string {
  return visible.size === 0 ? '(empty)' : [...visible].sort().join(', ')
}

/** The result of adapting one agent. */
export type AdaptationOutcome =
  | {
      /** The preset granted no shell; the selector added nothing. */
      kind: 'noop-no-capability'
    }
  | {
      kind: 'adapted'
      target: ShellToolName
      opposite: ShellToolName
      capability: ShellCapability
      /** The official target plugin was mounted by this adaptation. */
      mountedTarget: boolean
      /** The opposite tool was restricted by this adaptation. */
      restrictedOpposite: boolean
    }

/** Optional seams, so tests need neither a live host nor the real tool packages. */
export interface AdaptAgentShellOptions {
  /** Resolve an official tool plugin. Defaults to importing from the host. */
  loadToolPlugin?: (tool: ShellToolName) => Promise<Rc6ToolPlugin>
  /** Development diagnostics; silent in production unless debug is enabled. */
  debug?: (message: string) => void
}

/**
 * Bring one agent's shell surface in line with the active executor.
 *
 * @param agent - the agent from `agent/created`.
 * @param activeKind - the shell the HOST executor was composed with at boot.
 * @returns what was done, for logging and verification.
 * @throws ShellSelectorAgentAdaptationError after rolling back, when the agent
 *   is shell-capable but could not be brought to the target shell.
 */
export async function adaptAgentShell(
  agent: AgentLike,
  activeKind: ShellId,
  options: AdaptAgentShellOptions = {},
): Promise<AdaptationOutcome> {
  const agentCtx = agent.ctx
  const tools = toolsOf(agentCtx)
  if (tools === undefined) return { kind: 'noop-no-capability' }
  const scope = agentScope(agent)
  const debug = options.debug ?? ((): void => {})

  // (1) Capability is read BEFORE any modification: it describes the preset's
  //     grant, and the adaptation is about to change what is visible.
  const capability = inspectShellCapability(tools, scope)
  debug(
    `agent shell capability before: bash=${capability.hadBash} pwsh=${capability.hadPwsh}; active=${activeKind}`,
  )
  if (!capability.shellCapable) {
    // A no-shell preset stays a no-shell preset. This is a permission
    // boundary: the selector picks a dialect, it does not widen capability.
    debug('preset grants no standard shell capability; adding nothing')
    return { kind: 'noop-no-capability' }
  }

  const target = activeShellTool(activeKind)
  const opposite = oppositeShellTool(target)
  const loadToolPlugin = options.loadToolPlugin ?? importShellToolPlugin

  const rollback: Array<() => void> = []
  const undo = (): void => {
    for (const dispose of rollback.reverse()) {
      try {
        dispose()
      } catch {
        // Rolling back is best-effort; the original failure is what matters.
      }
    }
    rollback.length = 0
  }

  try {
    // (2) ADD BEFORE REMOVE.
    const ensured = await ensureTargetShellTool(agentCtx, tools, scope, target, loadToolPlugin)
    if (ensured.dispose !== undefined) rollback.push(ensured.dispose)
    if (ensured.mounted) debug(`installed scoped ${target}`)
    else debug(`target ${target} already present; not registering it again`)

    // (3) Verify the target BEFORE removing anything.
    if (!isToolVisible(tools, scope, target)) {
      throw new ShellSelectorAgentAdaptationError(
        target,
        `target tool "${target}" is not visible after registration`,
      )
    }

    // (4) Now, and only now, remove the mismatched dialect.
    const restriction = hideOppositeShellTool(agentCtx, tools, scope, opposite)
    if (restriction !== undefined) {
      rollback.push(restriction)
      debug(`restricted ${opposite}`)
    }

    // (5) Tool schema and prompt are two independent composition inputs; hiding
    //     the tool does not remove its guidance. Shadow it in the same
    //     transaction so the two can never disagree.
    const prompt = systemPromptOf(agentCtx)
    if (prompt !== undefined) {
      rollback.push(shadowOppositeShellPrompt(prompt, opposite))
      debug(`shadowed prompt section ${shellPromptSection(opposite)}`)
    }

    // (6) Final consistency check.
    verifyAgentShell(tools, scope, target, opposite)
    const after = visibleToolNames(tools, scope)
    debug(`after: bash=${after.has('bash')} pwsh=${after.has('pwsh')}`)

    return {
      kind: 'adapted',
      target,
      opposite,
      capability,
      mountedTarget: ensured.mounted,
      restrictedOpposite: restriction !== undefined,
    }
  } catch (error) {
    undo()
    if (error instanceof ShellSelectorAgentAdaptationError) throw error
    throw new ShellSelectorAgentAdaptationError(target, String((error as Error)?.message ?? error), {
      cause: error,
    })
  }
}

/**
 * Reconcile one prompt assembly with a completed adaptation.
 *
 * rc.6 computes `assembly.tools` and `assembly.sections` BEFORE running the
 * `system-prompt/assemble` waterfall, so a listener receives a snapshot taken
 * at entry. If an assembly were ever entered while the adaptation was still in
 * flight, that snapshot would describe the un-adapted agent — and a router that
 * picks its platform shell from `assembly.tools` would read the wrong catalog.
 *
 * This re-derives the shell rows from the LIVE tool view and drops the opposite
 * guidance by section identity, so the tool schema and the prompt the model
 * receives always agree with the host executor.
 */
export function reconcileAssembly(
  assembly: Rc6PromptAssembly,
  outcome: AdaptationOutcome,
  tools: Rc6ToolsService,
  scope: unknown,
): Rc6PromptAssembly {
  if (outcome.kind === 'noop-no-capability') return assembly
  const { target, opposite } = outcome

  const nextTools = assembly.tools.filter((tool) => tool.name !== opposite)
  // Only the native wire carries end-capability tools; in Code Mode the wire
  // holds `run_code` and the shells live in the SDK, so nothing is appended.
  const native = (tools.modeFor?.(scope) ?? 'native') === 'native'
  if (native && !nextTools.some((tool) => tool.name === target)) {
    const definition = tools.view(scope).visible.get(target)
    if (definition !== undefined) {
      nextTools.push({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      })
    }
  }

  return {
    ...assembly,
    tools: nextTools,
    sections: assembly.sections.filter((section) => section.name !== shellPromptSection(opposite)),
  }
}
