import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineEntry, TimelineState } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import {
  DEFAULT_DUCK_LEVEL,
  DUCK_RAMP_SECONDS,
  audioTrackGainAt,
  duckFactorAt,
  duckWindows,
  fadeRampAt,
  trackDuckFactorAt,
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

describe('audio ducking (#241)', () => {
  // Minimal state carrying only what duckWindows reads: the audio tracks.
  const state = (tracks: AudioTrack[]): TimelineState => ({
    entries: [],
    transitions: [],
    zooms: [],
    audioTracks: tracks,
  })
  // The shared `track()` above occupies sequence window [5, 17).

  describe('duckWindows', () => {
    it('yields no windows without a duck-enabled track', () => {
      expect(duckWindows(state([]))).toEqual([])
      expect(duckWindows(state([track()]))).toEqual([])
    })

    it('maps a duck-enabled track to its audible window at the default level', () => {
      expect(duckWindows(state([track({ duck: true })]))).toEqual([
        { start: 5, end: 17, level: DEFAULT_DUCK_LEVEL },
      ])
    })

    it('carries the track duck level, clamped into [0, 1]', () => {
      expect(duckWindows(state([track({ duck: true, duckLevel: 0.5 })]))).toEqual([
        { start: 5, end: 17, level: 0.5 },
      ])
      expect(duckWindows(state([track({ duck: true, duckLevel: 2 })]))).toEqual([
        { start: 5, end: 17, level: 1 },
      ])
    })

    it('a muted (zero-volume) duck-enabled track ducks nothing', () => {
      expect(duckWindows(state([track({ duck: true, volume: 0 })]))).toEqual([])
    })

    it('merges windows separated by less than the ramp time, the deeper duck winning', () => {
      // [5, 17) and [17.05, 29.05): the 0.05s gap is under the 0.25s ramp —
      // a brief gap in a voice-over must not audibly pump the mix back up.
      const merged = duckWindows(
        state([
          track({ id: 't1', duck: true, duckLevel: 0.4 }),
          track({ id: 't2', duck: true, duckLevel: 0.2, offset: 17.05 }),
        ]),
      )
      expect(merged).toEqual([{ start: 5, end: 29.05, level: 0.2 }])
    })

    it('keeps windows separated by more than the ramp time apart', () => {
      const windows = duckWindows(
        state([
          track({ id: 't1', duck: true }),
          track({ id: 't2', duck: true, offset: 18 }),
        ]),
      )
      expect(windows).toHaveLength(2)
      expect(windows[0]).toMatchObject({ start: 5, end: 17 })
      expect(windows[1]).toMatchObject({ start: 18, end: 30 })
    })

    it('sorts windows by start whatever the track order', () => {
      const windows = duckWindows(
        state([
          track({ id: 't2', duck: true, offset: 18 }),
          track({ id: 't1', duck: true }),
        ]),
      )
      expect(windows[0].start).toBe(5)
      expect(windows[1].start).toBe(18)
    })
  })

  describe('duckFactorAt', () => {
    const windows = duckWindows(state([track({ duck: true, duckLevel: 0.25 })]))

    it('is full gain outside the window and beyond its ramps', () => {
      expect(duckFactorAt(windows, 0)).toBe(1)
      expect(duckFactorAt(windows, 5 - DUCK_RAMP_SECONDS)).toBe(1)
      expect(duckFactorAt(windows, 17 + DUCK_RAMP_SECONDS)).toBe(1)
      expect(duckFactorAt([], 11)).toBe(1)
    })

    it('is the duck level throughout the window', () => {
      expect(duckFactorAt(windows, 5)).toBe(0.25)
      expect(duckFactorAt(windows, 11)).toBe(0.25)
      expect(duckFactorAt(windows, 17)).toBe(0.25)
    })

    it('ramps down linearly just before the window and back up just after it', () => {
      // Halfway down the pre-start ramp and halfway up the post-end ramp:
      // midway between full gain (1) and the level (0.25).
      expect(duckFactorAt(windows, 5 - DUCK_RAMP_SECONDS / 2)).toBeCloseTo(0.625, 10)
      expect(duckFactorAt(windows, 17 + DUCK_RAMP_SECONDS / 2)).toBeCloseTo(0.625, 10)
    })

    it('never recovers above either duck where two windows’ ramps overlap', () => {
      // Gap 0.4s — wider than one ramp (no merge) but narrower than two, so
      // the up-ramp of the first meets the down-ramp of the second. The
      // factor between them is the minimum of the two ramps, peaking at 0.85
      // in the middle rather than returning to 1.
      const pair = duckWindows(
        state([
          track({ id: 't1', duck: true }),
          track({ id: 't2', duck: true, offset: 17.4 }),
        ]),
      )
      expect(pair).toHaveLength(2)
      expect(duckFactorAt(pair, 17.2)).toBeCloseTo(0.85, 10)
      expect(duckFactorAt(pair, 17.1)).toBeCloseTo(0.55, 10)
      expect(duckFactorAt(pair, 17.3)).toBeCloseTo(0.55, 10)
    })
  })

  describe('trackDuckFactorAt', () => {
    const voice = track({ id: 'voice', duck: true })
    const windows = duckWindows(state([voice]))

    it('exempts duck-enabled tracks — the voice is never itself ducked', () => {
      expect(trackDuckFactorAt(voice, windows, 11)).toBe(1)
      const otherDucker = track({ id: 'other-voice', duck: true, offset: 40 })
      expect(trackDuckFactorAt(otherDucker, windows, 11)).toBe(1)
    })

    it('ducks every non-duck-enabled track like the rest of the mix', () => {
      const music = track({ id: 'music' })
      expect(trackDuckFactorAt(music, windows, 11)).toBe(DEFAULT_DUCK_LEVEL)
      expect(trackDuckFactorAt(music, windows, 0)).toBe(1)
    })
  })

  it('ducking composes multiplicatively with volume, mute, and fades', () => {
    // The renderer call sites multiply gain × duck; pin the composition on a
    // representative: volume 0.5, mid fade-in (0.5) at sequence 6, ducked to
    // 0.25 → 0.5 × 0.5 × 0.25.
    const windows = duckWindows(state([track({ id: 'voice', duck: true, offset: 0, inPoint: 0, outPoint: 30 })]))
    const music = track({ id: 'music', volume: 0.5, fadeIn: 2 })
    const gain = audioTrackGainAt(music, 6) * trackDuckFactorAt(music, windows, 6)
    expect(gain).toBeCloseTo(0.5 * 0.5 * 0.25, 10)
  })
})
