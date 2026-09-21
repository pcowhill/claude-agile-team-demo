import { describe, expect, it } from 'vitest'
import { LAZY_MODULE_RULES, entryStaticClosure, findLazyChunkProblems } from './checkPluginChunks.ts'
import type { Manifest } from './checkPluginChunks.ts'

const EDITORS = ['Crop', 'Overlay', 'Redaction', 'Spotlight', 'Text', 'Zoom']

/** A healthy build: the entry statically pulls shared code; the two plugin
 * modules, the user guide and the six visual editors are their own chunks,
 * reached only through a dynamic import. The editors pull the unnamed chunk
 * Rollup makes of their shared `FrameEditor.tsx` (#571). Both plugins are
 * listed because the real build emits both, and the plugin rule now names
 * them (#573) — a fixture carrying one would make the rule's own `expected`
 * check fail on a manifest that is supposed to be healthy. */
const healthyManifest = (): Manifest => ({
  'index.html': {
    file: 'assets/index-abc.js',
    src: 'index.html',
    isEntry: true,
    imports: ['_shared-def.js'],
  },
  '_shared-def.js': { file: 'assets/shared-def.js' },
  'src/plugins/gif/index.ts': {
    file: 'assets/index-ghi.js',
    src: 'src/plugins/gif/index.ts',
    imports: ['_shared-def.js'],
  },
  'src/plugins/shapedWipes/index.ts': {
    file: 'assets/index-stu.js',
    src: 'src/plugins/shapedWipes/index.ts',
    imports: ['_shared-def.js'],
  },
  'src/guide/UserGuide.tsx': {
    file: 'assets/UserGuide-jkl.js',
    src: 'src/guide/UserGuide.tsx',
    imports: ['_shared-def.js'],
  },
  ...Object.fromEntries(
    EDITORS.map((name) => [
      `src/components/${name}Editor.tsx`,
      {
        file: `assets/${name}Editor-mno.js`,
        src: `src/components/${name}Editor.tsx`,
        imports: ['_shared-def.js', '_FrameEditor-pqr.js'],
      },
    ]),
  ),
  '_FrameEditor-pqr.js': { file: 'assets/FrameEditor-pqr.js', imports: ['_shared-def.js'] },
})
const EDITOR_KEYS = EDITORS.map((name) => `src/components/${name}Editor.tsx`)
const PLUGIN_KEYS = ['src/plugins/gif/index.ts', 'src/plugins/shapedWipes/index.ts']

/** The plugin rule alone, for the tests written against it before #478. */
const PLUGIN_RULES = LAZY_MODULE_RULES.filter((rule) => rule.label === 'plugin')

describe('entryStaticClosure (#197)', () => {
  it('walks static imports from every entry, ignoring dynamic-only chunks', () => {
    const closure = entryStaticClosure(healthyManifest())
    expect(closure).toEqual(new Set(['index.html', '_shared-def.js']))
  })

  it('survives import cycles', () => {
    const manifest: Manifest = {
      a: { file: 'a.js', isEntry: true, imports: ['b'] },
      b: { file: 'b.js', imports: ['a'] },
    }
    expect(entryStaticClosure(manifest)).toEqual(new Set(['a', 'b']))
  })
})

describe('findLazyChunkProblems (#197)', () => {
  it('passes a healthy build and names the chunks it verified, per area', () => {
    const { lazyKeys, problems } = findLazyChunkProblems(healthyManifest())
    expect(problems).toEqual([])
    expect(lazyKeys).toEqual({
      plugin: PLUGIN_KEYS,
      'user guide': ['src/guide/UserGuide.tsx'],
      'visual editors': EDITOR_KEYS,
    })
  })

  it('fails when a plugin module is statically reachable from the entry', () => {
    const manifest = healthyManifest()
    manifest['index.html'].imports = ['_shared-def.js', 'src/plugins/gif/index.ts']
    const { problems } = findLazyChunkProblems(manifest, PLUGIN_RULES)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/plugins/gif/index.ts')
    expect(problems[0]).toContain('statically reachable')
  })

  it('fails when no plugin chunk was emitted at all', () => {
    const manifest = healthyManifest()
    for (const key of PLUGIN_KEYS) delete manifest[key]
    const { problems } = findLazyChunkProblems(manifest, PLUGIN_RULES)
    // The area-level "none found" plus one per named module (#573).
    expect(problems).toHaveLength(1 + PLUGIN_KEYS.length)
    expect(problems[0]).toContain('no plugin chunk was emitted')
    for (const key of PLUGIN_KEYS) expect(problems.join('\n')).toContain(`"${key}"`)
  })

  it('fails when one plugin is merged into the entry while the other stays lazy', () => {
    const manifest = healthyManifest()
    // The gap #573 was filed for, and the reason the area-level checks above
    // are not enough. A static import merges the module into the entry, where
    // it is no longer a chunk and so has no manifest key at all: the pattern
    // check never sees it, and shapedWipes staying lazy satisfies "at least
    // one". Measured on the real build at 47b5dfe with
    // `import * as X from './gif/index'` added to catalog.ts — check:bundle
    // printed "1 chunk(s) outside the entry bundle
    // (src/plugins/shapedWipes/index.ts)" and exited 0, with the gif code in
    // the entry bundle.
    delete manifest['src/plugins/gif/index.ts']
    const { lazyKeys, problems } = findLazyChunkProblems(manifest, PLUGIN_RULES)
    expect(lazyKeys.plugin).toEqual(['src/plugins/shapedWipes/index.ts'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('plugin module "src/plugins/gif/index.ts"')
    expect(problems[0]).toContain('not emitted as its own chunk')
    expect(problems[0]).toContain('src/plugins/catalog.ts')
  })

  it("pins the plugin rule's expected list, and the pattern that must match it", () => {
    // The list is written out here as well as in the tool, so editing one
    // without the other fails. It does not — and cannot — check the list
    // against the catalog: see PLUGIN_CHUNKS's comment for what a plugin
    // missing from the list does and does not cost.
    const rule = LAZY_MODULE_RULES.find((candidate) => candidate.label === 'plugin')!
    expect(rule.expected).toEqual(PLUGIN_KEYS)
    for (const key of PLUGIN_KEYS) expect(rule.pattern.test(key)).toBe(true)
  })

  it('exempts the top-level wiring in src/plugins/ (catalog, runtime)', () => {
    const manifest = healthyManifest()
    // The catalog is entry code by design; only src/plugins/<dir>/ is plugin
    // code. A manifest listing it inside the entry closure is healthy.
    manifest['src/plugins/catalog.ts'] = {
      file: 'assets/catalog-xyz.js',
      src: 'src/plugins/catalog.ts',
    }
    manifest['index.html'].imports = ['_shared-def.js', 'src/plugins/catalog.ts']
    const { lazyKeys, problems } = findLazyChunkProblems(manifest, PLUGIN_RULES)
    expect(problems).toEqual([])
    expect(lazyKeys).toEqual({ plugin: PLUGIN_KEYS })
  })
})

describe('findLazyChunkProblems: the six visual editors (#571)', () => {
  it('fails when an editor is statically reachable from the entry', () => {
    const manifest = healthyManifest()
    // The accident this rule exists for: `import { CropEditor } from
    // './CropEditor'` re-added on the entry path (#537, #565). Before #571
    // the only signal was Vite's chunk-size warning, which does not fail
    // the build.
    manifest['index.html'].imports = ['_shared-def.js', 'src/components/CropEditor.tsx']
    const { problems } = findLazyChunkProblems(manifest)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('visual editors module "src/components/CropEditor.tsx"')
    expect(problems[0]).toContain('statically reachable')
    expect(problems[0]).toContain('visualEditors.tsx')
  })

  it('fails when one editor has no chunk of its own while its siblings stay lazy', () => {
    const manifest = healthyManifest()
    // What a static import actually does to the manifest: the merged module
    // has no key at all, so a pattern over the keys never sees it and the
    // five siblings satisfy "at least one chunk". Measured on the real build
    // for #571 — the pattern-only rule printed "5 chunk(s) outside the
    // entry bundle" and exited 0. The `expected` set is what fails it.
    delete manifest['src/components/CropEditor.tsx']
    const { lazyKeys, problems } = findLazyChunkProblems(manifest)
    expect(lazyKeys['visual editors']).toHaveLength(5)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('visual editors module "src/components/CropEditor.tsx"')
    expect(problems[0]).toContain('not emitted as its own chunk')
    expect(problems[0]).toContain('visualEditors.tsx')
  })

  it('fails when no editor chunk was emitted at all', () => {
    const manifest = healthyManifest()
    for (const key of EDITOR_KEYS) delete manifest[key]
    const { problems } = findLazyChunkProblems(manifest)
    // The area-level "none found" plus one per named module.
    expect(problems).toHaveLength(1 + EDITOR_KEYS.length)
    expect(problems[0]).toContain('no visual editors chunk was emitted')
    for (const key of EDITOR_KEYS) expect(problems.join('\n')).toContain(`"${key}"`)
  })

  it('matches exactly the six editors, not the rest of src/components/', () => {
    const manifest = healthyManifest()
    // Timeline.tsx is entry code and imports the loader; FrameEditor.tsx
    // ships as an unnamed chunk the six pull in. Neither is an editor, and
    // a manifest with the first in the entry closure is healthy.
    manifest['src/components/Timeline.tsx'] = {
      file: 'assets/Timeline-stu.js',
      src: 'src/components/Timeline.tsx',
    }
    manifest['index.html'].imports = ['_shared-def.js', 'src/components/Timeline.tsx']
    const { lazyKeys, problems } = findLazyChunkProblems(manifest)
    expect(problems).toEqual([])
    expect(lazyKeys['visual editors']).toEqual(EDITOR_KEYS)

    const rule = LAZY_MODULE_RULES.find((candidate) => candidate.label === 'visual editors')!
    expect(rule.expected).toEqual(EDITOR_KEYS)
    for (const key of EDITOR_KEYS) expect(rule.pattern.test(key)).toBe(true)
    for (const other of ['FrameEditor', 'Timeline', 'visualEditors', 'CropEditor.test'])
      expect(rule.pattern.test(`src/components/${other}.tsx`)).toBe(false)
  })
})

describe('findLazyChunkProblems: the user guide (#478)', () => {
  it('fails when the guide is statically reachable from the entry', () => {
    const manifest = healthyManifest()
    manifest['index.html'].imports = ['_shared-def.js', 'src/guide/UserGuide.tsx']
    const { problems } = findLazyChunkProblems(manifest)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('user guide module "src/guide/UserGuide.tsx"')
    expect(problems[0]).toContain('statically reachable')
    expect(problems[0]).toContain('React.lazy')
  })

  it('fails when no guide chunk was emitted at all', () => {
    const manifest = healthyManifest()
    delete manifest['src/guide/UserGuide.tsx']
    const { problems } = findLazyChunkProblems(manifest)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no user guide chunk was emitted')
  })

  it('does not count the always-loaded guide plumbing under src/lib/guide/ as guide code', () => {
    const manifest = healthyManifest()
    manifest['src/lib/guide/location.ts'] = { file: 'assets/location-m.js', src: 'src/lib/guide/location.ts' }
    manifest['index.html'].imports = ['_shared-def.js', 'src/lib/guide/location.ts']
    const { problems } = findLazyChunkProblems(manifest)
    expect(problems).toEqual([])
  })
})
