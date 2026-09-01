import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineEntry } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import {
  audioTrackGainAt,
  fadeRampAt,
  videoEntryGain,
  videoEntryGainAt,
  videoOverlayGainAt,
} from './gain'

const entry = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 'e1',
  clipId: 'c1',
  name: 'clip.mp4',
  duration: 10,
  url: 'blob:clip',
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

// Window [5, 17): offset 5, source [10, 22), trimmed length 12.
const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 't1',
  clipId: 'music-1',
  name: 'music.mp3',
  duration: 30,
  url: 'blob:music',
  offset: 5,
  inPoint: 10,
  outPoint: 22,
  ...overrides,
})

describe('videoEntryGain (#104)', () => {
  it('defaults to full volume, unmuted', () => {
    expect(videoEntryGain(entry())).toBe(1)
  })

  it('scales by the entry volume', () => {
    expect(videoEntryGain(entry({ volume: 0.5 }))).toBe(0.5)
    expect(videoEntryGain(entry({ volume: 0 }))).toBe(0)
  })

  it('mute wins over everything', () => {
    expect(videoEntryGain(entry({ muted: true }))).toBe(0)
    expect(videoEntryGain(entry({ muted: true, volume: 1 }))).toBe(0)
    expect(videoEntryGain(entry({ muted: true }), 0.5)).toBe(0)
  })

  it('composes with a transition ramp', () => {
    expect(videoEntryGain(entry(), 0.25)).toBe(0.25)
    expect(videoEntryGain(entry({ volume: 0.5 }), 0.5)).toBe(0.25)
    expect(videoEntryGain(entry({ volume: 0.5 }), 0)).toBe(0)
  })

  it('tolerates out-of-range inputs by clamping', () => {
    // The reducer and validator keep state in range; a stray caller value
    // must still never exceed what an element's volume accepts.
    expect(videoEntryGain(entry({ volume: 2 }))).toBe(1)
    expect(videoEntryGain(entry(), 1.5)).toBe(1)
  })
})

describe('audioTrackGainAt (#104)', () => {
  it('is 0 outside the audible window, full volume inside by default', () => {
    expect(audioTrackGainAt(track(), 4.99)).toBe(0)
    expect(audioTrackGainAt(track(), 17)).toBe(0)
    expect(audioTrackGainAt(track(), 5)).toBe(1)
    expect(audioTrackGainAt(track(), 11)).toBe(1)
  })

  it('scales by the track volume', () => {
    expect(audioTrackGainAt(track({ volume: 0.3 }), 11)).toBe(0.3)
    expect(audioTrackGainAt(track({ volume: 0 }), 11)).toBe(0)
  })

  it('fade-in ramps linearly from 0 at the window start to full at fadeIn', () => {
    const fading = track({ fadeIn: 2 })
    expect(audioTrackGainAt(fading, 5)).toBe(0)
    expect(audioTrackGainAt(fading, 6)).toBe(0.5)
    expect(audioTrackGainAt(fading, 7)).toBe(1)
    expect(audioTrackGainAt(fading, 12)).toBe(1)
  })

  it('fade-out ramps linearly to 0 at the window end', () => {
    // Window [5, 17), fadeOut 4: full until 13, 0 as the position reaches 17.
    const fading = track({ fadeOut: 4 })
    expect(audioTrackGainAt(fading, 13)).toBe(1)
    expect(audioTrackGainAt(fading, 15)).toBe(0.5)
    expect(audioTrackGainAt(fading, 16.99)).toBeCloseTo(0.0025, 5)
    expect(audioTrackGainAt(fading, 17)).toBe(0)
  })

  it('fades meeting in the middle peak at full volume where they meet', () => {
    // Trimmed length 12, fadeIn 6 + fadeOut 6: ramps up to sequence 11, down after.
    const fading = track({ fadeIn: 6, fadeOut: 6 })
    expect(audioTrackGainAt(fading, 5)).toBe(0)
    expect(audioTrackGainAt(fading, 8)).toBe(0.5)
    expect(audioTrackGainAt(fading, 11)).toBe(1)
    expect(audioTrackGainAt(fading, 14)).toBe(0.5)
  })

  it('composes volume with the fade envelope', () => {
    expect(audioTrackGainAt(track({ volume: 0.5, fadeIn: 2 }), 6)).toBe(0.25)
  })
})

describe('fadeRampAt (#220)', () => {
  it('is the identity envelope with no fades', () => {
    expect(fadeRampAt(undefined, undefined, 0, 10)).toBe(1)
    expect(fadeRampAt(0, 0, 0, 10)).toBe(1)
    expect(fadeRampAt(undefined, undefined, 10, 10)).toBe(1)
  })

  it('ramps linearly through fade-in and fade-out', () => {
    expect(fadeRampAt(2, undefined, 0, 10)).toBe(0)
    expect(fadeRampAt(2, undefined, 1, 10)).toBe(0.5)
    expect(fadeRampAt(2, undefined, 2, 10)).toBe(1)
    expect(fadeRampAt(undefined, 4, 6, 10)).toBe(1)
    expect(fadeRampAt(undefined, 4, 8, 10)).toBe(0.5)
    expect(fadeRampAt(undefined, 4, 10, 10)).toBe(0)
  })

  it('takes the minimum of overlapping ramps so an unclamped state degrades gracefully', () => {
    // fadeIn 8 + fadeOut 8 over length 10 cannot both complete: the envelope
    // caps at the lower ramp instead of exceeding either.
    expect(fadeRampAt(8, 8, 5, 10)).toBe(0.625)
  })

  it('clamps positions outside the window into [0, 1]', () => {
    expect(fadeRampAt(2, undefined, -1, 10)).toBe(0)
    expect(fadeRampAt(undefined, 2, 11, 10)).toBe(0)
  })
})

describe('videoEntryGainAt (#220)', () => {
  it('reduces to videoEntryGain for a fade-free entry', () => {
    expect(videoEntryGainAt(entry(), 3, 10)).toBe(1)
    expect(videoEntryGainAt(entry({ volume: 0.5 }), 3, 10, 0.5)).toBe(0.25)
  })

  it('applies the fade envelope over the output window', () => {
    const fading = entry({ fadeIn: 2, fadeOut: 2 })
    expect(videoEntryGainAt(fading, 0, 10)).toBe(0)
    expect(videoEntryGainAt(fading, 1, 10)).toBe(0.5)
    expect(videoEntryGainAt(fading, 5, 10)).toBe(1)
    expect(videoEntryGainAt(fading, 9, 10)).toBe(0.5)
    expect(videoEntryGainAt(fading, 10, 10)).toBe(0)
  })

  it('mute wins over a fade, and ramps multiply', () => {
    expect(videoEntryGainAt(entry({ muted: true, fadeIn: 2 }), 1, 10)).toBe(0)
    // Mid fade-in (0.5) inside a transition ramp (0.5) at volume 0.5.
    expect(videoEntryGainAt(entry({ volume: 0.5, fadeIn: 2 }), 1, 10, 0.5)).toBe(0.125)
  })
})

describe('videoOverlayGainAt (#220)', () => {
  // Window [5, 17): offset 5, source [10, 22), trimmed length 12 — the same
  // window shape as the audio track above (#145).
  const overlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
    id: 'o1',
    clipId: 'c1',
    name: 'clip.mp4',
    duration: 30,
    url: 'blob:clip',
    offset: 5,
    inPoint: 10,
    outPoint: 22,
    x: 0.62,
    y: 0.62,
    width: 0.35,
    height: 0.35,
    ...overrides,
  })

  it('reduces to volume × mute for a fade-free overlay', () => {
    expect(videoOverlayGainAt(overlay(), 11)).toBe(1)
    expect(videoOverlayGainAt(overlay({ volume: 0.5 }), 11)).toBe(0.5)
    expect(videoOverlayGainAt(overlay({ muted: true }), 11)).toBe(0)
  })

  it('fades over the overlay window like an audio track', () => {
    const fading = overlay({ fadeIn: 2, fadeOut: 4 })
    expect(videoOverlayGainAt(fading, 5)).toBe(0)
    expect(videoOverlayGainAt(fading, 6)).toBe(0.5)
    expect(videoOverlayGainAt(fading, 7)).toBe(1)
    expect(videoOverlayGainAt(fading, 13)).toBe(1)
    expect(videoOverlayGainAt(fading, 15)).toBe(0.5)
    expect(videoOverlayGainAt(fading, 17)).toBe(0)
  })

  it('mute wins over a fade, and volume composes with the envelope', () => {
    expect(videoOverlayGainAt(overlay({ muted: true, fadeIn: 2 }), 6)).toBe(0)
    expect(videoOverlayGainAt(overlay({ volume: 0.5, fadeIn: 2 }), 6)).toBe(0.25)
  })
})
