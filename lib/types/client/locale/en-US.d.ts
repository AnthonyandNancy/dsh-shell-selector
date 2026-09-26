/**
 * English UI copy for the Shell Selector settings section.
 *
 * @module dsh-shell-selector/client/locale-en
 */
export declare const en: {
    readonly nav: "Shell Selector";
    readonly title: "Shell Selector";
    readonly intro: "Choose which shell DeepSeek Harness uses for commands. Changes are saved now and take effect on the next restart.";
    readonly loading: "Loading…";
    readonly activeBlock: "Currently active";
    readonly afterRestartBlock: "After restart";
    readonly mode: "Shell mode";
    readonly modeDescription: "Choose how DeepSeek Harness picks the shell interpreter.";
    readonly modeDefault: "DSH default";
    readonly modeDefaultHint: "Follow the built-in platform rule: Bash on macOS/Linux, PowerShell on Windows.";
    readonly modeFallback: "Auto fallback (recommended)";
    readonly modeFallbackHint: "Use the first available shell in this order: Bash → PowerShell 7 → Windows PowerShell.";
    readonly modeExplicit: "Specific shell";
    readonly modeExplicitHint: "Always use the shell selected below after restart.";
    readonly shell: "Shell";
    readonly shellDescription: "Choose the interpreter to use after DeepSeek Harness restarts.";
    readonly shellBash: "Bash";
    readonly shellPwsh: "PowerShell 7 (pwsh)";
    readonly shellPowershell: "Windows PowerShell";
    readonly restartHint: "Changes to the Shell selector take effect after restarting DeepSeek Harness.";
    readonly capabilityHint: "The Shell selector applies to Agent Presets that enable Shell capability. Presets without Shell capability never gain Shell access.";
    readonly detect: "Re-detect";
    readonly detecting: "Detecting…";
    readonly save: "Save";
    readonly saving: "Saving…";
    readonly saved: "Settings saved. Restart DeepSeek Harness to apply the change.";
    readonly warningMissing: "The configured Shell can no longer be detected.";
    readonly warningActiveMissing: "The currently active Shell can no longer be detected.";
    readonly warningFallbackNone: "No supported shell detected.";
    readonly error: "Something went wrong: {message}";
    readonly detectedTitle: "Available interpreters";
    readonly detectedNone: "None";
    readonly versionUnknown: "version unknown";
    readonly readOnly: "Settings are read-only.";
};
export type EnLocaleKey = keyof typeof en;
//# sourceMappingURL=en-US.d.ts.map