/**
 * Host endpoint tests against the DSH 0.1.7-rc.1 settings model.
 *
 * rc.1 addresses configuration by PROFILE ENTRY ID (not by a registered
 * namespace), so these cases pin the two facts the boot plane depends on: a
 * save reaches `ctx.settings.replace('shell-selector', …)` with the revision
 * the row reported, and the boot snapshot stays frozen even though reconciling
 * that row re-enters `apply()` with the new configuration.
 */

import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { apply, resetBootFacts } from '../src/index.js'
import { ACTION_ROUTE, STATE_ROUTE } from '../src/web.js'
import { volatileRef } from './helpers/volatile-ref.js'

interface Route {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

interface RecordedReplace {
  ns: string
  section: unknown
  revision?: number
}

/** A host with only the services this plugin touches. */
function createHost(options: { revision?: number; replaceError?: Error } = {}): {
  ctx: Record<string, unknown>
  routes: Map<string, Route>
  replaces: RecordedReplace[]
} {
  const routes = new Map<string, Route>()
  const replaces: RecordedReplace[] = []
  const descriptors = [{ ns: 'shell-selector', revision: options.revision ?? 3 }]
  const settings = {
    describe: () => descriptors,
    replace: async (ns: string, section: unknown, revision?: number): Promise<void> => {
      if (options.replaceError !== undefined) throw options.replaceError
      replaces.push({ ns, section, ...(revision === undefined ? {} : { revision }) })
    },
    writable: true,
  }
  const webServer = {
    register: (route: Route): (() => void) => {
      routes.set(route.path, route)
      return () => {
        routes.delete(route.path)
      }
    },
  }
  const ctx: Record<string, unknown> = {
    settings,
    webServer,
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    // Cordis runs the effect immediately and keeps the returned disposer.
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    inject: (_deps: string[], callback: (child: unknown) => void) => {
      callback(ctx)
    },
    on: () => () => {},
  }
  return { ctx, routes, replaces }
}

/** A minimal GET request (the state route). */
function getRequest(): unknown {
  return {
    method: 'GET',
    headers: {},
    async *[Symbol.asyncIterator]() {},
  }
}

/** A minimal JSON POST request (the action route). */
function postRequest(body: unknown): unknown {
  const chunks = [Buffer.from(JSON.stringify(body))]
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** A response that records status, headers and body. */
function createResponse(): { res: unknown; record: { status: number; body: string } } {
  const record = { status: 0, body: '' }
  const res = {
    setHeader: () => {},
    writeHead: (status: number) => {
      record.status = status
    },
    end: (chunk?: string | Buffer) => {
      if (chunk !== undefined) record.body += chunk.toString()
    },
  }
  return { res, record }
}

function bodyOf(record: { body: string }): { ok: boolean; value?: Record<string, unknown>; error?: { code: string } } {
  return JSON.parse(record.body) as { ok: boolean; value?: Record<string, unknown>; error?: { code: string } }
}

describe('host settings surface', () => {
  beforeEach(() => {
    resetBootFacts()
  })

  it('reports the row revision and the composition decision', async () => {
    const host = createHost({ revision: 11 })
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const { res, record } = createResponse()
    await host.routes.get(STATE_ROUTE)?.handler(getRequest(), res)

    const body = bodyOf(record)
    expect(record.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.value?.['settingsRevision']).toBe(11)
    expect(body.value?.['configured']).toEqual({ mode: 'default' })
    expect((body.value?.['active'] as { mode: string }).mode).toBe('default')
  })

  it('writes the profile row, not a namespace', async () => {
    const host = createHost({ revision: 11 })
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const { res, record } = createResponse()
    await host.routes
      .get(ACTION_ROUTE)
      ?.handler(postRequest({ action: 'save', mode: 'explicit', shell: 'bash', expectedRevision: 11 }), res)

    expect(record.status).toBe(200)
    expect(host.replaces).toHaveLength(1)
    expect(host.replaces[0]).toEqual({
      ns: 'shell-selector',
      section: { mode: 'explicit', shell: 'bash' },
      revision: 11,
    })
    // dsh-settings refuses any function inside a write — a volatile reference
    // reaching this call reports `Config $.mode.get contains a function`.
    expect(JSON.parse(JSON.stringify(host.replaces[0]?.section))).toEqual(host.replaces[0]?.section)
    // The response reflects the value just written, even though reconciling the
    // row is about to dispose this fiber.
    expect(bodyOf(record).value?.['configured']).toEqual({ mode: 'explicit', shell: 'bash' })
  })

  it('drops a shell the chosen mode does not own', async () => {
    const host = createHost()
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const { res } = createResponse()
    await host.routes.get(ACTION_ROUTE)?.handler(postRequest({ action: 'save', mode: 'default', shell: 'bash' }), res)

    expect(host.replaces[0]?.section).toEqual({ mode: 'default' })
  })

  it('maps a settings conflict to HTTP 409', async () => {
    const conflict = Object.assign(new Error('row moved'), { name: 'SettingsConflictError' })
    const host = createHost({ replaceError: conflict })
    apply(host.ctx as unknown as Context, { mode: 'default' })

    const { res, record } = createResponse()
    await host.routes
      .get(ACTION_ROUTE)
      ?.handler(postRequest({ action: 'save', mode: 'explicit', shell: 'pwsh', expectedRevision: 3 }), res)

    expect(record.status).toBe(409)
    expect(bodyOf(record).error?.code).toBe('settings-conflict')
  })

  it('keeps the boot snapshot frozen when a save re-enters apply()', async () => {
    const host = createHost()
    apply(host.ctx as unknown as Context, { mode: 'default' })
    // Reconciling the row disposes this fiber and activates a new one with the
    // saved configuration; the running process still runs the booted shell.
    apply(host.ctx as unknown as Context, { mode: 'explicit', shell: 'bash' })

    const { res, record } = createResponse()
    await host.routes.get(STATE_ROUTE)?.handler(getRequest(), res)

    const value = bodyOf(record).value
    expect((value?.['active'] as { mode: string }).mode).toBe('default')
    expect(value?.['configured']).toEqual({ mode: 'explicit', shell: 'bash' })
  })

  it('reads a Loader-resolved row whose fields are volatile references', async () => {
    const host = createHost({ revision: 7 })
    apply(host.ctx as unknown as Context, { mode: volatileRef('explicit'), shell: volatileRef('pwsh') })

    const { res, record } = createResponse()
    await host.routes.get(STATE_ROUTE)?.handler(getRequest(), res)

    const value = bodyOf(record).value
    expect(record.status).toBe(200)
    expect(value?.['settingsRevision']).toBe(7)
    expect(value?.['configured']).toEqual({ mode: 'explicit', shell: 'pwsh' })
    expect((value?.['active'] as { mode: string }).mode).toBe('explicit')
  })
})