/**
 * English UI copy for the Shell Selector settings section.
 *
 * @module dsh-shell-selector/client/locale-en
 */

export const en = {
  nav: 'Shell Interpreter',
  title: 'Shell Interpreter',
  intro: 'Choose which shell DeepSeek Harness runs commands with. Changes are saved now and take effect on the next restart.',
  activeBlock: 'Currently active',
  afterRestartBlock: 'After restart',
  mode: 'Shell interpreter',
  modeDefault: 'DSH default',
  modeDefaultHint: 'Follow the built-in platform rule: Bash on macOS/Linux, PowerShell on Windows.',
  modeFallback: 'Auto fallback (recommended)',
  modeFallbackHint: 'Use the first available shell in this order: Bash → PowerShell 7 → Windows PowerShell.',
  modeExplicit: 'Specific shell',
  shell: 'Specific shell',
  shellBash: 'Bash',
  shellPwsh: 'PowerShell 7 (pwsh)',
  shellPowershell: 'Windows PowerShell',
  restartHint: 'Changes to the Shell interpreter take effect after restarting DeepSeek Harness.',
  detect: 'Re-detect',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Settings saved. Restart DeepSeek Harness to apply the change.',
  warningMissing: 'The configured Shell can no longer be detected.',
  warningActiveMissing: 'The currently active Shell can no longer be detected.',
  warningFallbackNone: 'No supported shell detected.',
  warningGated: 'The default agent preset is “{preset}”. Shell Selector settings take effect after selecting the “Shell Selector” preset.',
  error: 'Something went wrong: {message}',
  detectedTitle: 'Detected on this machine',
  detectedNone: 'None',
  versionUnknown: 'version unknown',
  readOnly: 'Settings are read-only.',
} as const

export type EnLocaleKey = keyof typeof en
