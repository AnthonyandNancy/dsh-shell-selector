/**
 * 简体中文 UI 文案（Shell 解析器设置页）。
 *
 * @module dsh-shell-selector/client/locale-zh
 */

import type { EnLocaleKey } from './en-US.js'

export const zh: Record<EnLocaleKey, string> = {
  nav: 'Shell 解析器',
  title: 'Shell 解析器',
  intro: '选择 DeepSeek Harness 执行 Shell 命令时使用的解析器。更改会立即保存，并在下次重启后生效。',
  activeBlock: '当前生效',
  afterRestartBlock: '重启后',
  mode: 'Shell 解析器',
  modeDefault: 'DSH 默认',
  modeDefaultHint: '跟随内置平台规则：macOS/Linux 使用 Bash，Windows 使用 PowerShell。',
  modeFallback: '自动降级（推荐）',
  modeFallbackHint: '按顺序使用第一个可用的 Shell：Bash → PowerShell 7 → Windows PowerShell。',
  modeExplicit: '指定 Shell',
  shell: '具体 Shell',
  shellBash: 'Bash',
  shellPwsh: 'PowerShell 7 (pwsh)',
  shellPowershell: 'Windows PowerShell',
  restartHint: '更改 Shell 解析器后，需要重启 DeepSeek Harness 才能生效。',
  detect: '重新检测',
  save: '保存',
  saving: '保存中…',
  saved: '设置已保存，重启 DeepSeek Harness 后生效。',
  warningMissing: '当前配置的 Shell 已无法检测到。',
  warningActiveMissing: '当前生效的 Shell 已无法检测到。',
  warningFallbackNone: '未检测到可用的 Shell 解析器。',
  warningGated: '当前默认 Agent Preset 为“{preset}”。选择“Shell Selector”预设后，Shell 解析器设置才会生效。',
  error: '出错了：{message}',
  detectedTitle: '本机检测到的 Shell',
  detectedNone: '无',
  versionUnknown: '版本未知',
  readOnly: '设置为只读，无法修改。',
}
