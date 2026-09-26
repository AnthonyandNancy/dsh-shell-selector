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
/** The profile entry id that carries this plugin's configuration. */
export const SHELL_SELECTOR_ENTRY_ID = 'shell-selector';
/**
 * The writer slot cosmokit stamps on a volatile reference.
 *
 * Global (`Symbol.for`), deliberately: the host resolves schemastery and
 * cosmokit from the installation while this package carries its own copies, and
 * only a global key is recognizable across that module boundary.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');
/**
 * Read one Config field the way the host delivers it.
 *
 * Reading the reference as a value silently loses the configuration (`mode`
 * degrades to its default and `shell` is dropped), and passing the reference on
 * to a settings write is refused outright — `cloneJsonShaped()` in
 * `@deepseek-ai/dsh-settings` reports `Config $.mode.get contains a function`.
 * A plain value (a host without volatile support) passes through unchanged, so
 * both deliveries answer the same way.
 *
 * @param field - one Config field as delivered by the Loader or by a schema.
 * @returns the field's value, or `undefined` when the reference holds none.
 */
function readField(field) {
    if (typeof field !== 'object' || field === null || !(VOLATILE_WRITE in field))
        return field;
    const read = field.get;
    return typeof read === 'function' ? read.call(field) : undefined;
}
/** Mark one schema node as live (settings-form editable). */
function live(schema) {
    const candidate = schema;
    if (typeof candidate.volatile === 'function')
        return candidate.volatile();
    if (candidate.meta !== undefined)
        candidate.meta['volatile'] = true;
    return schema;
}
/**
 * The plugin Config schema: the Loader's config contract (the value passed to
 * `apply()`) and the settings form projection are the same declaration.
 */
export const Config = z.object({
    mode: live(z.union(['default', 'fallback', 'explicit']).default('default')),
    shell: live(z.union(['bash', 'pwsh', 'powershell'])),
});
/**
 * Validate an unknown payload against the Config schema. Schemastery v3
 * implements the Standard Schema interface; validation may be async. The
 * non-object guard exists because schemastery's object schema maps `null`
 * to the empty value — the endpoint contract must reject that instead of
 * silently writing the defaults. The schema resolves live fields to
 * references, so the result is projected back into plain settings.
 */
export async function validateConfig(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, issues: ['expected an object with mode/shell'] };
    }
    const result = await Config['~standard'].validate(input);
    if (typeof result === 'object' && result !== null && Array.isArray(result.issues)) {
        const issues = result.issues;
        return { ok: false, issues: issues.map((issue) => issue.message) };
    }
    return { ok: true, value: configFromEntry(result.value) };
}
/**
 * Normalize a validated configuration: `shell` only survives when mode is
 * `explicit`.
 */
export function normalizeConfig(input) {
    if (input.mode !== 'explicit') {
        return { mode: input.mode };
    }
    return { mode: input.mode, ...(input.shell === undefined ? {} : { shell: input.shell }) };
}
/**
 * Read the Loader-supplied entry config into the plugin's own shape.
 *
 * The value arrives with live fields resolved to references (see
 * `readField()`), so every field is read through it first. The profile row is
 * user-editable, so it is treated as untrusted input: an unknown mode falls
 * back to `default` and an unknown shell is dropped rather than rendering a
 * decision the boot expressions cannot reproduce.
 */
export function configFromEntry(raw) {
    const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    const mode = readField(record['mode']);
    const shell = readField(record['shell']);
    return normalizeConfig({
        mode: isMode(mode) ? mode : 'default',
        ...(isShellId(shell) ? { shell } : {}),
    });
}
/** Validate one shell id against the allowlist. */
export function isShellId(value) {
    return value === 'bash' || value === 'pwsh' || value === 'powershell';
}
/** Validate one mode against the allowlist. */
export function isMode(value) {
    return value === 'default' || value === 'fallback' || value === 'explicit';
}
//# sourceMappingURL=settings.js.map