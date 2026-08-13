import { describe, expect, it } from 'vitest'
import { EXPORT_MIME_CANDIDATES, fitRect, pickExportMimeType } from './exportVideo'

// The export pipeline itself (playback capture + MediaRecorder) cannot run
// in jsdom; it is covered by e2e/export.spec.ts. These tests cover the pure
// pieces the pipeline is built from.

describe('pickExportMimeType', () => {
  it('returns the first supported candidate in preference order', () => {
    expect(pickExportMimeType(() => true)).toBe(EXPORT_MIME_CANDIDATES[0])
    expect(pickExportMimeType((type) => !type.includes('vp9'))).toBe('video/webm;codecs=vp8')
    expect(pickExportMimeType((type) => type === 'video/webm')).toBe('video/webm')
  })

  it('returns null when nothing is supported', () => {
    expect(pickExportMimeType(() => false)).toBeNull()
  })
})

describe('fitRect', () => {
  it('fills the target when aspect ratios match', () => {
    expect(fitRect(320, 180, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })

  it('letterboxes a wider source (bars above and below)', () => {
    expect(fitRect(200, 50, 100, 100)).toEqual({ x: 0, y: 37.5, width: 100, height: 25 })
  })

  it('pillarboxes a taller source (bars at the sides)', () => {
    expect(fitRect(50, 200, 100, 100)).toEqual({ x: 37.5, y: 0, width: 25, height: 100 })
  })

  it('never upscales asymmetrically: output keeps the source aspect ratio', () => {
    const rect = fitRect(320, 180, 1000, 1000)
    expect(rect.width / rect.height).toBeCloseTo(320 / 180, 10)
  })

  it('falls back to the full target for degenerate source dimensions', () => {
    expect(fitRect(0, 0, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })
})
