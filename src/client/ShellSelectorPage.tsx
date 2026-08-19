/**
 * The Shell Interpreter settings section: choose which shell DSH runs
 * commands with. Configuration is persisted immediately, but the running
 * process keeps its boot-time shell — the change applies after restart.
 *
 * @module dsh-shell-selector/client/page
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
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

function ModeBlock({ label, kind, t }: { label: string; kind: ShellId; t: Translate }): JSX.Element {
  return (
    <div className="sss-status-row">
      <span className="sss-status-label">{label}</span>
      <span className="sss-status-value">{shellLabel(t, kind)}</span>
    </div>
  )
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
        {state.status === 'error' ? (
          <div className="sss-alert-error" role="alert">
            {t('error', { message: state.error ?? 'unknown' })}
          </div>
        ) : (
          <div className="sss-loading" aria-busy="true">
            …
          </div>
        )}
      </div>
    )
  }

  const busy = state.action !== undefined
  const isWin = snapshot.platform === 'win32'
  const explicitAvailable = isWin
    ? snapshot.detected.length > 0
    : snapshot.detected.some((entry) => entry.kind === 'bash')
  const draftDiffers =
    draft !== undefined &&
    (draft.mode !== snapshot.configured.mode ||
      (draft.mode === 'explicit' && draft.shell !== snapshot.configured.shell))
  const showAfterRestart = snapshot.restartRequired || draftDiffers
  const previewKind =
    draftDiffers && draft !== undefined ? nextKindOf(draft, snapshot) : nextKindOf(snapshot.configured, snapshot)

  const commit = (mode: ShellSelectorMode, shell: ShellId): void => {
    setDraft({ mode, shell })
    controller.dismissNotice()
  }

  const save = (): void => {
    if (draft === undefined || busy) return
    void controller.save(draft.mode, draft.mode === 'explicit' ? draft.shell : undefined, snapshot.settingsRevision)
  }

  return (
    <div className="sss-section">
      <h2 className="sss-title">{t('title')}</h2>
      <p className="sss-intro">{t('intro')}</p>

      {snapshot.gatedByPreset && snapshot.defaultAgentPreset !== undefined ? (
        <p className="sss-warning" role="status">
          {t('warningGated', { preset: snapshot.defaultAgentPreset })}
        </p>
      ) : null}
      {snapshot.activeMissing ? (
        <p className="sss-warning" role="status">
          {t('warningActiveMissing')}
        </p>
      ) : null}
      {snapshot.configuredMissing ? (
        <p className="sss-warning" role="status">
          {t('warningMissing')}
        </p>
      ) : null}
      {isWin && snapshot.configured.mode === 'fallback' && snapshot.detected.length === 0 ? (
        <p className="sss-warning" role="status">
          {t('warningFallbackNone')}
        </p>
      ) : null}

      <div className="sss-status">
        <ModeBlock label={t('activeBlock')} kind={activeKindOf(snapshot)} t={t} />
        {showAfterRestart ? (
          <ModeBlock label={t('afterRestartBlock')} kind={previewKind} t={t} />
        ) : null}
      </div>

      <div className="sss-form">
        <div className="sss-field">
          <label className="sss-field-label" htmlFor="sss-mode">
            {t('mode')}
          </label>
          <select
            id="sss-mode"
            className="sss-select"
            value={draft?.mode ?? 'default'}
            disabled={busy || !snapshot.writable}
            onChange={(event) => {
              const mode = event.target.value as ShellSelectorMode
              commit(mode, draft?.shell ?? 'bash')
            }}
          >
            <option value="default">{t('modeDefault')}</option>
            {isWin ? <option value="fallback">{t('modeFallback')}</option> : null}
            <option value="explicit" disabled={!explicitAvailable}>
              {t('modeExplicit')}
            </option>
          </select>
          <p className="sss-hint">
            {draft?.mode === 'default'
              ? t('modeDefaultHint')
              : draft?.mode === 'fallback'
                ? t('modeFallbackHint')
                : t('modeExplicit')}
          </p>
          <p className="sss-restart-hint">{t('restartHint')}</p>
        </div>

        {draft?.mode === 'explicit' ? (
          <div className="sss-field">
            <label className="sss-field-label" htmlFor="sss-shell">
              {t('shell')}
            </label>
            <select
              id="sss-shell"
              className="sss-select"
              value={draft.shell}
              disabled={busy || !snapshot.writable}
              onChange={(event) => {
                commit('explicit', event.target.value as ShellId)
              }}
            >
              {isWin ? (
                <>
                  <option value="bash">{t('shellBash')}</option>
                  <option value="pwsh">{t('shellPwsh')}</option>
                  <option value="powershell">{t('shellPowershell')}</option>
                </>
              ) : (
                <option value="bash">{t('shellBash')}</option>
              )}
            </select>
          </div>
        ) : null}
      </div>

      {state.notice === 'saved' ? (
        <p className="sss-saved" role="status" aria-live="polite">
          {t('saved')}
        </p>
      ) : null}
      {state.error !== undefined ? (
        <p className="sss-error" role="alert">
          {t('error', { message: state.error })}
        </p>
      ) : null}

      <div className="sss-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void controller.detect() }}>
          {state.action === 'detect' ? '…' : t('detect')}
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

      <div className="sss-detected">
        <span className="sss-detected-label">{t('detectedTitle')}:</span>{' '}
        {snapshot.detected.length === 0 ? (
          t('detectedNone')
        ) : (
          snapshot.detected.map((entry, index) => (
            <span key={entry.kind}>
              {index > 0 ? ' · ' : ''}
              {entry.name}
              {entry.version === undefined ? ` (${t('versionUnknown')})` : ` (${entry.version})`}
            </span>
          ))
        )}
      </div>
    </div>
  )
}
