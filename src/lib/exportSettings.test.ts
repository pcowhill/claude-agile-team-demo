import { describe, expect, it } from 'vitest'
import {
  EXPORT_SIZE_PRESETS,
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FRAME_RATE,
  MIN_EXPORT_DIMENSION,
  automaticExportFrame,
  automaticSettings,
  isValidExportDimension,
  isValidExportFrameRate,
  isValidExportSettings,
} from './exportSettings'
import { EXPORT_FRAME_RATE } from './exportVideo'
import { FALLBACK_FRAME } from './frameSize'
import { slateEntry } from './timeline'

describe('export settings validation (#179)', () => {
  it('accepts whole-pixel dimensions within the bounds only', () => {
    expect(isValidExportDimension(MIN_EXPORT_DIMENSION)).toBe(true)
    expect(isValidExportDimension(MAX_EXPORT_DIMENSION)).toBe(true)
    expect(isValidExportDimension(1280)).toBe(true)
    expect(isValidExportDimension(MIN_EXPORT_DIMENSION - 1)).toBe(false)
    expect(isValidExportDimension(MAX_EXPORT_DIMENSION + 1)).toBe(false)
    expect(isValidExportDimension(0)).toBe(false)
    expect(isValidExportDimension(-1280)).toBe(false)
    expect(isValidExportDimension(1280.5)).toBe(false)
    expect(isValidExportDimension(Number.NaN)).toBe(false)
  })

  it('accepts positive frame rates up to the cap', () => {
    expect(isValidExportFrameRate(EXPORT_FRAME_RATE)).toBe(true)
    expect(isValidExportFrameRate(23.976)).toBe(true)
    expect(isValidExportFrameRate(MAX_EXPORT_FRAME_RATE)).toBe(true)
    expect(isValidExportFrameRate(0)).toBe(false)
    expect(isValidExportFrameRate(-30)).toBe(false)
    expect(isValidExportFrameRate(MAX_EXPORT_FRAME_RATE + 1)).toBe(false)
    expect(isValidExportFrameRate(Number.NaN)).toBe(false)
  })

  it('judges the settings as a whole', () => {
    expect(isValidExportSettings({ width: 1920, height: 1080, frameRate: 30 })).toBe(true)
    expect(isValidExportSettings({ width: 0, height: 1080, frameRate: 30 })).toBe(false)
    expect(isValidExportSettings({ width: 1920, height: Number.NaN, frameRate: 30 })).toBe(false)
    expect(isValidExportSettings({ width: 1920, height: 1080, frameRate: 0 })).toBe(false)
  })

  it('presets are themselves valid settings at the default frame rate', () => {
    for (const preset of EXPORT_SIZE_PRESETS) {
      expect(
        isValidExportSettings({
          width: preset.width,
          height: preset.height,
          frameRate: EXPORT_FRAME_RATE,
        }),
      ).toBe(true)
    }
  })

  it('automaticSettings pairs the frame with the default frame rate', () => {
    expect(automaticSettings({ width: 854, height: 480 })).toEqual({
      width: 854,
      height: 480,
      frameRate: EXPORT_FRAME_RATE,
    })
  })
})

describe('automaticExportFrame (#179)', () => {
  it('resolves the fallback frame when nothing contributes dimensions', async () => {
    // Slates have no dimensions of their own — same rule as export/preview.
    await expect(automaticExportFrame({ entries: [slateEntry('s1')] })).resolves.toEqual(
      FALLBACK_FRAME,
    )
    await expect(automaticExportFrame({ entries: [] })).resolves.toEqual(FALLBACK_FRAME)
  })
})
