/**
 * Render the shipped agent-preset composition:
 * `config/agent-presets/shell-selector/agent.cordis.yml` from
 * `src/boot/preset-template.yml`, filling the two tool-row expressions from
 * `src/boot/expressions.ts`. `preset.yml` (display metadata) is static.
 *
 * Run after `tsc` (the script imports the compiled `lib/boot/expressions.js`).
 * Exported `renderPreset()` is reused by `scripts/lint.mjs` for the byte-level
 * sync check.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const expressions = await import('../lib/boot/expressions.js')

const template = readFileSync(join(root, 'src', 'boot', 'preset-template.yml'), 'utf8')
const outputDir = join(root, 'config', 'agent-presets', 'shell-selector')

function fill(template, placeholders) {
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

/** Render the preset composition document (no file I/O). */
export function renderPreset() {
  return fill(template, [
    ['TOOL_BASH_DISABLED_EXPR', expressions.TOOL_BASH_DISABLED_EXPR],
    ['TOOL_PWSH_DISABLED_EXPR', expressions.TOOL_PWSH_DISABLED_EXPR],
  ])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2] ?? join(outputDir, 'agent.cordis.yml')
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, renderPreset())
  console.log(`rendered ${outputPath}`)
}
