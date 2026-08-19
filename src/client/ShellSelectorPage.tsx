/**
 * The Shell Interpreter settings section: choose which shell DSH runs
 * commands with. Configuration is persisted immediately, but the running
 * process keeps its boot-time shell — the change applies after restart.
 *
 * The page uses DSH-native primitives (`Menu`, `Button`) instead of browser
 * `<select>` controls, so it matches the rest of DeepSeek Harness Settings.
 *
 * @module dsh-shell-selector/client/page
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshSelect } from './DshSelect.js'
import type { ShellSelectorController } from './controller.js'
import type { EnLocaleKey } from './locale/en-US.js'
import type { ShellId, ShellSelectorMode, ShellSelectorState } from './types.js'

type Translate = (key: EnLocaleKey, params?: Record<string, unknown>) => string

export interface ShellSelectorPageProps {
  controller: ShellSelectorController
  t: Translate
}

interface Draft {
  mode: ShellSelectorMode
  shell: ShellId
}

function draftOf(snapshot: ShellSelectorState): Draft {
  const detected = snapshot.detected.map((entry) => entry.kind)
  const defaultShell: ShellId =
    snapshot.configured.shell !== undefined && snapshot.configured.shell !== null
      ? snapshot.configured.shell
      : (detected.includes('bash') ? 'bash' : (detected[0] ?? 'bash'))
  return { mode: snapshot.configured.mode, shell: defaultShell }
}

function shellLabel(t: Translate, kind: ShellId): string {
  if (kind === 'bash') return t('shellBash')
  if (kind === 'pwsh') return t('shellPwsh')
  return t('shellPowershell')
}

function detectedName(snapshot: ShellSelectorState, kind: ShellId, t: Translate): string {
  const entry = snapshot.detected.find((item) => item.kind === kind)
  return entry?.name ?? shellLabel(t, kind)
}

/** The shell this process actually runs commands with. */
function activeKindOf(snapshot: ShellSelectorState): ShellId {
  return snapshot.active.kind
}

/**
 * Which shell the NEXT boot composes, per current configuration and
 * detection. Mirrors the host's resolver for display purposes.
 */
function nextKindOf(configured: { mode: ShellSelectorMode; shell?: ShellId }, snapshot: ShellSelectorState): ShellId {
  const has = (kind: ShellId): boolean => snapshot.detected.some((entry) => entry.kind === kind)
  if (configured.mode === 'explicit' && configured.shell !== undefined) {
    return has(configured.shell) ? configured.shell : activeKindOf(snapshot)
  }
  if (configured.mode === 'fallback' && snapshot.platform === 'win32') {
    if (has('bash')) return 'bash'
    if (has('pwsh')) return 'pwsh'
    if (has('powershell')) return 'powershell'
    return activeKindOf(snapshot)
  }
  return snapshot.platform === 'win32' ? 'pwsh' : 'bash'
}

export function ShellSelectorPage({ controller, t }: ShellSelectorPageProps): JSX.Element {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const snapshot = state.snapshot
  const [draft, setDraft] = useState<Draft | undefined>(undefined)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (snapshot !== undefined) setDraft(draftOf(snapshot))
  }, [snapshot])

  useEffect(() => {
    if (state.notice === 'saved') {
      const timer = setTimeout(() => controller.dismissNotice(), 6000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [controller, state.notice])

  if (snapshot === undefined) {
    return (
      <div className="sss-section">
        <h2 className="sss-title">{t('title')}</h2>
        <p className="sss-intro">{t('intro')}</p>
        {state.status === 'error' ? <p className="sss-error">{t('error', { message: state.error ?? 'unknown' })}</p> : null}
        <div className="sss-loading">{t('loading')}</div>
      </div>
    )
  }

  const busy = state.action !== undefined
  const draftValue = draft ?? draftOf(snapshot)
  const detected = snapshot.detected
  const modeOptions = [
    { value: 'default' as const, label: t('modeDefault'), description: t('modeDefaultHint') },
    ...(snapshot.platform === 'win32'
      ? [{ value: 'fallback' as const, label: t('modeFallback'), description: t('modeFallbackHint') }]
      : []),
    { value: 'explicit' as const, label: t('modeExplicit'), description: t('modeExplicitHint') },
  ]
  const shellOptions = detected.map((entry) => ({
    value: entry.kind,
    label: entry.name,
    description: entry.path ?? entry.version,
  }))

  const save = (): void => {
    if (draft === undefined) return
    void controller.save(draft.mode, draft.mode === 'explicit' ? draft.shell : undefined, snapshot.settingsRevision)
  }

  const nextKind = nextKindOf({ mode: draftValue.mode, ...(draftValue.mode === 'explicit' ? { shell: draftValue.shell } : {}) }, snapshot)

  return (
    <div className="sss-section">
      <h2 className="sss-title">{t('title')}</h2>
      <p className="sss-intro">{t('intro')}</p>

      <div className="sss-rows">
        <div className="sss-row">
          <div className="sss-row-text">
            <span className="sss-row-label">{t('mode')}</span>
            <span className="sss-row-desc">{t('modeDescription')}</span>
          </div>
          <DshSelect
            ariaLabel={t('mode')}
            value={draftValue.mode}
            options={modeOptions}
            disabled={busy || !snapshot.writable}
            onChange={(mode) => setDraft({ ...draftValue, mode })}
          />
        </div>

        {draftValue.mode === 'explicit' ? (
          <div className="sss-row">
            <div className="sss-row-text">
              <span className="sss-row-label">{t('shell')}</span>
              <span className="sss-row-desc">{t('shellDescription')}</span>
            </div>
            <DshSelect
              ariaLabel={t('shell')}
              value={draftValue.shell}
              options={shellOptions}
              disabled={busy || !snapshot.writable || shellOptions.length === 0}
              onChange={(shell) => setDraft({ ...draftValue, shell })}
            />
          </div>
        ) : null}
      </div>

      <p className="sss-restart-hint">{t('restartHint')}</p>
      <p className="sss-capability-hint">{t('capabilityHint')}</p>

      <div className="sss-status">
        <div className="sss-status-row">
          <span className="sss-status-label">{t('activeBlock')}</span>
          <span className="sss-status-value">{detectedName(snapshot, activeKindOf(snapshot), t)}</span>
        </div>
        <div className="sss-status-row">
          <span className="sss-status-label">{t('afterRestartBlock')}</span>
          <span className="sss-status-value">{detectedName(snapshot, nextKind, t)}</span>
        </div>
      </div>

      {snapshot.activeMissing ? <p className="sss-warning">{t('warningActiveMissing')}</p> : null}
      {snapshot.configuredMissing ? <p className="sss-warning">{t('warningMissing')}</p> : null}
      {snapshot.detected.length === 0 ? <p className="sss-warning">{t('warningFallbackNone')}</p> : null}

      <div className="sss-detected">
        <span className="sss-detected-label">{t('detectedTitle')}</span>
        {detected.length === 0 ? (
          <span className="sss-detected-none">{t('detectedNone')}</span>
        ) : (
          detected.map((entry) => (
            <div className="sss-detected-row" key={entry.kind}>
              <span className="sss-detected-name">{entry.name}</span>
              {entry.path === undefined ? null : <span className="sss-detected-path">{entry.path}</span>}
              {entry.version === undefined ? null : <span className="sss-detected-version">{entry.version}</span>}
            </div>
          ))
        )}
      </div>

      <div className="sss-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void controller.detect()}>
          {state.action === 'detect' ? t('detecting') : t('detect')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !snapshot.writable || draft === undefined}
          onClick={save}
        >
          {state.action === 'save' ? t('saving') : t('save')}
        </Button>
        {!snapshot.writable ? <span className="sss-readonly">{t('readOnly')}</span> : null}
      </div>

      {state.error === undefined ? null : <p className="sss-error">{t('error', { message: state.error })}</p>}
      {state.notice === 'saved' ? <p className="sss-saved">{t('saved')}</p> : null}
    </div>
  )
}
