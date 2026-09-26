/**
 * Wiring the Shell Tool adaptation into the agent lifecycle.
 *
 * Two rc.6 facts shape this module, both verified against the installed
 * `@deepseek-ai/dsh@0.1.0-rc.6` tree:
 *
 *  1. `agent/created` is dispatched with a FIRE-AND-FORGET `emit`. A rejected
 *     async listener is only logged, so an async adaptation cannot make agent
 *     creation fail by rejecting.
 *  2. Mounting an official tool plugin is inherently asynchronous
 *     (`ctx.plugin()` activates one microtask later), so the adaptation cannot
 *     be completed synchronously inside that listener.
 *
 * Enforcement therefore moves to the one place that is BOTH awaited and ahead
 * of every model request: the agent-scoped `system-prompt/assemble` waterfall,
 * which builds the tool schema and the system prompt for each step. The barrier
 * awaits the adaptation, re-derives the shell rows from the live services, and
 * THROWS if the adaptation failed — so a mis-adapted agent fails loudly before
 * its first LLM request instead of quietly talking the wrong dialect.
 *
 * Because a preset registers its own `system-prompt/assemble` hook on the
 * standing scope before any agent scope exists, this agent-scope barrier always
 * runs nested inside it: the corrected catalog is what the preset's
 * `await next()` observes. That is what fixes `router-bootstrap: no platform
 * shell in catalog` at the source.
 *
 * @module dsh-shell-selector/agent/install
 */
import { adaptAgentShell, reconcileAssembly, ShellSelectorAgentAdaptationError, } from '../agent-shell.js';
import { agentScope, onAgentCreated, onPromptAssemble, toolsOf } from '../compat/rc6-agent.js';
/** Whether verbose per-agent adaptation tracing is enabled. */
function debugEnabled() {
    const flag = process.env.DSH_SHELL_SELECTOR_DEBUG;
    return flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false';
}
/**
 * Install the per-agent Shell Tool adaptation.
 *
 * @param ctx - the plugin context.
 * @param activeKind - the shell the host executor was composed with at boot.
 * @param options - test seams, forwarded to {@link adaptAgentShell}.
 * @returns a disposer for the lifecycle listener.
 */
export function installAgentShellAdaptation(ctx, activeKind, options = {}) {
    const verbose = debugEnabled();
    return onAgentCreated(ctx, (agent) => {
        const label = agent.id === undefined ? 'agent' : `agent "${agent.id}"`;
        const debug = (message) => {
            if (verbose)
                ctx.logger.debug('dsh-shell-selector: %s: %s', label, message);
        };
        // Kick the adaptation immediately. It settles within a microtask, so in
        // practice it is long done before the first assembly; the barrier below
        // makes that a guarantee rather than a race we happen to win.
        const adaptation = adaptAgentShell(agent, activeKind, { ...options, debug });
        // The listener's own rejection is only logged by rc.6, so it is not the
        // error path; the barrier re-raises. Keep the promise from being an
        // unhandled rejection when an agent never assembles a prompt.
        adaptation.catch(() => { });
        const scope = agentScope(agent);
        onPromptAssemble(agent.ctx, async (_assembly, _context, next) => {
            let outcome;
            try {
                outcome = await adaptation;
            }
            catch (error) {
                // Fail THIS session clearly, before any model request, naming the real
                // cause — never let the agent proceed to be diagnosed later by a
                // downstream "no platform shell in catalog".
                if (error instanceof ShellSelectorAgentAdaptationError)
                    throw error;
                throw new ShellSelectorAgentAdaptationError(activeKind === 'bash' ? 'bash' : 'pwsh', String(error?.message ?? error), { cause: error });
            }
            const assembled = await next();
            const tools = toolsOf(agent.ctx);
            if (tools === undefined)
                return assembled;
            return reconcileAssembly(assembled, outcome, tools, scope);
        });
    });
}
//# sourceMappingURL=install.js.map