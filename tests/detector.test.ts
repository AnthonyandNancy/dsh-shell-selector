/**
 * Detector tests with fabricated filesystems: fake PATH/ProgramFiles/SystemRoot
 * trees drive every availability branch on both platform flavors.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bashAvailability, detectSync, pwshAvailability, windowsPowerShellAvailability } from '../src/detector.js'
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

beforeEach(() => {
  newTree()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Fake environment. ProgramFiles/SystemRoot MUST be pointed at the temp tree:
 * dsh-pwsh-local's candidate list falls back to the real machine's defaults
 * (`C:\Program Files` / `C:\Windows`) when the keys are absent, which would
 * leak this machine's real shells into the probe.
 */
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const systemRoot = join(root, 'Windows')
  const programFiles = join(root, 'Program Files')
  mkdirSync(systemRoot, { recursive: true })
  mkdirSync(programFiles, { recursive: true })
  return { PATH, SystemRoot: systemRoot, ProgramFiles: programFiles, ...extra }
}

describe('bashAvailability', () => {
  it('finds bash on PATH on Windows', () => {
    touch(join(root, 'bin', 'bash.exe'))
    expect(bashAvailability('win32', env()).available).toBe(true)
    expect(bashAvailability('win32', env()).path).toBe(join(root, 'bin', 'bash.exe'))
  })

  it('rejects the WSL launcher on Windows even when it is first on PATH', () => {
    const sys32 = join(root, 'System32')
    mkdirSync(sys32, { recursive: true })
    touch(join(sys32, 'bash.exe'))
    // SystemRoot = root\Windows; the launcher must live at SystemRoot\System32\bash.exe.
    const systemRoot = join(root, 'Windows')
    mkdirSync(systemRoot, { recursive: true })
    touch(join(systemRoot, 'System32', 'bash.exe'))
    const pathWithWsl = `${join(systemRoot, 'System32')};${PATH}`
    expect(bashAvailability('win32', env({ PATH: pathWithWsl })).available).toBe(false)
  })

  it('finds a real bash on PATH on POSIX', () => {
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
  it('reports every detected shell in order', () => {
    touch(join(root, 'bin', 'bash.exe'))
    touch(join(root, 'bin', 'pwsh.exe'))
    const sysRoot = join(root, 'Windows')
    touch(join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    const result = detectSync('win32', env({ SystemRoot: sysRoot }))
    expect(result.map((entry) => entry.kind)).toEqual(['bash', 'pwsh', 'powershell'])
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
