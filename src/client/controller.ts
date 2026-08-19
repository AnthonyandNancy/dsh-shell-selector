/**
 * Controller for the Shell Selector settings page: an external store fed by
 * the plugin's own HTTP endpoint (the settings namespace is not exposed over
 * the settings RPC, so the page never touches `ctx.settingsScope`).
 *
 * @module dsh-shell-selector/client/controller
 */

import type { ApiResponse, ShellSelectorMode, ShellId, ShellSelectorState } from './types.js'

const STATE_ROUTE = '/_dsh/shell-selector/state'
const ACTION_ROUTE = '/_dsh/shell-selector/action'

export interface ControllerState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot?: ShellSelectorState | undefined
  /** Transient user feedback: 'saved' shows the success notice. */
  notice?: 'saved' | undefined
  error?: string | undefined
  action?: 'save' | 'detect' | undefined
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  const body = (await response.json()) as ApiResponse<T>
  if (!response.ok || !body.ok) {
    const failure = body as { ok: false; error?: { code?: string; message?: string } }
    throw new Error(failure.error?.message ?? `Shell Selector request failed with HTTP ${response.status}`)
  }
  return body.value
}

/** Small external store shared by the settings route and pushed invalidations. */
export class ShellSelectorController {
  private state: ControllerState = { status: 'idle' }
  private listeners = new Set<() => void>()
  private generation = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = (): ControllerState => this.state

  private set(next: ControllerState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    this.set({ ...this.state, status: 'loading', error: undefined, notice: undefined })
    try {
      const snapshot = await apiRequest<ShellSelectorState>(STATE_ROUTE)
      if (generation !== this.generation) return
      this.set({ status: 'ready', snapshot })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async save(mode: ShellSelectorMode, shell: ShellId | undefined, expectedRevision: number): Promise<void> {
    const generation = ++this.generation
    this.set({ ...this.state, action: 'save', error: undefined, notice: undefined })
    try {
      const snapshot = await apiRequest<ShellSelectorState>(ACTION_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', mode, shell, expectedRevision }),
      })
      if (generation !== this.generation) return
      this.set({ status: 'ready', snapshot, notice: 'saved', action: undefined })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({
        ...this.state,
        status: this.state.snapshot === undefined ? 'error' : 'ready',
        error: error instanceof Error ? error.message : String(error),
        action: undefined,
      })
      if (this.state.snapshot === undefined) void this.load()
    }
  }

  async detect(): Promise<void> {
    const generation = ++this.generation
    this.set({ ...this.state, action: 'detect', error: undefined })
    try {
      const snapshot = await apiRequest<ShellSelectorState>(ACTION_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect' }),
      })
      if (generation !== this.generation) return
      this.set({ status: 'ready', snapshot, action: undefined })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({
        ...this.state,
        status: this.state.snapshot === undefined ? 'error' : 'ready',
        error: error instanceof Error ? error.message : String(error),
        action: undefined,
      })
    }
  }

  /** Clear the transient save notice (e.g. after a few seconds or on edit). */
  dismissNotice(): void {
    if (this.state.notice === undefined) return
    this.set({ ...this.state, notice: undefined })
  }
}
