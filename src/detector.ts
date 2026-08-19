/**
 * Shell detection: which interpreters does this machine provide, and can
 * DeepSeek Harness actually use them?
 *
 * The availability rules mirror the boot expressions: a shell is reported
 * only when the DSH executor would be able to spawn it.
 *
 * @module dsh-shell-selector/detector
 */

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { candidatePwshPaths } from '@deepseek-ai/dsh-pwsh-local'
import type { ShellAvailability, ShellId } from './resolver.js'
import type { DetectedShell } from './types.js'

/** Windows Subsystem for Linux launcher: not a Bash we can claim. */
const WSL_BASH = join('System32', 'bash.exe')

/** Directories probed for `bash` on POSIX when PATH does not carry it. */
const POSIX_BASH_FALLBACK_DIRS = ['/bin', '/usr/bin', '/usr/local/bin']

/** Probe timeout per version read; a slow first start is a probe miss, not a hang. */
const VERSION_PROBE_TIMEOUT_MS = 5000

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

/**
 * Bash availability. On Windows the only claim we make is "resolvable from
 * PATH and not the WSL launcher": that is exactly the executable
 * `dsh-bash-local` would spawn. A Git Bash install that is not on PATH is
 * reported through `detect()` (as a hint) but not through `availability()`.
 */
export function bashAvailability(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { available: boolean; path?: string } {
  if (platform !== 'win32') {
    const onPath = resolveInPath('bash', env)
    if (onPath !== undefined) return { available: true, path: onPath }
    for (const dir of POSIX_BASH_FALLBACK_DIRS) {
      const full = join(dir, 'bash')
      if (isExecutableFile(full)) return { available: true, path: full }
    }
    return { available: false }
  }
  const found = resolveInPath('bash.exe', env)
  if (found === undefined) return { available: false }
  const sysRoot = String(env.SystemRoot ?? env.windir ?? 'C:\\Windows')
  if (found.toLowerCase() === join(sysRoot, WSL_BASH).toLowerCase()) return { available: false }
  return { available: true, path: found }
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
 * Version probe for one shell executable. Best-effort: a miss yields
 * `undefined`, never a failure.
 */
function probeVersion(kind: ShellId, executable: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const argv =
      kind === 'bash'
        ? [executable, '--version']
        : [executable, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: VERSION_PROBE_TIMEOUT_MS,
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', () => {})
    const settle = (value: string | undefined): void => {
      child.kill()
      resolve(value)
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

/** Probe versions concurrently; a slow shell delays the result, never blocks it forever. */
async function probeVersions(entries: { kind: ShellId; path: string }[]): Promise<Map<ShellId, string>> {
  const found = new Map<ShellId, string>()
  await Promise.all(
    entries.map(async (entry) => {
      const version = await probeVersion(entry.kind, entry.path)
      if (version !== undefined) found.set(entry.kind, version)
    }),
  )
  return found
}

/**
 * Full detection: availability + executable paths + best-effort versions.
 * Versions are probed concurrently with a per-process timeout.
 */
export async function detect(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<DetectedShell[]> {
  const bash = bashAvailability(platform, env)
  const pwsh = pwshAvailability(env)
  const powershell = windowsPowerShellAvailability(platform, env)
  const versions = await probeVersions(
    [
      ...(bash.available && bash.path !== undefined ? [{ kind: 'bash' as const, path: bash.path }] : []),
      ...(pwsh.available && pwsh.path !== undefined ? [{ kind: 'pwsh' as const, path: pwsh.path }] : []),
      ...(powershell.available && powershell.path !== undefined ? [{ kind: 'powershell' as const, path: powershell.path }] : []),
    ],
  )
  const result: DetectedShell[] = []
  if (bash.available) {
    const version = versions.get('bash')
    result.push({
      kind: 'bash',
      name: 'Bash',
      ...(bash.path === undefined ? {} : { path: bash.path }),
      ...(version === undefined ? {} : { version }),
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

/** Synchronous availability probe for the boot-time state (no versions). */
export function detectSync(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): DetectedShell[] {
  const bash = bashAvailability(platform, env)
  const pwsh = pwshAvailability(env)
  const powershell = windowsPowerShellAvailability(platform, env)
  const result: DetectedShell[] = []
  if (bash.available) result.push({ kind: 'bash', name: 'Bash', ...(bash.path === undefined ? {} : { path: bash.path }) })
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
