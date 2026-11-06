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
import { detectComposedShell } from './compat/executor-probe.js';
import { SHELL_PROMPT_SECTION_ORDER, SHELL_SECTION_ORDER_NAME, SHELL_TOOL_PACKAGE, agentScope, importShellToolPlugin, isNativeToolWire, isToolRestrictable, isToolVisible, mountPlugin, shellPromptSection, systemPromptOf, toolsOf, visibleToolNames, } from './compat/rc6-agent.js';
/** Raised when the agent's shell surface could not be brought to its target. */
export class ShellSelectorAgentAdaptationError extends Error {
    name = 'ShellSelectorAgentAdaptationError';
    /** The tool the active shell required. */
    target;
    constructor(target, detail, options) {
        super(`dsh-shell-selector: failed to adapt agent shell to ${target}: ${detail}`, options);
        this.target = target;
    }
}
/** The model-facing tool name for a resolved shell kind. */
export function activeShellTool(activeKind) {
    // PowerShell 7 and Windows PowerShell share ONE model-facing tool (`pwsh`);
    // they differ only in which executable the host executor spawns.
    return activeKind === 'bash' ? 'bash' : 'pwsh';
}
/** The other standard shell tool. */
export function oppositeShellTool(target) {
    return target === 'bash' ? 'pwsh' : 'bash';
}
/** Read the pre-adaptation shell capability of one agent scope. */
export function inspectShellCapability(tools, scope) {
    const hadBash = isToolVisible(tools, scope, 'bash');
    const hadPwsh = isToolVisible(tools, scope, 'pwsh');
    return { hadBash, hadPwsh, shellCapable: hadBash || hadPwsh };
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
export async function ensureTargetShellTool(agentCtx, tools, scope, target, loadToolPlugin) {
    if (isToolVisible(tools, scope, target))
        return { mounted: false };
    let plugin;
    try {
        plugin = await loadToolPlugin(target);
    }
    catch (error) {
        throw new ShellSelectorAgentAdaptationError(target, `the official tool package ${SHELL_TOOL_PACKAGE[target]} could not be loaded from the host runtime`, { cause: error });
    }
    try {
        const dispose = await mountPlugin(agentCtx, plugin);
        return { mounted: true, dispose };
    }
    catch (error) {
        throw new ShellSelectorAgentAdaptationError(target, `target tool "${target}" could not be registered on the agent scope`, { cause: error });
    }
}
/**
 * Hide the shell tool that does not match the active executor.
 *
 * Only called AFTER the target is verified present, so the catalog can never
 * transit through an empty state. Returns `undefined` when the opposite was not
 * there to begin with.
 */
export function hideOppositeShellTool(agentCtx, tools, scope, opposite) {
    if (!isToolVisible(tools, scope, opposite))
        return undefined;
    const agentTools = toolsOf(agentCtx);
    if (agentTools === undefined)
        return undefined;
    if (!isToolRestrictable(agentTools, scope, opposite)) {
        // rc.6 only lets a scope restrict INHERITED contributions. A visible but
        // unrestrictable opposite means our own scope registered it — which this
        // module never does — so the assumption behind the fix is broken.
        throw new Error(`opposite tool "${opposite}" is visible but not restrictable from the agent scope`);
    }
    return agentTools.restrict({ deny: [opposite] });
}
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
export function shadowOppositeShellPrompt(prompt, opposite) {
    const order = prompt.getSectionOrder?.(SHELL_SECTION_ORDER_NAME[opposite]) ?? SHELL_PROMPT_SECTION_ORDER;
    return prompt.section({
        name: shellPromptSection(opposite),
        order,
        text: '',
    });
}
/**
 * Assert the post-adaptation invariant, the one the Agent Router depends on.
 *
 * @throws ShellSelectorAgentAdaptationError when the surface is not exactly
 *   "target visible, opposite hidden".
 */
export function verifyAgentShell(tools, scope, target, opposite) {
    const visible = visibleToolNames(tools, scope);
    if (!visible.has(target)) {
        throw new ShellSelectorAgentAdaptationError(target, `target tool "${target}" is not visible after adaptation (catalog: ${describeCatalog(visible)})`);
    }
    if (visible.has(opposite)) {
        throw new ShellSelectorAgentAdaptationError(target, `opposite tool "${opposite}" is still visible after adaptation (catalog: ${describeCatalog(visible)})`);
    }
}
function describeCatalog(visible) {
    return visible.size === 0 ? '(empty)' : [...visible].sort().join(', ');
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
export async function adaptAgentShell(agent, activeKind, options = {}) {
    const agentCtx = agent.ctx;
    const tools = toolsOf(agentCtx);
    if (tools === undefined)
        return { kind: 'noop-no-capability' };
    const scope = agentScope(agent);
    const debug = options.debug ?? (() => { });
    // (1) Capability is read BEFORE any modification: it describes the preset's
    //     grant, and the adaptation is about to change what is visible.
    const capability = inspectShellCapability(tools, scope);
    debug(`agent shell capability before: bash=${capability.hadBash} pwsh=${capability.hadPwsh}; active=${activeKind}`);
    if (!capability.shellCapable) {
        // A no-shell preset stays a no-shell preset. This is a permission
        // boundary: the selector picks a dialect, it does not widen capability.
        debug('preset grants no standard shell capability; adding nothing');
        return { kind: 'noop-no-capability' };
    }
    const target = activeShellTool(activeKind);
    const opposite = oppositeShellTool(target);
    const loadToolPlugin = options.loadToolPlugin ?? importShellToolPlugin;
    // (0) DIALECT CONSISTENCY, before any side effect.
    //
    // `activeKind` is what this plugin decided; `ctx.shell` is what the host
    // actually composed. When they disagree — a bundle patch that never loaded, a
    // preset composed against a different executor — enforcing the target here
    // would mount a tool the executor cannot run and then hide the one it can.
    // Refusing is strictly better than damaging the preset: the preset's own
    // grant keeps working, and the caller reports the mismatch instead.
    const composed = detectComposedShell(agentCtx);
    if (composed !== undefined && activeShellTool(composed) !== target) {
        debug(`composed executor is ${composed} but the target is ${target}; not adapting`);
        return { kind: 'noop-mismatch', target, composed };
    }
    const rollback = [];
    const undo = () => {
        for (const dispose of rollback.reverse()) {
            try {
                dispose();
            }
            catch {
                // Rolling back is best-effort; the original failure is what matters.
            }
        }
        rollback.length = 0;
    };
    try {
        // (2) ADD BEFORE REMOVE.
        const ensured = await ensureTargetShellTool(agentCtx, tools, scope, target, loadToolPlugin);
        if (ensured.dispose !== undefined)
            rollback.push(ensured.dispose);
        if (ensured.mounted)
            debug(`installed scoped ${target}`);
        else
            debug(`target ${target} already present; not registering it again`);
        // (3) Verify the target BEFORE removing anything.
        if (!isToolVisible(tools, scope, target)) {
            throw new ShellSelectorAgentAdaptationError(target, `target tool "${target}" is not visible after registration`);
        }
        // (4) Now, and only now, remove the mismatched dialect.
        const restriction = hideOppositeShellTool(agentCtx, tools, scope, opposite);
        if (restriction !== undefined) {
            rollback.push(restriction);
            debug(`restricted ${opposite}`);
        }
        // (5) Tool schema and prompt are two independent composition inputs; hiding
        //     the tool does not remove its guidance. Shadow it in the same
        //     transaction so the two can never disagree.
        const prompt = systemPromptOf(agentCtx);
        if (prompt !== undefined) {
            rollback.push(shadowOppositeShellPrompt(prompt, opposite));
            debug(`shadowed prompt section ${shellPromptSection(opposite)}`);
        }
        // (6) Final consistency check.
        verifyAgentShell(tools, scope, target, opposite);
        const after = visibleToolNames(tools, scope);
        debug(`after: bash=${after.has('bash')} pwsh=${after.has('pwsh')}`);
        return {
            kind: 'adapted',
            target,
            opposite,
            capability,
            mountedTarget: ensured.mounted,
            restrictedOpposite: restriction !== undefined,
        };
    }
    catch (error) {
        undo();
        if (error instanceof ShellSelectorAgentAdaptationError)
            throw error;
        throw new ShellSelectorAgentAdaptationError(target, String(error?.message ?? error), {
            cause: error,
        });
    }
}
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
export function reconcileAssembly(assembly, outcome, tools, scope) {
    // Every no-op outcome means "this agent was left exactly as composed".
    // Reconciling then would rewrite a surface the plugin deliberately did not
    // touch — and `noop-mismatch` carries no `opposite`, so the destructuring
    // below would not even be total.
    if (outcome.kind !== 'adapted')
        return assembly;
    const { target, opposite } = outcome;
    // The guidance section is a plain array on every host version; the opposite
    // section is dropped by name so a stale snapshot cannot leak its prose.
    const oppositeSection = shellPromptSection(opposite);
    const sections = Array.isArray(assembly.sections)
        ? assembly.sections.filter((section) => section.name !== oppositeSection)
        : assembly.sections;
    // 0.2.2-rc.1: `tools` is attached AFTER this waterfall, so it is absent here.
    // The registry is authoritative and already restricted; correct the snapshot
    // only when the host actually supplied one (0.1.7-rc.1 and earlier).
    const incoming = Array.isArray(assembly.tools) ? assembly.tools : undefined;
    if (incoming === undefined) {
        return { ...assembly, sections };
    }
    const nextTools = incoming.filter((tool) => tool.name !== opposite);
    // Only the native wire carries end-capability tools; in PTC/Code Mode the
    // wire holds `run_code` and the shells live in the SDK, so nothing is
    // appended. `modeFor` was removed in 0.2.2-rc.1, where this branch is dead
    // anyway because `tools` never reaches the listener.
    const native = isNativeToolWire(tools, scope);
    if (native && !nextTools.some((tool) => tool.name === target)) {
        const definition = tools.view(scope).visible.get(target);
        if (definition !== undefined) {
            nextTools.push({
                name: definition.name,
                description: definition.description,
                parameters: definition.parameters,
            });
        }
    }
    return { ...assembly, tools: nextTools, sections };
}
//# sourceMappingURL=agent-shell.js.map