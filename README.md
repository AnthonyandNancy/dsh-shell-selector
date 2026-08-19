# dsh-shell-selector

Choose which shell interpreter DeepSeek Harness runs commands with —
**Bash** (including Git Bash on Windows), **PowerShell 7 (pwsh)** or
**Windows PowerShell** — from a Settings page.

| | |
|---|---|
| Host | Windows / macOS / Linux |
| Client | Web (Settings → **Shell Interpreter** tab) |
| Install | `dsh plugin add dsh-shell-selector-0.1.0.tgz` |
| License | MIT |

> **Restart requirement** — Changing the Shell interpreter does **not** hot-swap
> the running process. Your choice is saved immediately and takes effect the
> next time DeepSeek Harness starts. The Settings page always shows both
> **Currently active** (this process) and **After restart** (next boot), and
> tells you when a restart is required.

---

## Product contract

> **Agent Preset decides WHETHER there is Shell; Shell Selector decides WHICH
> shell it is.**

- Shell Selector never sets `agent-presets.default`, never contributes a
  `shell-selector` agent preset, and never inspects preset names.
- A preset that does not mount `tool-bash`/`tool-pwsh` cannot gain Shell
  capability through this plugin.
- A preset that does mount the standard Shell tools gets its **matching** tool
  only: Bash active → `tool-bash`; PowerShell active → `tool-pwsh`. The
  opposite tool is hidden per-agent with `tools.restrict()`.

## Why a restart?

DeepSeek Harness decides *at startup* which shell executor (`ctx.shell`)
composes into the running process. Swapping that stack at runtime would mean
unloading and reloading platform services and tools mid-session — something
this plugin deliberately never does. Instead:

1. **Save** persists your choice to `$DSH_HOME/settings.yaml` (standard
   settings service, conflict-checked writes).
2. The **current process keeps running with its original shell** — nothing is
   replaced, nothing is restarted.
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
   Git Bash directory on `PATH` when needed, and registers the
   `agent/created` listener that hides the non-matching Shell tool for every
   shell-capable agent.
3. **Settings namespace** (`shell-selector`, `mode: default|fallback|explicit`,
   `shell: bash|pwsh|powershell`) — persisted via the settings service.

**No runtime replacement** of `ctx.shell`, **no** dynamic loading/unloading of
`tool-bash`/`tool-pwsh`, **no** forced restart, **no** default preset change.

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
light/dark mode, keyboard navigation, and popover behavior.

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
- `tests/client/*` covers the DSH-native Select and Settings page layout.

## Security notes

- Configuration accepts only the allowlisted ids — there is no free-form
  command or path input, and **no user input is ever evaluated or spawned**.
- The boot expressions read `$DSH_HOME/settings.yaml` directly (a JSON parse
  attempt, then a flat YAML section parse) and only probe the fixed,
  allowlisted candidate executables.
- The Web endpoint is same-origin, GET/POST only, with strict CSP headers and
  body-size limits; the settings namespace itself is not exposed over the
  settings RPC.
