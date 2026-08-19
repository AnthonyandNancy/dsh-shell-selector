# Architecture

This document explains how `dsh-shell-selector` changes the shell
interpreter, why a restart is required, and how the pieces fit together.

## Product contract

- **Preset determines WHETHER. Selector determines WHICH.** An Agent Preset
  decides whether an agent has a Shell at all; Shell Selector decides which
  shell that is.
- **No hot switching.** Configuration changes are *persisted* and take effect
  on the *next process start*.
- **No runtime replacement** of `ctx.shell`, **no** hot-swapping of the host
  executor, **no** forced restart, **no** "apply now".
- **No preset coupling.** The plugin never sets `agent-presets.default`, never
  ships an agent preset of its own, and never inspects preset names.
- **No self-written shell tools.** Bash and PowerShell always come from the
  official `@deepseek-ai/dsh-tool-bash` / `@deepseek-ai/dsh-tool-pwsh` packages
  resolved from the host runtime; the plugin never spawns a process itself.
- The plugin must not modify the DSH main repository or `node_modules` of the
  app; it ships as a normal npm bundle installed with `dsh plugin add`.
- Supported on Windows, macOS and Linux, with a Web Settings page that looks
  native (official slot + primitives/tokens) and zh-CN + en-US locales.

## Two planes

```text
Host plane
  Shell Selector settings
  ↓
  boot resolver (cordis.patch.yml expressions)
  ↓
  bash-sandbox / pwsh-sandbox   (exactly one)
  ↓
  ctx.shell

Agent plane
  Preset composition
  ↓
  Does this agent have standard shell capability?
  ↓
  NO  → no shell (permission boundary; nothing is added)
  YES
  ↓
  Shell Selector active shell
  ↓
  ensure matching official shell tool   (ADD)
  ↓
  verify it is visible
  ↓
  hide opposite shell tool              (REMOVE, only after the add)
  ↓
  shadow opposite `tool:*` prompt section
  ↓
  verify final state
```

The two planes are deliberately separate. The bundle patch decides the *host*
executor; it must never be used to force `tool-bash`/`tool-pwsh` on globally,
because that would give a no-shell preset a shell.

## Why restart is required

The shell stack is a *boot-time composition decision*:

- The loader activates executor rows (`bash-sandbox` / `pwsh-sandbox`) **while
  the process starts**, before any session exists. Exactly one of them
  provides `ctx.shell`; DSH ships the platform rule by disabling one of them
  per platform.
- Each session's tool list is composed by the agent-preset service from the
  preset it mounts. Shell Selector aligns that agent's shell tool with the
  already-active executor.

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

The capability question belongs to the agent preset composition, not to Shell
Selector, so no state in this plugin describes it.

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

Owned by `src/agent-shell.ts` (the algorithm) and `src/agent/install.ts` (the
lifecycle wiring). All rc.6 structural knowledge is isolated in
`src/compat/rc6-agent.ts`.

#### The algorithm

On `agent/created` the agent has already joined its preset's standing scope, so
`tools.view(agent)` reflects the preset's actual composition — without inspecting
any name. Then, in this exact order:

| Step | Action | Why the order matters |
|---|---|---|
| 1 | `inspectShellCapability()` | Read `bash`/`pwsh` visibility **before** mutating; this is the preset's grant. |
| 2 | `ensureTargetShellTool()` | Mount the official target plugin on `agent.ctx` if missing. **ADD** |
| 3 | verify target visible | Refuse to proceed on a tool that did not actually register. |
| 4 | `hideOppositeShellTool()` | `tools.restrict({ deny: [opposite] })`. **REMOVE, never before step 3** |
| 5 | `shadowOppositeShellPrompt()` | Register an empty same-named `tool:*` section. |
| 6 | `verifyAgentShell()` | Target visible, opposite hidden. |

If step 1 finds no shell capability the adaptation returns
`NOOP_NO_CAPABILITY` and adds nothing — a no-shell preset stays a no-shell
preset. Any failure in steps 2-6 rolls back every effect registered in that
transaction and throws `ShellSelectorAgentAdaptationError`, so a half-adapted
agent scope cannot exist.

**Why ADD BEFORE REMOVE.** The original defect was the reverse order. On a
Windows preset exposing only `pwsh`, with Bash selected, the old code restricted
`pwsh` without ever registering `bash`, leaving the agent with an **empty** shell
catalog. A router preset that picks its platform shell from the catalog then
failed with `router-bootstrap: no platform shell in catalog` — a second-order
symptom of this plugin's bug, not a router bug.

#### Official tools only

The target is always the official rc.6 plugin, imported by bare specifier so it
resolves from the **host** runtime:

- `@deepseek-ai/dsh-tool-bash`
- `@deepseek-ai/dsh-tool-pwsh`

Declared as `peerDependencies` (plus `devDependencies` for tests) so the plugin
never bundles a second DSH runtime copy. This is what preserves `ctx.shell`,
sandbox and `sandbox_permissions`, user approval, jobs and background execution,
timeouts, cancellation, `shellEnv`, result rendering and the terminal UI.

Windows PowerShell and PowerShell 7 share the single model-facing `pwsh` tool;
no second `powershell` tool is ever created. The difference is the executable
the host executor spawns.

#### Scoping

Everything is registered through `agent.ctx`, never the root context: the mount,
the restriction and the prompt shadow all live in the agent's own layer and are
disposed with the agent. Verified in rc.6: an agent-scope registration is
invisible to the global layer and to sibling agents, so two agents adapt
independently with no duplicate registration.

#### Prompt alignment

In DSH the tool schema and the system prompt are **two independent composition
inputs**. Hiding the `pwsh` tool does not remove `tool:pwsh` guidance. The
adaptation therefore shadows the opposite section by **identity** — an empty
same-named section on the agent scope, which rc.6 drops when rendering. The
plugin never rewrites prompt prose with string or regex replacement.

#### The prompt-assembly barrier

Two verified rc.6 facts require an enforcement point beyond `agent/created`:

- `agent/created` is dispatched with a fire-and-forget `emit`, so a rejected
  async listener is only logged — it cannot fail agent creation;
- mounting a tool plugin is asynchronous (`ctx.plugin()` activates one microtask
  later), so the adaptation cannot complete synchronously in that listener.

So the adaptation is *started* in `agent/created` and *enforced* in an
agent-scoped `system-prompt/assemble` listener — the one hook that is both
awaited and ahead of every model request, and that produces the tool schema and
the prompt together. The barrier:

- awaits the adaptation, and **throws** `ShellSelectorAgentAdaptationError` if it
  failed, so the session fails with the real cause before any LLM request;
- re-derives the shell rows from the live tool view and drops the opposite
  `tool:*` section, because rc.6 computes `assembly.tools` and
  `assembly.sections` *before* running the waterfall — a listener sees a
  snapshot taken at entry.

Because a preset registers its own `system-prompt/assemble` hook on the standing
scope before any agent scope exists, this agent-scope barrier always runs nested
**inside** it. The corrected catalog is therefore what the preset's
`await next()` observes, which is what fixes the router at the source.

In Code Mode the wire surface carries `run_code` and the shells live in the SDK
catalog, so the barrier does not append a shell to the wire schema; the SDK-facing
catalog still follows the selector because it derives from the same tool view.

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
- `agent-shell.test.ts` — the full preset × selector state table (cases A-G),
  ADD-BEFORE-REMOVE ordering, the never-empty-catalog invariant, transactional
  rollback, two-agent isolation, and no-preset-name coupling.
- `router-bootstrap.test.ts` — reproduces the Agent Router's platform-shell
  selection and pins that a shell-capable agent always keeps one, that a failed
  adaptation does not degrade into "no platform shell", and that a no-shell
  preset is not escalated to satisfy a router.
- `agent-prompt.test.ts` — tool/prompt alignment in both directions, shadowing
  by identity rather than prose rewriting, and the Code Mode wire surface.
- `agent-install.test.ts` — the lifecycle wiring: the barrier is registered on
  the agent scope, completes the adaptation before the assembly a request is
  built from, raises rather than swallows failures, and adapts once per agent.
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
src/index.ts            host apply(): settings, snapshot, PATH prepend, agent adaptation, endpoint
src/settings.ts         namespace, schema, validation, normalization
src/resolver.ts         decision mirror (pure, platform-parameterized)
src/boot/expressions.ts single source of the boot expressions
src/boot/*.template     patch template (placeholders)
src/detector.ts         availability + version probing (Git Bash aware)
src/runtime-snapshot.ts immutable active-shell snapshot
src/agent-shell.ts      the adaptation algorithm (capability→ensure→verify→hide→shadow→verify)
src/agent/install.ts    lifecycle wiring + the prompt-assembly barrier
src/compat/rc6-agent.ts the ONLY module that speaks to DSH rc.6 internals
src/web.ts              state/action endpoints, detection cache
src/types.ts            shared host types
src/client/*            Web plugin: locale, controller, DshSelect, page, entry
cordis.patch.yml        shipped bundle patch (rendered)
scripts/*               clean-build, renderer, client bundler, lint
tests/*                 unit + boot-expression + agent + client contract suites
tests/helpers/*         the rc.6-faithful fake agent host
```
