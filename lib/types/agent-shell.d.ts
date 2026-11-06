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
 * On DSH 0.2.2-rc.1 the model-facing schema is owned by the tool registry's
 * prompt provider, not by the assembly, so step 4 is what actually removes the
 * tool from what the model sees; {@link reconcileAssembly} only handles the
 * guidance section there. See `./compat/rc6-agent.ts` for the host code path.
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
 * and the host drops empty sections when rendering the prompt — so the opposite
 * dialect's guidance never reaches the model. This works on SECTION IDENTITY;
 * the plugin never rewrites prompt prose with string or regex replacement.
 *
 * The order is read from the host's own placement table when it exposes one
 * (`getSectionOrder`, 0.2.1+), because 0.2.2-rc.1 moved the `tool:*` orders into
 * central `SECTION_ORDERS`; the pinned constant is only a fallback.
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
 * Bring one prompt assembly in line with a completed adaptation.
 *
 * ## What changed in DSH 0.2.2-rc.1
 *
 * The old contract handed listeners an assembly that already contained `tools`,
 * so this function could rewrite the model-facing schema in place. 0.2.2-rc.1
 * moved the schema to a tool provider: `assemble()` builds
 * `{ sections, contexts, variables }`, runs the waterfall, and only THEN
 * attaches `tools`. A listener therefore receives an assembly with **no `tools`
 * key**, and the previous `assembly.tools.filter(...)` was
 * `TypeError: Cannot read properties of undefined (reading 'filter')`.
 *
 * The schema no longer needs rewriting here at all: the provider re-derives
 * `definitions(scope, toolSet)` from the live registry on every assembly, so
 * `tools.restrict()` (already applied by the adaptation, before this listener
 * runs) is what removes the opposite tool from what the model sees. Reconcile
 * now only guarantees two things that the registry cannot state for itself:
 *
 *   1. the opposite dialect's guidance section is dropped from the prompt, and
 *   2. on hosts that DO carry `tools` in the assembly, the schema is corrected
 *      the old way — so this module keeps working on 0.1.7-rc.1 and on any
 *      future host that restores the field.
 *
 * It is idempotent and side-effect free: it never mutates `assembly`.
 */
export declare function reconcileAssembly(assembly: Rc6PromptAssembly, outcome: AdaptationOutcome, tools: Rc6ToolsService, scope: unknown): Rc6PromptAssembly;
//# sourceMappingURL=agent-shell.d.ts.map