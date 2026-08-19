/**
 * Clean the build outputs so a stale artifact can never mask a broken build.
 */

import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
for (const path of ['lib', '.client-build']) {
  rmSync(join(root, path), { recursive: true, force: true })
}
console.log('cleaned lib/ and .client-build/')
