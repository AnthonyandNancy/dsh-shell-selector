# Changelog

All notable changes to `dsh-shell-selector` are documented in this file.

## [0.2.4] — unreleased

Fixes the two failures a real DSH 0.2.2-rc.1 install produced after installing
this plugin from a checkout:

```
启用失败: dsh: warning: 1 entry did not activate bash-sandbox
(@deepseek-ai/dsh-bash-sandbox): Error: service "shell" has been registered
at <SandboxPwshExecutor>

新建会话失败: agent-preset/invalid: tool-pwsh (@deepseek-ai/dsh-tool-pwsh):
waiting for shell
```

### Fixes

- **The plugin adapted to the shell its CONFIGURATION predicted, not the shell
  the host COMPOSED.** `apply()` resolved `activeKind` from the settings row and
  a local detection sweep, and never read `ctx.shell`. Those two answers are
  equal on a healthy install and diverge exactly when this plugin's bundle patch
  did not load — e.g. the package is a profile dependency but absent from
  `dsh.profile.bundles`, which leaves both executor rows on the shipped platform
  rule. In that state `mode: fallback` selected Git Bash locally while the
  process really ran `SandboxPwshExecutor`, so the adaptation hid the one
  working tool (`pwsh`), mounted `bash` against a PowerShell executor, and
  `tool-pwsh` never activated:
  `agent-preset/invalid: tool-pwsh … waiting for shell`. `src/compat/executor-probe.ts`
  now reads the service (`SandboxBashExecutor` / `SandboxPwshExecutor` /
  `PwshLocalExecutor`, plus the resolved executable to tell PowerShell 7 from
  Windows PowerShell), the snapshot reports the composed shell, and a mismatch
  is reported once per process with an actionable message naming
  `dsh.profile.bundles`.
- **The late correction now reaches every consumer.** The plugin's row is
  composed before the executor rows, so `ctx.shell` becomes observable one step
  after `apply()`. The state endpoint reads the snapshot through the corrected
  boot facts instead of a value captured at registration, and the agent adapter
  resolves the active kind when an agent is created instead of at plugin load.
  Without this, the probe could correctly notice `SandboxBashExecutor` while the
  UI and every new agent still used the stale `pwsh` prediction.
- **A wrong target could delete a working shell.** The adaptation mounted the
  target dialect and then restricted the opposite without checking that the
  target matched the composed executor — so a bad guess removed the only usable
  tool. `adaptAgentShell()` now returns `noop-mismatch` and performs **zero**
  side effects when the target contradicts `ctx.shell`: no mount, no
  restriction, no prompt shadow. The preset keeps whatever it granted, which is
  never worse than not installing this plugin. `noop-*` outcomes now return the
  host's assembly untouched instead of reconciling a surface that was
  deliberately left alone.
- **The two executor rows could both enable, or both disable.** `ctx.shell` is a
  single-implementation service, so exactly one of `bash-sandbox` /
  `pwsh-sandbox` may be active. Their `disabled` expressions were complementary
  only while two INDEPENDENT probes agreed, and each expression re-ran the whole
  helper block including a real `bash.exe` probe (two `spawnSync` calls per
  candidate, 5 s timeout each, ~250 ms per evaluation, three evaluations per
  boot). A disagreement enables both rows
  (`service "shell" has been registered at <SandboxPwshExecutor>`) or neither.
  The decision is now memoized on `globalThis[Symbol.for('dsh.shellSelector.decision')]`,
  so whoever evaluates first probes and every other row reuses that one answer —
  the pair is exclusive by construction, and a boot costs one probe instead of
  three.

### Added

- `tests/executor-probe.test.ts`, `tests/apply-actual-shell.test.ts`, and new
  suites in `tests/agent-shell.test.ts` / `tests/expressions.test.ts` pin the
  composed-shell preference, the zero-side-effect mismatch path, and row
  exclusivity for every decision kind.
- `DECISION_CACHE_KEY` is exported so tests can seed and clear the memo.

### Changed

- `active.kind`, `activeMissing` and the per-agent adaptation now describe what
  the process is RUNNING. `restartRequired` still compares configuration
  decisions, so "saved but not yet in effect" keeps its original meaning.
- Installation note: use the release tarball rather than `pnpm add <dir>`.
  `link:` installs resolve this package's own `devDependencies` (`0.1.7-rc.1`
  `@deepseek-ai/dsh-tool-*`) instead of the host runtime, which pnpm warns about
  as *"The linked in dependency will not resolve the peer dependencies from the
  target node_modules."*
## [0.2.3] — unreleased

Compatibility with **DSH 0.2.2-rc.1**. One defect and one adaptation.

### Fixes

- **`TypeError: Cannot read properties of undefined (reading 'filter')` on
  every shell-capable agent.** DSH 0.2.2-rc.1 moved the model-facing tool schema
  out of the prompt assembly: `SystemPrompt.assemble()` now builds
  `{ sections, contexts, variables }`, runs the `system-prompt/assemble`
  waterfall, and attaches `tools` only to the value it returns —
  `return { ...transformed, tools }`. A waterfall listener therefore receives an
  assembly with **no `tools` key**, and `reconcileAssembly()`'s
  `assembly.tools.filter(...)` dereferenced `undefined`. Because that listener
  runs at the prompt-assembly barrier, the throw failed the model step of every
  agent whose preset granted a shell — for a preset with no shell tool the
  reconciliation returned early and the same build looked healthy.

  The schema no longer needs rewriting there at all. 0.2.2-rc.1's tool registry
  owns it through a provider (`ctx.systemPrompt.tools(...)`) that re-derives
  `definitions(scope, toolSet)` from the live registry on every assembly, so the
  adaptation's `tools.restrict()` — which already ran, before this listener —
  is what removes the opposite tool from what the model is offered.
  `reconcileAssembly()` now drops the opposite guidance section by identity and
  leaves `tools` **absent**, so the host's own `{ ...transformed, tools }` stays
  authoritative. When a host *does* supply `tools` (0.1.7-rc.1 and earlier) the
  previous correction still applies, so that line keeps working.

  Reported stack head:
  `TypeError: Cannot read properties of undefined (reading 'filter')` at
  `reconcileAssembly (lib/agent-shell.js)`.

### Changed

- **`tools.modeFor()` is gone; nothing reads it unconditionally.** It was
  removed in 0.2.2-rc.1 (the native/PTC split became a per-agent tool-executor
  plugin, `tools.setExecutor`/`selectExecutor`). `isNativeToolWire()` treats its
  absence as "native", which is the conservative answer: the registry is
  authoritative and the append branch is unreachable on 0.2.2 anyway, where
  `tools` never reaches the listener.
- **`agent/created` is now awaited.** 0.2.2-rc.1 dispatches it through
  `ctx.serial(...)` (it was a fire-and-forget `emit`), and `registry.announce()`
  propagates a listener rejection — so a throwing listener now fails agent
  creation instead of being logged. The lifecycle listener stays synchronous and
  non-throwing; the adaptation's rejection is still re-raised from the awaited
  barrier, where it names the real cause before any model request.
- **Section order comes from the host's placement table.** 0.2.2-rc.1 moved
  `tool:bash`/`tool:pwsh` orders into a central `SECTION_ORDERS` registry
  (`TOOL_BASH: 1000`, `TOOL_PWSH: 1010`) exposed as
  `systemPrompt.getSectionOrder(name)`. `shadowOppositeShellPrompt()` reads
  through it and keeps the old `105` only as a fallback, so the shadowing
  section keeps matching the section it shadows.
- **New seam in `src/compat/rc6-agent.ts`**: `modelFacingTools()` reads the
  model-facing schema from the live registry
  (`tools.definitions()`/`schemas()`/`view()`), which is the 0.2.2 answer to the
  removed `assembly.tools` input.
- No manifest, boot-expression or client change was needed: `dsh-client-ui-primitives`
  is provided in the browser by the Web frontend's own module registry
  (`window.__ModuleLoader__`), not as an installed package, and the
  `settings.section` slot, `ctx.settings.describe()/replace()`,
  `ctx.webServer.register`, `candidatePwshPaths`/`pwshPath` and the
  `settings.section` `{ id, order, label, inject }` contract are unchanged.
  The `^0.1.7-rc.1 || ^0.2.0-rc.1` peer range already admits `0.2.2-rc.1`.

### Added

- `tests/dsh-0.2.2-contract.test.ts` pins the new contract: reconcile must not
  throw on a `tools`-less assembly, must leave `tools` absent rather than
  writing `[]`, must preserve `contexts`/`variables`, must not mutate its input,
  and must still correct the 0.1.7 shape when `tools` is present.

## [0.2.2] — unreleased

### Fixes

- **DSH 0.2.0-rc.1 accepts the bundle again.** The nine `@deepseek-ai/dsh-*`
  peers declared `^0.1.7-rc.1`, a caret range that stops below `0.2.0`, so the
  host's compatibility verdict — `semver.satisfies(runtimeVersion, range,
  { includePrerelease: true })` over every `@deepseek-ai/dsh` /
  `@deepseek-ai/dsh-*` peer — reported every one of them and the plugin manager
  refused the install as `incompatible-version`, rendered as
  `dsh-shell-selector@0.2.1 与 DSH 0.2.0-rc.1 不兼容（要求 …）`. The boot-time
  preflight applies the same verdict to the composition, where the
  `shell-selector` row is disabled and a bundle layer that fails it is skipped
  outright, so neither the host half nor the Settings tab loaded. Each peer now
  declares `^0.1.7-rc.1 || ^0.2.0-rc.1`, so both runtimes stay claimed.
- The runtime API surface this plugin actually uses is unchanged between the two
  releases: `ctx.settings.describe()/replace()`, `ctx.webServer.register`,
  `candidatePwshPaths`, the `settings.section` slot contract, and the
  `@deepseek-ai/dsh-system-prompt` / `ctx.tools` scope surface the agent-plane
  adaptation reads. Only the declared range moved; no `src/` file changed.
- **Installing from GitHub no longer dies with
  `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`.** pnpm 11 judges a git-hosted
  dependency to need a build when it declares a
  `prepublish`/`prepack`/`publish` script **and** the file its `main` names is
  missing from the fetched tarball, and it runs that build only with the user's
  approval in the profile's `allowBuilds`. `lib/` was gitignored, so
  `dsh plugin add github:AnthonyandNancy/dsh-shell-selector` stopped with
  `The git-hosted package "dsh-shell-selector@0.2.1" needs to execute build
  scripts but is not in the "allowBuilds" allowlist` before any of the plugin's
  own code ran. The build output is now committed, so pnpm finds
  `lib/index.js` and skips `prepack` entirely: installing asks for no build
  approval, and nothing runs with the host user's permissions. `prepack` stays
  for `npm pack`.

### Changed

- `README.md` / `README.zh.md` install rows name the GitHub spec first and the
  release tarball second; the Development section records that `lib/` is a
  committed artifact and must be rebuilt together with `src/`.
- CI rebuilds the plugin and fails when the committed `lib/` or
  `cordis.patch.yml` no longer matches what `src/` produces.

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
