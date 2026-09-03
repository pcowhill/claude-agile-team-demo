import { describe, expect, it } from 'vitest'
import {
  CANVAS_PRESETS,
  canvasFrameSize,
  FALLBACK_FRAME,
  frameAspect,
  isCanvasPreset,
  outputFrameSize,
  presetFrame,
} from './frameSize'
import type { CanvasPreset } from './frameSize'

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

// The project's canvas preset (#273): a fixed output-frame aspect. These pin
// the two properties the rule is built on — the aspect is exact, and the
// frame contains the source-derived one so nothing is ever downscaled — plus
// the absent-as-default behavior that keeps Auto byte-identical.
describe('canvas presets (#273)', () => {
  const ratios: Record<CanvasPreset, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:5': 4 / 5,
  }
  const sources = [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 640, height: 360 },
    { width: 1000, height: 1000 },
    { width: 1234, height: 567 },
  ]

  it('offers exactly the four presets the issue names, each a reduced ratio', () => {
    expect(CANVAS_PRESETS.map(({ id }) => id)).toEqual(['16:9', '9:16', '1:1', '4:5'])
    for (const preset of CANVAS_PRESETS) {
      expect(preset.ratioWidth / preset.ratioHeight).toBeCloseTo(ratios[preset.id], 10)
      expect(Number.isInteger(preset.ratioWidth)).toBe(true)
      expect(Number.isInteger(preset.ratioHeight)).toBe(true)
    }
  })

  it('recognizes only those identifiers', () => {
    for (const { id } of CANVAS_PRESETS) expect(isCanvasPreset(id)).toBe(true)
    // 'auto' is deliberately not an identifier: Auto is the absent key.
    for (const value of ['auto', '3:2', '', '16:10', null, undefined, 0, {}]) {
      expect(isCanvasPreset(value)).toBe(false)
    }
  })

  it('yields exactly the preset aspect, in whole pixels, for every source', () => {
    for (const source of sources) {
      for (const { id } of CANVAS_PRESETS) {
        const frame = presetFrame(source, id)
        expect(Number.isInteger(frame.width)).toBe(true)
        expect(Number.isInteger(frame.height)).toBe(true)
        // Exact as a ratio, not merely close: the frame is an integer
        // multiple of the reduced ratio, so this is an equality of integers.
        const option = CANVAS_PRESETS.find((preset) => preset.id === id)!
        expect(frame.width * option.ratioHeight).toBe(frame.height * option.ratioWidth)
      }
    }
  })

  it('contains the source-derived frame, so no source is downscaled', () => {
    for (const source of sources) {
      for (const { id } of CANVAS_PRESETS) {
        const frame = presetFrame(source, id)
        expect(frame.width).toBeGreaterThanOrEqual(source.width)
        expect(frame.height).toBeGreaterThanOrEqual(source.height)
      }
    }
  })

  it('is the smallest such frame — one ratio step smaller no longer contains', () => {
    for (const source of sources) {
      for (const option of CANVAS_PRESETS) {
        const frame = presetFrame(source, option.id)
        const smaller = {
          width: frame.width - option.ratioWidth,
          height: frame.height - option.ratioHeight,
        }
        expect(
          smaller.width < source.width || smaller.height < source.height,
          `${option.id} of ${source.width}×${source.height} was not minimal`,
        ).toBe(true)
      }
    }
  })

  it('leaves a source already at the preset aspect exactly as it is', () => {
    // Choosing the aspect a project already has must not resize anything.
    expect(presetFrame({ width: 1920, height: 1080 }, '16:9')).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(presetFrame({ width: 1080, height: 1920 }, '9:16')).toEqual({
      width: 1080,
      height: 1920,
    })
    expect(presetFrame({ width: 720, height: 720 }, '1:1')).toEqual({ width: 720, height: 720 })
    expect(presetFrame({ width: 1080, height: 1350 }, '4:5')).toEqual({
      width: 1080,
      height: 1350,
    })
  })

  it('reshapes a landscape source into a portrait frame by growing the height', () => {
    // The customer's case: a landscape screen recording in a vertical
    // project. The width is kept (never downscaled) and the frame grows
    // taller, which is the letterboxing background fill (#259) treats.
    const frame = presetFrame({ width: 1920, height: 1080 }, '9:16')
    expect(frame.width).toBeGreaterThanOrEqual(1920)
    expect(frameAspect(frame)).toBeCloseTo(9 / 16, 10)
    expect(frame.height).toBeGreaterThan(frame.width)
  })

  it('composes with the source rule, and Auto is that rule untouched', () => {
    const derived = canvasFrameSize(sources)
    expect(derived).toEqual(outputFrameSize(sources))
    // Absent preset means Auto — the same object shape, no reshaping.
    expect(canvasFrameSize(sources, undefined)).toEqual(outputFrameSize(sources))
    for (const { id } of CANVAS_PRESETS) {
      expect(canvasFrameSize(sources, id)).toEqual(presetFrame(derived, id))
    }
  })

  it('fits the fallback frame to the preset when no source is usable', () => {
    // An all-slate timeline, or nothing probed yet: the historical fallback
    // goes through the same reshaping rather than escaping the preset.
    for (const { id } of CANVAS_PRESETS) {
      expect(canvasFrameSize([], id)).toEqual(presetFrame(FALLBACK_FRAME, id))
      expect(canvasFrameSize([{ width: 0, height: 0 }], id)).toEqual(
        presetFrame(FALLBACK_FRAME, id),
      )
    }
    expect(canvasFrameSize([])).toEqual(FALLBACK_FRAME)
  })

  it('handles a degenerate one-pixel source without collapsing the frame', () => {
    for (const option of CANVAS_PRESETS) {
      const frame = presetFrame({ width: 1, height: 1 }, option.id)
      expect(frame).toEqual({ width: option.ratioWidth, height: option.ratioHeight })
      expect(frame.width).toBeGreaterThan(0)
      expect(frame.height).toBeGreaterThan(0)
    }
  })
})
