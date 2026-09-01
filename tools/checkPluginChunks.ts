/**
 * Bundle discipline for plugins (#197, ADR 0003): plugin code must stay out
 * of the default bundle. The approved plugin architecture ships plugins as
 * lazy chunks that download only when a plugin is enabled — a plugin module
 * that gets statically imported into the entry bundle silently defeats the
 * whole point (the customer's "keep the default editor lightweight"
 * criterion). This check makes that regression fail CI instead.
 *
 * It reads Vite's build manifest (`dist/.vite/manifest.json`, emitted
 * because `build.manifest` is on in vite.config.ts) and enforces the layout
 * convention from `src/plugins/catalog.ts`:
 *
 * - Plugin code lives in `src/plugins/<plugin-dir>/…` and is loaded only via
 *   dynamic `import()`. Top-level files in `src/plugins/` (the catalog, the
 *   runtime singleton) are entry wiring and exempt.
 * - Every plugin module the manifest knows must be emitted as its own chunk,
 *   NOT reachable from any entry chunk through static imports.
 * - At least one plugin chunk must exist, proving the mechanism is actually
 *   exercised — a plugin module merged into the entry has no chunk of its
 *   own, so "none found" is itself a failure, not a pass.
 *
 * The pure logic lives here (unit-tested in checkPluginChunks.test.ts); the
 * CLI wrapper is runPluginChunksCheck.ts, wired as `npm run check:bundle`
 * and run in CI after the build.
 */

/** The slice of a Vite manifest chunk this check reads. */
export interface ManifestChunk {
  file: string
  src?: string
  isEntry?: boolean
  imports?: string[]
}

export type Manifest = Record<string, ManifestChunk>

/** Matches plugin code (`src/plugins/<dir>/…`), not the top-level wiring. */
const PLUGIN_MODULE_PATTERN = /^src\/plugins\/[^/]+\//

/**
 * Every manifest key reachable from an entry chunk through STATIC imports —
 * the modules a visitor downloads before interacting at all. Dynamic imports
 * are deliberately not followed: being reachable lazily is the desired state
 * for plugin chunks.
 */
export function entryStaticClosure(manifest: Manifest): Set<string> {
  const closure = new Set<string>()
  const queue = Object.keys(manifest).filter((key) => manifest[key].isEntry === true)
  while (queue.length > 0) {
    const key = queue.pop() as string
    if (closure.has(key)) continue
    closure.add(key)
    for (const imported of manifest[key]?.imports ?? []) queue.push(imported)
  }
  return closure
}

/**
 * The problems with a build's plugin chunks; an empty list means the bundle
 * discipline holds. Also returns the plugin chunks it judged, so the CLI can
 * report what was actually verified.
 */
export function findPluginChunkProblems(manifest: Manifest): {
  pluginKeys: string[]
  problems: string[]
} {
  const pluginKeys = Object.keys(manifest).filter((key) =>
    PLUGIN_MODULE_PATTERN.test(manifest[key].src ?? key),
  )
  const problems: string[] = []
  if (pluginKeys.length === 0) {
    problems.push(
      'no plugin chunk was emitted: expected at least one module under src/plugins/<dir>/ ' +
        'to build as its own lazy chunk. Either a plugin module was statically imported ' +
        '(merging it into the entry bundle), or the plugin layout changed without updating ' +
        'tools/checkPluginChunks.ts.',
    )
  }
  const closure = entryStaticClosure(manifest)
  for (const key of pluginKeys) {
    if (closure.has(key)) {
      problems.push(
        `plugin module "${key}" (chunk ${manifest[key].file}) is statically reachable from the ` +
          'entry bundle — plugin code must load only through the catalog\'s dynamic import().',
      )
    }
  }
  return { pluginKeys, problems }
}
