import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUNDED_RADIUS,
  MAX_ROUNDED_RADIUS,
  inscribedEllipse,
  isValidShapeMaskInput,
  maskClipPath,
  normalizeShapeMask,
  roundedCornerRadius,
  shapeMasksEqual,
} from './shapeMask'

describe('shape mask model (#266)', () => {
  it('accepts the known kinds and a finite rounded radius', () => {
    expect(isValidShapeMaskInput({ kind: 'rectangle' })).toBe(true)
    expect(isValidShapeMaskInput({ kind: 'ellipse' })).toBe(true)
    expect(isValidShapeMaskInput({ kind: 'rounded', radius: 0.2 })).toBe(true)
  })

  it('refuses unknown kinds and non-finite radii rather than coercing', () => {
    expect(isValidShapeMaskInput({ kind: 'star' } as never)).toBe(false)
    expect(isValidShapeMaskInput({ kind: 'rounded', radius: Number.NaN })).toBe(false)
    expect(isValidShapeMaskInput({ kind: 'rounded', radius: Infinity })).toBe(false)
  })

  it('normalizes rectangle to undefined — the stored key is absence', () => {
    expect(normalizeShapeMask({ kind: 'rectangle' })).toBeUndefined()
  })

  it('normalizes stored kinds to exactly their own fields, radius clamped', () => {
    expect(normalizeShapeMask({ kind: 'ellipse' })).toEqual({ kind: 'ellipse' })
    expect(normalizeShapeMask({ kind: 'rounded', radius: 0.25 })).toEqual({
      kind: 'rounded',
      radius: 0.25,
    })
    // Over half the shorter side clamps to the capsule maximum.
    expect(normalizeShapeMask({ kind: 'rounded', radius: 3 })).toEqual({
      kind: 'rounded',
      radius: MAX_ROUNDED_RADIUS,
    })
    // A zero (or negative) radius IS the rectangle: stored as absence, so
    // the same visible outline is never stored two ways.
    expect(normalizeShapeMask({ kind: 'rounded', radius: 0 })).toBeUndefined()
    expect(normalizeShapeMask({ kind: 'rounded', radius: -1 })).toBeUndefined()
    // A foreign extra field never survives normalization.
    expect(normalizeShapeMask({ kind: 'ellipse', stray: true } as never)).toEqual({
      kind: 'ellipse',
    })
  })

  it('compares masks structurally, absence included', () => {
    expect(shapeMasksEqual(undefined, undefined)).toBe(true)
    expect(shapeMasksEqual({ kind: 'ellipse' }, { kind: 'ellipse' })).toBe(true)
    expect(shapeMasksEqual({ kind: 'ellipse' }, undefined)).toBe(false)
    expect(shapeMasksEqual({ kind: 'ellipse' }, { kind: 'rounded', radius: 0.2 })).toBe(false)
    expect(
      shapeMasksEqual({ kind: 'rounded', radius: 0.2 }, { kind: 'rounded', radius: 0.2 }),
    ).toBe(true)
    expect(
      shapeMasksEqual({ kind: 'rounded', radius: 0.2 }, { kind: 'rounded', radius: 0.3 }),
    ).toBe(false)
  })

  it('starts a fresh rounded mask at a storable default', () => {
    expect(normalizeShapeMask({ kind: 'rounded', radius: DEFAULT_ROUNDED_RADIUS })).toEqual({
      kind: 'rounded',
      radius: DEFAULT_ROUNDED_RADIUS,
    })
  })
})

describe('inscribedEllipse (#266)', () => {
  it('centres in a landscape rectangle with half-side radii', () => {
    expect(inscribedEllipse({ x: 40, y: 20, width: 160, height: 90 })).toEqual({
      cx: 120,
      cy: 65,
      rx: 80,
      ry: 45,
    })
  })

  it('centres in a portrait rectangle', () => {
    expect(inscribedEllipse({ x: 0, y: 0, width: 90, height: 160 })).toEqual({
      cx: 45,
      cy: 80,
      rx: 45,
      ry: 80,
    })
  })

  it('is a circle exactly when the rectangle is square', () => {
    const ellipse = inscribedEllipse({ x: 10, y: 10, width: 100, height: 100 })
    expect(ellipse.rx).toBe(ellipse.ry)
    expect(ellipse).toEqual({ cx: 60, cy: 60, rx: 50, ry: 50 })
  })
})

describe('roundedCornerRadius (#266)', () => {
  it('is the fraction of the SHORTER side, so corners stay circular at any aspect', () => {
    expect(roundedCornerRadius({ width: 160, height: 90 }, 0.2)).toBeCloseTo(18)
    expect(roundedCornerRadius({ width: 90, height: 160 }, 0.2)).toBeCloseTo(18)
    expect(roundedCornerRadius({ width: 100, height: 100 }, 0.5)).toBeCloseTo(50)
  })

  it('scales with the rectangle — resolution-independent', () => {
    const small = roundedCornerRadius({ width: 32, height: 18 }, 0.25)
    const large = roundedCornerRadius({ width: 320, height: 180 }, 0.25)
    expect(large / small).toBeCloseTo(10)
  })
})

describe('maskClipPath (#266)', () => {
  const rect = { width: 0.4, height: 0.3 }

  it('an absent mask styles nothing at all — the identity', () => {
    expect(maskClipPath(undefined, rect)).toBeUndefined()
  })

  it('an ellipse inscribes in the card box as percentages', () => {
    expect(maskClipPath({ kind: 'ellipse' }, rect)).toBe('ellipse(50% 50% at 50% 50%)')
  })

  it('a rounded mask rounds by the shorter side in frame-container units', () => {
    // 0.25 of the shorter card side: the card is 0.4 frame-widths by 0.3
    // frame-heights, so the CSS min() of 0.25·40cqw and 0.25·30cqh
    // evaluates roundedCornerRadius at the frame's rendered size.
    expect(maskClipPath({ kind: 'rounded', radius: 0.25 }, rect)).toBe(
      'inset(0 round min(10cqw, 7.5cqh))',
    )
  })
})
