/**
 * Pure resolution logic for the shell-selector configuration.
 *
 * This module mirrors the boot expressions (`./boot/expressions.ts`) in
 * TypeScript so the host runtime can report exactly what the composition did
 * and what the next boot will do. `tests/expressions.test.ts` evaluates the
 * real expression strings against the same inputs and asserts agreement.
 *
 * @module dsh-shell-selector/resolver
 */
import type { BootKind } from './boot/expressions.js';
/** Shell identifiers a user may pin, when the platform offers them. */
export declare const SHELL_IDS: readonly ["bash", "pwsh", "powershell"];
export type ShellId = (typeof SHELL_IDS)[number];
/** Configuration modes. */
export declare const MODES: readonly ["default", "fallback", "explicit"];
export type ShellSelectorMode = (typeof MODES)[number];
/** The configuration model persisted in the `shell-selector` settings namespace. */
export interface ShellSelectorConfig {
    mode: ShellSelectorMode;
    shell?: ShellId;
}
/** Which shells the current machine actually provides (per latest detection). */
export interface ShellAvailability {
    bash: boolean;
    pwsh: boolean;
    powershell: boolean;
}
/**
 * The effective composition decision for one process start.
 *
 * `kind: 'platform'` means the shipped platform rule stays in charge (Bash on
 * POSIX, the PowerShell family on Windows). The `reason` explains how the
 * decision came to be, so the UI can distinguish "user asked, honored" from
 * "user asked, unavailable, safely recovered to DSH default".
 */
export interface EffectiveDecision {
    kind: BootKind;
    reason: 'platform-default' | 'fallback' | 'fallback-unavailable' | 'explicit' | 'explicit-unavailable';
    /** The configured shell id when the decision came from an explicit choice. */
    shell?: ShellId;
}
/**
 * Resolve one configuration against one platform and one availability
 * snapshot. Strictly mirrors `dshSsrEffective` in the boot expressions.
 *
 * @param config - the persisted configuration.
 * @param platform - `process.platform`.
 * @param availability - live detection results.
 */
export declare function resolveEffective(config: ShellSelectorConfig, platform: string, availability: ShellAvailability): EffectiveDecision;
/**
 * Resolve "what would the platform rule do" — the baseline every decision
 * compares against. Windows: PowerShell family (pwsh preferred, Windows
 * PowerShell as the executor's own fallback); POSIX: Bash.
 */
export declare function platformDefaultKind(platform: string): 'bash' | 'pwsh';
/**
 * The shell a decision actually composes: `platform` resolves through the
 * platform rule (Bash on POSIX, PowerShell family on Windows).
 */
export declare function resolvedShellKind(decision: EffectiveDecision, platform: string): ShellId;
/**
 * Semantic equality of two decisions for `restartRequired` computation.
 *
 * Decisions compare on the RESOLVED shell, never on raw configuration
 * strings: `default` on Windows and `explicit: pwsh` both compose the
 * PowerShell executor, so switching between them requires no restart.
 */
export declare function decisionsEqual(left: EffectiveDecision, right: EffectiveDecision, platform: string): boolean;
/**
 * Whether a restart would change the effective shell.
 *
 * @param booted - the immutable snapshot decision from this process start.
 * @param configured - the current (possibly just-saved) configuration.
 * @param platform - `process.platform`.
 * @param availability - detection results as of now.
 */
export declare function restartRequired(booted: EffectiveDecision, configured: ShellSelectorConfig, platform: string, availability: ShellAvailability): boolean;
/** The availability snapshot when nothing can be probed (safe defaults). */
export declare function emptyAvailability(): ShellAvailability;
//# sourceMappingURL=resolver.d.ts.map