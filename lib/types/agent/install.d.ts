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
import type { Context } from '@deepseek-ai/cordis';
import type { ShellId } from '../resolver.js';
import { type AdaptAgentShellOptions } from '../agent-shell.js';
/**
 * Install the per-agent Shell Tool adaptation.
 *
 * @param ctx - the plugin context.
 * @param activeKind - the shell the host executor was composed with at boot.
 * @param options - test seams, forwarded to {@link adaptAgentShell}.
 * @returns a disposer for the lifecycle listener.
 */
export declare function installAgentShellAdaptation(ctx: Context, activeKind: ShellId, options?: AdaptAgentShellOptions): () => void;
//# sourceMappingURL=install.d.ts.map