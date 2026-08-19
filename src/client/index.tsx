/**
 * dsh-shell-selector — browser plugin entry.
 *
 * Registers the "Shell Interpreter" settings section (a first-level tab under
 * Settings, via the official `settings.section` slot) plus its locale and
 * styles. All configuration traffic goes through the plugin's own HTTP
 * endpoint (`/ _dsh/shell-selector/...`) because the settings namespace is
 * not on the Web exposure whitelist.
 *
 * @module dsh-shell-selector/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ShellSelectorController } from './controller.js'
import { ShellSelectorPage } from './ShellSelectorPage.js'
import { en, type EnLocaleKey } from './locale/en-US.js'
import { zh } from './locale/zh-CN.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'shell-selector': EnLocaleKey
  }
}

const NS = 'shell-selector'

const CSS = `
.sss-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.sss-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.sss-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.sss-status{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
.sss-status-row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.sss-status-label{font-size:11px;color:var(--dsw-alias-label-caption);min-width:64px}
.sss-status-value{font-size:13px;color:var(--dsw-alias-label-primary)}
.sss-form{display:grid;gap:14px}
.sss-field{display:grid;gap:6px}
.sss-field-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sss-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;max-width:420px}
.sss-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.sss-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.sss-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sss-restart-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sss-warning{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.sss-saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.sss-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.sss-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sss-readonly{font-size:11px;color:var(--dsw-alias-label-caption)}
.sss-detected{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.sss-detected-label{color:var(--dsw-alias-label-tertiary)}
.sss-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.sss-alert-error{padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-2)}
`

function installStyles(): () => void {
  const id = 'dsh-shell-selector/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-shell-selector'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}

/** Required client services. */
export const inject = ['slots', 'locale']

/** Register the settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-shell-selector: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-shell-selector: locale')
  const t = ctx.locale.bind(NS)
  const controller = new ShellSelectorController()
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'shell-selector',
        order: 20,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
      },
      ShellSelectorPage,
    ),
  )
}
