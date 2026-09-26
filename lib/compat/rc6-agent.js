/**
 * The ONE place that speaks to DeepSeek Harness 0.1.0-rc.6 internals.
 *
 * rc.6 does not ship `.d.ts` files for `@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/dsh-system-prompt`, or `@deepseek-ai/dsh-agent`, and it does
 * not export the agent-scope tool/prompt surfaces as public types. Rather than
 * scatter `as Context & { ... }` casts through the business logic, every
 * structural assumption about rc.6 lives here, each one annotated with the
 * empirical observation that justifies it. When rc.7 changes an interface,
 * this file is the only one that moves.
 *
 * Everything below was verified against the installed
 * `@deepseek-ai/dsh@0.1.0-rc.6` tree, not against DSH master.
 *
 * @module dsh-shell-selector/compat/rc6-agent
 */
/**
 * The npm package that provides each shell tool.
 *
 * These are the OFFICIAL rc.6 tool plugins. Shell Selector never implements a
 * shell tool itself: mounting the official plugin is what preserves
 * `ctx.shell`, the sandbox and `sandbox_permissions`, user approval, jobs and
 * background execution, timeout and cancellation, `shellEnv`, result rendering
 * and the terminal UI presentation.
 */
export const SHELL_TOOL_PACKAGE = {
    bash: '@deepseek-ai/dsh-tool-bash',
    pwsh: '@deepseek-ai/dsh-tool-pwsh',
};
/**
 * The prompt section each official shell tool contributes.
 *
 * Verified in rc.6: `dsh-tool-bash` registers `tool:bash` and `dsh-tool-pwsh`
 * registers `tool:pwsh`, both at order 105. Prompt work is done by SECTION
 * IDENTITY through these names — never by string-replacing prose.
 */
export function shellPromptSection(tool) {
    return `tool:${tool}`;
}
/** rc.6 order of the `tool:*` guidance sections (tools occupy 100-199). */
export const SHELL_PROMPT_SECTION_ORDER = 105;
/**
 * The scope key rc.6 filters tool layers and prompt layers by.
 *
 * `tools.view(scope)` and `systemPrompt.assemble({ scope })` both key on the
 * agent object itself (the scope carrier), which is what `agent/created` hands
 * us. Passing the agent is the supported addressing.
 */
export function agentScope(agent) {
    return agent;
}
/** Read `ctx.tools`, or `undefined` when no tool runtime is composed. */
export function toolsOf(ctx) {
    const service = ctx.tools;
    if (service === null || typeof service !== 'object')
        return undefined;
    const candidate = service;
    if (typeof candidate.view !== 'function' || typeof candidate.restrict !== 'function')
        return undefined;
    return service;
}
/** Read `ctx.systemPrompt`, or `undefined` when no prompt service is composed. */
export function systemPromptOf(ctx) {
    const service = ctx.systemPrompt;
    if (service === null || typeof service !== 'object')
        return undefined;
    const candidate = service;
    if (typeof candidate.section !== 'function')
        return undefined;
    return service;
}
/** Whether a scope currently resolves a given tool name as visible. */
export function isToolVisible(tools, scope, name) {
    return tools.view(scope).visible.has(name);
}
/** Whether `restrict()` would accept a name for this scope. */
export function isToolRestrictable(tools, scope, name) {
    return tools.view(scope).restrictableNames.has(name);
}
/**
 * The tool names one scope resolves — the "catalog" the Agent Router reads.
 */
export function visibleToolNames(tools, scope) {
    return new Set(tools.view(scope).visible.keys());
}
/**
 * Mount a plugin on a context and WAIT for activation.
 *
 * Verified in rc.6: `ctx.plugin()` is asynchronous — the tool is NOT visible
 * synchronously after the call and becomes visible one microtask later. The
 * returned fiber's `await()` is the only correct completion signal, and it
 * REJECTS when the plugin's `apply()` throws, leaving the scope untouched.
 *
 * The returned disposer removes the mount, which is what makes the adaptation
 * transactional.
 */
export async function mountPlugin(ctx, plugin, config) {
    const fiber = ctx.plugin(plugin, config);
    await fiber.await();
    return () => {
        fiber.dispose();
    };
}
/**
 * Register a scoped `system-prompt/assemble` listener.
 *
 * Registered through the AGENT's context, so rc.6 scope-filters the dispatch
 * to that agent and disposes the listener with it. Because a preset's own
 * listener is registered on the standing scope BEFORE the agent scope exists,
 * an agent-scope listener always runs NESTED INSIDE it — so what this listener
 * returns is what the preset's `await next()` observes. That nesting is what
 * lets the fix reach a router that picks its platform shell from the catalog.
 */
export function onPromptAssemble(ctx, listener) {
    const events = ctx;
    return events.on('system-prompt/assemble', listener);
}
/** Subscribe to rc.6 `agent/created`. */
export function onAgentCreated(ctx, listener) {
    const events = ctx;
    return events.on('agent/created', (payload) => {
        listener(payload.agent);
    });
}
/**
 * Import an official tool plugin from the HOST's rc.6 runtime.
 *
 * A bare dynamic import resolves through the host installation, so the plugin
 * mounts the same module instance the host composed. Shell Selector must never
 * bundle its own copy of a DSH runtime.
 */
export async function importShellToolPlugin(tool) {
    const specifier = SHELL_TOOL_PACKAGE[tool];
    const module = (await import(specifier));
    const candidate = (typeof module.apply === 'function' ? module : module.default);
    if (candidate === undefined || typeof candidate.apply !== 'function') {
        throw new Error(`${specifier} does not export a Cordis plugin with apply()`);
    }
    return candidate;
}
//# sourceMappingURL=rc6-agent.js.map