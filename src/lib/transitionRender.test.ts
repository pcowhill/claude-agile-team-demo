import { describe, expect, it, vi } from 'vitest'
import {
  CROSS_ZOOM_PEAK,
  IRIS_COVER_RADIUS,
  TransitionRegistry,
  registerCoreTransitions,
  transitionLabel,
  transitionLayerSpec,
  transitionRegistry,
  unregisteredTransitionTypes,
} from './transitionRender'
import type { TransitionDefinition, TransitionLayerSpec } from './transitionRender'
import { TRANSITION_TYPES } from './timeline'

/** The fields every type shares unless it says otherwise (see BASE_SPEC). */
const base: TransitionLayerSpec = {
  outgoingAlpha: 1,
  incomingAlpha: 1,
  additive: false,
  incomingOffsetXFraction: 0,
  incomingOffsetYFraction: 0,
  outgoingOffsetXFraction: 0,
  outgoingOffsetYFraction: 0,
  incomingBacking: true,
  incomingClip: null,
  outgoingScale: 1,
  incomingScale: 1,
  veil: null,
  incomingEllipse: null,
}

/** A minimal fixture definition for registry tests. */
const fixtureDefinition = (id: string, name = id): TransitionDefinition => ({
  id,
  name,
  layerSpec: () => ({ ...base }),
})

describe('TransitionRegistry (#199)', () => {
  it('registers, finds, lists in order, and unregisters', () => {
    const registry = new TransitionRegistry()
    registry.register(fixtureDefinition('one', 'One'))
    registry.register(fixtureDefinition('two', 'Two'))
    expect(registry.has('one')).toBe(true)
    expect(registry.find('one')?.name).toBe('One')
    expect(registry.list().map((definition) => definition.id)).toEqual(['one', 'two'])
    registry.unregister('one')
    expect(registry.has('one')).toBe(false)
    expect(registry.find('one')).toBeUndefined()
    // Unregistering an absent id is a no-op — teardown order safety.
    expect(() => registry.unregister('one')).not.toThrow()
  })

  it('throws on a duplicate id — silent replacement would hide a collision', () => {
    const registry = new TransitionRegistry()
    registry.register(fixtureDefinition('dup'))
    expect(() => registry.register(fixtureDefinition('dup'))).toThrow(/already registered/)
  })

  it('notifies subscribers and bumps version on register and unregister', () => {
    const registry = new TransitionRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const before = registry.version
    registry.register(fixtureDefinition('a'))
    registry.unregister('a')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.version).toBe(before + 2)
    unsubscribe()
    registry.register(fixtureDefinition('b'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('registerCoreTransitions covers exactly TRANSITION_TYPES, in order', () => {
    const registry = new TransitionRegistry()
    registerCoreTransitions(registry)
    expect(registry.list().map((definition) => definition.id)).toEqual([...TRANSITION_TYPES])
    // Every core definition carries a picker name distinct from its id form.
    for (const definition of registry.list()) {
      expect(definition.name).not.toHaveLength(0)
      expect(definition.name[0]).toBe(definition.name[0].toUpperCase())
    }
  })

  it('the app singleton has the core set registered at startup', () => {
    expect(unregisteredTransitionTypes(TRANSITION_TYPES, transitionRegistry)).toEqual([])
  })
})

describe('registry resolution: fallback, labels, unknown types (#199)', () => {
  it('an unregistered type renders as a crossfade rather than throwing', () => {
    const registry = new TransitionRegistry()
    registerCoreTransitions(registry)
    // A pack transition left on the timeline after its plugin was disabled:
    // the render loop must keep drawing something reasonable.
    expect(transitionLayerSpec('gone-pack-type', 0.25, registry)).toEqual(
      transitionLayerSpec('crossfade', 0.25, registry),
    )
  })

  it('a registered definition resolves through its own layer rule', () => {
    const registry = new TransitionRegistry()
    registerCoreTransitions(registry)
    registry.register({
      id: 'custom',
      name: 'Custom',
      layerSpec: (progress) => ({ ...base, outgoingAlpha: 1 - progress }),
    })
    expect(transitionLayerSpec('custom', 0.75, registry)).toEqual({
      ...base,
      outgoingAlpha: 0.25,
    })
  })

  it('labels are the lowercased registered name; unknown types show their id', () => {
    const registry = new TransitionRegistry()
    registerCoreTransitions(registry)
    expect(transitionLabel('wipe-from-left', registry)).toBe('wipe from left')
    expect(transitionLabel('cross-zoom', registry)).toBe('cross-zoom')
    expect(transitionLabel('gone-pack-type', registry)).toBe('gone-pack-type')
  })

  it('unregisteredTransitionTypes reports unknown ids once each, known ones never', () => {
    const registry = new TransitionRegistry()
    registerCoreTransitions(registry)
    expect(
      unregisteredTransitionTypes(
        ['crossfade', 'star-wipe', 'star-wipe', 'iris-open', 'other'],
        registry,
      ),
    ).toEqual(['star-wipe', 'other'])
  })
})

describe('transitionLayerSpec', () => {
  it('crossfade dissolves: outgoing at 1 − progress, incoming added at progress', () => {
    expect(transitionLayerSpec('crossfade', 0)).toEqual({
      ...base,
      outgoingAlpha: 1,
      incomingAlpha: 0,
      additive: true,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 0.25)).toEqual({
      ...base,
      outgoingAlpha: 0.75,
      incomingAlpha: 0.25,
      additive: true,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 1)).toEqual({
      ...base,
      outgoingAlpha: 0,
      incomingAlpha: 1,
      additive: true,
      incomingBacking: false,
    })
  })

  it('crossfade layer weights always sum to 1, so covered regions blend without dimming', () => {
    // The additive blend makes the covered region exactly
    // progress·incoming + (1 − progress)·outgoing; weights summing to 1 is
    // what keeps an equal-aspect crossfade identical to the pre-#66 look
    // (no mid-fade brightness dip) at every progress.
    for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
      const spec = transitionLayerSpec('crossfade', progress)
      expect(spec.outgoingAlpha + spec.incomingAlpha).toBeCloseTo(1, 10)
    }
  })

  it('crossfade margins fade linearly to black: outgoing alpha reaches 0 exactly at the handover', () => {
    // The #66 failing case: a margin the incoming clip never covers shows
    // only outgoingAlpha·outgoing. It must decrease monotonically with
    // progress and be black (0) at progress 1, so nothing pops.
    let previous = Infinity
    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const alpha = transitionLayerSpec('crossfade', progress).outgoingAlpha
      expect(alpha).toBeLessThan(previous)
      previous = alpha
    }
    expect(transitionLayerSpec('crossfade', 1).outgoingAlpha).toBe(0)
  })

  // Each slide direction enters from its own edge: at progress 0 the incoming
  // layer sits one full frame beyond that edge (entirely outside the frame),
  // and at progress 1 it exactly covers the frame — offsets (0, 0) (#62).
  const SLIDES = [
    ['slide-from-above', { x: 0, y: -1 }],
    ['slide-from-below', { x: 0, y: 1 }],
    ['slide-from-left', { x: -1, y: 0 }],
    ['slide-from-right', { x: 1, y: 0 }],
  ] as const

  for (const [type, edge] of SLIDES) {
    it(`${type} moves both-opaque layers, the incoming one as a black-backed card (#74)`, () => {
      expect(transitionLayerSpec(type, 0)).toEqual({
        ...base,
        incomingOffsetXFraction: edge.x,
        incomingOffsetYFraction: edge.y,
      })
      expect(transitionLayerSpec(type, 0.5)).toEqual({
        ...base,
        incomingOffsetXFraction: edge.x * 0.5,
        incomingOffsetYFraction: edge.y * 0.5,
      })
      expect(transitionLayerSpec(type, 1)).toEqual(base)
    })
  }

  it('slides only ever offset along their own axis, so the card never drifts diagonally', () => {
    for (const [type] of SLIDES) {
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const spec = transitionLayerSpec(type, progress)
        expect(spec.incomingOffsetXFraction === 0 || spec.incomingOffsetYFraction === 0).toBe(true)
        expect(Math.abs(spec.incomingOffsetXFraction + spec.incomingOffsetYFraction)).toBeCloseTo(
          1 - progress,
          10,
        )
      }
    }
  })

  // Pushes (#181): the incoming card enters exactly like the matching slide
  // while the outgoing layer exits through the opposite edge in lockstep.
  const PUSHES = [
    ['push-from-left', { x: -1, y: 0 }],
    ['push-from-right', { x: 1, y: 0 }],
    ['push-from-above', { x: 0, y: -1 }],
    ['push-from-below', { x: 0, y: 1 }],
  ] as const

  for (const [type, edge] of PUSHES) {
    it(`${type} moves incoming and outgoing in lockstep (#181)`, () => {
      // Progress 0: incoming fully off its edge, outgoing at exact cover.
      expect(transitionLayerSpec(type, 0)).toEqual({
        ...base,
        incomingOffsetXFraction: edge.x,
        incomingOffsetYFraction: edge.y,
      })
      // Mid: the card's leading edge and the outgoing layer's trailing edge
      // sit on the same frame line — no gap, no overlap.
      expect(transitionLayerSpec(type, 0.5)).toEqual({
        ...base,
        incomingOffsetXFraction: edge.x * 0.5,
        incomingOffsetYFraction: edge.y * 0.5,
        outgoingOffsetXFraction: -edge.x * 0.5 + 0,
        outgoingOffsetYFraction: -edge.y * 0.5 + 0,
      })
      // Progress 1: incoming at exact cover (0, 0 — plain zeros, not -0),
      // outgoing one full frame off the opposite edge.
      expect(transitionLayerSpec(type, 1)).toEqual({
        ...base,
        outgoingOffsetXFraction: -edge.x + 0,
        outgoingOffsetYFraction: -edge.y + 0,
      })
    })
  }

  it('push edges stay adjacent at every progress: incoming − outgoing offset is one frame', () => {
    for (const [type, edge] of PUSHES) {
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const spec = transitionLayerSpec(type, progress)
        const gapX = spec.incomingOffsetXFraction - spec.outgoingOffsetXFraction
        const gapY = spec.incomingOffsetYFraction - spec.outgoingOffsetYFraction
        expect(gapX).toBeCloseTo(edge.x, 10)
        expect(gapY).toBeCloseTo(edge.y, 10)
      }
    }
  })

  // Wipes (#181): nothing moves; the static black-backed card is revealed
  // behind an edge travelling from the named side.
  const WIPES = [
    // [type, rect at progress 0.25]
    ['wipe-from-left', { x: 0, y: 0, width: 0.25, height: 1 }],
    ['wipe-from-right', { x: 0.75, y: 0, width: 0.25, height: 1 }],
    ['wipe-from-above', { x: 0, y: 0, width: 1, height: 0.25 }],
    ['wipe-from-below', { x: 0, y: 0.75, width: 1, height: 0.25 }],
  ] as const

  for (const [type, quarterRect] of WIPES) {
    it(`${type} reveals a growing band from its edge (#181)`, () => {
      // Progress 0: a zero-area reveal — none of the incoming card paints.
      const start = transitionLayerSpec(type, 0)
      expect(start.incomingClip!.width * start.incomingClip!.height).toBe(0)
      expect(start).toEqual({
        ...base,
        incomingClip: start.incomingClip,
      })
      // A quarter in, the band spans a quarter of the frame from the edge.
      expect(transitionLayerSpec(type, 0.25).incomingClip).toEqual(quarterRect)
      // Progress 1: the reveal is the whole frame — exact cover, no pop.
      expect(transitionLayerSpec(type, 1).incomingClip).toEqual({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })
    })
  }

  it('wipe reveals always hug their edge: the band grows without detaching', () => {
    for (const [type] of WIPES) {
      let previousArea = -1
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const clip = transitionLayerSpec(type, progress).incomingClip!
        // The band never leaves the frame…
        expect(clip.x).toBeGreaterThanOrEqual(0)
        expect(clip.y).toBeGreaterThanOrEqual(0)
        expect(clip.x + clip.width).toBeLessThanOrEqual(1)
        expect(clip.y + clip.height).toBeLessThanOrEqual(1)
        // …and its area grows monotonically to the full frame.
        const area = clip.width * clip.height
        expect(area).toBeGreaterThan(previousArea)
        previousArea = area
      }
    }
  })

  // Fades through a color (#181): the veil ramps to opaque at the midpoint,
  // hiding the layer swap beneath it, and back to clear by the end.
  for (const [type, color] of [
    ['fade-through-black', '#000000'],
    ['fade-through-white', '#ffffff'],
  ] as const) {
    it(`${type} dips behind a ${color} veil, opaque exactly at the midpoint (#181)`, () => {
      // Progress 0: no veil coverage, incoming hidden — the outgoing clip
      // alone, exactly as the instant before the transition. No pop.
      expect(transitionLayerSpec(type, 0)).toEqual({
        ...base,
        incomingAlpha: 0,
        veil: { color, alpha: 0 },
      })
      // First half: the veil ramps up over the outgoing clip.
      expect(transitionLayerSpec(type, 0.25)).toEqual({
        ...base,
        incomingAlpha: 0,
        veil: { color, alpha: 0.5 },
      })
      // Midpoint: fully the veil's color — the swap beneath is invisible.
      expect(transitionLayerSpec(type, 0.5).veil).toEqual({ color, alpha: 1 })
      // Second half: the incoming card is fully there, the veil ramps out.
      expect(transitionLayerSpec(type, 0.75)).toEqual({
        ...base,
        veil: { color, alpha: 0.5 },
      })
      // Progress 1: veil clear over the full incoming card. No pop.
      expect(transitionLayerSpec(type, 1)).toEqual({ ...base, veil: { color, alpha: 0 } })
    })
  }

  it('iris-open grows a centred ellipse from nothing to corner-touching cover (#181)', () => {
    expect(transitionLayerSpec('iris-open', 0)).toEqual({
      ...base,
      incomingEllipse: { radiusFraction: 0, invert: false },
    })
    expect(transitionLayerSpec('iris-open', 0.5).incomingEllipse).toEqual({
      radiusFraction: IRIS_COVER_RADIUS / 2,
      invert: false,
    })
    // Progress 1: radii √½ of each frame dimension — the ellipse
    // (x/(r·w))² + (y/(r·h))² = 1 passes exactly through the frame corners,
    // so the reveal is the whole frame. No pop at the handover.
    expect(transitionLayerSpec('iris-open', 1).incomingEllipse).toEqual({
      radiusFraction: IRIS_COVER_RADIUS,
      invert: false,
    })
    expect(IRIS_COVER_RADIUS).toBeCloseTo(Math.sqrt(0.5), 12)
  })

  it('iris-close shrinks an inverted ellipse: the outgoing clip lives in the closing hole (#181)', () => {
    // Progress 0: the hole is corner-touching cover — the incoming card
    // shows nowhere.
    expect(transitionLayerSpec('iris-close', 0)).toEqual({
      ...base,
      incomingEllipse: { radiusFraction: IRIS_COVER_RADIUS, invert: true },
    })
    expect(transitionLayerSpec('iris-close', 0.5).incomingEllipse).toEqual({
      radiusFraction: IRIS_COVER_RADIUS / 2,
      invert: true,
    })
    // Progress 1: a zero hole — the incoming card is the whole frame.
    expect(transitionLayerSpec('iris-close', 1)).toEqual({
      ...base,
      incomingEllipse: { radiusFraction: 0, invert: true },
    })
  })

  it('iris radii shrink or grow monotonically, so the edge never reverses', () => {
    for (const [type, sign] of [
      ['iris-open', 1],
      ['iris-close', -1],
    ] as const) {
      let previous = sign === 1 ? -1 : Infinity
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const radius = transitionLayerSpec(type, progress).incomingEllipse!.radiusFraction
        if (sign === 1) expect(radius).toBeGreaterThan(previous)
        else expect(radius).toBeLessThan(previous)
        previous = radius
      }
    }
  })

  it('cross-zoom scales out of one clip into the other, blending around the midpoint (#181)', () => {
    // Progress 0: both scales at rest, incoming invisible — exactly the
    // outgoing clip as the instant before. No pop.
    expect(transitionLayerSpec('cross-zoom', 0)).toEqual({
      ...base,
      incomingAlpha: 0,
      incomingScale: CROSS_ZOOM_PEAK,
    })
    // Midpoint: both layers at peak magnification, half blended (the alpha
    // ramp (progress − 0.4) / 0.2 carries float noise, hence closeTo).
    const mid = transitionLayerSpec('cross-zoom', 0.5)
    expect(mid.incomingAlpha).toBeCloseTo(0.5, 10)
    expect({ ...mid, incomingAlpha: 0.5 }).toEqual({
      ...base,
      incomingAlpha: 0.5,
      outgoingScale: CROSS_ZOOM_PEAK,
      incomingScale: CROSS_ZOOM_PEAK,
    })
    // Progress 1: the incoming clip fully shown at rest. No pop.
    expect(transitionLayerSpec('cross-zoom', 1)).toEqual({
      ...base,
      outgoingScale: CROSS_ZOOM_PEAK,
    })
  })

  it('cross-zoom never de-magnifies and fully blends in before the handover', () => {
    let previousOut = 0
    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const spec = transitionLayerSpec('cross-zoom', progress)
      // Scales stay ≥ 1: a layer is only ever magnified, so the export's
      // unclipped outgoing draw can never reveal content beyond the frame.
      expect(spec.outgoingScale).toBeGreaterThanOrEqual(1)
      expect(spec.incomingScale).toBeGreaterThanOrEqual(1)
      // The outgoing zoom accelerates monotonically until it saturates.
      expect(spec.outgoingScale).toBeGreaterThanOrEqual(previousOut)
      previousOut = spec.outgoingScale
    }
    expect(transitionLayerSpec('cross-zoom', 0.39).incomingAlpha).toBe(0)
    expect(transitionLayerSpec('cross-zoom', 0.61).incomingAlpha).toBe(1)
    // The backed incoming card is opaque from 0.6 on, so the scaled outgoing
    // layer beneath is fully covered well before the handover.
    expect(transitionLayerSpec('cross-zoom', 0.6).incomingAlpha).toBeCloseTo(1, 10)
  })
})
