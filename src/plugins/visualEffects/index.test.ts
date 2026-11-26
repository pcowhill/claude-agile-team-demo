import { afterEach, describe, expect, it } from 'vitest'
import { PICTURE_TEXTURE_RATE, pictureEffectParamsFor, pictureEffectRegistry } from '../../lib/pictureEffect'
import { builtInPlugins } from '../catalog'
import { VISUAL_EFFECT_IDS, isVisualEffect } from '../visualEffectsIds'
import {
  GRAIN_REFERENCE_WIDTH,
  OLD_FILM,
  VHS,
  VIGNETTE_INNER,
  activate,
  oldFilmBrightness,
  visualEffectDefinitions,
} from './index'

/**
 * The Visual effects plugin (#862), against the module the plugin runtime
 * lazy-loads: what it registers, what its rules return, and the
 * catalog's dependency predicate. The renderers' side is the e2e spec
 * (`e2e/visual-effects.spec.ts`).
 */
describe('Visual effects plugin (#862)', () => {
  let deactivate: (() => void) | null = null
  afterEach(() => {
    deactivate?.()
    deactivate = null
  })

  it('registers Vignette, Blur, Film grain, Old film and VHS in the ids module\'s order, and unregisters them', () => {
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
    deactivate = activate()
    expect(pictureEffectRegistry.list().map(({ id, name }) => [id, name])).toEqual([
      ['vignette', 'Vignette'],
      ['blur', 'Blur'],
      ['film-grain', 'Film grain'],
      ['old-film', 'Old film'],
      ['vhs', 'VHS'],
    ])
    deactivate()
    deactivate = null
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
  })

  it('declares its parameters, with defaults inside their ranges', () => {
    expect(visualEffectDefinitions.map((definition) => definition.params)).toEqual([
      [{ key: 'strength', label: 'Strength', min: 0, max: 100, default: 60, unit: '%' }],
      [{ key: 'amount', label: 'Amount', min: 0, max: 5, default: 1, unit: '%' }],
      [
        { key: 'amount', label: 'Amount', min: 0, max: 100, default: 30, unit: '%' },
        { key: 'size', label: 'Size', min: 2, max: 10, default: 3 },
      ],
      [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 70, unit: '%' }],
      [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 70, unit: '%' }],
    ])
  })

  it('Vignette darkens the corners to Strength, scaled by the weight', () => {
    const vignette = visualEffectDefinitions[0]
    expect(vignette.look({ strength: 60 }, 1)).toEqual({
      filters: [],
      layers: [{ kind: 'vignette', strength: 0.6, inner: VIGNETTE_INNER }],
    })
    expect(vignette.look({ strength: 60 }, 0.5).layers[0]).toMatchObject({ strength: 0.3 })
    // Weight 0 draws a layer that darkens nothing: no pop at either end.
    expect(vignette.look({ strength: 100 }, 0).layers[0]).toMatchObject({ strength: 0 })
  })

  it('Blur is a radius of Amount percent of the frame width, scaled by the weight', () => {
    const blur = visualEffectDefinitions[1]
    expect(blur.look({ amount: 1 }, 1)).toEqual({ filters: [{ kind: 'blur', radius: 0.01 }], layers: [] })
    expect(blur.look({ amount: 4 }, 0.25).filters[0]).toEqual({ kind: 'blur', radius: 0.01 })
    expect(blur.look({ amount: 5 }, 0).filters[0]).toEqual({ kind: 'blur', radius: 0 })
  })

  it('a default effect has the declared defaults', () => {
    expect(visualEffectDefinitions.map((definition) => pictureEffectParamsFor(definition))).toEqual([
      { strength: 60 },
      { amount: 1 },
      { amount: 30, size: 3 },
      { amount: 70 },
      { amount: 70 },
    ])
  })

  it('Film grain is a grain layer of Amount, scaled by the weight, its cells Size pixels of a 1080p frame (#870)', () => {
    const grain = visualEffectDefinitions[2]
    expect(grain.look({ amount: 30, size: 3 }, 1, 0)).toEqual({
      filters: [],
      layers: [{ kind: 'grain', amount: 0.3, cell: 3 / GRAIN_REFERENCE_WIDTH, seed: 0 }],
    })
    expect(grain.look({ amount: 40, size: 3 }, 0.5, 0).layers[0]).toMatchObject({ amount: 0.2 })
    // Weight 0 draws grain of no strength: no pop at either end.
    expect(grain.look({ amount: 100, size: 3 }, 0, 0).layers[0]).toMatchObject({ amount: 0 })
  })

  it('Film grain\'s pattern is a function of the time alone: one step per 1/24 s, the same for the same instant', () => {
    const grain = visualEffectDefinitions[2]
    const seedAt = (time: number) => (grain.look({ amount: 30, size: 3 }, 1, time).layers[0] as { seed: number }).seed
    expect(seedAt(2.1)).toBe(seedAt(2.1))
    expect(seedAt(2.1)).toBe(50)
    // Within a step the pattern holds; one step later it changes.
    expect(seedAt(2.1 + 0.01)).toBe(50)
    expect(seedAt(2.1 + 1 / PICTURE_TEXTURE_RATE)).toBe(51)
  })

  it('Old film is sepia, a flickering brightness, a fine grain, scratches and dust, all scaled by Amount and the weight (#870)', () => {
    const oldFilm = visualEffectDefinitions[3]
    const look = oldFilm.look({ amount: 100 }, 1, 2.1)
    expect(look.filters).toEqual([
      { kind: 'sepia', amount: OLD_FILM.sepia },
      { kind: 'brightness', amount: oldFilmBrightness(2.1, OLD_FILM.flicker) },
    ])
    expect(look.layers).toEqual([
      { kind: 'grain', amount: OLD_FILM.grain, cell: OLD_FILM.grainSize / GRAIN_REFERENCE_WIDTH, seed: 50 },
      { kind: 'scratches', amount: OLD_FILM.scratches, seed: 50 },
      { kind: 'dust', amount: OLD_FILM.dust, seed: 50 },
    ])
    // Half the Amount at half the weight is a quarter of everything.
    const quarter = oldFilm.look({ amount: 50 }, 0.5, 2.1)
    expect(quarter.filters[0]).toEqual({ kind: 'sepia', amount: OLD_FILM.sepia / 4 })
    expect(quarter.filters[1]).toEqual({ kind: 'brightness', amount: oldFilmBrightness(2.1, OLD_FILM.flicker / 4) })
    expect(quarter.layers[0]).toMatchObject({ amount: OLD_FILM.grain / 4 })
    expect(quarter.layers[1]).toMatchObject({ kind: 'scratches', amount: OLD_FILM.scratches / 4 })
    expect(quarter.layers[2]).toMatchObject({ kind: 'dust', amount: OLD_FILM.dust / 4 })
    // Weight 0 changes nothing: no sepia, brightness 1, grain of no strength.
    const none = oldFilm.look({ amount: 100 }, 0, 2.1)
    expect(none.filters).toEqual([
      { kind: 'sepia', amount: 0 },
      { kind: 'brightness', amount: 1 },
    ])
    expect(none.layers.map((layer) => (layer as { amount: number }).amount)).toEqual([0, 0, 0])
  })

  it("Old film's flicker is a function of the time alone, one value per 1/24 s, within its depth", () => {
    const oldFilm = visualEffectDefinitions[3]
    const brightnessAt = (time: number) =>
      (oldFilm.look({ amount: 100 }, 1, time).filters[1] as { amount: number }).amount
    // The same instant is the same brightness; within a step it holds.
    expect(brightnessAt(2.1)).toBe(brightnessAt(2.1))
    expect(brightnessAt(2.1 + 0.01)).toBe(brightnessAt(2.1))
    // Over a few seconds of steps it stays within the depth, and it moves:
    // most neighbouring steps differ, and it goes both above and below 1.
    const values = Array.from({ length: 96 }, (_, step) => brightnessAt((step + 0.5) / PICTURE_TEXTURE_RATE))
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(1 - OLD_FILM.flicker)
      expect(value).toBeLessThanOrEqual(1 + OLD_FILM.flicker)
    }
    const changes = values.slice(1).filter((value, index) => value !== values[index]).length
    expect(changes).toBeGreaterThan(90)
    expect(Math.min(...values)).toBeLessThan(1 - OLD_FILM.flicker / 2)
    expect(Math.max(...values)).toBeGreaterThan(1 + OLD_FILM.flicker / 2)
    // One step apart, the two instants differ.
    expect(brightnessAt(2.1 + 1 / PICTURE_TEXTURE_RATE)).not.toBe(brightnessAt(2.1))
  })

  it('VHS is a colour offset, a soft blur, scanlines and a tracking band, all scaled by Amount and the weight, their step from the time (#870)', () => {
    const vhs = visualEffectDefinitions[4]
    expect(vhs.look({ amount: 100 }, 1, 2.1)).toEqual({
      filters: [
        { kind: 'channel-offset', offset: VHS.offset },
        { kind: 'blur', radius: VHS.blur },
      ],
      layers: [
        { kind: 'scanlines', amount: VHS.scanlines, seed: 50 },
        { kind: 'tracking', amount: VHS.tracking, seed: 50 },
      ],
    })
    // Half the Amount at half the weight is a quarter of each.
    expect(vhs.look({ amount: 50 }, 0.5, 2.1)).toEqual({
      filters: [
        { kind: 'channel-offset', offset: VHS.offset / 4 },
        { kind: 'blur', radius: VHS.blur / 4 },
      ],
      layers: [
        { kind: 'scanlines', amount: VHS.scanlines / 4, seed: 50 },
        { kind: 'tracking', amount: VHS.tracking / 4, seed: 50 },
      ],
    })
    // Weight 0 changes nothing: no offset, a blur of no radius, lines and a band of no strength.
    expect(vhs.look({ amount: 100 }, 0, 2.1)).toEqual({
      filters: [
        { kind: 'channel-offset', offset: 0 },
        { kind: 'blur', radius: 0 },
      ],
      layers: [
        { kind: 'scanlines', amount: 0, seed: 50 },
        { kind: 'tracking', amount: 0, seed: 50 },
      ],
    })
    // The layers' step is the time's: the same within a step, the next one after it.
    const seedsAt = (time: number) => vhs.look({ amount: 100 }, 1, time).layers.map((layer) => (layer as { seed: number }).seed)
    expect(seedsAt(2.1 + 0.01)).toEqual([50, 50])
    expect(seedsAt(2.1 + 1 / PICTURE_TEXTURE_RATE)).toEqual([51, 51])
  })

  it('counts each of its picture effects in a project as one use, and nothing else (#953)', () => {
    const plugin = builtInPlugins.find((spec) => spec.id === 'visual-effects')
    const count = plugin?.projectUses?.count
    if (count === undefined) throw new Error('visual-effects declares no projectUses')
    const timelineWith = (...types: string[]) => ({
      entries: [{ id: 'a', clipId: 'c1' }],
      pictureEffects: types.map((type, index) => ({ id: `p${index}`, entryId: 'a', type, start: 0, end: 1, params: {} })),
    })
    const library = { clips: [], failures: [] }
    // The count reads only picture effects; the fixture carries what
    // `pictureEffectsOf` needs and nothing else.
    const asTimeline = (value: unknown) => value as Parameters<typeof count>[1]
    const one = { count: 1, what: '1 picture effect' }
    expect(count(library, asTimeline(timelineWith('vignette')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('blur')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('film-grain')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('old-film')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('vhs')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('vignette', 'from-elsewhere', 'blur')))).toEqual({
      count: 2,
      what: '2 picture effects',
    })
    expect(count(library, asTimeline(timelineWith('from-elsewhere')))).toEqual({ count: 0, what: '' })
    expect(count(library, asTimeline({ entries: [] }))).toEqual({ count: 0, what: '' })
    expect(isVisualEffect('box-open')).toBe(false)
  })
})
