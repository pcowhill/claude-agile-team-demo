import { afterEach, describe, expect, it } from 'vitest'
import { PICTURE_TEXTURE_RATE, pictureEffectParamsFor, pictureEffectRegistry } from '../../lib/pictureEffect'
import { builtInPlugins } from '../catalog'
import { VISUAL_EFFECT_IDS, isVisualEffect } from '../visualEffectsIds'
import { GRAIN_REFERENCE_WIDTH, VIGNETTE_INNER, activate, visualEffectDefinitions } from './index'

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

  it('registers Vignette, Blur and Film grain in the ids module\'s order, and unregisters them', () => {
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
    deactivate = activate()
    expect(pictureEffectRegistry.list().map(({ id, name }) => [id, name])).toEqual([
      ['vignette', 'Vignette'],
      ['blur', 'Blur'],
      ['film-grain', 'Film grain'],
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

  it('a project holding a visual effect depends on the plugin, one without does not', () => {
    const plugin = builtInPlugins.find((spec) => spec.id === 'visual-effects')
    const usedByProject = plugin?.usedByProject
    if (usedByProject === undefined) throw new Error('visual-effects declares no usedByProject')
    const timelineWith = (type: string) => ({
      entries: [{ id: 'a', clipId: 'c1' }],
      pictureEffects: [{ id: 'p1', entryId: 'a', type, start: 0, end: 1, params: {} }],
    })
    const library = { clips: [], failures: [] }
    // The predicate reads only picture effects; the fixture carries what
    // `pictureEffectsOf` needs and nothing else.
    const asTimeline = (value: unknown) => value as Parameters<typeof usedByProject>[1]
    expect(usedByProject(library, asTimeline(timelineWith('vignette')))).toBe(true)
    expect(usedByProject(library, asTimeline(timelineWith('blur')))).toBe(true)
    expect(usedByProject(library, asTimeline(timelineWith('film-grain')))).toBe(true)
    expect(usedByProject(library, asTimeline(timelineWith('from-elsewhere')))).toBe(false)
    expect(usedByProject(library, asTimeline({ entries: [] }))).toBe(false)
    expect(isVisualEffect('box-open')).toBe(false)
  })
})
