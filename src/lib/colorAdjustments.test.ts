import { describe, expect, it } from 'vitest'
import {
  colorAdjustmentsEqual,
  colorFilterFor,
  isValidColorAdjustments,
  normalizeColorAdjustments,
} from './colorAdjustments'

describe('normalizeColorAdjustments (#192)', () => {
  it('returns undefined for the identity set, however it is spelled', () => {
    expect(normalizeColorAdjustments({})).toBeUndefined()
    expect(
      normalizeColorAdjustments({ brightness: 100, contrast: 100, saturation: 100 }),
    ).toBeUndefined()
  })

  it('drops identity fields and keeps non-identity ones', () => {
    expect(normalizeColorAdjustments({ brightness: 150, contrast: 100, saturation: 100 })).toEqual({
      brightness: 150,
    })
    expect(
      normalizeColorAdjustments({ brightness: 100, contrast: 80, look: 'sepia' }),
    ).toEqual({ contrast: 80, look: 'sepia' })
  })

  it('clamps the dials into 0–200, and a clamp landing on identity drops the field', () => {
    expect(normalizeColorAdjustments({ brightness: 250, contrast: -10 })).toEqual({
      brightness: 200,
      contrast: 0,
    })
    // No dial value can clamp to 100 from outside the range, but the clamp
    // and the identity drop compose: an in-range 100 still normalizes away.
    expect(normalizeColorAdjustments({ saturation: 100, look: 'grayscale' })).toEqual({
      look: 'grayscale',
    })
  })
})

describe('isValidColorAdjustments (#192)', () => {
  it('accepts absent fields, finite dials, and known looks', () => {
    expect(isValidColorAdjustments({})).toBe(true)
    expect(isValidColorAdjustments({ brightness: 0, contrast: 200, saturation: 55 })).toBe(true)
    expect(isValidColorAdjustments({ look: 'grayscale' })).toBe(true)
    expect(isValidColorAdjustments({ look: 'sepia' })).toBe(true)
  })

  it('rejects non-finite dials and unknown looks', () => {
    expect(isValidColorAdjustments({ brightness: Number.NaN })).toBe(false)
    expect(isValidColorAdjustments({ contrast: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidColorAdjustments({ look: 'blur' as never })).toBe(false)
  })
})

describe('colorFilterFor (#192)', () => {
  it("is 'none' for absent or identity adjustments — what CSS and canvas treat as no filtering", () => {
    expect(colorFilterFor(undefined)).toBe('none')
    expect(colorFilterFor({})).toBe('none')
    expect(colorFilterFor({ brightness: 100, contrast: 100, saturation: 100 })).toBe('none')
  })

  it('emits the canonical order — brightness, contrast, saturate, look — with percent arguments', () => {
    expect(
      colorFilterFor({ look: 'sepia', saturation: 50, contrast: 120, brightness: 80 }),
    ).toBe('brightness(80%) contrast(120%) saturate(50%) sepia(100%)')
  })

  it('emits only the non-identity parts', () => {
    expect(colorFilterFor({ brightness: 150 })).toBe('brightness(150%)')
    expect(colorFilterFor({ look: 'grayscale' })).toBe('grayscale(100%)')
    expect(colorFilterFor({ saturation: 0 })).toBe('saturate(0%)')
  })
})

describe('colorAdjustmentsEqual (#192)', () => {
  it('compares field by field, treating both-absent as equal', () => {
    expect(colorAdjustmentsEqual(undefined, undefined)).toBe(true)
    expect(colorAdjustmentsEqual({ brightness: 150 }, { brightness: 150 })).toBe(true)
    expect(colorAdjustmentsEqual({ brightness: 150 }, { brightness: 151 })).toBe(false)
    expect(colorAdjustmentsEqual({ look: 'sepia' }, { look: 'grayscale' })).toBe(false)
    expect(colorAdjustmentsEqual(undefined, { brightness: 150 })).toBe(false)
  })
})
