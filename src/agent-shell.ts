/**
 * Agent-scoped Shell Tool adaptation.
 *
 * The Shell Selector decides WHICH shell interpreter a shell-capable agent
 * uses. A preset decides WHETHER the agent has the standard Shell capability.
 * This module applies the selector's decision per agent by restricting the
 * opposite shell tool from the agent's inherited tool view.
 *
 * It runs in the `agent/created` lifecycle (after the preset standing mount is
 * attached and before the first model prompt), never by inspecting preset
 * names, and never grants a shell to an agent whose composition has no
 * `tool-bash`/`tool-pwsh` rows.
 *
 * @module dsh-shell-selector/agent-shell
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ShellId } from './resolver.js'

/** The agent-shaped object exposed by `agent/created` events. */
export interface AgentLike {
  ctx: Context
}

/** The model-facing tool name for a resolved shell kind. */
export function activeShellTool(activeKind: ShellId): 'bash' | 'pwsh' {
  return activeKind === 'bash' ? 'bash' : 'pwsh'
}

/**
 * Restrict the shell tool that does not match the active executor.
 *
 * The restriction is registered on the agent's own scope, so it is disposed
 * automatically with the agent. If the agent has no standard Shell tools at
 * all, this is a no-op — Shell Selector never grants Shell capability.
 */
export function adaptAgentShell(agent: AgentLike, activeKind: ShellId): void {
  const ctx = agent.ctx as Context & { tools?: unknown }
  const tools = (ctx.tools ?? undefined) as
    | {
        view(scope: unknown): { visible?: { has(name: string): boolean } }
        restrict(options: { deny: string[] }): unknown
      }
    | undefined
  if (tools === undefined) return

  const view = tools.view(agent)
  const hasBash = view?.visible?.has('bash') ?? false
  const hasPwsh = view?.visible?.has('pwsh') ?? false
  if (!hasBash && !hasPwsh) return

  const target = activeShellTool(activeKind)
  const opposite = target === 'bash' ? 'pwsh' : 'bash'
  const hasOpposite = target === 'bash' ? hasPwsh : hasBash
  if (hasOpposite) {
    tools.restrict({ deny: [opposite] })
  }
}
