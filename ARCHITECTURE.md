# Architecture

This document explains how `dsh-shell-selector` changes the shell
interpreter, why a restart is required, and how the pieces fit together.

## Product contract

- **Agent Preset decides WHETHER there is Shell; Shell Selector decides WHICH
  shell it is.**
- **No hot switching.** Configuration changes are *persisted* and take effect
  on the *next process start*.
- **No runtime replacement** of `ctx.shell`, **no** dynamic unload/load of
  `tool-bash`/`tool-pwsh`, **no** forced restart, **no** "apply now".
- **No preset coupling.** The plugin never sets `agent-presets.default`, never
  ships a `shell-selector` agent preset, and never inspects preset names.
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
- Each session's tool list is composed by the agent-preset service from the
  preset it mounts. Shell Selector only restricts the tool that does not match
  the already-active executor.

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
  `explicit`, `explicit-unavailable`).
- `executable` — the resolved executable path of the active executor, when
  known.

The snapshot is immutable for the lifetime of the process. Availability is
deliberately **not** part of the snapshot: whether the active executable still
exists is a live fact, checked on every state read (`activeMissing`).

## Pending configuration

`configured` (mode/shell) is read live from the settings service and can
change at any time while the process runs. The state builder computes:

- `next = resolveEffective(configured, platform, availability)` — the
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

There is no `gatedByPreset` state. The capability question belongs to the
agent preset composition, not to Shell Selector.

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
  parse of `shell-selector`),
- probe the machine for real Bash/PowerShell availability (including Git for
  Windows paths; WSL `System32\bash.exe` is excluded),
- decide `eff.kind ∈ {platform, bash, pwsh, powershell}` with the same rules
  as `resolveEffective()` in `src/resolver.ts`,
- return the row's `disabled` value — exactly one executor survives.

`pwshPath` pins the Windows PowerShell executable only when the decision is
`powershell`; otherwise `undefined` leaves the executor's own resolution chain
(`%ProgramFiles%\PowerShell\7\pwsh.exe` → PATH → Windows PowerShell) in
charge. The bash row's `config.timeoutMs` is left untouched (patch rows
replace only the keys they list).

### 2. Agent-scoped Shell Tool adaptation

The host plugin registers one `agent/created` listener. At that point the
agent has already mounted its preset's standing scope, so `tools.view(agent)`
reflects the preset's actual composition — without inspecting names. The
listener:

- reads the **active boot shell kind** (immutable per process),
- checks whether the agent has `bash` and/or `pwsh` visible,
- does nothing if neither is visible (no capability grant),
- otherwise calls `tools.restrict({ deny: [<the non-matching tool>] })` on the
  agent's scope.

This guarantees the model-facing tool (`tool-bash` or `tool-pwsh`) matches the
host executor (`ctx.shell`) for every shell-capable agent. Because the
restriction is registered on the agent scope, it is disposed with the agent.

### 3. Settings namespace

`ctx.settings.register(settingsNamespace('shell-selector'), schema, {base:
{mode:'default'}, applies: 'restart'})`. The schemastery v3 schema accepts
`mode` (`default|fallback|explicit`) and `shell` (`bash|pwsh|powershell`),
drops `undefined` values, and `normalizeConfig()` strips `shell` unless mode
is `explicit`. Writes go through the provider's CAS
(`replace(ns, section, expectedRevision)`), surfacing
`SettingsConflictError` as HTTP 409 for the Settings page.

## Git Bash on Windows

The official Bash executor (`bash-sandbox`/`bash-local`) spawns `bash` and has
no configurable executable path. To truly use Git Bash when it is not on
`PATH`, the host plugin:

1. Detects Bash with `src/detector.ts`:
   - `bash.exe` on `PATH`;
   - Git Bash derived from `git.exe` on `PATH`;
   - `%ProgramFiles%\Git`, `%ProgramFiles(x86)%\Git`,
     `%LOCALAPPDATA%\Programs\Git`;
   - every candidate is validated with `bash --version` and
     `bash -c 'printf "$BASH_VERSION"'`; `System32\bash.exe` (WSL) is
     rejected.
2. When `platform === 'win32'` and the active shell is Bash, prepends the
   resolved Git Bash bin directory to the **process-local** `PATH` in `apply()`.
   This is the only supported way to make the official Bash executor reach a
   Git Bash installation that was never added to PATH. It never writes the
   registry or the user environment.

The boot expressions use the same candidate discovery/probe logic so the
composition and the host detector agree.

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
keeps the draft independent of the live snapshot. The select controls are a
thin wrapper (`DshSelect.tsx`) around the official `Menu`/`Button` primitives —
no native `<select>`/`<option>` is used. Sections: mode select (Windows:
default/fallback/explicit; POSIX: default/explicit-bash), shell select for
explicit mode, the fixed restart hint and capability hint under the selector,
the currently-active / after-restart status blocks, warnings, detected
interpreters, and Re-detect + Save actions. Client is bundled by
`scripts/build-client.mjs` into the `window.__ModuleLoader__.load({id,
factory(require)})` format with a private module table; package imports stay on
the runtime `require`.

## Detection

`detector.ts` probes the same things the boot expressions do, parameterized
by platform and environment so tests can fabricate machines:

- Bash: `bash.exe` on PATH → Git Bash derived from `git.exe` on PATH →
  `%ProgramFiles%\Git` → `%ProgramFiles(x86)%\Git` →
  `%LOCALAPPDATA%\Programs\Git`; on POSIX `bash` in PATH plus
  `/bin /usr/bin /usr/local/bin`. The WSL launcher is rejected.
- Every Bash candidate is validated with real `spawnSync` probes
  (`--version` and `$BASH_VERSION`).
- PowerShell 7: DSH's own `candidatePwshPaths` (`%ProgramFiles%\PowerShell\7`
  → PATH) so the detector agrees with `resolvePwshPath`.
- Windows PowerShell: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.

The state endpoint serves a sync availability snapshot immediately, then
upgrades versions in the background (`DetectionCache.refresh`). **Re-detect
only re-scans — it never touches the runtime stack.**

## Testing

- `resolver.test.ts` / `fallback.test.ts` / `restart-required.test.ts` — the
  decision logic and the semantic restart computation.
- `agent-shell.test.ts` — per-agent tool restriction, including no-capability
  no-op and no-preset-name coupling.
- `detector.test.ts` — fabricated PATH/ProgramFiles/SystemRoot trees, Git Bash
  discovery, WSL rejection, probe failure, and de-duplication.
- `settings.test.ts` — schemastery v3 validation semantics.
- `expressions.test.ts` — evaluates the **exact** rendered expressions with
  the loader's `new Function` machinery against a fabricated `$DSH_HOME` and
  asserts byte-for-byte agreement with the resolver mirror across the full
  configuration × availability matrix.
- `client/DshSelect.test.tsx` / `client/ShellSelectorPage.test.tsx` — DSH
  native Select behavior and Settings page layout in jsdom.
- `scripts/lint.mjs` — verifies the committed `cordis.patch.yml` equals a
  fresh render, and that the host code never evals/spawns user input or
  replaces `ctx.shell`.

## File map

```
src/index.ts            host apply(): settings, snapshot, PATH prepend, agent listener, endpoint
src/settings.ts         namespace, schema, validation, normalization
src/resolver.ts         decision mirror (pure, platform-parameterized)
src/boot/expressions.ts single source of the boot expressions
src/boot/*.template     patch template (placeholders)
src/detector.ts         availability + version probing (Git Bash aware)
src/runtime-snapshot.ts immutable active-shell snapshot
src/agent-shell.ts      per-agent shell-tool restriction
src/web.ts              state/action endpoints, detection cache
src/types.ts            shared host types
src/client/*            Web plugin: locale, controller, DshSelect, page, entry
cordis.patch.yml        shipped bundle patch (rendered)
scripts/*               clean-build, renderer, client bundler, lint
tests/*                 unit + boot-expression + client contract suites
```
