/**
 * Bundle discipline for lazily loaded code (#197, ADR 0003; #478; #571):
 * plugin code, the user guide and the six visual editors must stay out of
 * the default bundle. The approved plugin architecture ships plugins as lazy
 * chunks that download only when a plugin is enabled — a plugin module that
 * gets statically imported into the entry bundle silently defeats the whole
 * point (the customer's "keep the default editor lightweight" criterion).
 * The user guide (#478) follows the same discipline: its compiled content,
 * search and renderer download the first time the panel opens. So do the
 * six visual editors (#537, #565): each is an `import()` edge from
 * `src/components/visualEditors.tsx`, and a static import re-added anywhere
 * on the entry path would merge it back in with only Vite's chunk-size
 * warning — which does not fail the build — as the signal (#571). This
 * check makes any of the three regressions fail CI instead.
 *
 * It reads Vite's build manifest (`dist/.vite/manifest.json`, emitted
 * because `build.manifest` is on in vite.config.ts) and enforces one rule
 * per lazily loaded area (`LAZY_MODULE_RULES`):
 *
 * - The area's modules match a path pattern — `src/plugins/<plugin-dir>/…`
 *   (top-level files in `src/plugins/`, the catalog and the runtime
 *   singleton, are entry wiring and exempt), `src/guide/…`, or exactly the
 *   six `src/components/<Name>Editor.tsx` modules — and are loaded only via
 *   dynamic `import()`.
 * - Every such module the manifest knows must be emitted as its own chunk,
 *   NOT reachable from any entry chunk through static imports.
 * - At least one chunk per area must exist, proving the mechanism is
 *   actually exercised — a module merged into the entry has no chunk of its
 *   own, so "none found" is itself a failure, not a pass.
 * - Where a rule names its `expected` modules, each must be emitted as its
 *   own chunk. This is the check that catches the realistic regression: a
 *   module merged into the entry has no manifest key, so the pattern rule
 *   above never sees it, and its siblings satisfy "at least one". Measured
 *   for #571 with a static import of `CropEditor` added to `Timeline.tsx`:
 *   the pattern-only rule printed "5 chunk(s) outside the entry bundle" and
 *   exited 0.
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
  /** For messages: "plugin", "user guide", "visual editors". */
  label: string
  /** Matches the area's modules by manifest key (or `src`). */
  pattern: RegExp
  /** Where the area's code is supposed to be imported from, for the message. */
  loadedBy: string
  /**
   * Manifest keys that must each be emitted as their own chunk. A module
   * merged into the entry bundle has no chunk and so no key: the `pattern`
   * check cannot see it, and while a sibling remains lazy the "at least one
   * chunk" check passes too (#571). Naming the set is what makes one merged
   * module fail. A module renamed or removed fails the same way, which is
   * the reminder to update this file.
   */
  expected?: readonly string[]
}

/** The six visual editors, each an `import()` edge in `visualEditors.tsx` (#537, #565). */
const VISUAL_EDITORS = ['Crop', 'Overlay', 'Redaction', 'Spotlight', 'Text', 'Zoom'].map(
  (name) => `src/components/${name}Editor.tsx`,
)

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
  {
    label: 'visual editors',
    // Exactly the six editors (#537, #565). Their shared `FrameEditor.tsx`
    // is not named: Rollup emits it as an unnamed `_FrameEditor-*` chunk
    // with no `src`, reached only from the six, so holding the six out of
    // the entry holds it out too. The rest of `src/components/` is entry
    // code and must not match.
    pattern: /^src\/components\/(Crop|Overlay|Redaction|Spotlight|Text|Zoom)Editor\.tsx$/,
    loadedBy: "visualEditors.tsx's import() (src/components/visualEditors.tsx)",
    expected: VISUAL_EDITORS,
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
    for (const key of rule.expected ?? []) {
      if (key in manifest) continue
      problems.push(
        `${rule.label} module "${key}" was not emitted as its own chunk — either a static import merged ` +
          `it into the entry bundle (${rule.label} code must load only through ${rule.loadedBy}), or it ` +
          'was moved or renamed without updating tools/checkPluginChunks.ts.',
      )
    }
  }
  return { lazyKeys, problems }
}
