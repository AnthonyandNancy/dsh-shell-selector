# Shell Selector Unified Policy Implementation Plan

## Global constraints

- Work directly in the existing repository at D:\code\ai\dsh-shell-parser\dsh-shell-selector on the user-approved main branch.
- Preset determines whether an Agent has standard bash/pwsh capability; Shell Selector determines which interpreter a shell-enabled Agent uses.
- Do not infer shell capability from preset names, do not write agent-presets.default, and do not create or materialize a shell-selector Agent Preset.
- Keep shell changes restart-bound; never hot-swap ctx.shell.
- Use official DSH shell tools/executors and preserve ctx.shell, sandbox, approval, jobs, timeout, cancellation, and environment behavior. Never use child_process.exec for command execution.
- On Windows reject SystemRoot\\System32\\bash.exe as WSL, discover Git Bash from PATH/git.exe/well-known Git for Windows locations, validate with argv-based version and BASH_VERSION probes, and deduplicate.
- Use DSH Menu/Button/icon primitives and theme tokens; no native select/option and no third-party UI library.
- Run covering tests for every task and report actual results.

## Task 1: Remove preset gate and introduce policy/capability contracts

Files: src/resolver.ts, src/settings.ts, src/types.ts, src/runtime-snapshot.ts, src/web.ts, src/index.ts, related tests.

- Remove gated, gated-by-preset, readBootGate, isGated, defaultAgentPreset, and AGENT_PRESETS_SETTINGS_NAMESPACE dependencies.
- Change resolveEffective and restartRequired signatures to use config/platform/availability only.
- Keep activeShell/configuredShell and restart semantics.
- Update wire state to remove gate fields and add detected source/executable metadata as needed.
- Add pure capability adaptation helpers with fakeable registry interfaces if useful; do not use preset ids.
- Update existing tests first or alongside implementation so the resolver and state contract no longer mention gates.

## Task 2: Implement Windows Git Bash discovery and runtime executable resolution

Files: src/detector.ts, src/boot/expressions.ts, src/boot/patch.yml.template, cordis.patch.yml, index runtime setup, detector/expression tests.

- Implement deterministic Windows candidate discovery: PATH bash.exe excluding WSL, PATH git.exe-derived Git roots, ProgramFiles, ProgramFiles(x86), and LocalAppData Git roots; include bin and usr/bin.
- Validate file, executable/probe status, bash --version, and printf '%s' "$BASH_VERSION" using argv, timeout, and windowsHide. Support injected probe seams in tests.
- Return kind, Git Bash/Bash display name, source, executable/path compatibility, and version; dedupe paths case-insensitively.
- Keep auto fallback Bash/Git Bash -> pwsh -> Windows PowerShell.
- Render boot expressions without gated config. Ensure the selected executor is unique and the selected Git Bash bin directory is prepended only to the current process PATH when active.
- Add tests for every requested source, WSL rejection, probe failure, duplicate candidates, fallback, and path injection.

## Task 3: Add Agent-scoped official shell tool adaptation

Files: src/agent-shell.ts (or equivalent), src/index.ts, src/boot/patch.yml.template, package.json/lockfile, agent integration tests.

- Add DSH peer/dev dependencies for agent, scope, tools, system-prompt, and the official shell tool packages required by the patch.
- Patch in only the active official host tool source (dsh-tool-bash or dsh-tool-pwsh) alongside the unique executor.
- Register a synchronous agent/created listener before first Prompt assembly.
- Inspect final scope visibility of bash/pwsh with agent.ctx.tools.get and classify Shell-enabled iff either is visible.
- No shell: restrict inherited bash/pwsh and shadow tool:bash/tool:pwsh prompt sections empty.
- Shell-enabled: register/shadow only active tool in the Agent scope, restrict inactive tool, and shadow inactive dialect prompt section. Keep official tool definition/executor path.
- Add tests for standard+code-like shell compositions following Bash and pwsh, custom shell-enabled compositions, and no-shell remaining without either tool. Tests must prove no name-based branching.

## Task 4: Replace native Settings controls with DSH primitives

Files: src/client/ShellSelectorPage.tsx, src/client/index.tsx, locales, client types, new selector helper/component tests.

- Replace all select/option usage with a reusable DSH Menu-backed selector.
- Use Menu, Button, IconCheckOutline16, IconChevronDown16, and DSH --dsw-* tokens.
- Implement compact trigger, floating popover, selected check, disabled item, focus ring, Escape/outside click, and ArrowUp/Down/Home/End navigation.
- Make mode and shell rows match native Settings row layout; explicit mode alone shows shell selector; keep Save/re-detect/restart status.
- Show shell executable/source/version in muted ellipsis detail without over-wide controls.
- Remove gate warning/state and add zh-CN/en-US copy for policy/capability semantics.
- Add client interaction tests without relying on native select behavior.

## Task 5: Update documentation and remove obsolete preset assets

Files: README.md, README.zh.md, ARCHITECTURE.md, CHANGELOG.md, config/agent-presets/shell-selector/*, src/preset.ts, src/boot/preset-template.yml, scripts/render-preset.mjs, package scripts and lint checks.

- Explain Preset determines WHETHER and Selector determines WHICH.
- Document Git Bash discovery, validation, runtime path resolution, and restart configured/active semantics.
- Explain DSH-native Menu/Settings primitives and why native select is not used.
- Remove obsolete shell-selector preset materialization/rendering and default-preset mutation.
- Add requested changelog entries and ensure obsolete-term scans are clean.

## Task 6: Full verification and integration review

- Run pnpm lint, pnpm typecheck, pnpm test, pnpm build, and npm pack --dry-run.
- Run a real Windows smoke probe for Git Bash, PowerShell 7, and Windows PowerShell availability and executable resolution.
- Search for forbidden legacy terms and native select/option.
- Run a whole-branch review against the global constraints and fix all Critical/Important findings.
- Report PASS/FAIL/NOT RUN with command output summaries and changed-file paths.
