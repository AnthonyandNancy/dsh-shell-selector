/**
 * Detector tests with fabricated filesystems: fake PATH/ProgramFiles/SystemRoot
 * trees drive every availability branch on both platform flavors. The
 * `node:child_process` probe is mocked so a fixture file counts as a real,
 * passing Bash probe.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:child_process', () => mocks)

import { bashAvailability, bashCandidates, detectSync, pwshAvailability, windowsPowerShellAvailability } from '../src/detector.js'
import type { ShellAvailability } from '../src/resolver.js'

let root: string
let PATH: string

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

function newTree(): void {
  root = mkdtempSync(join(tmpdir(), 'dsh-shell-selector-'))
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  PATH = bin
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const systemRoot = join(root, 'Windows')
  const programFiles = join(root, 'Program Files')
  mkdirSync(systemRoot, { recursive: true })
  mkdirSync(programFiles, { recursive: true })
  return { PATH, SystemRoot: systemRoot, ProgramFiles: programFiles, ...extra }
}

beforeEach(() => {
  newTree()
  mocks.spawnSync.mockImplementation((file: string, args: string[]) => {
    if (!existsSync(file)) return { status: 1, stdout: '', stderr: '' }
    // The WSL launcher is filtered before probing; any other existing Bash
    // fixture passes the version + $BASH_VERSION probe.
    return {
      status: 0,
      stdout: args[0] === '--version' ? 'GNU bash, version 5.2.0\n' : '5.2.0\n',
      stderr: '',
    }
  })
  mocks.spawn.mockImplementation(() => {
    throw new Error('spawn should not be used in these detector tests')
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('bashAvailability', () => {
  it('finds a validated bash on PATH on Windows', () => {
    touch(join(root, 'bin', 'bash.exe'))
    expect(bashAvailability('win32', env()).available).toBe(true)
    expect(bashAvailability('win32', env()).path).toBe(join(root, 'bin', 'bash.exe'))
  })

  it('rejects the WSL launcher on Windows even when it is first on PATH', () => {
    const sysRoot = join(root, 'Windows')
    mkdirSync(join(sysRoot, 'System32'), { recursive: true })
    touch(join(sysRoot, 'System32', 'bash.exe'))
    const pathWithWsl = `${join(sysRoot, 'System32')};${PATH}`
    expect(bashAvailability('win32', env({ PATH: pathWithWsl })).available).toBe(false)
  })

  it('finds a validated bash on PATH on POSIX', () => {
    touch(join(root, 'bin', 'bash'))
    expect(bashAvailability('linux', env()).available).toBe(true)
  })

  it('does not look for bash.exe on POSIX', () => {
    touch(join(root, 'bin', 'bash.exe'))
    expect(bashAvailability('linux', env()).available).toBe(false)
  })

  it('is false when nothing exists', () => {
    expect(bashAvailability('win32', env()).available).toBe(false)
  })

  it('is false when the probe fails', () => {
    touch(join(root, 'bin', 'bash.exe'))
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' })
    expect(bashAvailability('win32', env()).available).toBe(false)
  })
})

describe('Git Bash discovery', () => {
  it('discovers Program Files Git Bash without PATH', () => {
    const programFiles = join(root, 'Program Files')
    touch(join(programFiles, 'Git', 'bin', 'bash.exe'))
    const found = bashAvailability('win32', env({ ProgramFiles: programFiles }))
    expect(found.available).toBe(true)
    expect(found.path).toBe(join(programFiles, 'Git', 'bin', 'bash.exe'))
    expect(found.source).toBe('git-for-windows')
  })

  it('discovers LocalAppData Git Bash without PATH', () => {
    const local = join(root, 'LocalAppData')
    touch(join(local, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'))
    const found = bashAvailability('win32', env({ LOCALAPPDATA: local }))
    expect(found.available).toBe(true)
    expect(found.path).toBe(join(local, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'))
  })

  it('derives Git Bash from git.exe on PATH', () => {
    const gitRoot = join(root, 'Program Files', 'Git')
    touch(join(gitRoot, 'cmd', 'git.exe'))
    touch(join(gitRoot, 'bin', 'bash.exe'))
    const found = bashAvailability('win32', env({ PATH: `${join(gitRoot, 'cmd')};${PATH}` }))
    expect(found.available).toBe(true)
    expect(found.path).toBe(join(gitRoot, 'bin', 'bash.exe'))
  })

  it('rejects System32 bash.exe even when it is the only candidate', () => {
    const sysRoot = join(root, 'Windows')
    mkdirSync(join(sysRoot, 'System32'), { recursive: true })
    touch(join(sysRoot, 'System32', 'bash.exe'))
    expect(bashAvailability('win32', env({ PATH: join(sysRoot, 'System32'), SystemRoot: sysRoot })).available).toBe(false)
  })

  it('does not duplicate the same Bash executable', () => {
    const gitRoot = join(root, 'Program Files', 'Git')
    touch(join(gitRoot, 'bin', 'bash.exe'))
    const candidates = bashCandidates('win32', env({ PATH: join(gitRoot, 'bin'), ProgramFiles: join(root, 'Program Files') }))
    expect(candidates.filter((entry) => entry.path.toLowerCase() === join(gitRoot, 'bin', 'bash.exe').toLowerCase())).toHaveLength(1)
  })
})

describe('pwshAvailability', () => {
  it('prefers ProgramFiles over PATH', () => {
    touch(join(root, 'bin', 'pwsh.exe'))
    const programFiles = join(root, 'Program Files')
    touch(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
    const found = pwshAvailability(env({ ProgramFiles: programFiles }))
    expect(found.available).toBe(true)
    expect(found.path).toBe(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
  })

  it('falls back to PATH', () => {
    touch(join(root, 'bin', 'pwsh.exe'))
    expect(pwshAvailability(env()).path).toBe(join(root, 'bin', 'pwsh.exe'))
  })

  it('is false when nothing exists', () => {
    expect(pwshAvailability(env()).available).toBe(false)
  })
})

describe('windowsPowerShellAvailability', () => {
  it('finds the System32 v1.0 executable on Windows', () => {
    const sysRoot = join(root, 'Windows')
    touch(join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    const found = windowsPowerShellAvailability('win32', env({ SystemRoot: sysRoot }))
    expect(found.available).toBe(true)
    expect(found.path).toBe(join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  })

  it('is never available on POSIX', () => {
    touch(join(root, 'bin', 'powershell.exe'))
    expect(windowsPowerShellAvailability('linux', env()).available).toBe(false)
  })
})

describe('detectSync', () => {
  it('reports Git Bash with its display name and every shell in order', () => {
    const programFiles = join(root, 'Program Files')
    touch(join(programFiles, 'Git', 'bin', 'bash.exe'))
    touch(join(root, 'bin', 'pwsh.exe'))
    const sysRoot = join(root, 'Windows')
    touch(join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    const result = detectSync('win32', env({ ProgramFiles: programFiles, SystemRoot: sysRoot }))
    expect(result.map((entry) => entry.kind)).toEqual(['bash', 'pwsh', 'powershell'])
    expect(result[0]?.name).toBe('Git Bash')
    expect(result[0]?.path).toBe(join(programFiles, 'Git', 'bin', 'bash.exe'))
  })

  it('excludes the WSL launcher from the bash entry', () => {
    const sysRoot = join(root, 'Windows')
    mkdirSync(join(sysRoot, 'System32'), { recursive: true })
    touch(join(sysRoot, 'System32', 'bash.exe'))
    touch(join(root, 'bin', 'pwsh.exe'))
    const result = detectSync('win32', env({ PATH: `${join(sysRoot, 'System32')};${PATH}`, SystemRoot: sysRoot }))
    expect(result.map((entry) => entry.kind)).toEqual(['pwsh'])
  })

  it('drives the availability map the resolver consumes', () => {
    touch(join(root, 'bin', 'bash.exe'))
    const availability: ShellAvailability = {
      bash: detectSync('win32', env()).some((entry) => entry.kind === 'bash'),
      pwsh: detectSync('win32', env()).some((entry) => entry.kind === 'pwsh'),
      powershell: detectSync('win32', env()).some((entry) => entry.kind === 'powershell'),
    }
    expect(availability).toEqual({ bash: true, pwsh: false, powershell: false })
  })
})
