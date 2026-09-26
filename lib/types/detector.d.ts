/**
 * Shell detection: which interpreters does this machine provide, and can
 * DeepSeek Harness actually use them?
 *
 * The availability rules mirror the boot expressions: a shell is reported
 * only when the DSH executor would be able to spawn it. Git for Windows Bash
 * is discovered from PATH, from `git.exe` roots, and from well-known install
 * locations, then validated with a real `bash --version` + `$BASH_VERSION`
 * probe before it is considered available.
 *
 * @module dsh-shell-selector/detector
 */
import type { ShellAvailability } from './resolver.js';
import type { DetectedShell, ShellSource } from './types.js';
/** A discovered Bash candidate. */
export interface BashCandidate {
    path: string;
    source: ShellSource;
}
/**
 * Discover Bash candidates on Windows. Order matters: PATH entries first,
 * then roots derived from `git.exe`, then well-known Git for Windows
 * locations. The WSL launcher is rejected at every step.
 */
export declare function bashCandidates(platform?: string, env?: NodeJS.ProcessEnv): BashCandidate[];
/**
 * Synchronously validate one Bash executable and return its version string.
 * Both `--version` and a `$BASH_VERSION` probe must succeed; a miss returns
 * `undefined`, never throws.
 */
export declare function probeBashSync(path: string, env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Bash availability. On Windows every candidate is discovered through
 * {@link bashCandidates} and validated with a real spawn probe; the WSL
 * launcher is never reported. On POSIX the same probe is applied to PATH and
 * the standard fallback directories.
 */
export declare function bashAvailability(platform?: string, env?: NodeJS.ProcessEnv): {
    available: boolean;
    path?: string;
    version?: string;
    source?: ShellSource;
};
/**
 * PowerShell 7 availability, using DSH's own candidate list
 * (`%ProgramFiles%\PowerShell\7` → PATH), so the detector agrees with
 * `dsh-pwsh-local`'s `resolvePwshPath`.
 */
export declare function pwshAvailability(env?: NodeJS.ProcessEnv): {
    available: boolean;
    path?: string;
};
/** Windows PowerShell availability: the inbox v1.0 executable only. */
export declare function windowsPowerShellAvailability(platform?: string, env?: NodeJS.ProcessEnv): {
    available: boolean;
    path?: string;
};
/** Full availability map for the resolver. */
export declare function detectAvailability(platform?: string, env?: NodeJS.ProcessEnv): ShellAvailability;
/**
 * Full detection: availability + executable paths + best-effort versions.
 * Bash is validated synchronously with a real probe; PowerShell versions are
 * probed concurrently with a per-process timeout.
 */
export declare function detect(platform?: string, env?: NodeJS.ProcessEnv): Promise<DetectedShell[]>;
/** Synchronous availability probe for the boot-time state (with Bash validation). */
export declare function detectSync(platform?: string, env?: NodeJS.ProcessEnv): DetectedShell[];
//# sourceMappingURL=detector.d.ts.map