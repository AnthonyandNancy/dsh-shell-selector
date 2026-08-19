# Changelog

All notable changes to `dsh-shell-selector` are documented in this file.

## [0.1.0] — 2025-XX-XX

### Fixes

- **Bundle host mount** (`cordis.patch.yml`): the bundle now carries an
  `- insert:` row mounting the `shell-selector` host plugin. Without it the
  patch lines applied at boot but the plugin itself never loaded after a
  restart (hot-injected instances were unaffected).

### Features

- **Shell interpreter selection** for DeepSeek Harness:
  - Windows: DSH default / auto fallback (Bash → PowerShell 7 → Windows
    PowerShell, resolved once at boot) / explicit Bash, PowerShell 7 or
    Windows PowerShell.
  - macOS / Linux: DSH default / explicit Bash.
- **Restart-based activation**: changes are persisted immediately and take
  effect on the next DeepSeek Harness start; the running process keeps its
  boot-time shell. No hot swapping, no forced restarts.
- **Web Settings page** (official `settings.section` slot, native DSH
  primitives/tokens, zh-CN + en-US):
  - Currently active vs. after-restart status blocks.
  - Fixed restart hint under the selector.
  - Re-detect (re-scan only) and Save (with success notice stating the
    restart requirement).
  - Warnings: configured shell missing, active shell missing, no shell
    available, gated by another agent preset.
- **Boot-time composition** through generated `cordis.patch.yml` expressions
  (executor rows) and the `shell-selector` agent preset (tool rows),
  `agent-presets.config.default` pointed at the preset.
- **Semantic restart detection**: `restartRequired` compares resolved shells
  (e.g. Windows `default` ↔ `explicit: pwsh` needs no restart), not raw
  configuration strings.
- **Agent-preset gating**: selecting a different default preset makes the
  override inert for sessions, with a UI notice.
- **Security**: allowlist-only configuration, no eval/spawn of user input,
  same-origin GET/POST endpoint with strict CSP and size limits.

### Notes

- Installing the plugin makes `Shell Selector` the default agent preset; the
  preset is a faithful copy of the standard preset with only the two
  shell-tool rows parameterized. With `mode: default` behavior matches a
  stock install.
- `$DSH_HOME/.agent-presets/shell-selector/` is managed (version-marked);
  marker-less user edits are preserved and reported.
