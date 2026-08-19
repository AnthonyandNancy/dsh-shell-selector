/**
 * Wrap the TypeScript-compiled client modules into the browser bundle format
 * the DSH Web runtime loads: `window.__ModuleLoader__.load({ id, factory
 * (require) { ... } })`. Package imports (`react`, `@deepseek-ai/...`) stay on
 * the runtime-provided `require`; local modules route through a private
 * module table. Mirrors the approach of `dsh-vision-cloud`.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const compiledRoot = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')

/**
 * Collect every compiled `.js` file, descending into subdirectories. tsc
 * preserves the `src/client` tree (`rootDir`), so nested modules like
 * `locale/en-US.js` must be registered too — a top-level-only scan would
 * silently drop them and leave their `__load_` calls on the runtime `require`.
 * Returns paths relative to the compiled root, `/`-separated to match the
 * specifiers tsc emits in the compiled sources.
 */
async function listCompiled() {
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
    }
  }
  await walk(compiledRoot)
  return files
    .map((path) => relative(compiledRoot, path).split(sep).join('/'))
    .sort((a, b) => a.localeCompare(b))
}

const compiledFiles = await listCompiled()

const lines = []
let outputLine = 0
function push(chunk) {
  if (lines.length > 0) outputLine += 1
  lines.push(chunk)
  outputLine += chunk.split('\n').length - 1
}

push('window.__ModuleLoader__.load({ id: "dsh-shell-selector", factory: (require) => {')
push('var __modules = Object.create(null); var __cache = Object.create(null);')
const sections = []
for (const filename of compiledFiles) {
  const moduleId = `./${filename}`
  const compiledPath = join(compiledRoot, filename)
  const source = (await readFile(compiledPath, 'utf8'))
    .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
    // Keep host package imports on `require`, but route compiler-emitted local
    // CommonJS imports through the private module table. `__load_` has the
    // same width as `require`, so the sectioned source maps remain aligned.
    .replace(/\brequire(?=\(["']\.\.?\/)/gu, '__load_')
  push(`__modules[${JSON.stringify(moduleId)}] = function(module, exports, require, __load_) {`)
  sections.push({
    offset: { line: outputLine + 1, column: 0 },
    map: JSON.parse(await readFile(`${compiledPath}.map`, 'utf8')),
  })
  push(source)
  push('};')
}
for (const line of [
  'function __resolve(from, request) {',
  '  if (!request.startsWith(".")) return request;',
  '  var parts = from.slice(2).split("/"); parts.pop();',
  '  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }',
  '  return "./" + parts.join("/");',
  '}',
  'function __load(id) {',
  '  if (__modules[id] === undefined) return require(id);',
  '  if (__cache[id] !== undefined) return __cache[id].exports;',
  '  var module = __cache[id] = { exports: {} };',
  '  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });',
  '  return module.exports;',
  '}',
  'return __load("./index.js"); } });',
  '//# sourceMappingURL=client.js.map',
  '',
]) push(line)
const wrapped = lines.join('\n')

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wrapped)

for (const section of sections) {
  section.map.file = 'client.js'
}
await writeFile(`${outputPath}.map`, `${JSON.stringify({ version: 3, file: 'client.js', sections })}\n`)
await rm(compiledRoot, { recursive: true, force: true })
console.log(`bundled ${outputPath}`)
