import { describe, expect, it } from 'vitest'
import { transitionLayerSpec } from './transitionRender'

describe('transitionLayerSpec', () => {
  it('crossfade dissolves: outgoing at 1 − progress, incoming added at progress', () => {
    expect(transitionLayerSpec('crossfade', 0)).toEqual({
      outgoingAlpha: 1,
      incomingAlpha: 0,
      additive: true,
      incomingOffsetYFraction: 0,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 0.25)).toEqual({
      outgoingAlpha: 0.75,
      incomingAlpha: 0.25,
      additive: true,
      incomingOffsetYFraction: 0,
      incomingBacking: false,
    })
    expect(transitionLayerSpec('crossfade', 1)).toEqual({
      outgoingAlpha: 0,
      incomingAlpha: 1,
      additive: true,
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

  it('slide-from-above moves both-opaque layers, the incoming one as a black-backed card (#74)', () => {
    expect(transitionLayerSpec('slide-from-above', 0)).toEqual({
      outgoingAlpha: 1,
      incomingAlpha: 1,
      additive: false,
      incomingOffsetYFraction: -1,
      incomingBacking: true,
    })
    expect(transitionLayerSpec('slide-from-above', 0.5)).toEqual({
      outgoingAlpha: 1,
      incomingAlpha: 1,
      additive: false,
      incomingOffsetYFraction: -0.5,
      incomingBacking: true,
    })
    expect(transitionLayerSpec('slide-from-above', 1)).toEqual({
      outgoingAlpha: 1,
      incomingAlpha: 1,
      additive: false,
      incomingOffsetYFraction: 0,
      incomingBacking: true,
    })
  })
})
