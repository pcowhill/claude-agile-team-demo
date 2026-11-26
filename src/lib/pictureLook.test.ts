import { describe, expect, it } from 'vitest'
import { NO_PICTURE_LOOK, PictureEffectRegistry, vignetteStops } from './pictureEffect'
import type { PictureEffect, PictureEffectDefinition } from './pictureEffect'
import {
  PICTURE_EFFECT_EASE_SECONDS,
  pictureEffectWeight,
  pictureFilterFunctions,
  pictureLookAt,
  timelineHasPictureFilters,
} from './pictureLook'
import type { TimelineEntry, TimelineState } from './timeline'

/**
 * The picture-effect resolver (#862): the one rule both renderers draw
 * from. These pin the ease, the bound-edge exception #919 asked for, the
 * stacking order, and what an unregistered type contributes (nothing).
 */

// Trimmed range [2, 10] of a 12 s clip: offsets 0..8 into the entry.
const entry: TimelineEntry = {
  id: 'e1',
  clipId: 'c1',
  name: 'clip.webm',
  duration: 12,
  url: 'blob:clip',
  inPoint: 2,
  outPoint: 10,
}

/** Test definitions whose looks echo their inputs, so the weight is visible. */
const dim: PictureEffectDefinition = {
  id: 'dim',
  name: 'Dim',
  params: [{ key: 'strength', label: 'Strength', min: 0, max: 1, default: 0.5 }],
  look: (params, weight) => ({
    filters: [],
    layers: [{ kind: 'vignette', strength: params.strength * weight, inner: 0.5 }],
  }),
}
const soften: PictureEffectDefinition = {
  id: 'soften',
  name: 'Soften',
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 0.1, default: 0.01 }],
  look: (params, weight) => ({ filters: [{ kind: 'blur', radius: params.amount * weight }], layers: [] }),
}

const registry = () => {
  const value = new PictureEffectRegistry()
  value.register(dim)
  value.register(soften)
  return value
}

const effect = (overrides: Partial<PictureEffect> = {}): PictureEffect => ({
  id: 'p1',
  entryId: 'e1',
  type: 'dim',
  start: 2,
  end: 5,
  params: { strength: 0.8 },
  ...overrides,
})

const stateWith = (...pictureEffects: PictureEffect[]): TimelineState => ({
  entries: [entry],
  zooms: [],
  pictureEffects,
})

/** The source time `offset` seconds into the entry's trimmed range. */
const at = (offset: number) => entry.inPoint + offset

describe('pictureEffectWeight', () => {
  const window = { start: 2, end: 5 }
  const ease = PICTURE_EFFECT_EASE_SECONDS

  it('is 0 outside the window and 1 across its middle', () => {
    expect(pictureEffectWeight(window, 1.99, 8)).toBe(0)
    expect(pictureEffectWeight(window, 5.01, 8)).toBe(0)
    expect(pictureEffectWeight(window, 3.5, 8)).toBe(1)
    expect(pictureEffectWeight(window, 2 + ease, 8)).toBe(1)
    expect(pictureEffectWeight(window, 5 - ease, 8)).toBe(1)
  })

  it('eases in and out over the ease length, from and to 0, so nothing pops', () => {
    expect(pictureEffectWeight(window, 2, 8)).toBe(0)
    expect(pictureEffectWeight(window, 5, 8)).toBe(0)
    // Smoothstep at the ease's midpoint is exactly half.
    expect(pictureEffectWeight(window, 2 + ease / 2, 8)).toBeCloseTo(0.5, 10)
    expect(pictureEffectWeight(window, 5 - ease / 2, 8)).toBeCloseTo(0.5, 10)
    let previous = -1
    for (let offset = 2; offset <= 2 + ease; offset += ease / 10) {
      const weight = pictureEffectWeight(window, offset, 8)
      expect(weight).toBeGreaterThanOrEqual(previous)
      previous = weight
    }
  })

  it('eases over half a window shorter than twice the ease, peaking at its middle', () => {
    const short = { start: 1, end: 1.2 }
    expect(pictureEffectWeight(short, 1.1, 8)).toBe(1)
    expect(pictureEffectWeight(short, 1.05, 8)).toBeCloseTo(0.5, 10)
  })

  it('does not ease at an edge on the entry\'s own bounds (#919)', () => {
    // From the in-point: full weight at the entry's first frame.
    expect(pictureEffectWeight({ start: 0, end: 3 }, 0, 8)).toBe(1)
    expect(pictureEffectWeight({ start: 0, end: 3 }, 3, 8)).toBe(0)
    // To the out-point: full weight at its last frame.
    expect(pictureEffectWeight({ start: 4, end: 8 }, 8, 8)).toBe(1)
    expect(pictureEffectWeight({ start: 4, end: 8 }, 4, 8)).toBe(0)
    // A split's halves, [1, 3] cut at 2 into [1, 2] on a 2 s entry and
    // [0, 1] on the next: full weight on both sides of the cut, as the
    // unsplit effect had there.
    expect(pictureEffectWeight({ start: 1, end: 3 }, 2, 8)).toBe(1)
    expect(pictureEffectWeight({ start: 1, end: 2 }, 2, 2)).toBe(1)
    expect(pictureEffectWeight({ start: 0, end: 1 }, 0, 6)).toBe(1)
  })

  it('is 0 for a collapsed window', () => {
    expect(pictureEffectWeight({ start: 8, end: 8 }, 8, 8)).toBe(0)
  })
})

describe('pictureLookAt', () => {
  it('is NO_PICTURE_LOOK itself without effects, outside every window, and for a missing entry', () => {
    expect(pictureLookAt({ entries: [entry], zooms: [] }, 0, at(3), registry())).toBe(NO_PICTURE_LOOK)
    expect(pictureLookAt(stateWith(effect()), 0, at(1), registry())).toBe(NO_PICTURE_LOOK)
    expect(pictureLookAt(stateWith(effect()), 3, at(3), registry())).toBe(NO_PICTURE_LOOK)
  })

  it("reads the window on the entry's trimmed clock, as zooms do", () => {
    // Offset 3.5 is source time 5.5, well inside [2, 5].
    expect(pictureLookAt(stateWith(effect()), 0, 5.5, registry())).toEqual({
      filters: [],
      layers: [{ kind: 'vignette', strength: 0.8, inner: 0.5 }],
    })
    // Source time 3.5 is offset 1.5: before the window.
    expect(pictureLookAt(stateWith(effect()), 0, 3.5, registry())).toBe(NO_PICTURE_LOOK)
  })

  it('passes the eased weight to the rule', () => {
    const look = pictureLookAt(stateWith(effect()), 0, at(2 + PICTURE_EFFECT_EASE_SECONDS / 2), registry())
    expect(look.layers[0]).toMatchObject({ strength: expect.closeTo(0.4, 10) })
  })

  it("passes the instant's source time to the rule, the clock a generated texture steps on (#870)", () => {
    const seen: (number | undefined)[] = []
    const timed = new PictureEffectRegistry()
    timed.register({
      ...dim,
      look: (params, weight, time) => {
        seen.push(time)
        return dim.look(params, weight)
      },
    })
    pictureLookAt(stateWith(effect()), 0, 5.25, timed)
    pictureLookAt(stateWith(effect()), 0, 6.5, timed)
    expect(seen).toEqual([5.25, 6.5])
  })

  it('fits the stored parameters to the definition before the rule sees them', () => {
    const look = pictureLookAt(stateWith(effect({ params: { strength: 7, stray: 1 } })), 0, at(3), registry())
    expect(look.layers).toEqual([{ kind: 'vignette', strength: 1, inner: 0.5 }])
    const defaulted = pictureLookAt(stateWith(effect({ params: {} })), 0, at(3), registry())
    expect(defaulted.layers[0]).toMatchObject({ strength: 0.5 })
  })

  it('stacks overlapping effects in start order', () => {
    const state = stateWith(
      effect({ id: 'a', type: 'soften', start: 1, end: 6, params: { amount: 0.02 } }),
      effect({ id: 'b', start: 2, end: 5 }),
      effect({ id: 'c', type: 'soften', start: 2.5, end: 4, params: { amount: 0.03 } }),
    )
    const look = pictureLookAt(state, 0, at(3), registry())
    expect(look.filters).toEqual([
      { kind: 'blur', radius: 0.02 },
      { kind: 'blur', radius: 0.03 },
    ])
    expect(look.layers).toEqual([{ kind: 'vignette', strength: 0.8, inner: 0.5 }])
  })

  it('renders an unregistered type as nothing, and only its own entry', () => {
    const state = stateWith(effect({ type: 'from-a-disabled-plugin' }))
    expect(pictureLookAt(state, 0, at(3), registry())).toBe(NO_PICTURE_LOOK)
    const other: TimelineState = {
      entries: [entry, { ...entry, id: 'e2' }],
      zooms: [],
      pictureEffects: [effect({ entryId: 'e2' })],
    }
    expect(pictureLookAt(other, 0, at(3), registry())).toBe(NO_PICTURE_LOOK)
    expect(pictureLookAt(other, 1, at(3), registry()).layers).toHaveLength(1)
  })
})

describe('timelineHasPictureFilters', () => {
  it('is true only for a registered effect whose look has a filter', () => {
    expect(timelineHasPictureFilters(stateWith(), registry())).toBe(false)
    expect(timelineHasPictureFilters(stateWith(effect()), registry())).toBe(false)
    expect(timelineHasPictureFilters(stateWith(effect({ type: 'soften' })), registry())).toBe(true)
    expect(timelineHasPictureFilters(stateWith(effect({ type: 'soften' })), new PictureEffectRegistry())).toBe(
      false,
    )
  })
})

describe('pictureFilterFunctions', () => {
  it('writes a blur radius as a fraction of the frame width in the renderer\'s unit', () => {
    const filters = [{ kind: 'blur' as const, radius: 0.01 }]
    // The export: px of a 1920-wide canvas.
    expect(pictureFilterFunctions(filters, 1920, 'px')).toEqual(['blur(19.2px)'])
    // The preview: the frame's cqw, 100 per width, divided by a 2x zoom.
    expect(pictureFilterFunctions(filters, 100, 'cqw', 2)).toEqual(['blur(0.5cqw)'])
    expect(pictureFilterFunctions([], 1920, 'px')).toEqual([])
  })

  it('writes sepia and brightness as plain numbers, untouched by the width and the scale (#870)', () => {
    const filters = [
      { kind: 'sepia', amount: 0.595 },
      { kind: 'brightness', amount: 1.0432 },
    ] as const
    expect(pictureFilterFunctions(filters, 1920, 'px')).toEqual(['sepia(0.595)', 'brightness(1.0432)'])
    expect(pictureFilterFunctions(filters, 100, 'cqw', 2)).toEqual(['sepia(0.595)', 'brightness(1.0432)'])
    // Out-of-range values are held where CSS and the canvas agree.
    expect(
      pictureFilterFunctions(
        [
          { kind: 'sepia', amount: 1.5 },
          { kind: 'brightness', amount: -0.2 },
        ],
        1920,
        'px',
      ),
    ).toEqual(['sepia(1)', 'brightness(0)'])
  })

  it('hands a channel offset to the renderer, in its place among the others, and drops it when the renderer draws none (#870)', () => {
    const filters = [
      { kind: 'blur', radius: 0.01 },
      { kind: 'channel-offset', offset: 0.003 },
      { kind: 'sepia', amount: 0.5 },
    ] as const
    const asked: number[] = []
    const reference = (offset: number) => {
      asked.push(offset)
      return `url(#shift-${offset})`
    }
    expect(pictureFilterFunctions(filters, 1920, 'px', 1, reference)).toEqual([
      'blur(19.2px)',
      'url(#shift-0.003)',
      'sepia(0.5)',
    ])
    // The fraction itself: each renderer turns it into its own pixels.
    expect(asked).toEqual([0.003])
    expect(pictureFilterFunctions(filters, 1920, 'px', 1, () => null)).toEqual(['blur(19.2px)', 'sepia(0.5)'])
    // No renderer to resolve it, or no offset at all, adds nothing.
    expect(pictureFilterFunctions(filters, 1920, 'px')).toEqual(['blur(19.2px)', 'sepia(0.5)'])
    expect(pictureFilterFunctions([{ kind: 'channel-offset', offset: 0 }], 1920, 'px', 1, reference)).toEqual([])
    expect(asked).toEqual([0.003])
  })

  it('hands slices to the renderer as the bands themselves, in their place, and drops them when it draws none (#871)', () => {
    const bands = [{ top: 0.2, height: 0.1, shift: -0.02 }]
    const filters = [
      { kind: 'sepia', amount: 0.5 },
      { kind: 'slices', bands },
      { kind: 'blur', radius: 0.01 },
    ] as const
    const asked: (readonly unknown[])[] = []
    const reference = (given: readonly unknown[]) => {
      asked.push(given)
      return 'url(#slices)'
    }
    expect(pictureFilterFunctions(filters, 1920, 'px', 1, undefined, reference)).toEqual([
      'sepia(0.5)',
      'url(#slices)',
      'blur(19.2px)',
    ])
    expect(asked).toEqual([bands])
    expect(pictureFilterFunctions(filters, 1920, 'px', 1, undefined, () => null)).toEqual(['sepia(0.5)', 'blur(19.2px)'])
    // No renderer to resolve them, or no bands, adds nothing.
    expect(pictureFilterFunctions(filters, 1920, 'px')).toEqual(['sepia(0.5)', 'blur(19.2px)'])
    expect(pictureFilterFunctions([{ kind: 'slices', bands: [] }], 1920, 'px', 1, undefined, reference)).toEqual([])
    expect(asked).toHaveLength(1)
  })
})

describe('vignetteStops', () => {
  it('is transparent out to inner and reaches strength at the corner, rising smoothly', () => {
    const stops = vignetteStops({ kind: 'vignette', strength: 0.6, inner: 0.4 })
    expect(stops[0]).toEqual({ offset: 0.4, alpha: 0 })
    expect(stops.at(-1)).toEqual({ offset: 1, alpha: 0.6 })
    for (let index = 1; index < stops.length; index++) {
      expect(stops[index].offset).toBeGreaterThan(stops[index - 1].offset)
      expect(stops[index].alpha).toBeGreaterThan(stops[index - 1].alpha)
    }
  })

  it('clamps strength and inner into [0, 1]', () => {
    const stops = vignetteStops({ kind: 'vignette', strength: 3, inner: -1 })
    expect(stops[0].offset).toBe(0)
    expect(stops.at(-1)?.alpha).toBe(1)
  })
})
