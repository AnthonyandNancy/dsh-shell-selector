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

import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { candidatePwshPaths } from '@deepseek-ai/dsh-pwsh-local'
import type { ShellAvailability } from './resolver.js'
import type { DetectedShell, ShellSource } from './types.js'

/** Windows Subsystem for Linux launcher: not a Bash we can claim. */
const WSL_BASH = join('System32', 'bash.exe')

/** Directories probed for `bash` on POSIX when PATH does not carry it. */
const POSIX_BASH_FALLBACK_DIRS = ['/bin', '/usr/bin', '/usr/local/bin']

/** Probe timeout per version read; a slow first start is a probe miss, not a hang. */
const VERSION_PROBE_TIMEOUT_MS = 5000

/** A discovered Bash candidate. */
export interface BashCandidate {
  path: string
  source: ShellSource
}

function isExecutableFile(path: string): boolean {
  try {
    const st = statSync(path)
    return st.isFile() || st.isSymbolicLink()
  } catch {
    return false
  }
}

/** PATH directories in process order, absolute. */
function pathDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const sep = process.platform === 'win32' ? ';' : ':'
  return String(env.PATH ?? '')
    .split(sep)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => join(part))
}

/** Resolve `exe` through PATH (plus extra directories), mirroring spawn(). */
function resolveInPath(exe: string, env: NodeJS.ProcessEnv, extraDirs: string[] = []): string | undefined {
  for (const dir of [...extraDirs, ...pathDirectories(env)]) {
    const full = join(dir, exe)
    if (isExecutableFile(full)) return full
  }
  return undefined
}

/** Full environment for spawned probes: process env overlaid with the supplied fake env. */
function probeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/** True when a Windows bash path is the WSL launcher under SystemRoot. */
function isWslBash(path: string, env: NodeJS.ProcessEnv): boolean {
  const sysRoot = String(env.SystemRoot ?? env.windir ?? 'C:\\Windows')
  return resolve(path).toLowerCase() === resolve(join(sysRoot, WSL_BASH)).toLowerCase()
}

function addCandidate(list: BashCandidate[], seen: Set<string>, path: string, source: ShellSource): void {
  const key = resolve(path).toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  list.push({ path: resolve(path), source })
}

function addGitRootCandidates(list: BashCandidate[], seen: Set<string>, root: string, source: ShellSource): void {
  addCandidate(list, seen, join(root, 'bin', 'bash.exe'), source)
  addCandidate(list, seen, join(root, 'usr', 'bin', 'bash.exe'), source)
}

/**
 * Discover Bash candidates on Windows. Order matters: PATH entries first,
 * then roots derived from `git.exe`, then well-known Git for Windows
 * locations. The WSL launcher is rejected at every step.
 */
export function bashCandidates(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): BashCandidate[] {
  if (platform !== 'win32') return []
  const seen = new Set<string>()
  const result: BashCandidate[] = []
  const add = (path: string, source: ShellSource): void => {
    if (!isExecutableFile(path) || isWslBash(path, env)) return
    addCandidate(result, seen, path, source)
  }

  for (const dir of pathDirectories(env)) {
    add(join(dir, 'bash.exe'), 'path')
  }

  for (const dir of pathDirectories(env)) {
    const git = join(dir, 'git.exe')
    if (!isExecutableFile(git)) continue
    const root = resolve(dir, '..')
    addGitRootCandidates(result, seen, root, 'git-for-windows')
  }

  const programFiles = String(env.ProgramFiles ?? 'C:\\Program Files')
  const programFilesX86 = String(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)')
  addGitRootCandidates(result, seen, join(programFiles, 'Git'), 'git-for-windows')
  addGitRootCandidates(result, seen, join(programFilesX86, 'Git'), 'git-for-windows')

  const localAppData = String(env.LOCALAPPDATA ?? '')
  if (localAppData.length > 0) {
    addGitRootCandidates(result, seen, join(localAppData, 'Programs', 'Git'), 'git-for-windows')
  }

  return result
}

/**
 * Synchronously validate one Bash executable and return its version string.
 * Both `--version` and a `$BASH_VERSION` probe must succeed; a miss returns
 * `undefined`, never throws.
 */
export function probeBashSync(path: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fullEnv = probeEnv(env)
  let version: string | undefined
  try {
    const versionResult = spawnSync(path, ['--version'], {
      encoding: 'utf8',
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: fullEnv,
    })
    if (versionResult.error !== undefined || versionResult.status !== 0) return undefined
    const text = String(versionResult.stdout ?? '').trim()
    version = text.split(/\r?\n/, 1)[0]?.trim() || undefined
  } catch {
    return undefined
  }
  try {
    const probe = spawnSync(path, ['-c', 'printf "%s" "$BASH_VERSION"'], {
      encoding: 'utf8',
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: fullEnv,
    })
    if (probe.error !== undefined || probe.status !== 0) return undefined
    if (String(probe.stdout ?? '').trim().length === 0) return undefined
  } catch {
    return undefined
  }
  return version
}

/**
 * Bash availability. On Windows every candidate is discovered through
 * {@link bashCandidates} and validated with a real spawn probe; the WSL
 * launcher is never reported. On POSIX the same probe is applied to PATH and
 * the standard fallback directories.
 */
export function bashAvailability(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): {
  available: boolean
  path?: string
  version?: string
  source?: ShellSource
} {
  if (platform !== 'win32') {
    const onPath = resolveInPath('bash', env)
    const found = onPath ?? POSIX_BASH_FALLBACK_DIRS.map((dir) => join(dir, 'bash')).find((full) => isExecutableFile(full))
    if (found === undefined) return { available: false }
    const version = probeBashSync(found, env)
    return version === undefined ? { available: false, path: found } : { available: true, path: found, version, source: 'system' }
  }
  for (const candidate of bashCandidates(platform, env)) {
    const version = probeBashSync(candidate.path, env)
    if (version !== undefined) {
      return { available: true, path: candidate.path, version, source: candidate.source }
    }
  }
  return { available: false }
}

/**
 * PowerShell 7 availability, using DSH's own candidate list
 * (`%ProgramFiles%\PowerShell\7` → PATH), so the detector agrees with
 * `dsh-pwsh-local`'s `resolvePwshPath`.
 */
export function pwshAvailability(env: NodeJS.ProcessEnv = process.env): { available: boolean; path?: string } {
  for (const candidate of candidatePwshPaths(env)) {
    if (isExecutableFile(candidate)) return { available: true, path: candidate }
  }
  return { available: false }
}

/** Windows PowerShell availability: the inbox v1.0 executable only. */
export function windowsPowerShellAvailability(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { available: boolean; path?: string } {
  if (platform !== 'win32') return { available: false }
  const sysRoot = String(env.SystemRoot ?? env.windir ?? 'C:\\Windows')
  const full = join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return isExecutableFile(full) ? { available: true, path: full } : { available: false }
}

/** Full availability map for the resolver. */
export function detectAvailability(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): ShellAvailability {
  return {
    bash: bashAvailability(platform, env).available,
    pwsh: pwshAvailability(env).available,
    powershell: windowsPowerShellAvailability(platform, env).available,
  }
}

/**
 * Version probe for one PowerShell executable. Best-effort: a miss yields
 * `undefined`, never a failure.
 */
function probePowerShellVersion(executable: string): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: VERSION_PROBE_TIMEOUT_MS,
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', () => {})
    const settle = (value: string | undefined): void => {
      child.kill()
      resolvePromise(value)
    }
    child.on('error', () => settle(undefined))
    child.on('close', (code) => {
      if (code !== 0) return settle(undefined)
      const text = Buffer.concat(chunks).toString('utf8').trim()
      const first = text.split(/\r?\n/, 1)[0]?.trim()
      settle(first === undefined || first === '' ? undefined : first)
    })
  })
}

/** Probe PowerShell versions concurrently; a slow shell delays the result, never blocks it forever. */
async function probePowerShellVersions(entries: { kind: 'pwsh' | 'powershell'; path: string }[]): Promise<Map<'pwsh' | 'powershell', string>> {
  const found = new Map<'pwsh' | 'powershell', string>()
  await Promise.all(
    entries.map(async (entry) => {
      const version = await probePowerShellVersion(entry.path)
      if (version !== undefined) found.set(entry.kind, version)
    }),
  )
  return found
}

/**
 * Full detection: availability + executable paths + best-effort versions.
 * Bash is validated synchronously with a real probe; PowerShell versions are
 * probed concurrently with a per-process timeout.
 */
export async function detect(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<DetectedShell[]> {
  const bash = bashAvailability(platform, env)
  const pwsh = pwshAvailability(env)
  const powershell = windowsPowerShellAvailability(platform, env)
  const versions = await probePowerShellVersions(
    [
      ...(pwsh.available && pwsh.path !== undefined ? [{ kind: 'pwsh' as const, path: pwsh.path }] : []),
      ...(powershell.available && powershell.path !== undefined ? [{ kind: 'powershell' as const, path: powershell.path }] : []),
    ],
  )
  const result: DetectedShell[] = []
  if (bash.available) {
    result.push({
      kind: 'bash',
      name: bash.source === 'git-for-windows' || bash.source === 'well-known' ? 'Git Bash' : 'Bash',
      ...(bash.path === undefined ? {} : { path: bash.path }),
      ...(bash.version === undefined ? {} : { version: bash.version }),
      ...(bash.source === undefined ? {} : { source: bash.source }),
    })
  }
  if (pwsh.available) {
    const version = versions.get('pwsh')
    result.push({
      kind: 'pwsh',
      name: 'PowerShell 7',
      ...(pwsh.path === undefined ? {} : { path: pwsh.path }),
      ...(version === undefined ? {} : { version }),
    })
  }
  if (powershell.available) {
    const version = versions.get('powershell')
    result.push({
      kind: 'powershell',
      name: 'Windows PowerShell',
      ...(powershell.path === undefined ? {} : { path: powershell.path }),
      ...(version === undefined ? {} : { version }),
    })
  }
  return result
}

/** Synchronous availability probe for the boot-time state (with Bash validation). */
export function detectSync(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): DetectedShell[] {
  const bash = bashAvailability(platform, env)
  const pwsh = pwshAvailability(env)
  const powershell = windowsPowerShellAvailability(platform, env)
  const result: DetectedShell[] = []
  if (bash.available) {
    result.push({
      kind: 'bash',
      name: bash.source === 'git-for-windows' || bash.source === 'well-known' ? 'Git Bash' : 'Bash',
      ...(bash.path === undefined ? {} : { path: bash.path }),
      ...(bash.version === undefined ? {} : { version: bash.version }),
      ...(bash.source === undefined ? {} : { source: bash.source }),
    })
  }
  if (pwsh.available) result.push({ kind: 'pwsh', name: 'PowerShell 7', ...(pwsh.path === undefined ? {} : { path: pwsh.path }) })
  if (powershell.available) {
    result.push({
      kind: 'powershell',
      name: 'Windows PowerShell',
      ...(powershell.path === undefined ? {} : { path: powershell.path }),
    })
  }
  return result
}
