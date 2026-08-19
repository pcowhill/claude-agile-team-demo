import { describe, expect, it } from 'vitest'
import { transitionLayerSpec } from './transitionRender'

describe('transitionLayerSpec', () => {
  it('crossfade dissolves: outgoing at 1 − progress, incoming added at progress', () => {
    expect(transitionLayerSpec('crossfade', 0)).toEqual({
      outgoingAlpha: 1,
      incomingAlpha: 0,
      additive: true,
      incomingOffsetXFraction: 0,
      incomingOffsetYFraction: 0,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 0.25)).toEqual({
      outgoingAlpha: 0.75,
      incomingAlpha: 0.25,
      additive: true,
      incomingOffsetXFraction: 0,
      incomingOffsetYFraction: 0,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 1)).toEqual({
      outgoingAlpha: 0,
      incomingAlpha: 1,
      additive: true,
      incomingOffsetXFraction: 0,
      incomingOffsetYFraction: 0,
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
        outgoingAlpha: 1,
        incomingAlpha: 1,
        additive: false,
        incomingOffsetXFraction: edge.x,
        incomingOffsetYFraction: edge.y,
        incomingBacking: true,
      })
      expect(transitionLayerSpec(type, 0.5)).toEqual({
        outgoingAlpha: 1,
        incomingAlpha: 1,
        additive: false,
        incomingOffsetXFraction: edge.x * 0.5,
        incomingOffsetYFraction: edge.y * 0.5,
        incomingBacking: true,
      })
      expect(transitionLayerSpec(type, 1)).toEqual({
        outgoingAlpha: 1,
        incomingAlpha: 1,
        additive: false,
        incomingOffsetXFraction: 0,
        incomingOffsetYFraction: 0,
        incomingBacking: true,
      })
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
})
