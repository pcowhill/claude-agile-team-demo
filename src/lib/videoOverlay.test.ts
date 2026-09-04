import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { VideoOverlay } from './videoOverlay'
import {
  clampVideoOverlay,
  DEFAULT_IMAGE_OVERLAY_DURATION,
  DEFAULT_OVERLAY_RECT,
  forbiddenImageOverlayField,
  IMAGE_OVERLAY_FORBIDDEN_FIELDS,
  imageOverlayFromClip,
  isImageOverlay,
  isValidImageOverlay,
  isValidImageOverlayPlacement,
  isValidVideoOverlayPlacement,
  MAX_OVERLAY_SIZE,
  MIN_OVERLAY_SIZE,
  videoOverlayFromClip,
  videoOverlaysEqual,
} from './videoOverlay'
import { DEFAULT_STILL_DURATION, effectiveDuration } from './timeline'
import { audioTrackPlaybackAt } from './playback'

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

describe('image overlay layers (#294)', () => {
  const imageClip = (overrides: Partial<LibraryClip> = {}): LibraryClip =>
    clip({ id: 'clip-logo', name: 'logo.png', kind: 'image', url: 'blob:logo', duration: 0, ...overrides })

  const imageOverlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay =>
    overlay({
      id: 'i1',
      kind: 'image',
      clipId: 'clip-logo',
      name: 'logo.png',
      duration: DEFAULT_IMAGE_OVERLAY_DURATION,
      url: 'blob:logo',
      inPoint: 0,
      outPoint: DEFAULT_IMAGE_OVERLAY_DURATION,
      ...overrides,
    })

  it('builds a still overlay from an image clip: default rect, whole-still window', () => {
    const built = imageOverlayFromClip(imageClip(), 'i1')
    expect(built).toEqual({
      id: 'i1',
      kind: 'image',
      clipId: 'clip-logo',
      name: 'logo.png',
      duration: DEFAULT_IMAGE_OVERLAY_DURATION,
      url: 'blob:logo',
      offset: 0,
      inPoint: 0,
      outPoint: DEFAULT_IMAGE_OVERLAY_DURATION,
      ...DEFAULT_OVERLAY_RECT,
    })
    // No audio fields at all — not zeroed ones, absent ones.
    for (const field of IMAGE_OVERLAY_FORBIDDEN_FIELDS) {
      expect(Object.hasOwn(built, field)).toBe(false)
    }
    // The offset is the caller's, exactly as for a video overlay.
    expect(imageOverlayFromClip(imageClip(), 'i2', 3).offset).toBe(3)
  })

  it('takes the still default duration, and refuses a clip that is not an image', () => {
    // The issue's requirement, pinned rather than assumed: a still overlay
    // shows for as long as a still entry does. The constant is declared in
    // this module (timeline.ts imports it, so the reverse would be a cycle),
    // which is exactly why the two need pinning to each other.
    expect(DEFAULT_IMAGE_OVERLAY_DURATION).toBe(DEFAULT_STILL_DURATION)
    expect(() => imageOverlayFromClip(clip(), 'i1')).toThrow(/not an image clip/)
    expect(() => imageOverlayFromClip(imageClip({ kind: 'audio' }), 'i1')).toThrow(/not an image clip/)
  })

  it('isImageOverlay distinguishes the kinds', () => {
    expect(isImageOverlay(imageOverlay())).toBe(true)
    expect(isImageOverlay(overlay())).toBe(false)
  })

  it('refuses an image placement carrying audio or a trim, by name', () => {
    const placement = { offset: 2, duration: 4, x: 0.1, y: 0.1, width: 0.3, height: 0.3 }
    expect(isValidImageOverlayPlacement(placement)).toBe(true)
    // Every forbidden field is caught, and named — the parser reports the
    // name; the validator only has to refuse.
    for (const field of IMAGE_OVERLAY_FORBIDDEN_FIELDS) {
      const carrying = { ...placement, [field]: field === 'muted' || field === 'duck' ? true : 0.5 }
      expect(forbiddenImageOverlayField(carrying)).toBe(field)
      expect(isValidImageOverlayPlacement(carrying)).toBe(false)
    }
    // A trim belongs to a source; a still has none.
    for (const trim of ['inPoint', 'outPoint']) {
      expect(isValidImageOverlayPlacement({ ...placement, [trim]: 0 })).toBe(false)
    }
    // A window with no length would make it unshowable (the still rule).
    for (const duration of [0, -1, Number.NaN]) {
      expect(isValidImageOverlayPlacement({ ...placement, duration })).toBe(false)
    }
  })

  it('isValidImageOverlay refuses audio on a whole overlay, and a dead window', () => {
    expect(isValidImageOverlay(imageOverlay())).toBe(true)
    for (const field of IMAGE_OVERLAY_FORBIDDEN_FIELDS) {
      expect(isValidImageOverlay(imageOverlay({ [field]: 0.5 } as Partial<VideoOverlay>))).toBe(false)
    }
    expect(isValidImageOverlay(imageOverlay({ duration: 0 }))).toBe(false)
    // A loose trim is normalization's business, not a rejection.
    expect(isValidImageOverlay(imageOverlay({ inPoint: 2, outPoint: 9 }))).toBe(true)
  })

  it('clamps a still overlay: window pinned to the whole still, audio dropped', () => {
    const clamped = clampVideoOverlay(
      imageOverlay({
        duration: 4,
        inPoint: 2,
        outPoint: 9,
        offset: -3,
        x: 0.9,
        y: 0.9,
        width: 0.4,
        height: 0.4,
        volume: 0.5,
        muted: true,
        fadeIn: 1,
        fadeOut: 1,
      }),
    )
    // The window is the whole still — never a trim of it.
    expect(clamped.inPoint).toBe(0)
    expect(clamped.outPoint).toBe(4)
    expect(clamped.duration).toBe(4)
    expect(clamped.offset).toBe(0)
    // The rectangle clamps exactly as a video overlay's: size first, then
    // position into what the size leaves.
    expect(clamped.x).toBeCloseTo(0.6)
    expect(clamped.y).toBeCloseTo(0.6)
    expect(clamped.width).toBeCloseTo(0.4)
    // Audio is dropped, not zeroed — the backstop behind the validator.
    for (const field of IMAGE_OVERLAY_FORBIDDEN_FIELDS) {
      expect(Object.hasOwn(clamped, field)).toBe(false)
    }
    // Nothing to fix: same reference, so a no-op edit is cheap to detect.
    const settled = imageOverlay({ duration: 4, inPoint: 0, outPoint: 4, offset: 1 })
    expect(clampVideoOverlay(settled)).toBe(settled)
  })

  it('keeps the rectangle bounds it shares with a video overlay', () => {
    const tiny = clampVideoOverlay(imageOverlay({ width: 0, height: 5 }))
    expect(tiny.width).toBe(MIN_OVERLAY_SIZE)
    expect(tiny.height).toBe(MAX_OVERLAY_SIZE)
  })

  it('a still overlay is never equal to a video one with the same fields', () => {
    // The kind is part of the identity: without it, an edit that changed
    // only the kind would read as a no-op and never reach the state.
    const still = imageOverlay({ id: 'x', duration: 5, inPoint: 0, outPoint: 5 })
    const { kind: _kind, ...asVideo } = still
    expect(videoOverlaysEqual(still, asVideo as VideoOverlay)).toBe(false)
    expect(videoOverlaysEqual(still, { ...still })).toBe(true)
  })

  it('the shared window helpers read a still overlay correctly', () => {
    // The whole reason the window is stored as inPoint/outPoint: every
    // helper that already works on offsets and trims keeps working.
    const still = imageOverlay({ offset: 2, duration: 3, inPoint: 0, outPoint: 3 })
    expect(effectiveDuration(still)).toBe(3)
    expect(audioTrackPlaybackAt(still, 1.9).shouldPlay).toBe(false)
    expect(audioTrackPlaybackAt(still, 2).shouldPlay).toBe(true)
    expect(audioTrackPlaybackAt(still, 4.99).shouldPlay).toBe(true)
    // Half-open at the end, exactly as for every other lane item.
    expect(audioTrackPlaybackAt(still, 5).shouldPlay).toBe(false)
  })
})
