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
  loading: '加载中…',
  activeBlock: '当前生效',
  afterRestartBlock: '重启后',
  mode: 'Shell 模式',
  modeDescription: '选择 DSH 使用 Shell 的解析策略。',
  modeDefault: 'DSH 默认',
  modeDefaultHint: '跟随内置平台规则：macOS/Linux 使用 Bash，Windows 使用 PowerShell。',
  modeFallback: '自动降级（推荐）',
  modeFallbackHint: '按顺序使用第一个可用的 Shell：Bash → PowerShell 7 → Windows PowerShell。',
  modeExplicit: '指定 Shell',
  modeExplicitHint: '重启后始终使用下方选择的 Shell。',
  shell: 'Shell',
  shellDescription: '选择重启后执行 Shell 命令时使用的解析器。',
  shellBash: 'Bash',
  shellPwsh: 'PowerShell 7 (pwsh)',
  shellPowershell: 'Windows PowerShell',
  restartHint: '更改 Shell 解析器后，需要重启 DeepSeek Harness 才能生效。',
  capabilityHint: 'Shell 解析器适用于启用了 Shell 能力的 Agent Preset。未启用 Shell 能力的 Agent 不会因此获得 Shell 权限。',
  detect: '重新检测',
  detecting: '检测中…',
  save: '保存',
  saving: '保存中…',
  saved: '设置已保存，重启 DeepSeek Harness 后生效。',
  warningMissing: '当前配置的 Shell 已无法检测到。',
  warningActiveMissing: '当前生效的 Shell 已无法检测到。',
  warningFallbackNone: '未检测到可用的 Shell 解析器。',
  error: '出错了：{message}',
  detectedTitle: '可用解析器',
  detectedNone: '无',
  versionUnknown: '版本未知',
  readOnly: '设置为只读，无法修改。',
}
