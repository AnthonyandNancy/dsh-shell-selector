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
import type { Context } from '@deepseek-ai/cordis';
/** The model-facing name of a standard one-shot shell tool. */
export type ShellToolName = 'bash' | 'pwsh';
/**
 * The npm package that provides each shell tool.
 *
 * These are the OFFICIAL rc.6 tool plugins. Shell Selector never implements a
 * shell tool itself: mounting the official plugin is what preserves
 * `ctx.shell`, the sandbox and `sandbox_permissions`, user approval, jobs and
 * background execution, timeout and cancellation, `shellEnv`, result rendering
 * and the terminal UI presentation.
 */
export declare const SHELL_TOOL_PACKAGE: Readonly<Record<ShellToolName, string>>;
/**
 * The prompt section each official shell tool contributes.
 *
 * Verified in rc.6: `dsh-tool-bash` registers `tool:bash` and `dsh-tool-pwsh`
 * registers `tool:pwsh`, both at order 105. Prompt work is done by SECTION
 * IDENTITY through these names — never by string-replacing prose.
 */
export declare function shellPromptSection(tool: ShellToolName): string;
/** rc.6 order of the `tool:*` guidance sections (tools occupy 100-199). */
export declare const SHELL_PROMPT_SECTION_ORDER = 105;
/** A Cordis plugin object, as the official tool packages export it. */
export interface Rc6ToolPlugin {
    name?: string;
    inject?: unknown;
    apply(ctx: Context, config?: unknown): unknown;
}
/** One tool as the rc.6 registry stores it (`tools.view().visible` values). */
export interface Rc6ToolDefinition {
    name: string;
    description: string;
    parameters: unknown;
}
/** The result of `tools.view(scope)` in rc.6. */
export interface Rc6ToolView {
    /** Tools this scope resolves, after every layer's restrictions. */
    visible: Map<string, Rc6ToolDefinition>;
    /** Every name this scope knows, restricted or not. */
    knownNames: Set<string>;
    /** Names `tools.restrict()` will accept — INHERITED contributions only. */
    restrictableNames: Set<string>;
}
/**
 * The rc.6 `ctx.tools` service, narrowed to what this plugin uses.
 *
 * `restrict()` is scope-only: rc.6 throws when called on an unscoped context,
 * and it refuses names outside `view(scope).restrictableNames` — notably a tool
 * the SAME scope registered is NOT restrictable by that scope. Both behaviours
 * are load-bearing for the adaptation algorithm.
 */
export interface Rc6ToolsService {
    view(scope?: unknown): Rc6ToolView;
    restrict(filter: {
        allow?: string[];
        deny?: string[];
    }): () => void;
    modeFor?(scope?: unknown): string;
}
/** A prompt section as rc.6 accepts it. */
export interface Rc6PromptSection {
    name: string;
    order: number;
    text: string;
}
/** The rc.6 `ctx.systemPrompt` service, narrowed to what this plugin uses. */
export interface Rc6SystemPromptService {
    section(section: Rc6PromptSection): () => void;
}
/** One assembled prompt section (`assembly.sections` entries). */
export interface Rc6AssembledSection {
    name: string;
    text: string;
}
/**
 * The prompt assembly rc.6 hands to `system-prompt/assemble` listeners.
 *
 * IMPORTANT (verified): `tools` and `sections` are BOTH computed BEFORE the
 * waterfall runs. A listener therefore sees a snapshot, and any registration
 * performed during the waterfall does not retroactively appear in it. That is
 * exactly why the barrier in `../agent/verify.ts` re-derives from the live
 * services instead of trusting the snapshot.
 */
export interface Rc6PromptAssembly {
    sections: Rc6AssembledSection[];
    tools: Rc6ToolDefinition[];
    [key: string]: unknown;
}
/** The agent object carried by rc.6 `agent/created`. */
export interface Rc6Agent {
    id?: string;
    ctx: Context;
}
/**
 * The scope key rc.6 filters tool layers and prompt layers by.
 *
 * `tools.view(scope)` and `systemPrompt.assemble({ scope })` both key on the
 * agent object itself (the scope carrier), which is what `agent/created` hands
 * us. Passing the agent is the supported addressing.
 */
export declare function agentScope(agent: Rc6Agent): unknown;
/** Read `ctx.tools`, or `undefined` when no tool runtime is composed. */
export declare function toolsOf(ctx: Context): Rc6ToolsService | undefined;
/** Read `ctx.systemPrompt`, or `undefined` when no prompt service is composed. */
export declare function systemPromptOf(ctx: Context): Rc6SystemPromptService | undefined;
/** Whether a scope currently resolves a given tool name as visible. */
export declare function isToolVisible(tools: Rc6ToolsService, scope: unknown, name: string): boolean;
/** Whether `restrict()` would accept a name for this scope. */
export declare function isToolRestrictable(tools: Rc6ToolsService, scope: unknown, name: string): boolean;
/**
 * The tool names one scope resolves — the "catalog" the Agent Router reads.
 */
export declare function visibleToolNames(tools: Rc6ToolsService, scope: unknown): Set<string>;
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
export declare function mountPlugin(ctx: Context, plugin: Rc6ToolPlugin, config?: unknown): Promise<() => void>;
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
export declare function onPromptAssemble(ctx: Context, listener: (assembly: Rc6PromptAssembly, context: unknown, next: () => Promise<Rc6PromptAssembly>) => Promise<Rc6PromptAssembly>): () => void;
/** Subscribe to rc.6 `agent/created`. */
export declare function onAgentCreated(ctx: Context, listener: (agent: Rc6Agent) => void): () => void;
/**
 * Import an official tool plugin from the HOST's rc.6 runtime.
 *
 * A bare dynamic import resolves through the host installation, so the plugin
 * mounts the same module instance the host composed. Shell Selector must never
 * bundle its own copy of a DSH runtime.
 */
export declare function importShellToolPlugin(tool: ShellToolName): Promise<Rc6ToolPlugin>;
//# sourceMappingURL=rc6-agent.d.ts.map