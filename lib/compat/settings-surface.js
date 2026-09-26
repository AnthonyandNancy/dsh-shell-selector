/**
 * The host `ctx.settings` surface this plugin uses, isolated from the package.
 *
 * DSH 0.1.7-rc.1 reshaped settings around Config projections: `SettingsForms`
 * (formerly `SettingsProvider`) is keyed by PROFILE ENTRY ID rather than by a
 * registered namespace, `describe()` reports one row per configurable entry,
 * and a form write only touches VOLATILE fields of that entry's Config. The
 * `settingsNamespace()` brand and `register()` are gone, so the plugin reads
 * and writes through this smallest possible surface and never imports the
 * package: a runtime upgrade cannot break the plugin's module graph again.
 *
 * @module dsh-shell-selector/compat/settings-surface
 */
/** Read `ctx.settings`, or `undefined` when no settings service is composed. */
export function settingsOf(ctx) {
    const service = ctx.settings;
    if (service === null || typeof service !== 'object')
        return undefined;
    const candidate = service;
    if (typeof candidate.describe !== 'function' || typeof candidate.replace !== 'function')
        return undefined;
    return service;
}
//# sourceMappingURL=settings-surface.js.map