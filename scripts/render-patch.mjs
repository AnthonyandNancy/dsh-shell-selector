/**
 * Render `cordis.patch.yml` from `src/boot/patch.yml.template`, filling the
 * `!!js` expression placeholders from `src/boot/expressions.ts`.
 *
 * Run after `tsc` (the script imports the compiled `lib/boot/expressions.js`).
 * Exported `renderPatch()` is reused by `scripts/lint.mjs` for the byte-level
 * sync check.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const expressions = await import('../lib/boot/expressions.js')

const template = readFileSync(join(root, 'src', 'boot', 'patch.yml.template'), 'utf8')

/** Replace one placeholder line with the expression, indented to the line's column. */
export function fill(template, placeholders) {
  return template
    .split('\n')
    .map((line) => {
      for (const [name, value] of placeholders) {
        if (!line.includes(`{{${name}}}`)) continue
        const indent = line.match(/^\s*/u)?.[0] ?? ''
        const body = value.replace(/\n$/u, '')
        return body
          .split('\n')
          .map((part) => `${indent}${part}`)
          .join('\n')
      }
      return line
    })
    .join('\n')
}

/** Render the patch document (no file I/O). */
export function renderPatch() {
  return fill(template, [
    ['BASH_SANDBOX_DISABLED_EXPR', expressions.BASH_SANDBOX_DISABLED_EXPR],
    ['PWSH_SANDBOX_DISABLED_EXPR', expressions.PWSH_SANDBOX_DISABLED_EXPR],
    ['PWSH_PATH_EXPR', expressions.PWSH_PATH_EXPR],
  ])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2] ?? join(root, 'cordis.patch.yml')
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderPatch())
  console.log(`rendered ${outputPath}`)
}
