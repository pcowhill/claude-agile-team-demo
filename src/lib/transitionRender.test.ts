import { describe, expect, it } from 'vitest'
import { transitionLayerSpec } from './transitionRender'
import type { TransitionLayerSpec } from './transitionRender'

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
}

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
})
