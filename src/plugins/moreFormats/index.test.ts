import { afterEach, describe, expect, it } from 'vitest'
import { exportFormats } from '../../lib/exportFormats'
import { builtInPlugins } from '../catalog'
import { WEBP_FRAME_RATE, WEBP_MAX_DIMENSION } from '../moreFormatsLimits'
import { activate, WEBP_FORMAT_ID } from './index'
import { webpFrameDurations, webpOutputSize, webpTickAt } from './webpSink'

/**
 * The More export formats plugin (#858). Like the GIF plugin's tests, these
 * exercise the module the plugin runtime lazy-loads, against the app's real
 * registry singleton; the deactivate returned by `activate` is the cleanup.
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

describe('More export formats activate/deactivate (#858)', () => {
  it('registers Animated WebP and the deactivate unregisters it', () => {
    expect(exportFormats.has(WEBP_FORMAT_ID)).toBe(false)
    deactivate = activate()
    const spec = exportFormats.get(WEBP_FORMAT_ID)
    expect(spec.label).toBe('Animated WebP')
    expect(spec.extension).toBe('webp')
    deactivate()
    deactivate = null
    expect(exportFormats.has(WEBP_FORMAT_ID)).toBe(false)
  })

  it('probes the canvas encoder rather than MediaRecorder, and offers no Size limit', () => {
    deactivate = activate()
    const spec = exportFormats.get(WEBP_FORMAT_ID)
    expect(spec.candidates).toEqual([])
    expect(spec.candidatesWithAudio).toEqual([])
    expect(spec.sizeLimit).toBeUndefined()
    // jsdom grants no 2D context, so the honest answer here is no, whatever
    // MediaRecorder says; the e2e suite proves the yes in Chromium.
    expect(spec.isSupported?.(() => true)).toBe(false)
  })

  it('states its limits in the format note: the numbers the sink uses', () => {
    deactivate = activate()
    const note = exportFormats.get(WEBP_FORMAT_ID).note
    expect(note).toContain(`${WEBP_FRAME_RATE} fps`)
    expect(note).toContain(`${WEBP_MAX_DIMENSION} px`)
    expect(note).toContain('soundless')
  })

  it('is in the catalog with no usedByProject: an export format is not project state', () => {
    const plugin = builtInPlugins.find((spec) => spec.id === 'more-export-formats')
    expect(plugin?.name).toBe('More export formats')
    expect(plugin?.usedByProject).toBeUndefined()
  })
})

describe('the Animated WebP sink\'s sampling (#858)', () => {
  it('caps the longer side, never upscales, keeps the aspect', () => {
    expect(webpOutputSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 })
    expect(webpOutputSize(1080, 1920, 480)).toEqual({ width: 270, height: 480 })
    expect(webpOutputSize(320, 240, 480)).toEqual({ width: 320, height: 240 })
  })

  it('puts a time that lands on a tick on that tick, despite floating point', () => {
    // 0.7 × 20 is 13.999… in floating point; 0.3 × 10 is 3.0000…4.
    expect(webpTickAt(0.7, 20)).toBe(14)
    expect(webpTickAt(0.3, 10)).toBe(3)
    expect(webpTickAt(0.299, 10)).toBe(2)
    expect(webpTickAt(0, 10)).toBe(0)
  })

  it('a frame lasts until the next kept tick, so a skipped tick holds the frame before it', () => {
    expect(webpFrameDurations([0, 1, 2, 3], 10)).toEqual([100, 100, 100, 100])
    // Tick 2 was never delivered: frame 1 shows for two ticks, and the
    // animation still lasts as long as the export did.
    expect(webpFrameDurations([0, 1, 3], 10)).toEqual([100, 200, 100])
  })

  it('rounds on the running clock, so a rate that does not divide 1000 keeps exact time', () => {
    const durations = webpFrameDurations([0, 1, 2, 3, 4, 5], 15)
    expect(durations).toEqual([67, 66, 67, 67, 66, 67])
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(400)
  })
})
