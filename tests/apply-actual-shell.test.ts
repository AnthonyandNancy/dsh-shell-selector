/**
 * `apply()` must adapt to the shell the host COMPOSED, not to the shell its own
 * configuration predicted.
 *
 * The two are equal on a healthy install and diverge exactly when this plugin's
 * bundle patch did not load — which is the state that produced
 * `tool-pwsh ... waiting for shell` followed by `agent-preset/invalid`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { apply, resetBootFacts } from '../src/index.js'
import { STATE_ROUTE } from '../src/web.js'

interface Route {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

/** Stand-in for `SandboxPwshExecutor`. */
class SandboxPwshExecutor {
  get pwshPath(): string {
    return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  }
}

/** Stand-in for `SandboxBashExecutor`. */
class SandboxBashExecutor {
  readonly shell = 'bash'
}

interface Host {
  ctx: Record<string, unknown>
  routes: Map<string, Route>
  warns: unknown[][]
  /** Activate the executor row after `apply()` has already run. */
  provideShell: (value: object) => void
}

/** A host with only the services this plugin touches. */
function createHost(options: { shell?: object } = {}): Host {
  const routes = new Map<string, Route>()
  const warns: unknown[][] = []
  const shellWaiters: Array<(child: unknown) => void> = []
  const ctx: Record<string, unknown> = {
    settings: { describe: () => [], replace: async () => {}, writable: true },
    webServer: {
      register: (route: Route): (() => void) => {
        routes.set(route.path, route)
        return () => {
          routes.delete(route.path)
        }
      },
    },
    logger: {
      info: () => {},
      debug: () => {},
      warn: (...args: unknown[]) => warns.push(args),
      error: () => {},
    },
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    // Faithful to Cordis: `inject` creates a PENDING fiber when a named
    // dependency is absent, then runs the callback when it appears. `apply()`
    // observes `ctx.shell` this way because the service appears after the
    // plugin has loaded.
    inject: (deps: string[], callback: (child: unknown) => void) => {
      if (deps.every((dep) => ctx[dep] !== undefined)) {
        callback(ctx)
        return () => {}
      }
      if (deps.length === 1 && deps[0] === 'shell') shellWaiters.push(callback)
      return () => {}
    },
    on: () => () => {},
  }
  if (options.shell !== undefined) ctx['shell'] = options.shell
  return {
    ctx,
    routes,
    warns,
    provideShell: (value: object) => {
      ctx['shell'] = value
      for (const callback of shellWaiters.splice(0)) callback(ctx)
    },
  }
}

/** Read the state the Settings page would render. */
async function readState(routes: Map<string, Route>): Promise<Record<string, unknown>> {
  const route = routes.get(STATE_ROUTE)
  if (route === undefined) throw new Error(`no ${STATE_ROUTE} route registered`)
  let body = ''
  const res = {
    setHeader: () => {},
    writeHead: () => {},
    end: (chunk: unknown) => {
      body = String(chunk)
    },
  }
  await route.handler({ method: 'GET' }, res)
  const payload = JSON.parse(body) as { ok: boolean; value: Record<string, unknown> }
  if (!payload.ok) throw new Error('state route failed')
  return payload.value
}

describe('apply() prefers the composed shell', () => {
  beforeEach(() => {
    resetBootFacts()
  })

  /**
   * These cases must not depend on which shells THIS machine happens to have.
   * `mode: 'default'` is the deterministic choice: it resolves to `platform`,
   * and `resolvedShellKind` turns that into `pwsh` on Windows and `bash`
   * elsewhere without probing anything. Every case below therefore compares the
   * composed shell against the platform default.
   */
  const platformDefault = process.platform === 'win32' ? 'pwsh' : 'bash'
  const oppositeExecutor = process.platform === 'win32' ? SandboxBashExecutor : SandboxPwshExecutor
  const oppositeKind = process.platform === 'win32' ? 'bash' : 'pwsh'

  it('reports the composed shell even when it contradicts the platform default', async () => {
    const host = createHost({ shell: new oppositeExecutor() })
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const state = await readState(host.routes)
    const active = state['active'] as Record<string, unknown>
    expect(active['kind']).toBe(oppositeKind)

    // Exactly one warning, naming the mismatch so the user can act on it.
    expect(host.warns).toHaveLength(1)
    expect(String(host.warns[0]?.[0])).toContain('boot patch did not take effect')
    // The message names the deployable fix.
    expect(String(host.warns[0]?.[0])).toContain('dsh.profile.bundles')
  })

  it('stays silent when the composition matches the configuration', async () => {
    const host = createHost({ shell: platformDefault === 'pwsh' ? SandboxPwshExecutor : SandboxBashExecutor })
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const state = await readState(host.routes)
    const active = state['active'] as Record<string, unknown>
    expect(active['kind']).toBe(platformDefault)
    expect(host.warns).toHaveLength(0)
  })

  it('falls back to the configured shell when no shell service is composed', async () => {
    const host = createHost()
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const state = await readState(host.routes)
    const active = state['active'] as Record<string, unknown>
    // `default` keeps the shipped platform rule, so there is nothing to warn about.
    expect(active['kind']).toBe(platformDefault)
    expect(host.warns).toHaveLength(0)
  })

  it('freezes the composed shell across a re-entrant apply (settings save)', async () => {
    const host = createHost({ shell: new oppositeExecutor() })
    apply(host.ctx as unknown as Context, { mode: 'default' })
    const first = await readState(host.routes)
    expect((first['active'] as Record<string, unknown>)['kind']).toBe(oppositeKind)

    // Saving the row re-enters apply() with a new configuration. The shell this
    // process booted with must NOT change.
    apply(host.ctx as unknown as Context, { mode: 'explicit', shell: oppositeKind })
    const second = await readState(host.routes)

    expect((second['active'] as Record<string, unknown>)['kind']).toBe(oppositeKind)
    // Reported once per process, not once per apply.
    expect(host.warns).toHaveLength(1)
  })

  it('updates the already-registered state route when the service appears later', async () => {
    // The real composition inserts this plugin's row BEFORE the executor rows,
    // so the first apply sees no `ctx.shell`. When the executor row activates,
    // the one-time correction must also reach consumers that were built during
    // the first apply — the state route and the agent adapter.
    const host = createHost()
    apply(host.ctx as unknown as Context, { mode: 'default' })
    const before = await readState(host.routes)
    expect((before['active'] as Record<string, unknown>)['kind']).toBe(platformDefault)
    expect(host.warns).toHaveLength(0)

    host.provideShell(new oppositeExecutor())

    const after = await readState(host.routes)
    expect((after['active'] as Record<string, unknown>)['kind']).toBe(oppositeKind)
    expect(host.warns).toHaveLength(1)
  })
})
