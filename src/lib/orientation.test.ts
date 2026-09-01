import { describe, expect, it } from 'vitest'
import {
  isValidOrientation,
  normalizeOrientation,
  orientationsEqual,
  orientationSwapsDimensions,
  orientationTransform,
  orientedDimensions,
} from './orientation'
import type { Orientation } from './orientation'

describe('isValidOrientation (#232)', () => {
  it('accepts the quarter turns, flips, and absence', () => {
    expect(isValidOrientation({})).toBe(true)
    expect(isValidOrientation({ rotation: 90 })).toBe(true)
    expect(isValidOrientation({ rotation: 180, flipH: true })).toBe(true)
    expect(isValidOrientation({ rotation: 270, flipV: true })).toBe(true)
    expect(isValidOrientation({ flipH: false, flipV: true })).toBe(true)
  })

  it('refuses non-quarter rotations and non-boolean flips', () => {
    expect(isValidOrientation({ rotation: 45 as never })).toBe(false)
    expect(isValidOrientation({ rotation: 0 as never })).toBe(false)
    expect(isValidOrientation({ rotation: Number.NaN as never })).toBe(false)
    expect(isValidOrientation({ flipH: 'yes' as never })).toBe(false)
    expect(isValidOrientation({ flipV: 1 as never })).toBe(false)
  })
})

describe('normalizeOrientation', () => {
  it('normalizes the identity to undefined — the stored no-key form', () => {
    expect(normalizeOrientation({})).toBeUndefined()
    expect(normalizeOrientation({ flipH: false, flipV: false })).toBeUndefined()
  })

  it('keeps only non-identity fields, false flips dropped', () => {
    expect(normalizeOrientation({ rotation: 90, flipH: false })).toEqual({ rotation: 90 })
    expect(normalizeOrientation({ flipV: true })).toEqual({ flipV: true })
    expect(normalizeOrientation({ rotation: 270, flipH: true, flipV: true })).toEqual({
      rotation: 270,
      flipH: true,
      flipV: true,
    })
  })
})

describe('orientationsEqual', () => {
  it('compares stored forms structurally, absent as identity fields', () => {
    expect(orientationsEqual(undefined, undefined)).toBe(true)
    expect(orientationsEqual({ rotation: 90 }, { rotation: 90 })).toBe(true)
    expect(orientationsEqual({ rotation: 90 }, { rotation: 180 })).toBe(false)
    expect(orientationsEqual({ flipH: true }, undefined)).toBe(false)
    expect(orientationsEqual({ rotation: 90, flipV: true }, { rotation: 90 })).toBe(false)
  })
})

describe('orientedDimensions', () => {
  const source = { width: 640, height: 360 }

  it('swaps width and height for the quarter turns', () => {
    expect(orientedDimensions(source, { rotation: 90 })).toEqual({ width: 360, height: 640 })
    expect(orientedDimensions(source, { rotation: 270, flipH: true })).toEqual({
      width: 360,
      height: 640,
    })
    expect(orientationSwapsDimensions({ rotation: 90 })).toBe(true)
    expect(orientationSwapsDimensions({ rotation: 270 })).toBe(true)
  })

  it('returns the same object for shape-preserving orientations', () => {
    expect(orientedDimensions(source, undefined)).toBe(source)
    expect(orientedDimensions(source, { rotation: 180 })).toBe(source)
    expect(orientedDimensions(source, { flipH: true, flipV: true })).toBe(source)
    expect(orientationSwapsDimensions({ rotation: 180 })).toBe(false)
    expect(orientationSwapsDimensions(undefined)).toBe(false)
  })
})

describe('orientationTransform', () => {
  it('is the identity for no orientation', () => {
    expect(orientationTransform(undefined)).toEqual({ rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('maps each field to its transform piece, flips as negative scales', () => {
    expect(orientationTransform({ rotation: 90 })).toEqual({ rotation: 90, scaleX: 1, scaleY: 1 })
    expect(orientationTransform({ flipH: true })).toEqual({ rotation: 0, scaleX: -1, scaleY: 1 })
    expect(orientationTransform({ flipV: true })).toEqual({ rotation: 0, scaleX: 1, scaleY: -1 })
    const combined: Orientation = { rotation: 270, flipH: true, flipV: true }
    expect(orientationTransform(combined)).toEqual({ rotation: 270, scaleX: -1, scaleY: -1 })
  })
})
