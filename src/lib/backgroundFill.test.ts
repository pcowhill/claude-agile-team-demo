import { describe, expect, it } from 'vitest'
import {
  BACKDROP_BLUR_FRACTION,
  backdropBlurRadius,
  backdropRect,
  backgroundFillsEqual,
  coverRect,
  isValidBackgroundFillInput,
  normalizeBackgroundFill,
} from './backgroundFill'

describe('background fill model (#259)', () => {
  it('accepts the known kinds and a storable color', () => {
    expect(isValidBackgroundFillInput({ kind: 'none' })).toBe(true)
    expect(isValidBackgroundFillInput({ kind: 'blur' })).toBe(true)
    expect(isValidBackgroundFillInput({ kind: 'color', color: '#1a2b3c' })).toBe(true)
  })

  it('refuses unknown kinds and malformed colors rather than coercing', () => {
    expect(
      isValidBackgroundFillInput({ kind: 'gradient' } as never),
    ).toBe(false)
    expect(isValidBackgroundFillInput({ kind: 'color', color: '#ABCDEF' })).toBe(false)
    expect(isValidBackgroundFillInput({ kind: 'color', color: 'red' })).toBe(false)
    expect(isValidBackgroundFillInput({ kind: 'color', color: '#abc' })).toBe(false)
  })

  it('normalizes none to undefined — the stored key is absence', () => {
    expect(normalizeBackgroundFill({ kind: 'none' })).toBeUndefined()
  })

  it('normalizes stored kinds to exactly their own fields', () => {
    expect(normalizeBackgroundFill({ kind: 'blur' })).toEqual({ kind: 'blur' })
    expect(normalizeBackgroundFill({ kind: 'color', color: '#0044ff' })).toEqual({
      kind: 'color',
      color: '#0044ff',
    })
    // A foreign extra field never survives normalization.
    expect(
      normalizeBackgroundFill({ kind: 'blur', stray: true } as never),
    ).toEqual({ kind: 'blur' })
  })

  it('compares fills structurally, absence included', () => {
    expect(backgroundFillsEqual(undefined, undefined)).toBe(true)
    expect(backgroundFillsEqual({ kind: 'blur' }, { kind: 'blur' })).toBe(true)
    expect(backgroundFillsEqual({ kind: 'blur' }, undefined)).toBe(false)
    expect(backgroundFillsEqual({ kind: 'blur' }, { kind: 'color', color: '#000000' })).toBe(false)
    expect(
      backgroundFillsEqual({ kind: 'color', color: '#000000' }, { kind: 'color', color: '#000000' }),
    ).toBe(true)
    expect(
      backgroundFillsEqual({ kind: 'color', color: '#000000' }, { kind: 'color', color: '#000001' }),
    ).toBe(false)
  })
})

describe('coverRect (#259)', () => {
  it('a portrait source covers a landscape frame by width, overflowing vertically', () => {
    // 90×160 content into a 320×180 frame: scale = max(320/90, 180/160).
    const rect = coverRect({ width: 90, height: 160 }, { width: 320, height: 180 })
    expect(rect.width).toBeCloseTo(320)
    expect(rect.height).toBeCloseTo((160 / 90) * 320)
    expect(rect.x).toBeCloseTo(0)
    // Centered: the vertical overflow splits evenly.
    expect(rect.y).toBeCloseTo((180 - (160 / 90) * 320) / 2)
    expect(rect.y).toBeLessThan(0)
  })

  it('a landscape source covers a portrait frame by height, overflowing horizontally', () => {
    const rect = coverRect({ width: 320, height: 180 }, { width: 180, height: 320 })
    expect(rect.height).toBeCloseTo(320)
    expect(rect.width).toBeCloseTo((320 / 180) * 320)
    expect(rect.y).toBeCloseTo(0)
    expect(rect.x).toBeCloseTo((180 - (320 / 180) * 320) / 2)
    expect(rect.x).toBeLessThan(0)
  })

  it('a matching aspect covers the frame exactly — no overflow', () => {
    expect(coverRect({ width: 1280, height: 720 }, { width: 320, height: 180 })).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
  })

  it('the composed cropped/oriented shape is what covers: a kept half-width region', () => {
    // A 320×180 source cropped to its left half presents 160×180 (#255);
    // covering the 320×180 frame scales it 2× and overflows vertically.
    const rect = coverRect({ width: 160, height: 180 }, { width: 320, height: 180 })
    expect(rect.width).toBeCloseTo(320)
    expect(rect.height).toBeCloseTo(360)
    expect(rect.y).toBeCloseTo(-90)
  })

  it('a quarter-turned shape covers as its transposed dimensions', () => {
    // 320×180 turned 90° presents 180×320 (#232) — portrait-in-landscape.
    const rect = coverRect({ width: 180, height: 320 }, { width: 320, height: 180 })
    expect(rect.width).toBeCloseTo(320)
    expect(rect.height).toBeCloseTo((320 / 180) * 320)
  })

  it('degenerate content covers the frame 1:1 instead of dividing by zero', () => {
    expect(coverRect({ width: 0, height: 180 }, { width: 320, height: 180 })).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
  })
})

describe('backdropRect (#259)', () => {
  it('is the cover fit inflated around its centre by twice the blur fraction', () => {
    const content = { width: 1280, height: 720 }
    const frame = { width: 320, height: 180 }
    const base = coverRect(content, frame)
    const rect = backdropRect(content, frame)
    expect(rect.width).toBeCloseTo(base.width * (1 + 2 * BACKDROP_BLUR_FRACTION))
    expect(rect.height).toBeCloseTo(base.height * (1 + 2 * BACKDROP_BLUR_FRACTION))
    // Centre preserved: the inflation splits evenly on both sides.
    expect(rect.x + rect.width / 2).toBeCloseTo(base.x + base.width / 2)
    expect(rect.y + rect.height / 2).toBeCloseTo(base.y + base.height / 2)
    // The drawn picture always extends past every frame edge, so the blur
    // never samples past the picture into nothing at the border.
    expect(rect.x).toBeLessThan(0)
    expect(rect.y).toBeLessThan(0)
    expect(rect.x + rect.width).toBeGreaterThan(frame.width)
    expect(rect.y + rect.height).toBeGreaterThan(frame.height)
  })
})

describe('backdropBlurRadius (#259)', () => {
  it('is the fixed fraction of the frame shorter side, resolution-independent', () => {
    expect(backdropBlurRadius({ width: 1920, height: 1080 })).toBeCloseTo(
      1080 * BACKDROP_BLUR_FRACTION,
    )
    expect(backdropBlurRadius({ width: 180, height: 320 })).toBeCloseTo(
      180 * BACKDROP_BLUR_FRACTION,
    )
    // The same fraction at any buffer size: preview buffer and export frame agree.
    const preview = backdropBlurRadius({ width: 160, height: 90 })
    const exportFrame = backdropBlurRadius({ width: 1600, height: 900 })
    expect(exportFrame / preview).toBeCloseTo(10)
  })
})
