/**
 * Which shell the host ACTUALLY composed for `ctx.shell`.
 *
 * `ctx.shell` is a single-implementation service (see
 * `@deepseek-ai/dsh-shell`: "one implementation per context; loading a second
 * throws"). Exactly one of the official executors provides it:
 *
 *   - `@deepseek-ai/dsh-bash-sandbox`  → `SandboxBashExecutor`
 *   - `@deepseek-ai/dsh-pwsh-sandbox`  → `SandboxPwshExecutor`
 *
 * which one won is a fact about the COMPOSITION, and it can contradict what this
 * plugin's own configuration predicted. The canonical contradiction: the package
 * is installed but absent from `dsh.profile.bundles`, so its bundle patch never
 * loads and the two executor rows keep the shipped platform rule. The plugin
 * would then believe `fallback` selected Git Bash while `SandboxPwshExecutor` is
 * the process's real `ctx.shell`.
 *
 * Adapting the agent surface to that wrong belief hides the one shell tool that
 * works, which surfaces to the user as
 * `agent-preset/invalid: tool-pwsh (@deepseek-ai/dsh-tool-pwsh): waiting for shell`
 * and a session that cannot be created. This module is the correction: read the
 * service, do not re-derive it.
 *
 * Returning `undefined` is a first-class answer — "no shell is composed" or
 * "this provider is not one I recognise". Callers must fall back to their own
 * prediction rather than guess.
 *
 * @module dsh-shell-selector/compat/executor-probe
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ShellId } from '../resolver.js';
/**
 * Executor class name → the shell it provides.
 *
 * Verified against the installed `@deepseek-ai/dsh@0.2.2-rc.1` tree:
 * `var LocalBashExecutor = class LocalBashExecutor extends ShellExecutor`,
 * `var SandboxBashExecutor = class SandboxBashExecutor extends LocalBashExecutor`
 * and `var SandboxPwshExecutor = class SandboxPwshExecutor extends PwshLocalExecutor`.
 * The non-sandbox locals keep the same naming for compositions without a sandbox
 * provider, so both families are listed.
 */
export declare const EXECUTOR_CLASS_KINDS: Readonly<Record<string, ShellId>>;
/**
 * Report the shell the host composed, or `undefined` when it cannot be known.
 *
 * @param ctx - the plugin context (the service is global, so any context sees it).
 * @returns `'bash'`, `'pwsh'`, `'powershell'`, or `undefined`.
 */
export declare function detectComposedShell(ctx: Context): ShellId | undefined;
//# sourceMappingURL=executor-probe.d.ts.map