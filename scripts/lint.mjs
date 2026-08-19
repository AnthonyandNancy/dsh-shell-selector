/**
 * Lightweight lint: the generated composition artifacts must match what the
 * render scripts produce, and the host code must not hot-swap the shell.
 *
 * The render functions are imported in-process (never spawned): the sandboxed
 * Windows environment forbids child-process pipes, and in-process rendering is
 * deterministic anyway.
 */

import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPatch } from './render-patch.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
let failed = false

function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    failed = true
    console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

check('generated cordis.patch.yml is in sync', () => {
  const fresh = renderPatch()
  const committed = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  if (fresh !== committed) {
    throw new Error('cordis.patch.yml differs from the template render; run `pnpm build`')
  }
})

check('settings/resolver never eval or spawn user input', () => {
  for (const name of ['settings.ts', 'resolver.ts', 'web.ts']) {
    const source = readFileSync(join(root, 'src', name), 'utf8')
    if (/\beval\s*\(|new\s+Function|child_process/.test(source)) {
      throw new Error(`${name} must never eval or spawn user input`)
    }
  }
})

check('no runtime shell swap in host code', () => {
  const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
  if (/\bctx\.shell\s*=|provide\(["']shell/.test(index)) {
    throw new Error('src/index.ts must never replace ctx.shell')
  }
})

if (failed) process.exit(1)
