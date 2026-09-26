/**
 * Single source of truth for the boot-time composition expressions.
 *
 * `dsh-shell-selector` changes the shell stack at PROCESS STARTUP — never at
 * runtime. The swap happens in the composition layer, where the loader
 * evaluates `!!js` expressions while activating the executor rows
 * (`bash-sandbox` / `pwsh-sandbox`). Those expressions cannot import anything:
 * the loader evaluates them with `new Function("ctx", "expr", "with(ctx){return
 * eval(expr)}")` inside a bare Cordis context where only `process`, `Buffer`,
 * `fetch`, `globalThis` and the loader context itself (`ctx.baseUrl`) exist.
 * Everything below is therefore one self-contained JavaScript block, evaluated
 * verbatim by the Loader.
 *
 * Where the configuration lives moved in DSH 0.1.7-rc.1: the persisted
 * document is the profile patch row (`cordis.patch.yml` -> `- id:
 * shell-selector`), and `ctx.baseUrl` is the profile directory holding it. The
 * retired `$DSH_HOME/settings.yaml` stays as a second source, so an
 * installation that has not been migrated yet still resolves.
 *
 * The same decision is mirrored in TypeScript (`../resolver.ts`) for the
 * host-side runtime state; `tests/expressions.test.ts` evaluates these exact
 * strings against a fake `$DSH_HOME` and a fake profile directory, and asserts
 * they agree with the mirror.
 *
 * @module dsh-shell-selector/boot-expressions
 */
/**
 * The decision the process booted with. `platform` means "leave the shipped
 * platform rule untouched" (Bash on POSIX, PowerShell on Windows).
 */
export type BootKind = 'platform' | 'bash' | 'pwsh' | 'powershell';
/** Raw `shell-selector` configuration as the boot expressions read it. */
export interface BootConfig {
    mode: 'default' | 'fallback' | 'explicit';
    shell?: 'bash' | 'pwsh' | 'powershell';
}
/**
 * Helper block shared by every row expression. It defines all helpers and
 * computes `eff` (the effective decision). Every declaration lives inside the
 * outer arrow function so the Loader's `with(ctx)` object can never capture
 * them; only `process` resolves through the context chain, exactly like the
 * shipped base patch expressions.
 */
export declare const EXPRESSION_HELPERS: string;
/**
 * `bash-sandbox.disabled` — enable Bash exactly when the decision says Bash.
 * `platform` keeps the shipped rule: disabled on Windows.
 */
export declare const BASH_SANDBOX_DISABLED_EXPR: string;
/**
 * `pwsh-sandbox.disabled` — enable the PowerShell executor exactly when the
 * decision says pwsh/powershell. `platform` keeps the shipped rule: disabled
 * everywhere except Windows.
 */
export declare const PWSH_SANDBOX_DISABLED_EXPR: string;
/**
 * `pwsh-sandbox.config.pwshPath` — pin Windows PowerShell when the decision
 * says `powershell`; otherwise stay `undefined` so the executor's own
 * resolution chain (`%ProgramFiles%\PowerShell\7\pwsh.exe` → PATH → Windows
 * PowerShell) applies.
 */
export declare const PWSH_PATH_EXPR: string;
/** True when a config read means "leave the platform rule in charge". */
export declare function isPlatformDecision(kind: BootKind): boolean;
//# sourceMappingURL=expressions.d.ts.map