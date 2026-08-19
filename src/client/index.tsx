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
.sss-section{max-width:720px;min-width:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.sss-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.sss-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.sss-rows{display:grid;gap:16px;padding:4px 0;min-width:0}
.sss-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box}
.sss-row-text{display:grid;gap:2px;min-width:0;flex:1 1 240px}
.sss-row-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.sss-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.sss-select{display:inline-flex;flex:0 0 auto;min-width:0;max-width:100%;box-sizing:border-box}
.sss-select-trigger{max-width:260px;min-width:0;box-sizing:border-box}
.sss-select-trigger-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sss-select-chevron{margin-left:6px;flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
/* The menu is portalled and end-aligned; bound its width so a long option
   description cannot make the list wider than the Settings dialog. */
.sss-menu-item{display:grid;gap:2px;min-width:0;max-width:296px}
.sss-menu-item-label{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sss-menu-item-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.sss-restart-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sss-capability-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sss-status{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;min-width:0;max-width:100%;box-sizing:border-box}
.sss-status-row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;min-width:0}
.sss-status-label{font-size:11px;color:var(--dsw-alias-label-caption);min-width:64px;flex:0 0 auto}
.sss-status-value{font-size:13px;color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.sss-warning{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.sss-saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.sss-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.sss-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sss-readonly{font-size:11px;color:var(--dsw-alias-label-caption)}
.sss-detected{display:grid;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);min-width:0;max-width:100%;box-sizing:border-box}
.sss-detected-label{color:var(--dsw-alias-label-tertiary)}
.sss-detected-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box}
.sss-detected-name{font-size:12px;color:var(--dsw-alias-label-primary);flex:0 0 auto}
/* A full Windows PowerShell path must never widen the dialog. */
.sss-detected-path{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;max-width:100%}
.sss-detected-version{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.sss-detected-none{color:var(--dsw-alias-label-tertiary)}
.sss-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
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
