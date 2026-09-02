import { describe, expect, it } from 'vitest'
import {
  croppedDimensions,
  cropMediaPlacement,
  cropSourceRect,
  cropsEqual,
  isValidCrop,
  keptFractions,
  MIN_KEPT_FRACTION,
  normalizeCrop,
} from './crop'
import { orientedDimensions } from './orientation'

describe('isValidCrop (#255)', () => {
  it('accepts empty, partial, and full edge sets', () => {
    expect(isValidCrop({})).toBe(true)
    expect(isValidCrop({ left: 0.25 })).toBe(true)
    expect(isValidCrop({ left: 0, right: 0.5, top: 0.1, bottom: 0.2 })).toBe(true)
  })

  it('refuses non-finite edges', () => {
    expect(isValidCrop({ left: Number.NaN })).toBe(false)
    expect(isValidCrop({ top: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidCrop({ bottom: 'deep' as never })).toBe(false)
  })
})

describe('normalizeCrop', () => {
  it('normalizes identity to undefined — the stored form is no key at all', () => {
    expect(normalizeCrop({})).toBeUndefined()
    expect(normalizeCrop({ left: 0, right: 0, top: 0, bottom: 0 })).toBeUndefined()
  })

  it('drops zero fields and keeps non-zero ones', () => {
    expect(normalizeCrop({ left: 0.25, right: 0 })).toEqual({ left: 0.25 })
    expect(normalizeCrop({ top: 0.1, bottom: 0.2 })).toEqual({ top: 0.1, bottom: 0.2 })
  })

  it('clamps negative edges to zero and deep single edges below 1', () => {
    expect(normalizeCrop({ left: -0.5 })).toBeUndefined()
    // A lone edge at or past 1 clamps to 1, then the axis floor scales it
    // back so MIN_KEPT_FRACTION survives.
    expect(normalizeCrop({ left: 1.5 })).toEqual({ left: 1 - MIN_KEPT_FRACTION })
  })

  it('scales an over-deep pair back proportionally to the minimum kept fraction', () => {
    const normalized = normalizeCrop({ left: 0.6, right: 0.5 })
    expect(normalized).toBeDefined()
    const { left = 0, right = 0 } = normalized!
    expect(1 - left - right).toBeCloseTo(MIN_KEPT_FRACTION, 10)
    // The edges keep their ratio, so the kept region stays where aimed.
    expect(left / right).toBeCloseTo(0.6 / 0.5, 10)
  })

  it('clamps each axis independently', () => {
    const normalized = normalizeCrop({ left: 0.7, right: 0.7, top: 0.2 })
    const { left = 0, right = 0, top = 0, bottom = 0 } = normalized!
    expect(1 - left - right).toBeCloseTo(MIN_KEPT_FRACTION, 10)
    expect(top).toBe(0.2)
    expect(bottom).toBe(0)
  })
})

describe('cropsEqual', () => {
  it('treats absent and zero edges alike', () => {
    expect(cropsEqual(undefined, undefined)).toBe(true)
    expect(cropsEqual({ left: 0.2 }, { left: 0.2 })).toBe(true)
    expect(cropsEqual({ left: 0.2 }, { left: 0.3 })).toBe(false)
    expect(cropsEqual({ top: 0.1 }, undefined)).toBe(false)
    expect(cropsEqual({ left: 0.2, top: 0.1 }, { left: 0.2 })).toBe(false)
  })
})

describe('keptFractions and cropSourceRect', () => {
  it('an absent crop keeps the whole source', () => {
    expect(keptFractions(undefined)).toEqual({ x: 1, y: 1 })
    expect(cropSourceRect(undefined, { width: 320, height: 180 })).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
  })

  it('maps edge fractions to the kept source-pixel rectangle', () => {
    expect(cropSourceRect({ left: 0.25, top: 0.1 }, { width: 320, height: 180 })).toEqual({
      x: 80,
      y: 18,
      width: 240,
      height: 162,
    })
    expect(
      cropSourceRect({ left: 0.25, right: 0.25, top: 0.5 }, { width: 320, height: 180 }),
    ).toEqual({ x: 80, y: 90, width: 160, height: 90 })
  })
})

describe('croppedDimensions', () => {
  it('returns the same object for an absent crop — crop-free callers pay nothing', () => {
    const dims = { width: 320, height: 180 }
    expect(croppedDimensions(dims, undefined)).toBe(dims)
  })

  it('presents the kept region in whole pixels, never below 1', () => {
    expect(croppedDimensions({ width: 320, height: 180 }, { left: 0.5 })).toEqual({
      width: 160,
      height: 180,
    })
    expect(croppedDimensions({ width: 320, height: 180 }, { left: 0.33, top: 0.33 })).toEqual({
      width: 214,
      height: 121,
    })
    expect(croppedDimensions({ width: 2, height: 2 }, { left: 0.89, top: 0.89 })).toEqual({
      width: 1,
      height: 1,
    })
  })

  it('composes with orientation in the crop-before-orientation order', () => {
    // Crop selects sensor content; the quarter turn then swaps the KEPT
    // region's shape — 320×180 cropped to its right half is 160×180, and
    // rotated it presents 180×160.
    const composed = orientedDimensions(
      croppedDimensions({ width: 320, height: 180 }, { left: 0.5 }),
      { rotation: 90 },
    )
    expect(composed).toEqual({ width: 180, height: 160 })
  })
})

describe('cropMediaPlacement', () => {
  it('styles nothing for an absent crop or unusable inputs', () => {
    expect(cropMediaPlacement(undefined, 16 / 9, 16 / 9)).toBeUndefined()
    expect(cropMediaPlacement({ left: 0.5 }, undefined, 16 / 9)).toBeUndefined()
    expect(cropMediaPlacement({ left: 0.5 }, Number.NaN, 16 / 9)).toBeUndefined()
    expect(cropMediaPlacement({ left: 0.5 }, 16 / 9, 0)).toBeUndefined()
  })

  it('a horizontal crop of a box-filling source clips and recentres without scaling', () => {
    // Source and box share an aspect: the source fills the box, and keeping
    // the right half cannot scale up (the kept region is already full box
    // height) — it clips to the right half and recentres it.
    const placement = cropMediaPlacement({ left: 0.5 }, 16 / 9, 16 / 9)!
    expect(placement.scale).toBeCloseTo(1, 10)
    expect(placement.insetLeft).toBeCloseTo(50, 10)
    expect(placement.insetRight).toBeCloseTo(0, 10)
    expect(placement.insetTop).toBeCloseTo(0, 10)
    expect(placement.insetBottom).toBeCloseTo(0, 10)
    expect(placement.translateX).toBeCloseTo(-25, 10)
    expect(placement.translateY).toBeCloseTo(0, 10)
  })

  it('an all-edges crop of a box-filling source scales the kept centre up in place', () => {
    const placement = cropMediaPlacement(
      { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25 },
      16 / 9,
      16 / 9,
    )!
    expect(placement.scale).toBeCloseTo(2, 10)
    expect(placement.insetLeft).toBeCloseTo(25, 10)
    expect(placement.insetRight).toBeCloseTo(25, 10)
    expect(placement.insetTop).toBeCloseTo(25, 10)
    expect(placement.insetBottom).toBeCloseTo(25, 10)
    expect(placement.translateX).toBeCloseTo(0, 10)
    expect(placement.translateY).toBeCloseTo(0, 10)
  })

  it('accounts for the letterbox of a source wider than its box', () => {
    // A 2:1 source in a square box renders letterboxed (full width, half
    // height, centred). Keeping its right half doubles it to fill the box.
    const placement = cropMediaPlacement({ left: 0.5 }, 2, 1)!
    expect(placement.scale).toBeCloseTo(2, 10)
    expect(placement.insetLeft).toBeCloseTo(50, 10)
    expect(placement.insetRight).toBeCloseTo(0, 10)
    expect(placement.insetTop).toBeCloseTo(25, 10)
    expect(placement.insetBottom).toBeCloseTo(25, 10)
    expect(placement.translateX).toBeCloseTo(-50, 10)
    expect(placement.translateY).toBeCloseTo(0, 10)
  })

  it('works in the transposed box a quarter turn swaps to (#232 composition)', () => {
    // A 16:9 source in a 16:9 card, quarter-turned: the element box is the
    // transposed card (aspect 9/16). The source letterboxes into it at full
    // box width; keeping the left half scales by the height-limited factor.
    const boxAspect = 9 / 16
    const sourceAspect = 16 / 9
    const placement = cropMediaPlacement({ left: 0.5 }, sourceAspect, boxAspect)!
    // Rendered source in the box: width 9/16, height (9/16)/(16/9) — the
    // kept half is (9/32) × that height; the box contain-fit is width-bound.
    const renderedHeight = boxAspect / sourceAspect
    expect(placement.scale).toBeCloseTo(Math.min(2, 1 / renderedHeight), 10)
    expect(placement.insetLeft).toBeCloseTo(50, 10)
    expect(placement.insetRight).toBeCloseTo(0, 10)
  })
})
