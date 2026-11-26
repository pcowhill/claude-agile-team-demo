import { afterEach, describe, expect, it } from 'vitest'
import { PICTURE_TEXTURE_RATE, pictureEffectParamsFor, pictureEffectRegistry } from '../../lib/pictureEffect'
import { builtInPlugins } from '../catalog'
import { VISUAL_EFFECT_IDS, isVisualEffect } from '../visualEffectsIds'
import {
  CHROMATIC_ABERRATION,
  GLITCH,
  GRAIN_REFERENCE_WIDTH,
  OLD_FILM,
  VHS,
  VIGNETTE_INNER,
  activate,
  glitchBands,
  glitchBurst,
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

  it('registers Vignette, Blur, Film grain, Old film, VHS, Chromatic aberration and Glitch in the ids module\'s order, and unregisters them', () => {
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
    deactivate = activate()
    expect(pictureEffectRegistry.list().map(({ id, name }) => [id, name])).toEqual([
      ['vignette', 'Vignette'],
      ['blur', 'Blur'],
      ['film-grain', 'Film grain'],
      ['old-film', 'Old film'],
      ['vhs', 'VHS'],
      ['chromatic-aberration', 'Chromatic aberration'],
      ['glitch', 'Glitch'],
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
      [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 30, unit: '%' }],
      [
        { key: 'intensity', label: 'Intensity', min: 0, max: 100, default: 50, unit: '%' },
        { key: 'frequency', label: 'Frequency', min: 0, max: 100, default: 30, unit: '%' },
      ],
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
      { amount: 30 },
      { intensity: 50, frequency: 30 },
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

  it('Chromatic aberration is a channel offset of Amount percent of its full split, scaled by the weight (#871)', () => {
    const aberration = visualEffectDefinitions[5]
    const offsetOf = (amount: number, weight: number) => {
      const { filters, layers } = aberration.look({ amount }, weight, 2.1)
      expect(layers).toEqual([])
      expect(filters).toHaveLength(1)
      const [filter] = filters
      if (filter.kind !== 'channel-offset') throw new Error(`expected a channel offset, got ${filter.kind}`)
      return filter.offset
    }
    // Amount 100 at full weight is the whole split, about 19 px of a 1080p frame.
    expect(offsetOf(100, 1)).toBe(CHROMATIC_ABERRATION.offset)
    expect(CHROMATIC_ABERRATION.offset * 1920).toBeCloseTo(19.2)
    // Zero at Amount 0 and at weight 0: the picture untouched.
    expect(offsetOf(0, 1)).toBe(0)
    expect(offsetOf(100, 0)).toBe(0)
    // It grows with Amount, and the weight scales it as Amount does.
    const amounts = [0, 10, 30, 50, 100]
    const offsets = amounts.map((amount) => offsetOf(amount, 1))
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(new Set(offsets).size).toBe(amounts.length)
    expect(offsetOf(50, 0.5)).toBeCloseTo(CHROMATIC_ABERRATION.offset / 4, 12)
    // No texture: the same at any time.
    expect(aberration.look({ amount: 30 }, 1, 0)).toEqual(aberration.look({ amount: 30 }, 1, 7.3))
  })

  it('Glitch splits red and blue in the bursts its Frequency picks, by Intensity and the burst\'s own size, scaled by the weight (#871)', () => {
    const glitch = visualEffectDefinitions[6]
    const offsetAt = (params: { intensity: number; frequency: number }, weight: number, time: number) => {
      const { filters, layers } = glitch.look(params, weight, time)
      expect(layers).toEqual([])
      // The tear first, then the split (step 2b(ii)), so the split splits the torn picture.
      expect(filters.map((filter) => filter.kind)).toEqual(['slices', 'channel-offset'])
      const filter = filters[1]
      if (filter.kind !== 'channel-offset') throw new Error(`expected a channel offset, got ${filter.kind}`)
      return filter.offset
    }
    const burstLength = GLITCH.steps / PICTURE_TEXTURE_RATE
    const bursts = Array.from({ length: 400 }, (_, burst) => (burst + 0.5) * burstLength)
    const sizes = (chance: number) => bursts.map((time) => glitchBurst(time, chance))

    // Same input, same output: the bursts are a pure function of the time.
    expect(sizes(0.3)).toEqual(sizes(0.3))
    // Frequency is the share of bursts that glitch: none at 0, every one at 1,
    // and about that share in between, each burst holding its size.
    expect(sizes(0).every((size) => size === 0)).toBe(true)
    expect(sizes(1).every((size) => size >= GLITCH.least && size <= 1)).toBe(true)
    for (const chance of [0.1, 0.3, 0.6]) {
      const share = sizes(chance).filter((size) => size > 0).length / bursts.length
      expect(Math.abs(share - chance), `share at ${chance}`).toBeLessThan(0.07)
    }
    // A burst that glitches at one Frequency glitches at every higher one, the same size.
    sizes(0.3).forEach((size, burst) => {
      if (size > 0) expect(sizes(0.6)[burst]).toBe(size)
    })
    // The sizes vary from burst to burst: not one jump repeated.
    expect(new Set(sizes(1).map((size) => size.toFixed(3))).size).toBeGreaterThan(100)
    // A burst holds still through its steps and changes at the next burst.
    const firstStep = 0.1 / PICTURE_TEXTURE_RATE
    for (let burst = 0; burst < 40; burst++) {
      const start = burst * burstLength + firstStep
      for (let step = 1; step < GLITCH.steps; step++) {
        expect(glitchBurst(start + step / PICTURE_TEXTURE_RATE, 1)).toBe(glitchBurst(start, 1))
      }
    }
    expect(new Set(bursts.slice(0, 40).map((time) => glitchBurst(time, 1))).size).toBeGreaterThan(30)

    // The look: Intensity percent of the full split, times the burst's size and the weight.
    const glitching = bursts.find((time) => glitchBurst(time, 0.3) > 0.9)!
    const quiet = bursts.find((time) => glitchBurst(time, 0.3) === 0)!
    const size = glitchBurst(glitching, 0.3)
    expect(offsetAt({ intensity: 100, frequency: 30 }, 1, glitching)).toBeCloseTo(GLITCH.offset * size, 12)
    expect(offsetAt({ intensity: 50, frequency: 30 }, 0.5, glitching)).toBeCloseTo((GLITCH.offset * size) / 4, 12)
    // Nothing at Intensity 0, at weight 0, at Frequency 0, or in a quiet burst.
    expect(offsetAt({ intensity: 0, frequency: 30 }, 1, glitching)).toBe(0)
    expect(offsetAt({ intensity: 100, frequency: 30 }, 0, glitching)).toBe(0)
    expect(offsetAt({ intensity: 100, frequency: 0 }, 1, glitching)).toBe(0)
    expect(offsetAt({ intensity: 100, frequency: 30 }, 1, quiet)).toBe(0)
    // Intensity 100 at full weight in the largest burst is the whole split, about 38 px of a 1080p frame.
    expect(GLITCH.offset * 1920).toBeCloseTo(38.4)
  })

  it('Glitch tears bands of the picture sideways in the same bursts, by Intensity and the burst\'s own size, scaled by the weight (#871, step 2b(ii))', () => {
    const glitch = visualEffectDefinitions[6]
    const bandsAt = (params: { intensity: number; frequency: number }, weight: number, time: number) => {
      const filter = glitch.look(params, weight, time).filters[0]
      if (filter.kind !== 'slices') throw new Error(`expected slices, got ${filter.kind}`)
      return filter.bands
    }
    const burstLength = GLITCH.steps / PICTURE_TEXTURE_RATE
    const bursts = Array.from({ length: 400 }, (_, burst) => (burst + 0.5) * burstLength)

    // Each burst's bands: inside the frame, of a height in range, shifted
    // left or right by between `least` and all of the tear.
    for (const time of bursts) {
      const bands = glitchBands(time)
      expect(bands).toHaveLength(GLITCH.bands)
      for (const band of bands) {
        expect(band.top).toBeGreaterThanOrEqual(0)
        expect(band.top + band.height).toBeLessThanOrEqual(1)
        expect(band.height).toBeGreaterThanOrEqual(GLITCH.thinnest)
        expect(band.height).toBeLessThanOrEqual(GLITCH.thickest)
        expect(Math.abs(band.shift)).toBeGreaterThanOrEqual(GLITCH.least * GLITCH.tear - 1e-12)
        expect(Math.abs(band.shift)).toBeLessThanOrEqual(GLITCH.tear)
      }
    }
    // A pure function of the time, holding still through a burst's steps
    // and changing at the next burst.
    expect(bursts.map(glitchBands)).toEqual(bursts.map(glitchBands))
    const firstStep = 0.1 / PICTURE_TEXTURE_RATE
    for (let burst = 0; burst < 40; burst++) {
      const start = burst * burstLength + firstStep
      for (let step = 1; step < GLITCH.steps; step++) {
        expect(glitchBands(start + step / PICTURE_TEXTURE_RATE)).toEqual(glitchBands(start))
      }
    }
    const tops = bursts.map((time) => glitchBands(time)[0].top.toFixed(4))
    expect(new Set(tops).size).toBeGreaterThan(380)
    // Both directions, and the whole frame's height, are used.
    const all = bursts.flatMap(glitchBands)
    const left = all.filter((band) => band.shift < 0).length / all.length
    expect(Math.abs(left - 0.5)).toBeLessThan(0.07)
    expect(Math.min(...all.map((band) => band.top))).toBeLessThan(0.02)
    expect(Math.max(...all.map((band) => band.top + band.height))).toBeGreaterThan(0.98)

    // The look: the burst's bands, their shifts times Intensity percent,
    // the burst's size and the weight, the split's own factor.
    const glitching = bursts.find((time) => glitchBurst(time, 0.3) > 0.9)!
    const quiet = bursts.find((time) => glitchBurst(time, 0.3) === 0)!
    const size = glitchBurst(glitching, 0.3)
    const expected = (factor: number) =>
      glitchBands(glitching).map((band) => ({ ...band, shift: band.shift * factor }))
    const close = (actual: readonly { top: number; height: number; shift: number }[], factor: number) => {
      expect(actual).toHaveLength(GLITCH.bands)
      expected(factor).forEach((band, index) => {
        expect(actual[index].top).toBe(band.top)
        expect(actual[index].height).toBe(band.height)
        expect(actual[index].shift).toBeCloseTo(band.shift, 12)
      })
    }
    close(bandsAt({ intensity: 100, frequency: 30 }, 1, glitching), size)
    close(bandsAt({ intensity: 50, frequency: 30 }, 0.5, glitching), size / 4)
    // No bands at Intensity 0, at weight 0, at Frequency 0, or in a quiet burst.
    expect(bandsAt({ intensity: 0, frequency: 30 }, 1, glitching)).toEqual([])
    expect(bandsAt({ intensity: 100, frequency: 30 }, 0, glitching)).toEqual([])
    expect(bandsAt({ intensity: 100, frequency: 0 }, 1, glitching)).toEqual([])
    expect(bandsAt({ intensity: 100, frequency: 30 }, 1, quiet)).toEqual([])
    // The largest tear, at Intensity 100 in a burst of size 1, is about 96 px of a 1080p frame.
    expect(GLITCH.tear * 1920).toBeCloseTo(96)
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
    expect(count(library, asTimeline(timelineWith('chromatic-aberration')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('glitch')))).toEqual(one)
    expect(count(library, asTimeline(timelineWith('vignette', 'from-elsewhere', 'blur')))).toEqual({
      count: 2,
      what: '2 picture effects',
    })
    expect(count(library, asTimeline(timelineWith('from-elsewhere')))).toEqual({ count: 0, what: '' })
    expect(count(library, asTimeline({ entries: [] }))).toEqual({ count: 0, what: '' })
    expect(isVisualEffect('box-open')).toBe(false)
  })
})
