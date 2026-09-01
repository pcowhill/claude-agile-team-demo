import { describe, expect, it } from 'vitest'
import { entryStaticClosure, findPluginChunkProblems } from './checkPluginChunks.ts'
import type { Manifest } from './checkPluginChunks.ts'

/** A healthy build: the entry statically pulls shared code; the plugin
 * module is its own chunk, reached only through a dynamic import. */
const healthyManifest = (): Manifest => ({
  'index.html': {
    file: 'assets/index-abc.js',
    src: 'index.html',
    isEntry: true,
    imports: ['_shared-def.js'],
  },
  '_shared-def.js': { file: 'assets/shared-def.js' },
  'src/plugins/sample/index.ts': {
    file: 'assets/index-ghi.js',
    src: 'src/plugins/sample/index.ts',
    imports: ['_shared-def.js'],
  },
})

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

describe('findPluginChunkProblems (#197)', () => {
  it('passes a healthy build and names the plugin chunks it verified', () => {
    const { pluginKeys, problems } = findPluginChunkProblems(healthyManifest())
    expect(problems).toEqual([])
    expect(pluginKeys).toEqual(['src/plugins/sample/index.ts'])
  })

  it('fails when a plugin module is statically reachable from the entry', () => {
    const manifest = healthyManifest()
    manifest['index.html'].imports = ['_shared-def.js', 'src/plugins/sample/index.ts']
    const { problems } = findPluginChunkProblems(manifest)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('src/plugins/sample/index.ts')
    expect(problems[0]).toContain('statically reachable')
  })

  it('fails when no plugin chunk was emitted at all', () => {
    const manifest = healthyManifest()
    delete manifest['src/plugins/sample/index.ts']
    const { problems } = findPluginChunkProblems(manifest)
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
    const { pluginKeys, problems } = findPluginChunkProblems(manifest)
    expect(problems).toEqual([])
    expect(pluginKeys).toEqual(['src/plugins/sample/index.ts'])
  })
})
