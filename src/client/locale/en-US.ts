/**
 * English UI copy for the Shell Selector settings section.
 *
 * @module dsh-shell-selector/client/locale-en
 */

export const en = {
  nav: 'Shell Selector',
  title: 'Shell Selector',
  intro: 'Choose which shell DeepSeek Harness uses for commands. Changes are saved now and take effect on the next restart.',
  loading: 'Loading…',
  activeBlock: 'Currently active',
  afterRestartBlock: 'After restart',
  mode: 'Shell mode',
  modeDescription: 'Choose how DeepSeek Harness picks the shell interpreter.',
  modeDefault: 'DSH default',
  modeDefaultHint: 'Follow the built-in platform rule: Bash on macOS/Linux, PowerShell on Windows.',
  modeFallback: 'Auto fallback (recommended)',
  modeFallbackHint: 'Use the first available shell in this order: Bash → PowerShell 7 → Windows PowerShell.',
  modeExplicit: 'Specific shell',
  modeExplicitHint: 'Always use the shell selected below after restart.',
  shell: 'Shell',
  shellDescription: 'Choose the interpreter to use after DeepSeek Harness restarts.',
  shellBash: 'Bash',
  shellPwsh: 'PowerShell 7 (pwsh)',
  shellPowershell: 'Windows PowerShell',
  restartHint: 'Changes to the Shell selector take effect after restarting DeepSeek Harness.',
  capabilityHint: 'The Shell selector applies to Agent Presets that enable Shell capability. Presets without Shell capability never gain Shell access.',
  detect: 'Re-detect',
  detecting: 'Detecting…',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Settings saved. Restart DeepSeek Harness to apply the change.',
  warningMissing: 'The configured Shell can no longer be detected.',
  warningActiveMissing: 'The currently active Shell can no longer be detected.',
  warningFallbackNone: 'No supported shell detected.',
  error: 'Something went wrong: {message}',
  detectedTitle: 'Available interpreters',
  detectedNone: 'None',
  versionUnknown: 'version unknown',
  readOnly: 'Settings are read-only.',
} as const

export type EnLocaleKey = keyof typeof en
