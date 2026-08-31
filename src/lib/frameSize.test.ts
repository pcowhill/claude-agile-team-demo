import { describe, expect, it } from 'vitest'
import { FALLBACK_FRAME, frameAspect, outputFrameSize } from './frameSize'

describe('outputFrameSize', () => {
  it('returns the single source dimensions unchanged', () => {
    expect(outputFrameSize([{ width: 1280, height: 720 }])).toEqual({ width: 1280, height: 720 })
  })

  it('takes the largest width and height independently across sources', () => {
    // A wide clip and a tall clip: the frame must hold both without
    // downscaling either — 1920 wide from the first, 1080 tall from the
    // second, even though no single source is 1920×1080.
    expect(
      outputFrameSize([
        { width: 1920, height: 810 },
        { width: 608, height: 1080 },
      ]),
    ).toEqual({ width: 1920, height: 1080 })
  })

  it('falls back to the historical export default when no source is given', () => {
    expect(outputFrameSize([])).toEqual({ width: 640, height: 360 })
    expect(outputFrameSize([])).toEqual(FALLBACK_FRAME)
  })

  it('ignores sources reporting a zero dimension', () => {
    // An element whose metadata never arrived reports 0×0 — it must not
    // zero out the frame or survive as a degenerate axis.
    expect(
      outputFrameSize([
        { width: 0, height: 0 },
        { width: 320, height: 0 },
        { width: 320, height: 180 },
      ]),
    ).toEqual({ width: 320, height: 180 })
  })

  it('falls back when every source is degenerate', () => {
    expect(outputFrameSize([{ width: 0, height: 240 }])).toEqual(FALLBACK_FRAME)
  })

  it('returns a copy of the fallback, never the shared object', () => {
    const frame = outputFrameSize([])
    frame.width = 1
    expect(FALLBACK_FRAME.width).toBe(640)
  })
})

describe('frameAspect', () => {
  it('is width over height', () => {
    expect(frameAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9)
    expect(frameAspect({ width: 320, height: 320 })).toBe(1)
  })
})
