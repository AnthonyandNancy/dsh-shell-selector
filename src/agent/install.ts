/**
 * Wiring the Shell Tool adaptation into the agent lifecycle.
 *
 * Two host facts shape this module:
 *
 *  1. `agent/created` is dispatched through `ctx.serial(...)` on DSH 0.2.2-rc.1
 *     (it was a fire-and-forget `emit` on 0.1.7-rc.1 and earlier). `serial`
 *     AWAITS every listener and propagates a rejection to
 *     `registry.announce()`'s caller, so a throwing listener now fails agent
 *     creation outright instead of being logged. The listener below therefore
 *     never rejects: it starts the adaptation, keeps the promise, and re-raises
 *     from the awaited barrier instead.
 *  2. Mounting an official tool plugin is inherently asynchronous
 *     (`ctx.plugin()` activates one microtask later), so the adaptation cannot
 *     be completed synchronously inside that listener.
 *
 * Enforcement therefore moves to the one place that is BOTH awaited and ahead
 * of every model request: the agent-scoped `system-prompt/assemble` waterfall,
 * which builds the tool schema and the system prompt for each step. The barrier
 * awaits the adaptation, reconciles the shell surface, and THROWS if the
 * adaptation failed — so a mis-adapted agent fails loudly before its first LLM
 * request instead of quietly talking the wrong dialect.
 *
 * Because a preset registers its own `system-prompt/assemble` hook on the
 * standing scope before any agent scope exists, this agent-scope barrier always
 * runs nested inside it: the corrected catalog is what the preset's
 * `await next()` observes. That is what fixes `router-bootstrap: no platform
 * shell in catalog` at the source.
 *
 * @module dsh-shell-selector/agent/install
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ShellId } from '../resolver.js'
import {
  adaptAgentShell,
  reconcileAssembly,
  ShellSelectorAgentAdaptationError,
  type AdaptationOutcome,
  type AdaptAgentShellOptions,
  type AgentLike,
} from '../agent-shell.js'
import { agentScope, onAgentCreated, onPromptAssemble, toolsOf, type Rc6PromptAssembly } from '../compat/rc6-agent.js'

/** Whether verbose per-agent adaptation tracing is enabled. */
function debugEnabled(): boolean {
  const flag = process.env.DSH_SHELL_SELECTOR_DEBUG
  return flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false'
}

/**
 * Install the per-agent Shell Tool adaptation.
 *
 * @param ctx - the plugin context.
 * @param activeKind - the shell the host executor was composed with, or a
 *   getter for it. The getter is what production passes: this plugin's row is
 *   inserted before the executor rows, so the composed shell is corrected only
 *   after `apply()`, and an agent created later must adapt to that correction.
 * @param options - test seams, forwarded to {@link adaptAgentShell}.
 * @returns a disposer for the lifecycle listener.
 */
export function installAgentShellAdaptation(
  ctx: Context,
  activeKind: ShellId | (() => ShellId),
  options: AdaptAgentShellOptions = {},
): () => void {
  const verbose = debugEnabled()

  return onAgentCreated(ctx, (agent) => {
    const kind = typeof activeKind === 'function' ? activeKind() : activeKind
    const label = agent.id === undefined ? 'agent' : `agent "${agent.id}"`
    const debug = (message: string): void => {
      if (verbose) ctx.logger.debug('dsh-shell-selector: %s: %s', label, message)
    }

    // Kick the adaptation immediately. It settles within a microtask, so in
    // practice it is long done before the first assembly; the barrier below
    // makes that a guarantee rather than a race we happen to win.
    //
    // The listener must stay synchronous and non-throwing: 0.2.2-rc.1 awaits
    // it through `ctx.serial`, so a rejection here would fail agent creation.
    const adaptation = adaptAgentShell(agent as AgentLike, kind, { ...options, debug })
    // The rejection is re-raised by the barrier, which is the awaited path.
    // This handler only stops it from being an unhandled rejection when an
    // agent never assembles a prompt.
    adaptation.catch(() => {})

    const scope = agentScope(agent)

    onPromptAssemble(agent.ctx, async (_assembly, _context, next) => {
      let outcome: AdaptationOutcome
      try {
        outcome = await adaptation
      } catch (error) {
        // Fail THIS session clearly, before any model request, naming the real
        // cause — never let the agent proceed to be diagnosed later by a
        // downstream "no platform shell in catalog".
        if (error instanceof ShellSelectorAgentAdaptationError) throw error
        throw new ShellSelectorAgentAdaptationError(
          kind === 'bash' ? 'bash' : 'pwsh',
          String((error as Error)?.message ?? error),
          { cause: error },
        )
      }

      // 0.2.2-rc.1 changed this object: `next()` resolves the host's assembly,
      // which carries `sections`/`contexts`/`variables` and — depending on the
      // version — `tools`. Reconcile tolerates every shape.
      const assembled: Rc6PromptAssembly = await next()
      // A no-op adaptation leaves the host's assembly authoritative.
      if (outcome.kind !== 'adapted') return assembled
      const tools = toolsOf(agent.ctx)
      if (tools === undefined) return assembled
      return reconcileAssembly(assembled, outcome, tools, scope)
    })
  })
}
