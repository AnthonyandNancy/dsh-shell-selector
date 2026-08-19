# dsh-shell-selector

Choose which shell interpreter DeepSeek Harness runs commands with —
**Bash**, **PowerShell 7 (pwsh)** or **Windows PowerShell** — from a Settings
page.

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

---

## How the change takes effect

The shell swap happens in the **composition layer at process startup** via
three mechanisms installed by this plugin:

1. **Bundle patch** (`cordis.patch.yml`) — the executor rows
   `bash-sandbox` / `pwsh-sandbox` read the saved configuration at boot and
   enable exactly one of them. An explicit *Windows PowerShell* choice pins
   the Windows PowerShell executable path for the PowerShell executor.
2. **Agent preset** (`shell-selector`) — sessions get the matching tool:
   `tool-bash` when Bash was chosen, `tool-pwsh` when a PowerShell was chosen.
   The preset is contributed through the official user-preset mechanism
   (`$DSH_HOME/.agent-presets/shell-selector`) and becomes the default agent
   preset.
3. **Settings namespace** (`shell-selector`, `mode: default|fallback|explicit`,
   `shell: bash|pwsh|powershell`) — persisted via the settings service.

**No runtime replacement** of `ctx.shell`, **no** dynamic loading/unloading of
`tool-bash`/`tool-pwsh`, **no** forced restart. The host plugin only registers
settings, snapshots the boot decision, materializes the preset, and serves the
Settings page.

> **Note on agent presets:** installing this plugin makes **Shell Selector**
> the default agent preset (visible in the Agent Presets settings). Choosing a
> different preset disables the shell override for sessions that use it (the
> Settings page shows a notice). Sessions keep standard behavior in every
> other respect — this preset is a faithful copy of the standard preset whose
> only difference is the two shell-tool rows.

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

## Development

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
npm pack --dry-run
```

- `scripts/render-patch.mjs` / `scripts/render-preset.mjs` generate
  `cordis.patch.yml` and the preset composition from `src/boot/expressions.ts`
  (single source of truth); `scripts/lint.mjs` verifies the committed files
  are in sync.
- `scripts/build-client.mjs` bundles the browser client into
  `lib/client.js` (the DSH Web module-loader format).
- `tests/expressions.test.ts` evaluates the boot expressions against a
  fabricated environment and asserts they agree with `src/resolver.ts`.

## Security notes

- Configuration accepts only the allowlisted ids — there is no free-form
  command or path input, and **no user input is ever evaluated or spawned**.
- The boot expressions read `$DSH_HOME/settings.yaml` directly (a JSON parse
  attempt, then a flat YAML section parse) and never execute shell commands.
- The Web endpoint is same-origin, GET/POST only, with strict CSP headers and
  body-size limits; the settings namespace itself is not exposed over the
  settings RPC.
