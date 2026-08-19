# Changelog

All notable changes to `dsh-shell-selector` are documented in this file.

## [0.1.0] — 2025-XX-XX

### Fixes

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
- **Preset-independent capability model**: Agent Preset decides WHETHER Shell
  exists; Shell Selector decides WHICH shell it is. A preset without
  `tool-bash`/`tool-pwsh` never gains Shell capability.
- **Per-agent tool matching**: an `agent/created` listener calls
  `tools.restrict()` so the visible Shell tool always matches the active
  executor for every shell-capable agent.
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
