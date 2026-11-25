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

/** A `FontFace` stand-in: `load` settles when the test says. */
class FakeFace {
  loads = 0
  settle: (ok: boolean) => void = () => {}
  readonly family: string
  readonly source: string
  readonly descriptors: FontFaceDescriptors
  constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
    this.family = family
    this.source = source
    this.descriptors = descriptors
  }
  load = () => {
    this.loads++
    return new Promise<void>((resolve, reject) => {
      this.settle = (ok) => (ok ? resolve() : reject(new Error('network')))
    })
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
    const bebas = [...added].filter((face) => face.family === 'Font Pack Bebas Neue')
    expect(bebas).toHaveLength(1)
    const first = loadTextFonts(['pack-bebas-neue'], registry)
    bebas[0].settle(false)
    await expect(first).resolves.toBeUndefined()
    void loadTextFonts(['pack-bebas-neue'], registry)
    expect(bebas[0].loads).toBe(2)
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
