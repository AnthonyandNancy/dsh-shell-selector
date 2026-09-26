/**
 * Controller for the Shell Selector settings page: an external store fed by
 * the plugin's own HTTP endpoint (the settings namespace is not exposed over
 * the settings RPC, so the page never touches `ctx.settingsScope`).
 *
 * @module dsh-shell-selector/client/controller
 */
import type { ShellSelectorMode, ShellId, ShellSelectorState } from './types.js';
export interface ControllerState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    snapshot?: ShellSelectorState | undefined;
    /** Transient user feedback: 'saved' shows the success notice. */
    notice?: 'saved' | undefined;
    error?: string | undefined;
    action?: 'save' | 'detect' | undefined;
}
/** Small external store shared by the settings route and pushed invalidations. */
export declare class ShellSelectorController {
    private state;
    private listeners;
    private generation;
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => ControllerState;
    private set;
    load(): Promise<void>;
    save(mode: ShellSelectorMode, shell: ShellId | undefined, expectedRevision: number): Promise<void>;
    detect(): Promise<void>;
    /** Clear the transient save notice (e.g. after a few seconds or on edit). */
    dismissNotice(): void;
}
//# sourceMappingURL=controller.d.ts.map