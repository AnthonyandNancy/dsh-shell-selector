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
import type { Context } from '@deepseek-ai/cordis';
import type { ShellId } from './resolver.js';
import { type Rc6Agent, type Rc6PromptAssembly, type Rc6SystemPromptService, type Rc6ToolPlugin, type Rc6ToolsService, type ShellToolName } from './compat/rc6-agent.js';
/** The agent-shaped object exposed by `agent/created` events. */
export type AgentLike = Rc6Agent;
/** Raised when the agent's shell surface could not be brought to its target. */
export declare class ShellSelectorAgentAdaptationError extends Error {
    readonly name = "ShellSelectorAgentAdaptationError";
    /** The tool the active shell required. */
    readonly target: ShellToolName;
    constructor(target: ShellToolName, detail: string, options?: {
        cause?: unknown;
    });
}
/** The model-facing tool name for a resolved shell kind. */
export declare function activeShellTool(activeKind: ShellId): ShellToolName;
/** The other standard shell tool. */
export declare function oppositeShellTool(target: ShellToolName): ShellToolName;
/** What the agent's composition granted BEFORE the selector touched it. */
export interface ShellCapability {
    /** `tool-bash` was visible pre-adaptation. */
    hadBash: boolean;
    /** `tool-pwsh` was visible pre-adaptation. */
    hadPwsh: boolean;
    /**
     * The preset granted the standard Shell capability in some dialect.
     *
     * This is the ONLY gate on granting a shell. It is read before any
     * modification, because the adaptation itself changes what is visible.
     */
    shellCapable: boolean;
}
/** Read the pre-adaptation shell capability of one agent scope. */
export declare function inspectShellCapability(tools: Rc6ToolsService, scope: unknown): ShellCapability;
/** How the target tool came to be present. */
export interface EnsureTargetResult {
    /** True when this call mounted the official plugin (false = already there). */
    mounted: boolean;
    /** Undo the mount; `undefined` when nothing was mounted. */
    dispose?: () => void;
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
export declare function ensureTargetShellTool(agentCtx: Context, tools: Rc6ToolsService, scope: unknown, target: ShellToolName, loadToolPlugin: (tool: ShellToolName) => Promise<Rc6ToolPlugin>): Promise<EnsureTargetResult>;
/**
 * Hide the shell tool that does not match the active executor.
 *
 * Only called AFTER the target is verified present, so the catalog can never
 * transit through an empty state. Returns `undefined` when the opposite was not
 * there to begin with.
 */
export declare function hideOppositeShellTool(agentCtx: Context, tools: Rc6ToolsService, scope: unknown, opposite: ShellToolName): (() => void) | undefined;
/**
 * Blank the opposite tool's guidance section for this agent.
 *
 * A same-named section registered on the agent scope SHADOWS the inherited one,
 * and rc.6 drops empty sections when rendering the prompt — so the opposite
 * dialect's guidance never reaches the model. This works on SECTION IDENTITY;
 * the plugin never rewrites prompt prose with string or regex replacement.
 */
export declare function shadowOppositeShellPrompt(prompt: Rc6SystemPromptService, opposite: ShellToolName): () => void;
/**
 * Assert the post-adaptation invariant, the one the Agent Router depends on.
 *
 * @throws ShellSelectorAgentAdaptationError when the surface is not exactly
 *   "target visible, opposite hidden".
 */
export declare function verifyAgentShell(tools: Rc6ToolsService, scope: unknown, target: ShellToolName, opposite: ShellToolName): void;
/** The result of adapting one agent. */
export type AdaptationOutcome = {
    /** The preset granted no shell; the selector added nothing. */
    kind: 'noop-no-capability';
} | {
    kind: 'adapted';
    target: ShellToolName;
    opposite: ShellToolName;
    capability: ShellCapability;
    /** The official target plugin was mounted by this adaptation. */
    mountedTarget: boolean;
    /** The opposite tool was restricted by this adaptation. */
    restrictedOpposite: boolean;
};
/** Optional seams, so tests need neither a live host nor the real tool packages. */
export interface AdaptAgentShellOptions {
    /** Resolve an official tool plugin. Defaults to importing from the host. */
    loadToolPlugin?: (tool: ShellToolName) => Promise<Rc6ToolPlugin>;
    /** Development diagnostics; silent in production unless debug is enabled. */
    debug?: (message: string) => void;
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
export declare function adaptAgentShell(agent: AgentLike, activeKind: ShellId, options?: AdaptAgentShellOptions): Promise<AdaptationOutcome>;
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
export declare function reconcileAssembly(assembly: Rc6PromptAssembly, outcome: AdaptationOutcome, tools: Rc6ToolsService, scope: unknown): Rc6PromptAssembly;
//# sourceMappingURL=agent-shell.d.ts.map