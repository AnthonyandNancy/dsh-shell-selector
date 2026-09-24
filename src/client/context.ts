/**
 * The client service surface this plugin uses.
 *
 * DSH 0.1.7-rc.1 retired `@deepseek-ai/dsh-client-runtime`, taking the
 * `ClientContext` type the browser halves used to import with it. The services
 * themselves are unchanged — `effect`, `slots`, `locale` — so this plugin
 * declares the smallest structural type it calls rather than importing a
 * package that no longer exists. Keeping the surface local also means a future
 * runtime reshuffle cannot break the plugin's module graph again.
 *
 * @module dsh-shell-selector/client/context
 */

import type { EnLocaleKey } from './locale/en-US.js'

/** What one `settings.section` registration carries. */
export interface SlotRegistrationOptions {
  /** Slot name the contribution attaches to. */
  name: string
  /** Unique contribution id inside that slot. */
  id: string
  /** Sort order among the slot's contributions. */
  order: number
  /** Localized tab label. */
  label: () => string
  /** Props the slot hands to the component. */
  inject: () => Record<string, unknown>
}

/** The browser plugin context, narrowed to what this plugin calls. */
export interface ShellSelectorClientContext {
  /** Register a disposer in the plugin's own fiber. */
  effect(callback: () => void | (() => void), label?: string): void
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<EnLocaleKey, string>>): () => void
    bind(namespace: string): (key: EnLocaleKey) => string
  }
  slots: {
    inject(name: string, callback: () => void): void
    /**
     * Register one contribution. `component` is deliberately structural: the
     * page types its own props at the definition site, and the host passes the
     * `inject()` result to it.
     */
    register(options: SlotRegistrationOptions, component: unknown): void
  }
}