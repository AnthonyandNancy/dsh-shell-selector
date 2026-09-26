/**
 * dsh-shell-selector — the host plugin.
 *
 * Product contract (see ARCHITECTURE.md): configuration changes are PERSISTED
 * and take effect on the NEXT process start. This plugin never replaces
 * `ctx.shell`, never unloads/reloads `tool-bash`/`tool-pwsh`, never restarts
 * anything. The shell swap happens at boot, in the composition layer, via the
 * bundle patch expressions (`cordis.patch.yml`).
 *
 * DSH 0.1.7-rc.1 owns configuration differently from rc.6: the plugin declares
 * a Config schema (`./settings.ts`), the Loader passes the resolved profile row
 * to `apply()`, and `ctx.settings` edits that row. A save reconciles the entry,
 * so this function runs again with the new config. The boot facts — what THIS
 * process actually composed — are therefore frozen on the first apply of the
 * process and never recomputed: "currently active" stays a statement about the
 * running process and `restartRequired` remains honest.
 *
 * `apply()` only: freezes boot facts, prepares the Bash PATH for Git for
 * Windows, installs the per-agent Shell Tool adaptation, serves the Settings
 * endpoint, and reports the restart requirement.
 *
 * @module dsh-shell-selector
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name (the bundle patch inserts a row with this package). */
export declare const name = "shell-selector";
/** The settings service must exist before this plugin reads or writes its row. */
export declare const inject: string[];
/** The Loader's Config schema — also the Settings form projection. */
export { Config } from './settings.js';
/** Drop the frozen boot facts (tests; a running application never calls this). */
export declare function resetBootFacts(): void;
/**
 * Plugin apply: freeze the boot facts, prepare the Bash PATH, install the
 * per-agent Shell Tool adaptation, install the Web endpoint, and start
 * background detection.
 *
 * @param ctx - the plugin context.
 * @param rawConfig - the Loader-resolved `shell-selector` profile row config.
 */
export declare function apply(ctx: Context, rawConfig?: unknown): () => void;
//# sourceMappingURL=index.d.ts.map