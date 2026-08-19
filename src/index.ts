/**
 * dsh-shell-selector — the host plugin.
 *
 * Product contract (see ARCHITECTURE.md): configuration changes are PERSISTED
 * and take effect on the NEXT process start. This plugin never replaces
 * `ctx.shell`, never unloads/reloads `tool-bash`/`tool-pwsh`, never restarts
 * anything. The shell swap happens at boot, in the composition layer, via the
 * bundle patch expressions (`cordis.patch.yml`) and the `shell-selector`
 * agent preset.
 *
 * This apply() function therefore only: registers the settings namespace,
 * captures the immutable boot snapshot, materializes the agent preset,
 * serves the Settings endpoint, and reports the restart requirement.
 *
 * @module dsh-shell-selector
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  AGENT_PRESETS_SETTINGS_NAMESPACE,
  SHELL_SELECTOR_SETTINGS_NAMESPACE,
  ShellSelectorSchema,
} from './settings.js'
import { bashAvailability, pwshAvailability, windowsPowerShellAvailability } from './detector.js'
import { resolveEffective, type EffectiveDecision } from './resolver.js'
import { createRuntimeSnapshot } from './runtime-snapshot.js'
import { ensurePreset } from './preset.js'
import { DetectionCache, installShellSelectorWeb, type ShellSelectorBackend } from './web.js'

/** Stable Cordis plugin name (the bundle patch inserts a row with this package). */
export const name = 'shell-selector'

/** The settings service must exist before this plugin registers its namespace. */
export const inject = ['settings']

function readPluginVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Read the agent-presets GATE exactly like the boot expressions do: from the
 * raw settings file, user layer only. The composition decides with this same
 * input, so the snapshot must too.
 */
function readBootGate(): boolean {
  try {
    const home = resolveDshHome()
    const text = readFileSync(join(home, 'settings.yaml'), 'utf8')
    try {
      const root = JSON.parse(text) as unknown
      const gate = root !== null && typeof root === 'object' && !Array.isArray(root)
        ? (root as Record<string, unknown>)['agent-presets']
        : undefined
      const section = gate !== null && typeof gate === 'object' && !Array.isArray(gate)
        ? (gate as Record<string, unknown>)
        : undefined
      const value = section?.['default']
      return typeof value === 'string' && value !== 'shell-selector'
    } catch {
      // fall through to the flat parse
    }
    let inSection = false
    let gated = false
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/u, '')
      if (/^[A-Za-z0-9_-]+:\s*$/u.test(line)) {
        inSection = line === 'agent-presets:'
        continue
      }
      if (!inSection) continue
      if (line.trim() === '') continue
      if (!/^\s/u.test(raw)) {
        inSection = false
        continue
      }
      const m = /^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/u.exec(line)
      if (!m) continue
      if (m[1] === 'default') gated = m[2]!.replace(/^["']|["']$/gu, '') !== 'shell-selector'
    }
    return gated
  } catch {
    return false
  }
}

/** Resolve the executable the ACTIVE executor uses, for the snapshot. */
function snapshotExecutable(
  platform: string,
  decision: EffectiveDecision,
  bashPath: string | undefined,
  pwshPath: string | undefined,
  powershellPath: string | undefined,
): string | undefined {
  if (decision.kind === 'bash') return bashPath
  if (decision.kind === 'pwsh') return pwshPath
  if (decision.kind === 'powershell') return powershellPath
  // Platform default: the executor's own resolution — pwsh on Windows, bash elsewhere.
  return platform === 'win32' ? pwshPath : bashPath
}

/**
 * Plugin apply: register settings, capture the boot snapshot, materialize the
 * preset, install the Web endpoint, and start background detection.
 */
export function apply(ctx: Context): () => void {
  const pluginVersion = readPluginVersion()
  const platform = process.platform
  const settingsScope = ctx.settings.register(SHELL_SELECTOR_SETTINGS_NAMESPACE, ShellSelectorSchema, {
    base: { mode: 'default' },
    applies: 'restart',
  })

  // Boot facts, captured once and never revisited.
  const bootConfig = settingsScope.get()
  const bootGate = readBootGate()
  const detection = new DetectionCache(platform)
  const bootDecision = resolveEffective(bootConfig, platform, detection.availability(), bootGate)
  const snapshot = createRuntimeSnapshot({
    platform,
    config: bootConfig,
    decision: bootDecision,
    executable: snapshotExecutable(
      platform,
      bootDecision,
      bashAvailability(platform).path,
      pwshAvailability().path,
      windowsPowerShellAvailability(platform).path,
    ),
  })

  // Preset must exist before any session mounts; apply() runs at startup.
  try {
    ensurePreset(pluginVersion, { info: (msg) => ctx.logger.info(msg), warn: (msg) => ctx.logger.warn(msg) })
  } catch (error) {
    ctx.logger.error('dsh-shell-selector: failed to materialize the agent preset; sessions may not start. %s', error instanceof Error ? error.message : String(error))
  }

  const revisionOf = (): number => {
    const descriptor = ctx.settings.describe().find((row) => row.ns === SHELL_SELECTOR_SETTINGS_NAMESPACE)
    return descriptor?.revision ?? 0
  }

  const isGated = (): boolean => {
    const resolved = ctx.settings.get(AGENT_PRESETS_SETTINGS_NAMESPACE)
    const value = resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)['default']
      : undefined
    if (typeof value === 'string') return value !== 'shell-selector'
    return readBootGate()
  }

  const defaultAgentPreset = (): string | undefined => {
    const resolved = ctx.settings.get(AGENT_PRESETS_SETTINGS_NAMESPACE)
    const value = resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)
      ? (resolved as Record<string, unknown>)['default']
      : undefined
    return typeof value === 'string' ? value : undefined
  }

  const backend: ShellSelectorBackend = {
    pluginVersion,
    platform,
    snapshot,
    snapshotDecision: bootDecision,
    settings: {
      get: () => settingsScope.get(),
      // CAS lives on the provider surface (the scope has no revision param).
      replace: (section, expectedRevision) =>
        ctx.settings.replace(SHELL_SELECTOR_SETTINGS_NAMESPACE, section, expectedRevision),
    },
    availability: () => detection.availability(),
    detected: () => detection.detected(),
    refreshDetection: () => detection.refresh(platform),
    isGated,
    defaultAgentPreset,
    revision: revisionOf,
    writable: () => (ctx.settings as unknown as { writable?: boolean }).writable ?? true,
  }

  // Web routes only when a web server is present (web profile); the fiber is
  // owned by the plugin's dispose tree, so route cleanup happens through
  // `webCtx.effect`.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => installShellSelectorWeb(webCtx, backend), 'dsh-shell-selector: web routes')
  })

  // Kick the version probe in the background; state stays available immediately.
  void detection.refresh(platform).catch(() => {})

  ctx.logger.info(
    'dsh-shell-selector: active shell %s (mode %s)%s; restartRequired on next settings change.',
    snapshot.kind,
    snapshot.mode,
    snapshot.shell === undefined ? '' : `, shell ${snapshot.shell}`,
  )

  return () => {
    // dispose() on the plugin tears down the inject fiber and its effects.
  }
}
