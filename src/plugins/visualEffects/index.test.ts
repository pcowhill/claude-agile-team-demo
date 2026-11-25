import { afterEach, describe, expect, it } from 'vitest'
import { pictureEffectParamsFor, pictureEffectRegistry } from '../../lib/pictureEffect'
import { builtInPlugins } from '../catalog'
import { VISUAL_EFFECT_IDS, isVisualEffect } from '../visualEffectsIds'
import { VIGNETTE_INNER, activate, visualEffectDefinitions } from './index'

/**
 * The Visual effects plugin (#862), against the module the plugin runtime
 * lazy-loads: what it registers, what its two rules return, and the
 * catalog's dependency predicate. The renderers' side is the e2e spec
 * (`e2e/visual-effects.spec.ts`).
 */
describe('Visual effects plugin (#862)', () => {
  let deactivate: (() => void) | null = null
  afterEach(() => {
    deactivate?.()
    deactivate = null
  })

  it('registers Vignette and Blur in the ids module\'s order, and unregisters them', () => {
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
    deactivate = activate()
    expect(pictureEffectRegistry.list().map(({ id, name }) => [id, name])).toEqual([
      ['vignette', 'Vignette'],
      ['blur', 'Blur'],
    ])
    deactivate()
    deactivate = null
    expect(VISUAL_EFFECT_IDS.some((id) => pictureEffectRegistry.has(id))).toBe(false)
  })

  it('declares one percent parameter each, with defaults inside their ranges', () => {
    expect(visualEffectDefinitions.map((definition) => definition.params)).toEqual([
      [{ key: 'strength', label: 'Strength', min: 0, max: 100, default: 60, unit: '%' }],
      [{ key: 'amount', label: 'Amount', min: 0, max: 5, default: 1, unit: '%' }],
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
    ])
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
    expect(usedByProject(library, asTimeline(timelineWith('from-elsewhere')))).toBe(false)
    expect(usedByProject(library, asTimeline({ entries: [] }))).toBe(false)
    expect(isVisualEffect('box-open')).toBe(false)
  })
})
