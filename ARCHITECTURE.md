# Architecture

This document explains how `dsh-shell-selector` changes the shell
interpreter, why a restart is required, and how the pieces fit together.

## Product contract

- **No hot switching.** Configuration changes are *persisted* and take effect
  on the *next process start*.
- **No runtime replacement** of `ctx.shell`, **no** dynamic unload/load of
  `tool-bash`/`tool-pwsh`, **no** forced restart, **no** "apply now".
- The plugin must not modify the DSH main repository or `node_modules` of the
  app; it ships as a normal npm bundle installed with `dsh plugin add`.
- Supported on Windows, macOS and Linux, with a Web Settings page that looks
  native (official slot + primitives/tokens) and zh-CN + en-US locales.

## Why restart is required

The shell stack is a *boot-time composition decision*:

- The loader activates executor rows (`bash-sandbox` / `pwsh-sandbox`) **while
  the process starts**, before any session exists. Exactly one of them
  provides `ctx.shell`; DSH ships the platform rule by disabling one of them
  per platform.
- The agent-preset service composes each session's tool list from a *default
  preset chosen at boot* (`agent-presets.config.default`), including the shell
  tool rows (`tool-bash` / `tool-pwsh`).

Replacing that stack in a running process would mean disposing and re-activing
platform services (the sandbox executors keep per-process state such as
confinement runners and timeout machinery), and hot-swapping a session's tool
list while tools may be executing — both are explicitly out of scope. The
honest semantics are therefore:

> Save now, restart later. The current process keeps the shell it booted
> with; the saved configuration is what the next boot composes.

The Settings UI makes this visible: **Currently active** (immutable snapshot
of this process) and **After restart** (what the next boot will compose), plus
a fixed restart hint below the selector and a save confirmation that states
the restart requirement.

## Runtime snapshot

`createRuntimeSnapshot()` (host, `apply()` time) captures:

- `kind` — the shell this process actually runs commands with (resolved from
  the boot decision; `platform` resolves to Bash on POSIX / PowerShell on
  Windows).
- `mode` / `shell` — the configuration the process **booted with** (never
  `settings.shell` of the *current* value).
- `reason` — how the boot decision came to be (`platform-default`, `fallback`,
  `explicit`, `explicit-unavailable`, `gated-by-preset`).
- `executable` — the resolved executable path of the active executor, when
  known.

The snapshot is immutable for the lifetime of the process. Availability is
deliberately **not** part of the snapshot: whether the active executable still
exists is a live fact, checked on every state read (`activeMissing`).

## Pending configuration

`configured` (mode/shell) is read live from the settings service and can
change at any time while the process runs. The state builder computes:

- `next = resolveEffective(configured, platform, availability, gated)` — the
  decision the next boot will make, using the same resolution rules as the
  boot expressions.
- `restartRequired = !decisionsEqual(snapshotDecision, next, platform)` —
  **semantic comparison on the resolved shell**, never on raw strings:
  `default` on Windows and `explicit: pwsh` both compose the PowerShell
  executor, so switching between them requires **no** restart, while
  `explicit: bash` does.
- `configuredMissing` — the explicit choice is unavailable
  (`explicit-unavailable`); the UI shows「当前配置的 Shell 已无法检测到。」
- `fallback-none` — fallback mode with no shell available anywhere
  (`fallback-unavailable`).
- `gatedByPreset` — another agent preset is the user's default, so the
  override is inert for sessions.

## The boot composition (how the swap actually happens)

The swap itself happens in the composition layer at process startup, through
generated artifacts — **the host plugin never replaces `ctx.shell`**:

### 1. Bundle patch — `cordis.patch.yml` (executor rows)

Two rows patch the executor entries by id (row patching only overwrites the
listed keys):

```yaml
- id: bash-sandbox
  disabled: !!js | (…expression…)
- id: pwsh-sandbox
  disabled: !!js | (…expression…)
  config: { pwshPath: !!js | (…expression…) }
```

The expressions are the single source of truth in
`src/boot/expressions.ts`, rendered by `scripts/render-patch.mjs`. Each is a
self-contained arrow IIFE evaluated by the loader's
`new Function("ctx","expr","with(ctx){return eval(expr)}")` at entry
activation — i.e. during boot. They:

- read `$DSH_HOME/settings.yaml` (JSON parse attempt, then a flat section
  parse of `shell-selector` and `agent-presets`),
- probe the machine (PATH for `bash.exe`/`pwsh.exe`, `%ProgramFiles%` for
  PowerShell 7, `%SystemRoot%` for Windows PowerShell; the WSL launcher
  `System32\bash.exe` is excluded),
- decide `eff.kind ∈ {platform, bash, pwsh, powershell}` with the same rules
  as `resolveEffective()` in `src/resolver.ts`,
- return the row's `disabled` value — exactly one executor survives.

`pwshPath` pins the Windows PowerShell executable only when the decision is
`powershell`; otherwise `undefined` leaves the executor's own resolution chain
(`%ProgramFiles%\PowerShell\7\pwsh.exe` → PATH → Windows PowerShell) in
charge. The bash row's `config.timeoutMs` is left untouched (patch rows
replace only the keys they list).

### 2. Agent preset — tool rows

Sessions get the matching shell tool from the `shell-selector` agent preset,
materialized by `ensurePreset()` at `apply()` time into the official user
root `$DSH_HOME/.agent-presets/shell-selector/` (preset discovery is
first-root-wins, so the plugin can never shadow the shipped `standard` id).
The preset is a byte-faithful copy of the shipped standard preset whose only
difference is the two tool rows:

```yaml
- id: tool-bash
  disabled: !!js | (same expression as bash-sandbox)
- id: tool-pwsh
  disabled: !!js | (same expression as pwsh-sandbox)
```

The write is idempotent and marker-guarded: a copy carrying the plugin's
version marker is refreshed; a marker-less file is treated as user-authored
and left untouched (with a warning). Writes are tmp+rename atomic. The bundle
patch also sets `agent-presets.config.default: shell-selector`, so default
sessions use the preset (the agent-presets composition only overlays `roots`,
leaving `default` in place).

With `mode: default`, both expressions reduce to the shipped platform rule:
behavior is identical to a stock install — **installing the plugin changes
nothing about the current shell**.

### 3. Settings namespace

`ctx.settings.register(settingsNamespace('shell-selector'), schema, {base:
{mode:'default'}, applies: 'restart'})`. The schemastery v3 schema accepts
`mode` (`default|fallback|explicit`) and `shell` (`bash|pwsh|powershell`),
drops `undefined` values, and `normalizeConfig()` strips `shell` unless mode
is `explicit`. Writes go through the provider's CAS
(`replace(ns, section, expectedRevision)`), surfacing
`SettingsConflictError` as HTTP 409 for the Settings page.

## Gating by agent preset

The user may choose a different default agent preset in Agent Presets
settings. Then sessions follow *that* preset's tool rows, and the shell
override must be inert (otherwise the executor and the tool would
disagree). Both the boot expressions and the host read the same gate — the
`agent-presets.default` value from the raw settings file (user layer);
the host prefers the resolved settings value and falls back to the file
read. The UI shows a `warningGated` notice.

Known edge: if *another plugin* patches `agent-presets.config.default` at a
layer above this bundle's, the expressions (which only read the file) cannot
see it; the host's `isGated()` can. Documented as a limitation.

## The Web surface

The `shell-selector` namespace is deliberately **not** on the Web settings
RPC whitelist, so the browser talks to two same-origin exact routes
(`/_dsh/shell-selector/state`, `/_dsh/shell-selector/action`) registered with
`ctx.webServer.register({kind:'exact', …})` inside
`ctx.inject(['webServer'], …)` (the fiber and its effects live in the
plugin's dispose tree). GET/HEAD state + POST actions only; JSON responses
carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and a
restrictive CSP; request bodies are capped.

The client is a normal DSH Web plugin: `dsh.client.inject` lists the runtime
dependencies, `apply(ctx)` installs styles (document-injected stylesheet with
`data-plugin-css`, DSH design tokens only — no third-party UI library),
registers the `shell-selector` locale namespace (module augmentation of
`LocaleNamespaceMap`), and registers the settings section:

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'shell-selector',
  order: 20,               // general 0 < models 10 < plugins 15
  label: () => t('nav'),
  inject: () => ({ controller, t }),
}, ShellSelectorPage))
```

The page uses `useSyncExternalStore` over a small controller (external store)
that fetches the state endpoint, pushes saves with `expectedRevision`, and
keeps the draft independent of the live snapshot. Sections: mode select
(Windows: default/fallback/explicit; POSIX: default/explicit-bash), shell
select for explicit mode, the fixed restart hint under the selector, the
currently-active / after-restart status blocks, warnings, and
Re-detect + Save actions. Client is bundled by `scripts/build-client.mjs`
into the `window.__ModuleLoader__.load({id, factory(require)})` format with a
private module table; package imports stay on the runtime `require`.

## Detection

`detector.ts` probes the same things the boot expressions do, parameterized
by platform and environment so tests can fabricate machines:

- Bash: PATH resolution (`bash.exe` on Windows, `bash` on POSIX with
  `/bin /usr/bin /usr/local/bin` fallbacks); the WSL launcher is excluded.
- PowerShell 7: DSH's own `candidatePwshPaths` (`%ProgramFiles%\PowerShell\7`
  → PATH) so the detector agrees with `resolvePwshPath`.
- Windows PowerShell: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.

The state endpoint serves a sync availability snapshot immediately, then
upgrades versions in the background (`DetectionCache.refresh`). **Re-detect
only re-scans — it never touches the runtime stack.**

## Testing

- `resolver.test.ts` / `fallback.test.ts` / `restart-required.test.ts` — the
  decision logic and the semantic restart computation.
- `detector.test.ts` — fabricated PATH/ProgramFiles/SystemRoot trees on both
  platform flavors (no real shells involved).
- `settings.test.ts` — schemastery v3 validation semantics.
- `expressions.test.ts` — evaluates the **exact** rendered expressions with
  the loader's `new Function` machinery against a fabricated `$DSH_HOME` and
  asserts byte-for-byte agreement with the resolver mirror across the full
  configuration × availability × gating matrix.
- `scripts/lint.mjs` — verifies the committed `cordis.patch.yml` and preset
  composition equal fresh renders, and that the host code never evals/spawns
  user input or replaces `ctx.shell`.

## File map

```
src/index.ts            host apply(): settings, snapshot, preset, endpoint
src/settings.ts         namespace, schema, validation, normalization
src/resolver.ts         decision mirror (pure, platform-parameterized)
src/boot/expressions.ts single source of the boot expressions
src/boot/*.template     patch/preset templates (placeholders)
src/detector.ts         availability + version probing
src/runtime-snapshot.ts immutable active-shell snapshot
src/preset.ts           user-preset materialization (marker-guarded)
src/web.ts              state/action endpoints, detection cache
src/types.ts            shared host types
src/client/*            Web plugin: locale, controller, page, entry
config/agent-presets/   shipped preset files (rendered)
cordis.patch.yml        shipped bundle patch (rendered)
scripts/*               clean-build, renderers, client bundler, lint
tests/*                 unit + boot-expression contract suite
```
