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

import type { Context } from '@deepseek-ai/cordis'
import type { ShellId } from '../resolver.js'

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
export const EXECUTOR_CLASS_KINDS: Readonly<Record<string, ShellId>> = {
  SandboxBashExecutor: 'bash',
  // The base class is `LocalBashExecutor`, NOT `BashLocalExecutor`. A transposed
  // key leaves a non-sandbox bash composition probing as `undefined`, which the
  // caller then reads as "no shell composed" and falls back to a wrong guess.
  LocalBashExecutor: 'bash',
  SandboxPwshExecutor: 'pwsh',
  PwshLocalExecutor: 'pwsh',
}

/** The Windows PowerShell 5.1 launcher, lower-cased for comparison. */
const WINDOWS_POWERSHELL_BASENAME = 'powershell.exe'

/**
 * Read the pwsh executable without ever throwing.
 *
 * `pwshPath` is a getter on `PwshLocalExecutor` that resolves the configured
 * executable. A resolution failure must not downgrade a working executor to
 * "unknown", so the error is swallowed and `undefined` returned.
 */
function pwshExecutableOf(shell: object): string | undefined {
  try {
    const value = (shell as { pwshPath?: unknown }).pwshPath
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** Whether a resolved path points at the Windows PowerShell 5.1 executable. */
function isWindowsPowerShell(executable: string | undefined): boolean {
  if (executable === undefined) return false
  const basename = executable.split(/[\\/]/u).pop() ?? ''
  return basename.toLowerCase() === WINDOWS_POWERSHELL_BASENAME
}

/**
 * Report the shell the host composed, or `undefined` when it cannot be known.
 *
 * @param ctx - the plugin context (the service is global, so any context sees it).
 * @returns `'bash'`, `'pwsh'`, `'powershell'`, or `undefined`.
 */
export function detectComposedShell(ctx: Context): ShellId | undefined {
  // The "never throws" promise has to cover the READS, not just `pwshPath`:
  // `ctx.shell`, `.constructor` and `.name` are all attacker-shaped surface
  // (a throwing getter, a Proxy `get` trap) and none of them is ours. The
  // specific `try/catch` inside `pwshExecutableOf` is kept separate on purpose —
  // it carries a different meaning, that a resolution failure must not
  // downgrade a KNOWN executor to "unknown".
  try {
    const shell = (ctx as Context & { shell?: unknown }).shell
    if (shell === null || typeof shell !== 'object') return undefined
    const name = (shell as { constructor?: { name?: unknown } }).constructor?.name
    if (typeof name !== 'string') return undefined
    // `EXECUTOR_CLASS_KINDS` is a plain object literal, so a bare index would
    // also reach inherited members: `constructor`, `toString`, `valueOf` and
    // `__proto__` each resolve to a truthy inherited value, slip past the
    // `kind === undefined` guard, and make an unrecognised provider report
    // `'pwsh'` instead of `undefined`. An own-property check rejects them while
    // keeping the exported shape a plain record.
    if (!Object.hasOwn(EXECUTOR_CLASS_KINDS, name)) return undefined
    const kind = EXECUTOR_CLASS_KINDS[name]
    if (kind === undefined) return undefined
    if (kind === 'bash') return 'bash'
    // PowerShell 7 and Windows PowerShell share one executor; the resolved
    // executable decides which family is really running.
    return isWindowsPowerShell(pwshExecutableOf(shell as object)) ? 'powershell' : 'pwsh'
  } catch {
    // Any input at all — however hostile — answers `undefined` instead of
    // throwing; callers fall back to their own prediction.
    return undefined
  }
}
