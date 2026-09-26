/**
 * dsh-shell-selector — browser plugin entry.
 *
 * Registers the "Shell Interpreter" settings section — a first-level tab under
 * Settings, through the official `settings.section` slot (still rendered by
 * DSH 0.1.7-rc.1) — plus its locale and styles. All configuration traffic goes
 * through the plugin's own HTTP endpoint (`/_dsh/shell-selector/...`); the host
 * side writes the `shell-selector` profile row through the settings service.
 *
 * @module dsh-shell-selector/client
 */
import type { ShellSelectorClientContext } from './context.js';
/** Required client services. */
export declare const inject: string[];
/** Register the settings section. */
export declare function apply(ctx: ShellSelectorClientContext): void;
//# sourceMappingURL=index.d.ts.map