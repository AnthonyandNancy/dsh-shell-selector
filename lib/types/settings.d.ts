/**
 * The `shell-selector` plugin configuration.
 *
 * DSH 0.1.7-rc.1 replaced the "register a settings namespace" model with a
 * Config projection: a plugin declares a schemastery `Config`, the Loader
 * hands the resolved value to `apply()`, and the Settings page edits the
 * profile patch row through `ctx.settings`. Shell Selector therefore owns no
 * namespace of its own — its configuration lives on the `shell-selector`
 * profile entry (the row inserted by `cordis.patch.yml`), which is exactly
 * what the boot expressions read at process start.
 *
 * Only fields marked VOLATILE are projected into the settings form and
 * accepted by a form write (`volatileForm()` / `isVolatilePath()` in
 * `@deepseek-ai/dsh-settings`), so both fields carry the flag. The flag lives
 * in `schema.meta.volatile`: newer schemastery releases expose `.volatile()`,
 * older ones only the raw meta, so the marker is applied either way.
 *
 * A volatile field does NOT resolve to its value: schemastery resolves it to a
 * cosmokit reference, which is what the Loader passes to `apply()` and what
 * `~standard.validate()` returns. Both readers below therefore go through
 * `readField()`, so the plugin works with values and a form write carries plain
 * JSON data.
 *
 * @module dsh-shell-selector/settings
 */
import z from '@deepseek-ai/schemastery';
import type { ShellId, ShellSelectorMode } from './resolver.js';
/** The profile entry id that carries this plugin's configuration. */
export declare const SHELL_SELECTOR_ENTRY_ID = "shell-selector";
/**
 * The plugin Config schema: the Loader's config contract (the value passed to
 * `apply()`) and the settings form projection are the same declaration.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    mode: z<"default" | "fallback" | "explicit", "default" | "fallback" | "explicit", "defined">;
    shell: z<"bash" | "pwsh" | "powershell", "bash" | "pwsh" | "powershell", "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    mode: z<"default" | "fallback" | "explicit", "default" | "fallback" | "explicit", "defined">;
    shell: z<"bash" | "pwsh" | "powershell", "bash" | "pwsh" | "powershell", "plain">;
}>>, "plain">;
/** The persisted configuration value. */
export interface ShellSelectorSettings {
    mode: ShellSelectorMode;
    shell?: ShellId;
}
/** Validation outcome. */
export type ValidationResult = {
    ok: true;
    value: ShellSelectorSettings;
} | {
    ok: false;
    issues: string[];
};
/**
 * Validate an unknown payload against the Config schema. Schemastery v3
 * implements the Standard Schema interface; validation may be async. The
 * non-object guard exists because schemastery's object schema maps `null`
 * to the empty value — the endpoint contract must reject that instead of
 * silently writing the defaults. The schema resolves live fields to
 * references, so the result is projected back into plain settings.
 */
export declare function validateConfig(input: unknown): Promise<ValidationResult>;
/**
 * Normalize a validated configuration: `shell` only survives when mode is
 * `explicit`.
 */
export declare function normalizeConfig(input: ShellSelectorSettings): ShellSelectorSettings;
/**
 * Read the Loader-supplied entry config into the plugin's own shape.
 *
 * The value arrives with live fields resolved to references (see
 * `readField()`), so every field is read through it first. The profile row is
 * user-editable, so it is treated as untrusted input: an unknown mode falls
 * back to `default` and an unknown shell is dropped rather than rendering a
 * decision the boot expressions cannot reproduce.
 */
export declare function configFromEntry(raw: unknown): ShellSelectorSettings;
/** Validate one shell id against the allowlist. */
export declare function isShellId(value: unknown): value is ShellId;
/** Validate one mode against the allowlist. */
export declare function isMode(value: unknown): value is ShellSelectorMode;
//# sourceMappingURL=settings.d.ts.map