/**
 * Bundle discipline for lazily loaded code (#197, ADR 0003; #478): plugin
 * code and the user guide must stay out of the default bundle. The approved
 * plugin architecture ships plugins as lazy chunks that download only when a
 * plugin is enabled — a plugin module that gets statically imported into the
 * entry bundle silently defeats the whole point (the customer's "keep the
 * default editor lightweight" criterion). The user guide (#478) follows the
 * same discipline: its compiled content, search and renderer download the
 * first time the panel opens. This check makes either regression fail CI
 * instead.
 *
 * It reads Vite's build manifest (`dist/.vite/manifest.json`, emitted
 * because `build.manifest` is on in vite.config.ts) and enforces one rule
 * per lazily loaded area (`LAZY_MODULE_RULES`):
 *
 * - The area's modules match a path pattern — `src/plugins/<plugin-dir>/…`
 *   (top-level files in `src/plugins/`, the catalog and the runtime
 *   singleton, are entry wiring and exempt) or `src/guide/…` — and are
 *   loaded only via dynamic `import()`.
 * - Every such module the manifest knows must be emitted as its own chunk,
 *   NOT reachable from any entry chunk through static imports.
 * - At least one chunk per area must exist, proving the mechanism is
 *   actually exercised — a module merged into the entry has no chunk of its
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

/** One lazily loaded area of the source tree and how its code is meant to load. */
export interface LazyModuleRule {
  /** For messages: "plugin", "user guide". */
  label: string
  /** Matches the area's modules by manifest key (or `src`). */
  pattern: RegExp
  /** Where the area's code is supposed to be imported from, for the message. */
  loadedBy: string
}

export const LAZY_MODULE_RULES: readonly LazyModuleRule[] = [
  {
    label: 'plugin',
    // Plugin code (`src/plugins/<dir>/…`), not the top-level wiring.
    pattern: /^src\/plugins\/[^/]+\//,
    loadedBy: "the catalog's dynamic import() (src/plugins/catalog.ts)",
  },
  {
    label: 'user guide',
    pattern: /^src\/guide\//,
    loadedBy: "App's React.lazy import() of src/guide/UserGuide.tsx",
  },
]

/**
 * Every manifest key reachable from an entry chunk through STATIC imports —
 * the modules a visitor downloads before interacting at all. Dynamic imports
 * are deliberately not followed: being reachable lazily is the desired state
 * for these chunks.
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
 * The problems with a build's lazy chunks; an empty list means the bundle
 * discipline holds. Also returns the chunks it judged per area, so the CLI
 * can report what was actually verified.
 */
export function findLazyChunkProblems(
  manifest: Manifest,
  rules: readonly LazyModuleRule[] = LAZY_MODULE_RULES,
): {
  lazyKeys: Record<string, string[]>
  problems: string[]
} {
  const closure = entryStaticClosure(manifest)
  const lazyKeys: Record<string, string[]> = {}
  const problems: string[] = []
  for (const rule of rules) {
    const keys = Object.keys(manifest).filter((key) => rule.pattern.test(manifest[key].src ?? key))
    lazyKeys[rule.label] = keys
    if (keys.length === 0) {
      problems.push(
        `no ${rule.label} chunk was emitted: expected at least one module matching ${rule.pattern} ` +
          `to build as its own lazy chunk. Either a ${rule.label} module was statically imported ` +
          '(merging it into the entry bundle), or the layout changed without updating ' +
          'tools/checkPluginChunks.ts.',
      )
    }
    for (const key of keys) {
      if (closure.has(key)) {
        problems.push(
          `${rule.label} module "${key}" (chunk ${manifest[key].file}) is statically reachable from the ` +
            `entry bundle — ${rule.label} code must load only through ${rule.loadedBy}.`,
        )
      }
    }
  }
  return { lazyKeys, problems }
}
