import { describe, expect, it } from 'vitest'
import { LAZY_MODULE_RULES, entryStaticClosure, findLazyChunkProblems } from './checkPluginChunks.ts'
import type { Manifest } from './checkPluginChunks.ts'

/** A healthy build: the entry statically pulls shared code; the plugin
 * module and the user guide are their own chunks, reached only through a
 * dynamic import. */
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
  'src/guide/UserGuide.tsx': {
    file: 'assets/UserGuide-jkl.js',
    src: 'src/guide/UserGuide.tsx',
    imports: ['_shared-def.js'],
  },
})

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
      plugin: ['src/plugins/gif/index.ts'],
      'user guide': ['src/guide/UserGuide.tsx'],
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
    delete manifest['src/plugins/gif/index.ts']
    const { problems } = findLazyChunkProblems(manifest, PLUGIN_RULES)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no plugin chunk was emitted')
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
    expect(lazyKeys).toEqual({ plugin: ['src/plugins/gif/index.ts'] })
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
