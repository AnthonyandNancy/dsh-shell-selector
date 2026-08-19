/**
 * dsh-shell-selector — the host plugin.
 *
 * Product contract (see ARCHITECTURE.md): configuration changes are PERSISTED
 * and take effect on the NEXT process start. This plugin never replaces
 * `ctx.shell`, never unloads/reloads `tool-bash`/`tool-pwsh`, never restarts
 * anything. The shell swap happens at boot, in the composition layer, via the
 * bundle patch expressions (`cordis.patch.yml`).
 *
 * This apply() function therefore only: registers the settings namespace,
 * captures the immutable boot snapshot, prepares the Bash PATH for Git for
 * Windows, installs the per-agent Shell Tool adaptation, serves the Settings
 * endpoint, and reports the restart requirement.
 *
 * @module dsh-shell-selector
 */

import { readFileSync } from 'node:fs'
import { dirname, delimiter } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SHELL_SELECTOR_SETTINGS_NAMESPACE,
  ShellSelectorSchema,
} from './settings.js'
import { bashAvailability, pwshAvailability, windowsPowerShellAvailability } from './detector.js'
import { resolveEffective, resolvedShellKind, type EffectiveDecision } from './resolver.js'
import { createRuntimeSnapshot } from './runtime-snapshot.js'
import { DetectionCache, installShellSelectorWeb, type ShellSelectorBackend } from './web.js'
import { adaptAgentShell, type AgentLike } from './agent-shell.js'

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
 * When the active shell is Bash on Windows and the resolved Bash is a Git for
 * Windows installation that is not already on PATH, prepend its directory to
 * the current process PATH. This is the only supported way to make the
 * official `bash-local`/`bash-sandbox` executor (which spawns `bash`) reach a
 * Git Bash that was never manually added to PATH. The change is process-local
 * and never writes the registry or user environment.
 */
function prepareBashPath(platform: string, activeKind: ReturnType<typeof resolvedShellKind>): void {
  if (platform !== 'win32' || activeKind !== 'bash') return
  const bash = bashAvailability(platform)
  if (!bash.available || bash.path === undefined) return
  const dir = dirname(bash.path)
  const current = process.env.PATH ?? ''
  if (current.split(delimiter).some((part) => part.trim().toLowerCase() === dir.toLowerCase())) return
  process.env.PATH = `${dir}${delimiter}${current}`
  process.env.DSH_SHELL_SELECTOR_BASH_PATH = bash.path
}

/**
 * Plugin apply: register settings, capture the boot snapshot, prepare Bash
 * PATH, install the per-agent Shell Tool adaptation, install the Web endpoint,
 * and start background detection.
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
  const detection = new DetectionCache(platform)
  const bootDecision = resolveEffective(bootConfig, platform, detection.availability())
  const bootActiveKind = resolvedShellKind(bootDecision, platform)
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

  prepareBashPath(platform, bootActiveKind)

  // Agent capability is decided by each preset's composition; this listener
  // only hides the shell tool that does not match the active executor. It runs
  // before the first prompt and never grants Shell to a preset without it.
  ;(ctx as Context & { on(event: string, listener: (payload: { agent: AgentLike }) => void): unknown }).on('agent/created', (payload) => {
    try {
      adaptAgentShell(payload.agent, bootActiveKind)
    } catch (error) {
      ctx.logger.warn('dsh-shell-selector: failed to adapt agent shell tool: %s', String(error))
    }
  })

  const revisionOf = (): number => {
    const descriptor = ctx.settings.describe().find((row) => row.ns === SHELL_SELECTOR_SETTINGS_NAMESPACE)
    return descriptor?.revision ?? 0
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
