/**
 * Web-profile endpoint: the Settings page's read/write surface.
 *
 * The plugin speaks over its own same-origin JSON endpoint instead of the
 * settings API, because the page needs more than a form: the immutable boot
 * snapshot, the live detection sweep, and the restart verdict. The write side
 * is still the settings service — `ctx.settings.replace(entryId, section,
 * revision)` — so the value lands on the `shell-selector` profile row (the
 * document the boot expressions read) with conflict detection intact.
 *
 * DSH 0.1.7-rc.1 reconciles that entry after a write, which re-enters the
 * plugin's `apply()` with the new configuration; THIS process keeps the shell
 * it booted with, because the executor row was decided at startup.
 *
 * @module dsh-shell-selector/web
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ShellSelectorSettings } from './settings.js';
import { type EffectiveDecision, type ShellAvailability } from './resolver.js';
import type { ActiveShell, DetectedShell, ShellSelectorState } from './types.js';
/** Exact route serving the Settings page's state. */
export declare const STATE_ROUTE = "/_dsh/shell-selector/state";
/** Exact route accepting save / re-detect actions. */
export declare const ACTION_ROUTE = "/_dsh/shell-selector/action";
/** Runtime facts the endpoint closes over. */
export interface ShellSelectorBackend {
    pluginVersion: string;
    platform: string;
    snapshot: ActiveShell;
    snapshotDecision: EffectiveDecision;
    settings: {
        get(): ShellSelectorSettings;
        replace(section: ShellSelectorSettings, expectedRevision?: number): Promise<void>;
    };
    /** Live availability cache, refreshed in the background and on demand. */
    availability(): ShellAvailability;
    /** Live detected list (with versions once the background probe settles). */
    detected(): DetectedShell[];
    /** Kick a fresh detection sweep; resolves when the sweep settles. */
    refreshDetection(): Promise<void>;
    /** Settings revision, for save-with-conflict-detection. */
    revision(): number;
    writable(): boolean;
}
/**
 * Build the full state the Settings page renders.
 *
 * @param backend - the live runtime facts.
 * @param configuredOverride - the configuration to report; defaults to the one
 *   this fiber was composed with. A save passes the freshly written value,
 *   because reconciling the entry disposes this fiber before it could observe
 *   that value itself.
 */
export declare function buildState(backend: ShellSelectorBackend, configuredOverride?: ShellSelectorSettings): ShellSelectorState;
/** Install the two routes on the web server. Returns a disposer. */
export declare function installShellSelectorWeb(ctx: Context, backend: ShellSelectorBackend): () => void;
/** Background detection keeper: sync availability immediately, versions later. */
export declare class DetectionCache {
    private availabilityValue;
    private detectedValue;
    private sweeping;
    constructor(platform: string);
    availability(): ShellAvailability;
    detected(): DetectedShell[];
    refresh(platform: string): Promise<void>;
}
//# sourceMappingURL=web.d.ts.map