# Changelog

All notable changes to `dsh-shell-selector` are documented in this file.

## [0.2.1] — 2026-09-24

### Fixes

- **DSH 0.1.7-rc.1 accepts the bundle again.** 0.2.0 pinned
  `@deepseek-ai/dsh-client-ui-primitives` to the exact `0.1.0-rc.6` **in
  `peerDependencies` as well as in `devDependencies`**. The host compares every
  `@deepseek-ai/dsh`-prefixed peer against its own runtime version
  (`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`), so
  the plugin manager refused the install with `incompatible-version` — rendered
  as `dsh-shell-selector@0.2.0 与 DSH 0.1.7-rc.1 不兼容（要求
  @deepseek-ai/dsh-client-ui-primitives 0.1.0-rc.6）…` — and the boot-time
  bundle loader *skipped* `dsh-shell-selector` entirely, so neither the host
  half nor the Settings tab loaded. The peer now declares the same
  `^0.1.7-rc.1` line as every other `@deepseek-ai/dsh-*` peer.
- The `devDependency` stays at the exact `0.1.0-rc.6`, and only there: the rc.1
  publish ships no `.d.ts` and its lib resolves its own runtime imports out of
  the installation's hoisted tree, neither of which an out-of-tree test run can
  provide. The host reads `peerDependencies` only, so the dev pin can no longer
  reach the compatibility verdict.
- The client code is unchanged: the runtime's `0.1.7-rc.1` primitives still
  export `Button` (`variant="outline"`, `size="sm"|"md"`) and `Menu` with the
  exact props this plugin passes (`open`, `anchor`, `items`, `selectedId`,
  `align`, `side`, `portal`, `className`, `onSelect`, `onClose`) over
  `{ id, label, disabled }` rows.

### Changed

- `README.md` / `README.zh.md` install rows point at
  `dsh-shell-selector-0.2.1.tgz`; the 0.1.0 row they carried targets the retired
  rc.6 settings model, so it passed the peer check but broke at run time.

## [0.2.0] — unreleased

Compatibility with **DSH 0.1.7-rc.1**. Every change below follows from that
release's settings rework; the agent plane (tool registry, prompt waterfall,
agent scope) was re-verified against rc.1 and is untouched.

### Breaking

- **Requires DSH 0.1.7-rc.1 or newer.** `peerDependencies` now declare
  `^0.1.7-rc.1` for the `@deepseek-ai/dsh-*` packages (cordis `^4.0.4`,
  schemastery `^3.18.4`), and `@deepseek-ai/dsh-client-runtime` — removed from
  the runtime — is gone from `peerDependencies`, `devDependencies` and
  `dsh.client.inject`. The rc.6 settings model this plugin was written against
  no longer exists, so rc.6 is no longer claimed.
- **The configuration lives on this plugin's profile row.** `ctx.settings`
  registers nothing in rc.1; a plugin declares a schemastery `Config` and the
  service projects it into the settings surface. Both fields are marked
  volatile (the only path a form write may address) and the value is persisted
  on the `shell-selector` row of the profile patch.

### Fixes

- **Host plugin no longer fails to load.** The old code imported
  `settingsNamespace` from `@deepseek-ai/dsh-settings`; rc.1 removed that
  export, and a static named import of a missing export is a link-time
  `SyntaxError`, so the whole host half never loaded. The plugin now talks to
  the settings service through a minimal local surface
  (`src/compat/settings-surface.ts`) and imports nothing from the package.
- **`ctx.settings.register` crash.** Even past the import, `apply()` threw
  `TypeError: ctx.settings.register is not a function`. The entry Config
  replaces the registration.
- **The boot expressions can read the user's choice again.** They now read the
  profile patch row (`ctx.baseUrl` resolves the profile directory holding
  `cordis.patch.yml`) and fall back to the retired `$DSH_HOME/settings.yaml`,
  so a not-yet-migrated installation still resolves. They are unchanged for a
  missing configuration: the shipped platform rule stays in charge.
- **Boot facts stay frozen across a save.** rc.1 reconciles the row after a
  write, which re-enters `apply()` with the new configuration; without the
  freeze, currently-active would start describing the saved value as if it
  were running and `restartRequired` would flip to false.
- **The save response reports the value just written**, not the pre-save value
  this fiber was still holding while it was being disposed.
- **The POST route returns its promise**, so the write can be awaited and a
  rejection cannot escape as an unhandled rejection.
- **Saving a choice works again.** A volatile Config field resolves to a
  reference, not to its value: the reference reached
  `ctx.settings.replace('shell-selector', …)`, where the settings service
  refuses anything that is not JSON data and answered
  `出错了：Config $.mode.get contains a function` — HTTP 500 `action-failed`,
  so the Settings page could not store a shell at all. The same reference was
  read as a value on the way in, which degraded the configuration to
  `mode: default` (and dropped `shell`), so the reported "configured for next
  boot" value, the boot decision and the per-agent shell adaptation all ignored
  the user's choice. `src/settings.ts` now reads every field through
  `readField()`, and a form write carries plain values only.

### Changed

- **Client surface**: the removed `dsh-client-runtime` no longer supplies the
  context type — it is declared locally in `src/client/context.ts` — and the
  Select chevron is drawn in-tree, because the icon family was renamed between
  rc.6 and rc.1.
- Documentation, the patch template and the tests describe the row-based
  configuration; `tests/web.test.ts` pins the entry id, revision, conflict and
  freeze contracts, and `tests/expressions.test.ts` covers the profile row.
- **Development tree**: the `@deepseek-ai/dsh-*` devDependencies are installed
  at the rc.1 line the manifest already declared. The previous tree held
  schemastery 3.18.1, which has no volatile support at all — the reason the
  suite stayed green while the real host (routed to its own 3.18.4) failed every
  save. `@deepseek-ai/dsh-client-ui-primitives` keeps the host's `0.1.0-rc.6`
  in the **dev tree only**, because that lib resolves on its own; the rc.1
  publish expects the installation's hoisted tree, which an out-of-tree plugin's
  test run cannot provide. Its `peerDependencies` entry carries the
  `^0.1.7-rc.1` line every other `@deepseek-ai/dsh-*` peer declares — the exact
  pin that 0.2.0 left in `peerDependencies` is the defect 0.2.1 fixes.


## [0.1.0] — 2025-XX-XX

### Fixes

- **`router-bootstrap: no platform shell in catalog`** — root cause was in this
  plugin's agent adaptation, not in the Agent Router. The old code removed the
  mismatched shell tool *without first adding the matching one*: on a Windows
  preset exposing only `pwsh`, selecting Bash restricted `pwsh` while `bash` was
  never registered, collapsing the agent's shell catalog to empty. A router
  preset that picks its platform shell from that catalog then threw. The
  adaptation is now a transaction in a fixed **ADD BEFORE REMOVE** order:
  inspect capability → ensure target → verify target → hide opposite → shadow
  opposite prompt → verify final state.
- **Adaptation is transactional** — any failure rolls back every effect it
  registered, so a shell-capable agent is never left with zero shells and a
  half-adapted agent scope cannot exist.
- **Adaptation failures are no longer swallowed** — the old code logged a
  warning and let the agent run with a wrong or missing shell. Failures now
  raise `ShellSelectorAgentAdaptationError` at the prompt-assembly barrier,
  before any model request, naming the real cause instead of surfacing later as
  a downstream "no platform shell" error.
- **Tool and prompt are kept in sync** — hiding a shell tool does not remove its
  `tool:*` guidance in DSH, so the opposite section is now shadowed by section
  identity (an empty same-named agent-scoped section). No prompt prose is ever
  rewritten by string or regex replacement.
- **Official tools are reused, never reimplemented** — the target shell tool is
  the official `@deepseek-ai/dsh-tool-bash` / `@deepseek-ai/dsh-tool-pwsh` plugin
  imported from the host runtime (declared as peer dependencies), preserving
  `ctx.shell`, sandbox and `sandbox_permissions`, approval, jobs, background
  execution, timeouts, cancellation, `shellEnv`, result rendering and the
  terminal UI presentation.
- **Settings dropdown no longer overflows** — the menu is portalled and
  end-aligned, so it grows leftwards from the trigger's right edge instead of
  escaping the Settings dialog; row width is bounded and long executable paths
  can no longer force horizontal scrolling.
- **Dropdown keyboard navigation is scoped** — arrow/Home/End navigation
  previously queried every `[role="menuitem"]` in the document and could focus
  another open DSH menu's rows; it is now restricted to the select's own rows.
- **Bundle host mount** (`cordis.patch.yml`): the bundle now carries an
  `- insert:` row mounting the `shell-selector` host plugin. Without it the
  patch lines applied at boot but the plugin itself never loaded after a
  restart (hot-injected instances were unaffected).
- **Removed agent-preset coupling**: the plugin no longer sets
  `agent-presets.default`, no longer ships or materializes a `shell-selector`
  agent preset, and no longer inspects preset names.

### Features

- **Shell interpreter selection** for DeepSeek Harness:
  - Windows: DSH default / auto fallback (Bash → PowerShell 7 → Windows
    PowerShell, resolved once at boot) / explicit Bash, PowerShell 7 or
    Windows PowerShell.
  - macOS / Linux: DSH default / explicit Bash.
- **Preset-independent capability model**: *Preset determines WHETHER. Selector
  determines WHICH.* A preset without `tool-bash`/`tool-pwsh` never gains Shell
  capability — a permission boundary the selector must not cross.
- **Per-agent tool matching**: the visible shell tool always matches the active
  host executor for every shell-capable agent, in native and Code Mode alike.
  PowerShell 7 and Windows PowerShell share the one model-facing `pwsh` tool.
- **rc.6 compatibility layer** (`src/compat/rc6-agent.ts`): every structural
  assumption about DSH 0.1.0-rc.6 internals lives in one module, each annotated
  with the empirical observation that justifies it, so a future rc.7 change has
  a single place to move.
- **Git Bash on Windows**: discovers Git Bash even when it is not on PATH
  (`git.exe` derivation, Program Files, LocalAppData), validates candidates
  with real probes, rejects the WSL `System32\bash.exe` launcher, and prepends
  the resolved Git bin directory to process-local PATH when Bash is active.
- **Restart-based activation**: changes are persisted immediately and take
  effect on the next DeepSeek Harness start; the running process keeps its
  boot-time shell. No hot swapping, no forced restarts.
- **Web Settings page** (official `settings.section` slot, native DSH
  `Menu`/`Button` primitives, zh-CN + en-US):
  - Currently active vs. after-restart status blocks.
  - Fixed restart hint and capability hint.
  - Re-detect (re-scan only) and Save (with success notice stating the
    restart requirement).
  - Warnings: configured shell missing, active shell missing, no shell
    available.
- **Boot-time composition** through generated `cordis.patch.yml` expressions
  (executor rows only; no preset rows).
- **Semantic restart detection**: `restartRequired` compares resolved shells
  (e.g. Windows `default` ↔ `explicit: pwsh` needs no restart), not raw
  configuration strings.
- **Security**: allowlist-only configuration, no eval/spawn of user input,
  same-origin GET/POST endpoint with strict CSP and size limits.

### Notes

- With `mode: default` behavior matches a stock install.
- The plugin does not write `$DSH_HOME/.agent-presets/*` and does not change
  the user's default agent preset.
