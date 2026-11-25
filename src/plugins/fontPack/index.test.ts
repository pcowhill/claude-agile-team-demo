import { afterEach, describe, expect, it } from 'vitest'
import { CORE_TEXT_FONTS, FontRegistry, fontRegistry, loadTextFonts, registerCoreFonts } from '../../lib/textOverlay'
import type { TimelineState } from '../../lib/timeline'
import { emptyLibrary } from '../../lib/mediaLibrary'
import { builtInPlugins } from '../catalog'
import { FONT_PACK_IDS, isFontPackFont } from '../fontPackIds'
import { activate, activateFontPack, packFonts } from './index'

/**
 * The Font pack plugin (#867), against the module the plugin runtime
 * lazy-loads: what it registers, the faces it adds and when they load, and
 * the catalog's dependency predicate. The renderers' side, and the files
 * themselves, are the e2e spec (`e2e/font-pack.spec.ts`).
 */

/**
 * A `FontFace` stand-in: `load` settles when the test says. As the CSS Font
 * Loading spec has it, only an `unloaded` face downloads: `load()` on a face
 * that is loading, loaded or in `error` returns the same promise and counts
 * no new download (#928).
 */
class FakeFace {
  loads = 0
  status: 'unloaded' | 'loading' | 'loaded' | 'error' = 'unloaded'
  settle: (ok: boolean) => void = () => {}
  private loaded: Promise<void> | null = null
  readonly family: string
  readonly source: string
  readonly descriptors: FontFaceDescriptors
  constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
    this.family = family
    this.source = source
    this.descriptors = descriptors
  }
  load = () => {
    if (this.loaded !== null) return this.loaded
    this.loads++
    this.status = 'loading'
    this.loaded = new Promise<void>((resolve, reject) => {
      this.settle = (ok) => {
        this.status = ok ? 'loaded' : 'error'
        if (ok) resolve()
        else reject(new Error('network'))
      }
    })
    return this.loaded
  }
}

function environment() {
  const registry = new FontRegistry()
  registerCoreFonts(registry)
  const added = new Set<FakeFace>()
  const fonts = { add: (face: FakeFace) => added.add(face), delete: (face: FakeFace) => added.delete(face) }
  const createFace = (family: string, source: string, descriptors: FontFaceDescriptors) =>
    new FakeFace(family, source, descriptors)
  return { registry, added, env: { registry, fonts, createFace } }
}

describe('Font pack plugin (#867)', () => {
  let deactivate: (() => void) | null = null
  afterEach(() => {
    deactivate?.()
    deactivate = null
  })

  it('lists its ten fonts after the four core fonts, in the ids module\'s order, and removes them', () => {
    const { registry, env } = environment()
    deactivate = activateFontPack(env)
    expect(registry.list().map((font) => font.id)).toEqual([
      ...CORE_TEXT_FONTS.map((font) => font.id),
      ...FONT_PACK_IDS,
    ])
    expect(registry.list().slice(4).map((font) => font.label)).toEqual([
      'Nunito',
      'Montserrat',
      'Oswald',
      'Bebas Neue',
      'Zilla Slab',
      'Cormorant Garamond',
      'Courier Prime',
      'Caveat',
      'Comic Neue',
      'Silkscreen',
    ])
    deactivate()
    deactivate = null
    expect(registry.list().map((font) => font.id)).toEqual(CORE_TEXT_FONTS.map((font) => font.id))
  })

  it('names its own family first in each stack, so an installed font of the same name is not used', () => {
    for (const font of packFonts) {
      expect(font.family).toBe(`Font Pack ${font.label}`)
      expect(font.stack.startsWith(`"Font Pack ${font.label}", `)).toBe(true)
    }
  })

  it('adds every file as an unloaded face, and takes them away again on deactivate', () => {
    const { added, env } = environment()
    deactivate = activateFontPack(env)
    const faces = [...added]
    // 31 files: Bebas Neue has one, Oswald, Caveat and Silkscreen two, the other six four.
    expect(faces).toHaveLength(31)
    expect(faces.every((face) => face.loads === 0)).toBe(true)
    const nunito = faces.filter((face) => face.family === 'Font Pack Nunito')
    expect(nunito.map((face) => [face.descriptors.weight, face.descriptors.style])).toEqual([
      ['400', 'normal'],
      ['400', 'italic'],
      ['700', 'normal'],
      ['700', 'italic'],
    ])
    expect(nunito[0].source).toMatch(/^url\(".*nunito-latin-400-normal\.woff2[^"]*"\) format\("woff2"\)$/)
    deactivate()
    deactivate = null
    expect(added.size).toBe(0)
  })

  it("a font's load loads all of its faces, once, and resolves after they have", async () => {
    const { registry, added, env } = environment()
    deactivate = activateFontPack(env)
    const caveat = [...added].filter((face) => face.family === 'Font Pack Caveat')
    let settled = false
    const loading = loadTextFonts(['pack-caveat', 'sans'], registry).then(() => (settled = true))
    expect(caveat.map((face) => face.loads)).toEqual([1, 1])
    // No other family is touched.
    expect([...added].filter((face) => face.family !== 'Font Pack Caveat').every((face) => face.loads === 0)).toBe(
      true,
    )
    caveat[0].settle(true)
    await Promise.resolve()
    expect(settled).toBe(false)
    caveat[1].settle(true)
    await loading
    expect(settled).toBe(true)
    // A second export asks again and is answered by the same load.
    await loadTextFonts(['pack-caveat'], registry)
    expect(caveat.map((face) => face.loads)).toEqual([1, 1])
  })

  it('a failed download resolves the load, so the export draws the fallback, and the next export tries again', async () => {
    const { registry, added, env } = environment()
    deactivate = activateFontPack(env)
    const bebasFaces = () => [...added].filter((face) => face.family === 'Font Pack Bebas Neue')
    const [failed] = bebasFaces()
    expect(bebasFaces()).toHaveLength(1)
    const first = loadTextFonts(['pack-bebas-neue'], registry)
    failed.settle(false)
    await expect(first).resolves.toBeUndefined()
    // The failed face is out of the set, and an unloaded one for the same
    // file is in its place: asking the failed face again would download
    // nothing (#928).
    expect(failed.status).toBe('error')
    expect(added.has(failed)).toBe(false)
    const [fresh] = bebasFaces()
    expect(bebasFaces()).toHaveLength(1)
    expect(fresh).not.toBe(failed)
    expect([fresh.source, fresh.descriptors]).toEqual([failed.source, failed.descriptors])
    expect(fresh.status).toBe('unloaded')
    // The next export downloads it, and resolves once it has.
    const second = loadTextFonts(['pack-bebas-neue'], registry)
    expect(fresh.loads).toBe(1)
    expect(failed.loads).toBe(1)
    fresh.settle(true)
    await expect(second).resolves.toBeUndefined()
    // Deactivating removes the replacement, not only the original faces.
    deactivate()
    deactivate = null
    expect(added.size).toBe(0)
  })

  it('after a partial failure only the failed face is replaced and downloaded again', async () => {
    const { registry, added, env } = environment()
    deactivate = activateFontPack(env)
    const caveatFaces = () => [...added].filter((face) => face.family === 'Font Pack Caveat')
    const [regular, bold] = caveatFaces()
    const first = loadTextFonts(['pack-caveat'], registry)
    regular.settle(true)
    bold.settle(false)
    await first
    const now = caveatFaces()
    expect(now).toHaveLength(2)
    expect(now).toContain(regular)
    expect(now).not.toContain(bold)
    const fresh = now.find((face) => face !== regular)!
    expect(fresh.descriptors).toEqual(bold.descriptors)
    void loadTextFonts(['pack-caveat'], registry)
    expect([regular.loads, fresh.loads]).toEqual([1, 1])
  })

  it("a face the browser's own attempt left in error is swapped before the next load, which then waits for it", async () => {
    const { registry, added, env } = environment()
    deactivate = activateFontPack(env)
    const bebasFaces = () => [...added].filter((face) => face.family === 'Font Pack Bebas Neue')
    const [failed] = bebasFaces()
    // The preview's or the canvas's text started this download, not the loader.
    void failed.load().catch(() => {})
    failed.settle(false)
    await Promise.resolve()
    expect(failed.status).toBe('error')
    let settled = false
    const loading = loadTextFonts(['pack-bebas-neue'], registry).then(() => (settled = true))
    const [fresh] = bebasFaces()
    expect(fresh).not.toBe(failed)
    expect(fresh.loads).toBe(1)
    await Promise.resolve()
    expect(settled).toBe(false)
    fresh.settle(true)
    await loading
    expect(settled).toBe(true)
  })

  it('a load that fails after deactivation leaves no face behind (#940)', async () => {
    const { registry, added, env } = environment()
    const undo = activateFontPack(env)
    const nunito = registry.list().find((font) => font.id === packFonts[0].id)!
    const loading = nunito.load!()
    const inFlight = [...added].filter((face) => face.loads === 1)
    expect(inFlight).toHaveLength(packFonts[0].files.length)
    undo()
    expect(added.size).toBe(0)
    // The downloads fail after the plugin is gone: nothing is swapped in,
    // so the family is no longer resolvable and re-enabling adds one set.
    for (const face of inFlight) face.settle(false)
    await loading
    expect(added.size).toBe(0)
  })

  it('without the Font Loading API, the fonts are listed with no loader to wait for', async () => {
    const registry = new FontRegistry()
    deactivate = activateFontPack({ registry, fonts: null, createFace: null })
    expect(registry.list()).toHaveLength(10)
    await expect(loadTextFonts(FONT_PACK_IDS, registry)).resolves.toBeUndefined()
  })

  it('activate registers into the app registry (jsdom has no FontFace)', () => {
    deactivate = activate()
    expect(FONT_PACK_IDS.every((id) => fontRegistry.has(id))).toBe(true)
    deactivate()
    deactivate = null
    expect(FONT_PACK_IDS.some((id) => fontRegistry.has(id))).toBe(false)
  })

  describe('the catalog entry', () => {
    const spec = builtInPlugins.find((plugin) => plugin.id === 'font-pack')!
    const text = (font: string) => ({
      id: `t-${font}`,
      content: 'Title',
      offset: 0,
      duration: 2,
      x: 0.5,
      y: 0.5,
      font,
      size: 0.1,
      color: '#ffffff',
      bold: false,
      italic: false,
    })

    it('loads the plugin lazily, and the module it loads is this one', async () => {
      const module = await spec.load()
      expect(module.activate).toBe(activate)
    })

    it('reports a project whose text or subtitle style uses a pack font, and no other', () => {
      const used = (timeline: TimelineState) => spec.usedByProject!(emptyLibrary, timeline)
      expect(used({ entries: [] })).toBe(false)
      expect(used({ entries: [], texts: [text('sans'), text('display')] })).toBe(false)
      expect(used({ entries: [], texts: [text('sans'), text('pack-caveat')] })).toBe(true)
      const style = { x: 0.5, y: 0.9, font: 'pack-oswald', size: 0.06, color: '#ffffff', bold: false, italic: false }
      expect(used({ entries: [], subtitleStyle: style })).toBe(true)
      expect(used({ entries: [], subtitleStyle: { ...style, font: 'serif' } })).toBe(false)
    })

    it('knows every id the plugin registers', () => {
      expect(packFonts.map((font) => font.id)).toEqual([...FONT_PACK_IDS])
      expect(FONT_PACK_IDS.every(isFontPackFont)).toBe(true)
      expect(isFontPackFont('sans')).toBe(false)
    })
  })
})
