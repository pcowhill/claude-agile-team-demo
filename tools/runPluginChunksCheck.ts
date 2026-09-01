/**
 * CLI for the plugin bundle-discipline check (#197): `npm run check:bundle`,
 * run in CI after `npm run build`. Reads the Vite manifest the build emitted
 * and fails loudly when plugin code leaks into the entry bundle — see
 * checkPluginChunks.ts for the rules.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findPluginChunkProblems } from './checkPluginChunks.ts'
import type { Manifest } from './checkPluginChunks.ts'

const manifestPath = join(import.meta.dirname, '..', 'dist', '.vite', 'manifest.json')

let manifest: Manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
} catch (error) {
  console.error(
    `could not read the build manifest at ${manifestPath} — run \`npm run build\` first ` +
      `(${error instanceof Error ? error.message : String(error)})`,
  )
  process.exit(1)
}

const { pluginKeys, problems } = findPluginChunkProblems(manifest)
if (problems.length > 0) {
  console.error('Plugin bundle discipline check FAILED (#197, ADR 0003):')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(
  `Plugin bundle discipline holds: ${pluginKeys.length} plugin chunk(s) outside the entry bundle` +
    ` (${pluginKeys.join(', ')}).`,
)
