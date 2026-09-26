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
import type { ShellSelectorController } from './controller.js';
import type { EnLocaleKey } from './locale/en-US.js';
type Translate = (key: EnLocaleKey, params?: Record<string, unknown>) => string;
export interface ShellSelectorPageProps {
    controller: ShellSelectorController;
    t: Translate;
}
export declare function ShellSelectorPage({ controller, t }: ShellSelectorPageProps): JSX.Element;
export {};
//# sourceMappingURL=ShellSelectorPage.d.ts.map