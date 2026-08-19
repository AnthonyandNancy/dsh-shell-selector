# dsh-shell-selector Shell Policy Redesign

## Goal

Make Shell Selector the process-wide interpreter policy while preserving Agent Preset capability boundaries:

- Preset determines whether the agent has the standard bash / pwsh capability.
- Shell Selector determines which interpreter a shell-enabled agent uses.
- No-shell presets remain shell-free.
- Shell changes remain restart-bound; the running ctx.shell stack is never hot-swapped.

## Current DSH integration facts

The installed DeepSeek Harness API exposes the following supported seams:

- agent/created is emitted synchronously while the unpublished Agent is being announced and before the first prompt assembly.
- agent.ctx.tools.get/register/restrict resolves scoped tool visibility, supports scoped shadow registrations, and filters inherited preset/global tools.
- agent.ctx.systemPrompt.section supports a same-name scoped shadow, allowing an inactive shell dialect contribution to be suppressed without replacing the global prompt registry.
- @deepseek-ai/dsh-client-ui-primitives publicly exports Menu, Button, and check/chevron icons.

The implementation will use those APIs rather than copying complete presets or using child_process.exec for command execution.

## Boot policy

1. Read the persisted shell-selector namespace.
2. Detect candidates for the current platform.
3. Resolve the effective shell from mode, OS, and availability only.
4. Enable exactly one host executor:
   - Bash/Git Bash: bash-sandbox and host dsh-tool-bash.
   - PowerShell 7/Windows PowerShell: pwsh-sandbox and host dsh-tool-pwsh.
5. For explicit Windows PowerShell, pass the validated executable path to the PowerShell provider.
6. For Git Bash outside PATH, prepend its bin directory to the current process PATH during boot/plugin initialization. This is process-local only; no setx, registry, or permanent environment mutation.

Default mode leaves DSH's platform default in charge. Windows fallback is strictly Bash/Git Bash, PowerShell 7, Windows PowerShell. WSL's System32\\bash.exe launcher is never a normal Bash candidate.

## Agent capability adaptation

The host patch provides one selected official shell tool as a global source. Each Agent creation then receives a synchronous scoped adaptation:

- Inspect final composition visibility for the standard tool names bash and pwsh.
- If neither is visible, apply an inherited-tool restriction denying both and shadow both shell prompt sections with empty scoped sections.
- If at least one is visible, treat the Agent as shell-enabled. Register/shadow only the active global definition in the Agent's own scope, deny the inactive name in inherited layers, and shadow the inactive dialect prompt section with empty text.
- Never infer capability from preset ids such as standard, code, or shell-selector.
- Never alter agent-presets.default or materialize a plugin-owned preset.

Because the tool definition remains the official DSH tool, execution continues through DSH's ctx.shell, sandbox, approval, jobs, timeout, cancellation, and environment paths.

## Git Bash discovery and validation

Windows candidate order is deterministic and deduplicated case-insensitively:

1. PATH bash.exe, except %SystemRoot%\\System32\\bash.exe.
2. Git root inferred from PATH git.exe: <root>\\bin\\bash.exe and <root>\\usr\\bin\\bash.exe.
3. %ProgramFiles%\\Git\\bin\\bash.exe and usr\\bin\\bash.exe.
4. %ProgramFiles(x86)%\\Git\\bin\\bash.exe and usr\\bin\\bash.exe.
5. %LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe and usr\\bin\\bash.exe.

Every candidate must be a file, pass an argv-based bash --version probe, and pass an argv-based bash -c printf probe with timeout and windowsHide. Probe failures remove the candidate from availability. Detection returns display name, source, executable, and best-effort version; duplicate executables appear once.

## Settings UI

Replace browser-native selects with DSH primitives:

- Menu supplies the anchored floating list, selected styling, outside click, and Escape handling.
- Button supplies the trigger and secondary/primary actions.
- IconCheckOutline16 and IconChevronDown16 supply selected/check and trigger affordances.
- Existing --dsw-* tokens provide typography, foreground/background, border, radius, hover, selected, focus, and shadow styling.

Mode and shell rows follow the DSH Settings row pattern. The closed trigger is compact and content-sized. Explicit mode alone reveals the shell row. Shell entries may include a muted, ellipsized executable line. The component supplements Menu's focus behavior with arrow/Home/End movement while preserving aria menu roles, Escape, outside click, and disabled options.

The page retains explicit Save semantics, re-detection, restart hint, active/configured status rows, read-only state, and light/dark token behavior. It removes all preset-gate state and copy.

## Verification

Tests cover resolver independence, no-shell protection, boot expression agreement, Git Bash path sources and probe failures, fallback order, runtime PATH injection, active/configured restart state, and the selector interactions. Documentation explains policy/capability separation, Git Bash discovery/validation/runtime resolution, restart semantics, and why native HTML selects are not used.
