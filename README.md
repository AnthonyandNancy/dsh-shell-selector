# dsh-shell-selector

Choose which shell interpreter DeepSeek Harness runs commands with —
**Bash** (including Git Bash on Windows), **PowerShell 7 (pwsh)** or
**Windows PowerShell** — from a Settings page.

| | |
|---|---|
| Host | Windows / macOS / Linux |
| Client | Web (Settings → **Shell Interpreter** tab) |
| Install | `dsh plugin add dsh-shell-selector-0.2.1.tgz` |
| License | MIT |

> **Restart requirement** — Changing the Shell interpreter does **not** hot-swap
> the running process. Your choice is saved immediately and takes effect the
> next time DeepSeek Harness starts. The Settings page always shows both
> **Currently active** (this process) and **After restart** (next boot), and
> tells you when a restart is required.

---

## Product contract

> **Preset determines WHETHER. Selector determines WHICH.**
>
> An Agent Preset decides whether an agent has a Shell at all; Shell Selector
> decides which shell that is.

- Shell Selector never sets `agent-presets.default`, never contributes an agent
  preset of its own, and never inspects preset names.
- A preset that mounts neither `tool-bash` nor `tool-pwsh` **cannot** gain Shell
  capability through this plugin. That is a permission boundary, not a
  convenience default.
- A preset that does mount a standard Shell tool gets the **matching** tool
  only. On Windows a preset exposing just `pwsh` with Bash selected ends up with
  `bash` visible and `pwsh` hidden — the target tool is *added* before the
  mismatched one is removed, so a shell-capable agent can never be left with
  zero shells.
- The tool schema and the system prompt are kept in step: `tool:bash` guidance
  never accompanies a PowerShell tool, and vice versa.
- Both PowerShell 7 and Windows PowerShell use the single model-facing `pwsh`
  tool; they differ only in which executable the host executor spawns.

### Per-agent adaptation

For every agent, in this order:

1. **Inspect capability** — read the agent's tool view *before* changing
   anything. No `bash` and no `pwsh` means no shell capability: stop here.
2. **Ensure target** — if the tool for the active shell is missing, mount the
   official `@deepseek-ai/dsh-tool-bash` / `@deepseek-ai/dsh-tool-pwsh` plugin on
   the agent's own scope.
3. **Verify target** — confirm it is really visible.
4. **Hide opposite** — only now restrict the other dialect's tool.
5. **Shadow opposite prompt** — blank its `tool:*` section by section identity.
6. **Verify final state** — target visible, opposite hidden.

Any failure rolls the whole transaction back and fails the session with a
`ShellSelectorAgentAdaptationError` naming the real cause. The plugin never logs
a warning and lets an agent proceed with a wrong or empty shell surface.

## Why a restart?

DeepSeek Harness decides *at startup* which shell executor (`ctx.shell`)
composes into the running process. Swapping that stack at runtime would mean
unloading and reloading platform services and tools mid-session — something
this plugin deliberately never does. Instead:

1. **Save** writes your choice to this plugin's profile row
   (`cordis.patch.yml` -> `- id: shell-selector`) through the settings service,
   so writes stay conflict-checked.
2. The **current process keeps running with its original shell** — nothing is
   replaced, nothing is restarted. DSH reconciles the row, which reloads the
   plugin; the boot facts stay frozen.
3. On the **next boot**, the composition layer reads your saved choice while
   the executor rows are activated, and the matching shell is composed from
   the first second.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

---

## Modes

### Windows

| Mode | Behavior |
|---|---|
| **DSH default** | Keep the built-in platform rule (PowerShell). |
| **Auto fallback** (recommended) | First available shell in strict order: **Bash → PowerShell 7 → Windows PowerShell**. Resolved once at startup. |
| **Specific shell** | Exactly **Bash**, **PowerShell 7 (pwsh)** or **Windows PowerShell**. If the chosen shell cannot be detected, the next boot falls back to the DSH default. |

### macOS / Linux

| Mode | Behavior |
|---|---|
| **DSH default** | Keep the built-in platform rule (Bash). |
| **Specific shell** | **Bash** (the only explicit option on POSIX in v1). |

On Windows the WSL launcher (`System32\bash.exe`) is **not** treated as Bash.
Git for Windows is discovered even when it is not on PATH.

---

## How the change takes effect

The shell swap happens in the **composition layer at process startup** via:

1. **Bundle patch** (`cordis.patch.yml`) — the executor rows
   `bash-sandbox` / `pwsh-sandbox` read the saved configuration at boot and
   enable exactly one of them. An explicit *Windows PowerShell* choice pins
   the Windows PowerShell executable path for the PowerShell executor.
2. **Host plugin** (`src/index.ts`) — captures the boot snapshot, prepares the
   Git Bash directory on `PATH` when needed, and installs the per-agent Shell
   Tool adaptation described above.
3. **Configuration row** (`shell-selector`, `mode: default|fallback|explicit`,
   `shell: bash|pwsh|powershell`) — a plugin Config projected into the settings
   surface and persisted on the profile row.

**No runtime replacement** of `ctx.shell`, **no** hot-swapping of the host
executor, **no** forced restart, **no** default preset change. The bundle patch
governs the *host* plane only; agent tool surfaces are handled per agent, so a
no-shell preset is never given a shell by a global patch.

### Git Bash on Windows

- Detection order: `bash.exe` on `PATH` → Git Bash derived from `git.exe` on
  `PATH` → `%ProgramFiles%\Git` → `%ProgramFiles(x86)%\Git` →
  `%LOCALAPPDATA%\Programs\Git`.
- Every candidate is validated with real probes: `bash --version` and
  `bash -c 'printf "$BASH_VERSION"'`; `System32\bash.exe` (WSL) is rejected.
- Because the official Bash executor always spawns `bash` and cannot be told
  to use an absolute path, the host plugin prepends the resolved Git Bash bin
  directory to the **process-local** `PATH` when the active shell is Bash on
  Windows. No registry or user environment is modified.

---

## The Settings page

Settings → **Shell Interpreter**:

- **Currently active** — the shell this process runs commands with (immutable
  per process).
- **After restart** — the shell the next boot will compose, shown whenever a
  change is pending.
- **Re-detect** — re-scans the machine without changing anything.
- **Save** — persists the choice; the success message states that the change
  takes effect after restarting DeepSeek Harness.
- Warnings when the configured shell can no longer be detected, when the
  active shell is missing, or when no shell is available at all.

The UI uses the DSH native primitives (`Menu`, `Button`, icons), not native
`<select>` controls, so it matches the rest of the Settings experience in
light/dark mode, keyboard navigation, and popover behavior. The dropdown is
portalled and end-aligned, so it grows leftwards from the trigger's right edge
and cannot escape the Settings dialog or force horizontal scrolling.

## Development

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
npm pack --dry-run
```

- `scripts/render-patch.mjs` generates `cordis.patch.yml` from
  `src/boot/expressions.ts` (single source of truth); `scripts/lint.mjs`
  verifies the committed file is in sync.
- `scripts/build-client.mjs` bundles the browser client into
  `lib/client.js` (the DSH Web module-loader format).
- `tests/expressions.test.ts` evaluates the boot expressions against a
  fabricated environment and asserts they agree with `src/resolver.ts`.
- `tests/detector.test.ts` covers Git Bash discovery, WSL rejection, probe
  validation, and duplicate de-duplication.
- `tests/agent-shell.test.ts` covers the full preset × selector state table,
  ADD-BEFORE-REMOVE ordering, and transactional rollback.
- `tests/router-bootstrap.test.ts` reproduces the Agent Router's platform-shell
  selection and pins that a shell-capable agent always keeps one.
- `tests/agent-prompt.test.ts` pins tool/prompt alignment in both directions.
- `tests/agent-install.test.ts` covers the lifecycle wiring and the
  prompt-assembly barrier.
- `tests/client/*` covers the DSH-native Select (including menu placement and
  scoped keyboard navigation) and the Settings page layout.

`src/compat/rc6-agent.ts` and `src/compat/settings-surface.ts` are the only
modules that speak to DSH internals; every assumption lives there with the
observation that justifies it.

## Security notes

- Configuration accepts only the allowlisted ids — there is no free-form
  command or path input, and **no user input is ever evaluated or spawned**.
- The boot expressions read the profile row directly (then the retired
  `$DSH_HOME/settings.yaml`) and only probe the fixed, allowlisted candidate
  executables.
- The Web endpoint is same-origin, GET/POST only, with strict CSP headers and
  body-size limits; the settings page reads and writes through it rather than
  through the settings RPC.
