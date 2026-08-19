/**
 * Boot-expression tests: the single most important contract of this plugin.
 *
 * The composition decides at BOOT from `!!js` expressions evaluated by the
 * Cordis loader (`new Function("ctx","expr","with(ctx){return eval(expr)}")`
 * with only `process`/`Buffer`/`fetch`/`globalThis` in scope). This suite
 * evaluates the EXACT rendered expressions against a fabricated environment
 * (fake `$DSH_HOME/settings.yaml`, PATH, ProgramFiles, SystemRoot) and asserts
 * the result agrees with the TypeScript resolver mirror on every
 * configuration × availability combination.
 */

import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BASH_SANDBOX_DISABLED_EXPR,
  PWSH_PATH_EXPR,
  PWSH_SANDBOX_DISABLED_EXPR,
} from '../src/boot/expressions.js'
import { resolveEffective, type ShellAvailability } from '../src/resolver.js'
import type { BootConfig } from '../src/boot/expressions.js'

/** The loader's exact evaluation machinery. */
const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }') as (
  ctx: Record<string, unknown>,
  expr: string,
) => unknown

/**
 * A fake `process` for the expression: only what the expressions touch.
 * `node:child_process` is mocked so fabricated Bash fixtures pass the real
 * `bash --version` / `$BASH_VERSION` probe contract.
 */
function fakeProcess(platform: string, env: Record<string, string>): Record<string, unknown> {
  const real = (globalThis as unknown as { process: NodeJS.Process }).process
  return {
    platform,
    env,
    getBuiltinModule: (id: string) => {
      if (id === 'node:child_process') {
        return {
          spawnSync(file: string, args: string[]) {
            if (existsSync(file)) {
              const version = args[0] === '--version' ? 'GNU bash, version 5.2.0\n' : '5.2.0\n'
              return { status: 0, stdout: version, stderr: '' }
            }
            return { status: 1, stdout: '', stderr: '' }
          },
        }
      }
      return real.getBuiltinModule(id)
    },
  }
}

let root: string
let home: string
let settingsFile: string

function ensureDirs(...paths: string[]): void {
  for (const dir of paths) mkdirSync(dir, { recursive: true })
}

function writeSettings(body: string): void {
  writeFileSync(settingsFile, body)
}

/** Fabricated environment for one matrix cell. */
function buildEnv(options: {
  platform: string
  bash?: boolean
  wslFirst?: boolean
  pwsh?: boolean
  powershell?: boolean
}): Record<string, string> {
  const env: Record<string, string> = {
    DSH_HOME: home,
    PATH: join(root, 'bin'),
    SystemRoot: join(root, 'Windows'),
    ProgramFiles: join(root, 'Program Files'),
  }
  ensureDirs(join(root, 'bin'), join(root, 'Windows', 'System32'), join(root, 'Program Files'))
  if (options.platform === 'win32') {
    if (options.bash) {
      const target = options.wslFirst === true ? join(root, 'Windows', 'System32') : join(root, 'bin')
      writeFileSync(join(target, 'bash.exe'), '')
      if (options.wslFirst === true) env.PATH = `${join(root, 'Windows', 'System32')};${join(root, 'bin')}`
    }
    if (options.pwsh) writeFileSync(join(root, 'bin', 'pwsh.exe'), '')
    if (options.powershell) {
      ensureDirs(join(root, 'Windows', 'System32', 'WindowsPowerShell', 'v1.0'))
      writeFileSync(join(root, 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), '')
    }
  } else if (options.bash) {
    writeFileSync(join(root, 'bin', 'bash'), '')
  }
  return env
}

/** Expected availability as the TS mirror sees it (aligned with the expressions). */
function availabilityOf(
  platform: string,
  _env: Record<string, string>,
  options: Parameters<typeof buildEnv>[0],
): ShellAvailability {
  if (platform !== 'win32') return { bash: options.bash === true, pwsh: false, powershell: false }
  return {
    bash: options.bash === true && options.wslFirst !== true,
    pwsh: options.pwsh === true,
    powershell: options.powershell === true,
  }
}

function configOf(body: string): BootConfig {
  const cfg: BootConfig = { mode: 'default' }
  if (/mode: explicit/u.test(body)) cfg.mode = 'explicit'
  else if (/mode: fallback/u.test(body)) cfg.mode = 'fallback'
  const shell = /shell: (\w+)/u.exec(body)
  if (shell !== null) cfg.shell = shell[1] as BootConfig['shell']
  return cfg
}

/** Run one expression against the fabricated world and return its value. */
function run(expr: string, platform: string, env: Record<string, string>): unknown {
  return evaluate({ process: fakeProcess(platform, env) }, expr)
}

interface MatrixCell {
  name: string
  platform: 'win32' | 'linux'
  settings: string
  envOptions: Parameters<typeof buildEnv>[0]
}

const CELLS: MatrixCell[] = [
  { name: 'no settings file', platform: 'win32', settings: '', envOptions: { platform: 'win32', bash: true, pwsh: true } },
  { name: 'default, everything present', platform: 'win32', settings: 'shell-selector:\n  mode: default\n', envOptions: { platform: 'win32', bash: true, pwsh: true, powershell: true } },
  { name: 'default, nothing present', platform: 'win32', settings: 'shell-selector:\n  mode: default\n', envOptions: { platform: 'win32' } },
  { name: 'fallback, bash only', platform: 'win32', settings: 'shell-selector:\n  mode: fallback\n', envOptions: { platform: 'win32', bash: true } },
  { name: 'fallback, pwsh only', platform: 'win32', settings: 'shell-selector:\n  mode: fallback\n', envOptions: { platform: 'win32', pwsh: true } },
  { name: 'fallback, powershell only', platform: 'win32', settings: 'shell-selector:\n  mode: fallback\n', envOptions: { platform: 'win32', powershell: true } },
  { name: 'fallback, none', platform: 'win32', settings: 'shell-selector:\n  mode: fallback\n', envOptions: { platform: 'win32' } },
  { name: 'explicit bash, available', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: bash\n', envOptions: { platform: 'win32', bash: true } },
  { name: 'explicit bash, missing', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: bash\n', envOptions: { platform: 'win32' } },
  { name: 'explicit pwsh, available', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: pwsh\n', envOptions: { platform: 'win32', pwsh: true } },
  { name: 'explicit pwsh, missing', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: pwsh\n', envOptions: { platform: 'win32' } },
  { name: 'explicit powershell, available', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: powershell\n', envOptions: { platform: 'win32', powershell: true } },
  { name: 'explicit powershell, missing', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: powershell\n', envOptions: { platform: 'win32' } },
  { name: 'wsl launcher only on PATH', platform: 'win32', settings: 'shell-selector:\n  mode: explicit\n  shell: bash\n', envOptions: { platform: 'win32', bash: true, wslFirst: true } },
  { name: 'posix default', platform: 'linux', settings: 'shell-selector:\n  mode: default\n', envOptions: { platform: 'linux', bash: true } },
  { name: 'posix explicit bash', platform: 'linux', settings: 'shell-selector:\n  mode: explicit\n  shell: bash\n', envOptions: { platform: 'linux', bash: true } },
  { name: 'posix fallback (inert)', platform: 'linux', settings: 'shell-selector:\n  mode: fallback\n', envOptions: { platform: 'linux', bash: true } },
]

describe('boot expressions agree with the resolver mirror', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-shell-selector-expr-'))
    home = join(root, 'home')
    settingsFile = join(home, 'settings.yaml')
    ensureDirs(home)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  for (const cell of CELLS) {
    it(cell.name, () => {
      if (cell.settings.length > 0) writeSettings(cell.settings)
      const env = buildEnv(cell.envOptions)
      const platform = cell.platform
      const config = configOf(cell.settings)
      const availability = availabilityOf(platform, env, cell.envOptions)

      // What the composition must produce, per the mirror. A `platform`
      // decision leaves the shipped rule in charge: Bash on POSIX, the
      // PowerShell executor on Windows.
      const decision = resolveEffective(config, platform, availability)
      const bashEnabled = decision.kind === 'bash' || (decision.kind === 'platform' && platform !== 'win32')
      const pwshEnabled = decision.kind === 'pwsh' || decision.kind === 'powershell' || (decision.kind === 'platform' && platform === 'win32')
      const powershellPath =
        decision.kind === 'powershell' ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : undefined

      expect(run(BASH_SANDBOX_DISABLED_EXPR, platform, env)).toBe(!bashEnabled)
      expect(run(PWSH_SANDBOX_DISABLED_EXPR, platform, env)).toBe(!pwshEnabled)
      expect(run(PWSH_PATH_EXPR, platform, env)).toBe(powershellPath)
    })
  }

  it('render templates carry the expression placeholders (byte-level)', async () => {
    const fs = await import('node:fs')
    const patchTemplate = fs.readFileSync(new URL('../src/boot/patch.yml.template', import.meta.url), 'utf8')
    expect(patchTemplate).toContain('{{BASH_SANDBOX_DISABLED_EXPR}}')
    expect(patchTemplate).toContain('{{PWSH_SANDBOX_DISABLED_EXPR}}')
    expect(patchTemplate).toContain('{{PWSH_PATH_EXPR}}')
  })
})
