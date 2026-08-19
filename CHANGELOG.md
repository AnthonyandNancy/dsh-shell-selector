# Changelog

All notable changes to `dsh-shell-selector` are documented in this file.

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
