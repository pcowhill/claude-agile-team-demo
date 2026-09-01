import { describe, expect, it } from 'vitest'
import {
  GIF_FRAME_DELAY_MS,
  GIF_FRAME_RATE,
  GIF_MAX_DIMENSION,
  gifOutputSize,
  nextGifSampleAt,
} from './gifSink'

describe('gifOutputSize (#198)', () => {
  it('never scales up: frames within the cap keep their exact size', () => {
    expect(gifOutputSize(320, 180)).toEqual({ width: 320, height: 180 })
    expect(gifOutputSize(GIF_MAX_DIMENSION, 270)).toEqual({
      width: GIF_MAX_DIMENSION,
      height: 270,
    })
  })

  it('caps the longer side and scales the other proportionally, rounded', () => {
    // 1920×1080 → longer side 1920 capped to 480 → 480×270 exactly.
    expect(gifOutputSize(1920, 1080)).toEqual({ width: 480, height: 270 })
    // Portrait: the height is the longer side.
    expect(gifOutputSize(1080, 1920)).toEqual({ width: 270, height: 480 })
    // Non-integer scaling rounds: 1280×720 → 480×270.
    expect(gifOutputSize(1280, 720)).toEqual({ width: 480, height: 270 })
  })

  it('honors a custom cap and never collapses a dimension below 1 px', () => {
    expect(gifOutputSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 })
    // An extreme aspect ratio keeps a visible sliver rather than 0 px.
    expect(gifOutputSize(10000, 10, 480).height).toBe(1)
  })
})

describe('nextGifSampleAt (#198)', () => {
  it('advances to the next tick of the fixed grid', () => {
    expect(nextGifSampleAt(0)).toBeCloseTo(1 / GIF_FRAME_RATE, 10)
    expect(nextGifSampleAt(0.1)).toBeCloseTo(0.2, 10)
  })

  it('anchors to the grid, so real-time jitter never drifts the clock', () => {
    // A frame kept slightly late still schedules the next one on the grid.
    expect(nextGifSampleAt(0.1004)).toBeCloseTo(0.2, 10)
    expect(nextGifSampleAt(0.1996)).toBeCloseTo(0.2, 10)
  })
})

describe('GIF timing constants (#198)', () => {
  it('the delay is exact centiseconds — GIF stores delays in cs, so 10 fps loses nothing', () => {
    expect(GIF_FRAME_DELAY_MS).toBe(100)
    expect((GIF_FRAME_DELAY_MS / 10) % 1).toBe(0)
  })
})
