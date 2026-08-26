import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { VideoOverlay } from './videoOverlay'
import {
  clampVideoOverlay,
  DEFAULT_OVERLAY_RECT,
  isValidVideoOverlayPlacement,
  MAX_OVERLAY_SIZE,
  MIN_OVERLAY_SIZE,
  videoOverlayFromClip,
  videoOverlaysEqual,
} from './videoOverlay'

const clip = (overrides: Partial<LibraryClip> = {}): LibraryClip => ({
  id: 'clip-1',
  name: 'cam.webm',
  duration: 8,
  kind: 'video',
  url: 'blob:cam',
  ...overrides,
})

const overlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'v1',
  clipId: 'clip-1',
  name: 'cam.webm',
  duration: 8,
  url: 'blob:cam',
  offset: 1,
  inPoint: 0,
  outPoint: 8,
  x: 0.6,
  y: 0.6,
  width: 0.3,
  height: 0.3,
  ...overrides,
})

describe('videoOverlayFromClip (#145)', () => {
  it('copies clip data, plays the whole clip, and takes the default corner rect', () => {
    expect(videoOverlayFromClip(clip(), 'v9', 2)).toEqual({
      id: 'v9',
      clipId: 'clip-1',
      name: 'cam.webm',
      duration: 8,
      url: 'blob:cam',
      offset: 2,
      inPoint: 0,
      outPoint: 8,
      ...DEFAULT_OVERLAY_RECT,
    })
  })

  it('defaults to sequence start', () => {
    expect(videoOverlayFromClip(clip(), 'v9').offset).toBe(0)
  })

  it('the default rectangle sits fully on the frame', () => {
    const { x, y, width, height } = DEFAULT_OVERLAY_RECT
    expect(x + width).toBeLessThanOrEqual(1)
    expect(y + height).toBeLessThanOrEqual(1)
  })

  it('refuses non-video clips — audio has no picture, a still is not this feature', () => {
    expect(() => videoOverlayFromClip(clip({ kind: 'audio' }), 'v9')).toThrow(/not a video clip/)
    expect(() => videoOverlayFromClip(clip({ kind: 'image' }), 'v9')).toThrow(/not a video clip/)
  })
})

describe('isValidVideoOverlayPlacement (#145)', () => {
  it('accepts the default placement, with and without gain fields', () => {
    expect(isValidVideoOverlayPlacement(overlay())).toBe(true)
    expect(isValidVideoOverlayPlacement(overlay({ volume: 0.5, muted: true }))).toBe(true)
  })

  it('rejects non-finite numeric fields', () => {
    for (const field of ['offset', 'inPoint', 'outPoint', 'x', 'y', 'width', 'height'] as const) {
      expect(isValidVideoOverlayPlacement(overlay({ [field]: Number.NaN }))).toBe(false)
      expect(isValidVideoOverlayPlacement(overlay({ [field]: Infinity }))).toBe(false)
    }
    expect(isValidVideoOverlayPlacement(overlay({ volume: Number.NaN }))).toBe(false)
  })
})

describe('clampVideoOverlay (#145)', () => {
  it('clamps offset at zero but leaves it unbounded above (allowed tail)', () => {
    expect(clampVideoOverlay(overlay({ offset: -3 })).offset).toBe(0)
    expect(clampVideoOverlay(overlay({ offset: 9999 })).offset).toBe(9999)
  })

  it('clamps the trim into the source clip', () => {
    const clamped = clampVideoOverlay(overlay({ inPoint: -1, outPoint: 99 }))
    expect(clamped.inPoint).toBe(0)
    expect(clamped.outPoint).toBe(8)
  })

  it('clamps the rectangle size into its bounds, then the position into what the size leaves', () => {
    const tiny = clampVideoOverlay(overlay({ width: 0.001, height: 2 }))
    expect(tiny.width).toBe(MIN_OVERLAY_SIZE)
    expect(tiny.height).toBe(MAX_OVERLAY_SIZE)
    // A full-height overlay can only sit at y = 0.
    expect(tiny.y).toBe(0)
    // The rectangle never leaves the frame: position clamps to 1 − size.
    const pushed = clampVideoOverlay(overlay({ x: 0.9, width: 0.4 }))
    expect(pushed.x).toBeCloseTo(0.6, 10)
    expect(pushed.x + pushed.width).toBeCloseTo(1, 10)
    expect(clampVideoOverlay(overlay({ x: -2, y: -2 }))).toMatchObject({ x: 0, y: 0 })
  })

  it('clamps volume into 0..1, leaving an absent volume absent', () => {
    expect(clampVideoOverlay(overlay({ volume: 4 })).volume).toBe(1)
    expect(clampVideoOverlay(overlay({ volume: -1 })).volume).toBe(0)
    expect(clampVideoOverlay(overlay()).volume).toBeUndefined()
  })

  it('returns the same object when nothing changes', () => {
    const stored = overlay()
    expect(clampVideoOverlay(stored)).toBe(stored)
    const withGain = overlay({ volume: 0.5, muted: true })
    expect(clampVideoOverlay(withGain)).toBe(withGain)
  })
})

describe('videoOverlaysEqual', () => {
  it('compares every field', () => {
    const base = overlay({ volume: 0.5, muted: false })
    expect(videoOverlaysEqual(base, { ...base })).toBe(true)
    for (const change of [
      { id: 'other' },
      { clipId: 'other' },
      { name: 'other' },
      { duration: 9 },
      { url: 'blob:other' },
      { offset: 2 },
      { inPoint: 1 },
      { outPoint: 7 },
      { x: 0.1 },
      { y: 0.1 },
      { width: 0.4 },
      { height: 0.4 },
      { volume: 0.6 },
      { muted: true },
    ] as Partial<VideoOverlay>[]) {
      expect(videoOverlaysEqual(base, { ...base, ...change })).toBe(false)
    }
  })
})
