/**
 * Agent-preset bootstrap: makes the `shell-selector` preset visible to the
 * agent-presets service.
 *
 * The preset's tool rows (`tool-bash` / `tool-pwsh`) are what gives sessions
 * a shell tool matching the composed executor. Presets are discovered from
 * the shipped root and the user root (`$DSH_HOME/.agent-presets`); a preset
 * can only be contributed from a root, so this plugin materializes its preset
 * files into the user root at apply time (process startup, long before any
 * session mounts). The bundle patch points `agent-presets.config.default` at
 * the preset id.
 *
 * The write is idempotent and version-marked: an existing copy carrying this
 * plugin's marker is refreshed; a file WITHOUT the marker is treated as
 * user-authored and left untouched.
 *
 * @module dsh-shell-selector/preset
 */

import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SHELL_SELECTOR_PRESET_ID } from './settings.js'

/** First line marker identifying files owned by this plugin. */
function marker(version: string): string {
  return `# dsh-shell-selector ${version} — managed file, refreshed by the plugin; user edits are preserved only outside this marker.`
}

/** Package root (lib/ is one level below the package root). */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Absolute path of the preset directory this plugin manages. */
export function presetDirectory(home = resolveDshHome()): string {
  return join(home, '.agent-presets', SHELL_SELECTOR_PRESET_ID)
}

function ownedByUs(path: string, version: string): boolean {
  try {
    const first = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0] ?? ''
    return first.startsWith(`# dsh-shell-selector ${version}`)
  } catch {
    return false
  }
}

/**
 * Materialize (or refresh) the preset files. Synchronous and cheap: a few
 * hundred bytes at process startup, before any session can mount.
 *
 * @returns a short human-readable outcome for logging.
 */
export function ensurePreset(version: string, logger?: { info(msg: string): void; warn(msg: string): void }): string {
  const dir = presetDirectory()
  const compositionPath = join(dir, 'agent.cordis.yml')
  const metadataPath = join(dir, 'preset.yml')
  const composition = readFileSync(join(PACKAGE_ROOT, 'config', 'agent-presets', SHELL_SELECTOR_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  const metadata = readFileSync(join(PACKAGE_ROOT, 'config', 'agent-presets', SHELL_SELECTOR_PRESET_ID, 'preset.yml'), 'utf8')

  if (existsSync(compositionPath) && !ownedByUs(compositionPath, version)) {
    const message = `agent preset "${SHELL_SELECTOR_PRESET_ID}" exists without the dsh-shell-selector marker; leaving it untouched (remove it manually to let the plugin manage it).`
    logger?.warn?.(message)
    return message
  }

  mkdirSync(dir, { recursive: true })
  const tmpComposition = `${compositionPath}.tmp`
  const tmpMetadata = `${metadataPath}.tmp`
  writeFileSync(tmpComposition, `${marker(version)}\n${composition}`, 'utf8')
  writeFileSync(tmpMetadata, metadata, 'utf8')
  renameSync(tmpComposition, compositionPath)
  renameSync(tmpMetadata, metadataPath)
  const message = `agent preset "${SHELL_SELECTOR_PRESET_ID}" materialized at ${dir}`
  logger?.info?.(message)
  return message
}
