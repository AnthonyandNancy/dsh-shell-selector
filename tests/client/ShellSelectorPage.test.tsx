/**
 * Settings page layout tests: DSH-native rows, explicit-mode Shell row
 * visibility, and the muted restart/capability hints.
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellSelectorPage } from '../../src/client/ShellSelectorPage.js'
import type { ShellSelectorController } from '../../src/client/controller.js'
import type { ShellSelectorState } from '../../src/client/types.js'

const snapshot: ShellSelectorState = {
  schemaVersion: 1,
  platform: 'win32',
  pluginVersion: '0.1.0',
  active: { kind: 'pwsh', mode: 'explicit', shell: 'pwsh', reason: 'explicit' },
  configured: { mode: 'explicit', shell: 'bash' },
  detected: [
    { kind: 'bash', name: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe', source: 'git-for-windows' },
    { kind: 'pwsh', name: 'PowerShell 7', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
    { kind: 'powershell', name: 'Windows PowerShell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
  ],
  restartRequired: true,
  activeMissing: false,
  configuredMissing: false,
  settingsRevision: 1,
  writable: true,
}

function fakeController(initial = snapshot): ShellSelectorController {
  const listeners = new Set<() => void>()
  let state = { status: 'ready' as const, snapshot: initial }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => state,
    load: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    detect: vi.fn(async () => undefined),
    dismissNotice: vi.fn(),
  } as unknown as ShellSelectorController
}

const t = (key: string): string => key

afterEach(() => {
  cleanup()
})

describe('ShellSelectorPage', () => {
  it('renders DSH settings rows and the muted restart hint', () => {
    render(<ShellSelectorPage controller={fakeController()} t={t} />)
    expect(screen.getByText('mode')).toBeTruthy()
    expect(screen.getByText('shell')).toBeTruthy()
    expect(screen.getByText('restartHint')).toBeTruthy()
    expect(screen.getByText('capabilityHint')).toBeTruthy()
  })

  it('shows the explicit Shell row when mode is explicit', () => {
    render(<ShellSelectorPage controller={fakeController()} t={t} />)
    expect(screen.getByText('shell')).toBeTruthy()
  })

  it('hides the explicit Shell row after switching to fallback', async () => {
    const user = userEvent.setup()
    render(<ShellSelectorPage controller={fakeController()} t={t} />)
    const modeTrigger = screen.getByRole('button', { name: 'mode' })
    await user.click(modeTrigger)
    const fallback = screen.getByRole('menuitem', { name: /modeFallback/ })
    await user.click(fallback)
    expect(screen.queryByText('shell')).toBeNull()
  })

  it('renders detected interpreters with paths', () => {
    render(<ShellSelectorPage controller={fakeController()} t={t} />)
    expect(screen.getAllByText('Git Bash').length).toBeGreaterThan(0)
    expect(screen.getByText('C:\\Program Files\\Git\\bin\\bash.exe')).toBeTruthy()
    expect(screen.getAllByText('PowerShell 7').length).toBeGreaterThan(0)
  })

  it('does not render native selects anywhere', () => {
    const { container } = render(<ShellSelectorPage controller={fakeController()} t={t} />)
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('option')).toBeNull()
  })
})
