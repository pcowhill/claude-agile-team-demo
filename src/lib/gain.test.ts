import { describe, expect, it } from 'vitest'
import gainsBefore692 from './fixtures/gains-before-692.json'
import type { AudioTrack, RemapEffect, TimelineEntry, TimelineState } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { VOLUME_CHANGE_RAMP_SECONDS } from './volumeChange'
import { MAX_VOLUME } from './volume'
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
    // must still never exceed the Volume range (#692), and a transition
    // ramp never boosts.
    expect(videoEntryGain(entry({ volume: 9 }))).toBe(4)
    expect(videoEntryGain(entry({ volume: -1 }))).toBe(0)
    expect(videoEntryGain(entry(), 1.5)).toBe(1)
  })
})

describe('Volume above 1 (#692)', () => {
  it('composes a volume of 2 with a fade at its midpoint to 1, and with mute to 0', () => {
    // Fade-in of 2 s: one second in, the envelope is 0.5.
    expect(videoEntryGainAt(entry({ volume: 2, fadeIn: 2 }), [], 1, 10)).toBe(1)
    expect(videoEntryGainAt(entry({ volume: 2, fadeIn: 2, muted: true }), [], 1, 10)).toBe(0)
    expect(audioTrackGainAt(track({ volume: 2, fadeIn: 2 }), 6)).toBe(1)
    // Past the fade it is the whole 2, and a transition ramp still scales it.
    expect(videoEntryGainAt(entry({ volume: 2, fadeIn: 2 }), [], 5, 10)).toBe(2)
    expect(videoEntryGain(entry({ volume: 2 }), 0.25)).toBe(0.5)
  })

  it('renders every gain of a project with Volumes at or below 1 exactly as main did before #692', () => {
    // The cases below were evaluated by main's own gain.ts at d942d72 (the
    // commit #692 branched from) and the results committed beside this
    // test: entries, overlays and tracks across six volumes, mute, fades,
    // a transition ramp and positions at both window edges, plus the duck
    // factor a track at each volume makes.
    const base = { id: 'e', clipId: 'c', name: 'n', duration: 10, url: 'blob:n', inPoint: 0, outPoint: 10 }
    const actual: number[] = []
    for (const volume of [undefined, 0, 0.25, 0.5, 0.8, 1]) {
      for (const muted of [undefined, true]) {
        for (const fades of [{}, { fadeIn: 2, fadeOut: 3 }]) {
          for (const [into, ramp] of [[0, 1], [1, 1], [5, 0.4], [8.5, 1], [10, 1]] as const) {
            actual.push(videoEntryGainAt({ ...base, volume, muted, ...fades }, [], into, 10, ramp))
          }
          for (const t of [0, 1.5, 4, 9.9]) {
            const overlay = { ...base, offset: 0, x: 0, y: 0, width: 1, height: 1, volume, muted, ...fades }
            actual.push(videoOverlayGainAt(overlay as VideoOverlay, t))
          }
        }
        for (const t of [4, 5, 6, 10, 16.5, 17]) {
          actual.push(
            audioTrackGainAt({ ...base, offset: 5, inPoint: 2, outPoint: 14, volume, fadeIn: 1, fadeOut: 2 }, t),
          )
        }
      }
      for (const t of [4.8, 5, 8, 17.1]) {
        const ducking = {
          entries: [],
          audioTracks: [{ ...base, offset: 5, inPoint: 0, outPoint: 10, volume, duck: true, duckLevel: 0.3 }],
        } as unknown as TimelineState
        actual.push(duckFactorAt(duckWindows(ducking), t))
      }
    }
    expect(actual).toHaveLength(312)
    expect(actual).toEqual(gainsBefore692)
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

describe('audioTrackGainAt with volume changes (#1025)', () => {
  // Window [5, 17); a change 3 s into the trimmed range is at sequence 8.
  const changed = (level: number, overrides: Partial<AudioTrack> = {}) =>
    track({ volumeChanges: [{ id: 'v1', start: 3, length: 4, level }], ...overrides })

  it('plays the level inside the change, full volume away from it, and ramps between', () => {
    expect(audioTrackGainAt(changed(0.2), 6)).toBe(1)
    expect(audioTrackGainAt(changed(0.2), 8)).toBe(0.2)
    expect(audioTrackGainAt(changed(0.2), 10)).toBe(0.2)
    expect(audioTrackGainAt(changed(0.2), 8 - VOLUME_CHANGE_RAMP_SECONDS / 2)).toBeCloseTo(0.6, 12)
    expect(audioTrackGainAt(changed(0.2), 13)).toBe(1)
  })

  it('multiplies with the track Volume and the fades', () => {
    expect(audioTrackGainAt(changed(0.5, { volume: 0.8 }), 9)).toBeCloseTo(0.4, 12)
    // fadeOut 12 over the 12 s window: at sequence 9, 8 s from the end, the ramp reads 8 / 12.
    expect(audioTrackGainAt(changed(0.5, { fadeOut: 12 }), 9)).toBeCloseTo(0.5 * (8 / 12), 12)
  })

  it('clamps Volume × level to MAX_VOLUME', () => {
    expect(audioTrackGainAt(changed(MAX_VOLUME, { volume: 2 }), 9)).toBe(MAX_VOLUME)
  })

  it('multiplies with ducking, as fades do: 0.5 under a duck to 0.3 plays at 0.15', () => {
    const music = changed(0.5)
    const voice: AudioTrack = { ...track({ id: 'voice', duck: true, duckLevel: 0.3 }), offset: 7, inPoint: 0, outPoint: 5 }
    const windows = duckWindows({ entries: [], transitions: [], zooms: [], audioTracks: [music, voice] })
    const gain = audioTrackGainAt(music, 9) * trackDuckFactorAt(music, windows, 9)
    expect(gain).toBeCloseTo(0.15, 12)
  })

  it('leaves a change-free track exactly as before', () => {
    expect(audioTrackGainAt(track({ volume: 0.7, fadeIn: 2 }), 6)).toBe(0.35)
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
    expect(videoEntryGainAt(entry(), [], 3, 10)).toBe(1)
    expect(videoEntryGainAt(entry({ volume: 0.5 }), [], 3, 10, 0.5)).toBe(0.25)
  })

  it('applies the fade envelope over the output window', () => {
    const fading = entry({ fadeIn: 2, fadeOut: 2 })
    expect(videoEntryGainAt(fading, [], 0, 10)).toBe(0)
    expect(videoEntryGainAt(fading, [], 1, 10)).toBe(0.5)
    expect(videoEntryGainAt(fading, [], 5, 10)).toBe(1)
    expect(videoEntryGainAt(fading, [], 9, 10)).toBe(0.5)
    expect(videoEntryGainAt(fading, [], 10, 10)).toBe(0)
  })

  it('mute wins over a fade, and ramps multiply', () => {
    expect(videoEntryGainAt(entry({ muted: true, fadeIn: 2 }), [], 1, 10)).toBe(0)
    // Mid fade-in (0.5) inside a transition ramp (0.5) at volume 0.5.
    expect(videoEntryGainAt(entry({ volume: 0.5, fadeIn: 2 }), [], 1, 10, 0.5)).toBe(0.125)
  })
})

describe('videoEntryGainAt with volume changes (#1026)', () => {
  // A 10 s entry with one change at 4 to 6 s into its trimmed range, at
  // Level 0.25. Its ramps run 3.75 to 4 s and 6 to 6.25 s.
  const changed = (overrides: Partial<TimelineEntry> = {}) =>
    entry({ volumeChanges: [{ id: 'v1', start: 4, length: 2, level: 0.25 }], ...overrides })
  const speed = (start: number, end: number, factor: number, entryId = 'e1'): RemapEffect => ({
    id: `s-${entryId}-${start}`,
    entryId,
    kind: 'speed',
    start,
    end,
    factor,
  })

  it('with no speed segments, plays the level inside the change, ramps either side, and full volume away', () => {
    expect(videoEntryGainAt(changed(), [], 3, 10)).toBe(1)
    expect(videoEntryGainAt(changed(), [], 3.875, 10)).toBeCloseTo(0.625, 12)
    expect(videoEntryGainAt(changed(), [], 5, 10)).toBe(0.25)
    expect(videoEntryGainAt(changed(), [], 6.125, 10)).toBeCloseTo(0.625, 12)
    expect(videoEntryGainAt(changed(), [], 7, 10)).toBe(1)
  })

  it('keeps the change on the same source seconds behind a 2× speed segment before it', () => {
    // Source 0 to 2 plays at 2× in output 0 to 1, so source s ≥ 2 is output s − 1.
    const remaps = [speed(0, 2, 2)]
    // Output 3.5 is source 4.5, inside the change; unmapped it would be 1.
    expect(videoEntryGainAt(changed(), remaps, 3.5, 9)).toBe(0.25)
    // Output 2.9 is source 3.9, 0.1 s before the change: 0.25 + 0.75 × 0.4.
    expect(videoEntryGainAt(changed(), remaps, 2.9, 9)).toBeCloseTo(0.55, 12)
    // Output 5.5 is source 6.5, past the ramp out.
    expect(videoEntryGainAt(changed(), remaps, 5.5, 9)).toBe(1)
  })

  it('plays the ramps at the speed of a segment over the change, as it plays the sound', () => {
    // Source 3 to 7 at 2× is output 3 to 5: the ramp in, 3.75 to 4 s of
    // source, is output 3.375 to 3.5, and its midpoint reads 0.625.
    const remaps = [speed(3, 7, 2)]
    expect(videoEntryGainAt(changed(), remaps, 3.4375, 8)).toBeCloseTo(0.625, 12)
    expect(videoEntryGainAt(changed(), remaps, 4, 8)).toBe(0.25)
    expect(videoEntryGainAt(changed(), remaps, 5.25, 8)).toBe(1)
  })

  it('reads only its own entry’s speed segments', () => {
    expect(videoEntryGainAt(changed(), [speed(0, 2, 2, 'other')], 3.5, 10)).toBe(1)
  })

  it('multiplies with the transition crossfade inside an overlap, and with the fades', () => {
    expect(videoEntryGainAt(changed(), [], 5, 10, 0.4)).toBeCloseTo(0.1, 12)
    expect(videoEntryGainAt(changed({ volume: 0.8, fadeOut: 10 }), [], 5, 10)).toBeCloseTo(0.25 * 0.8 * 0.5, 12)
  })

  it('stays silent when muted, and clamps Volume × Level to MAX_VOLUME', () => {
    expect(videoEntryGainAt(changed({ muted: true }), [], 5, 10)).toBe(0)
    const loud = entry({ volume: 2, volumeChanges: [{ id: 'v1', start: 4, length: 2, level: MAX_VOLUME }] })
    expect(videoEntryGainAt(loud, [], 5, 10)).toBe(MAX_VOLUME)
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

describe('videoOverlayGainAt with volume changes (#1027)', () => {
  // Window [5, 17): offset 5, source [10, 22), trimmed length 12, with one
  // change at 4 to 6 s into the trimmed range at Level 0.25. Its ramps run
  // 3.75 to 4 s and 6 to 6.25 s of the overlay's own clock.
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
    volumeChanges: [{ id: 'v1', start: 4, length: 2, level: 0.25 }],
    ...overrides,
  })

  it('with no remaps, plays the level inside the change, ramps either side, and full volume away', () => {
    expect(videoOverlayGainAt(overlay(), 8)).toBe(1)
    expect(videoOverlayGainAt(overlay(), 8.875)).toBeCloseTo(0.625, 12)
    expect(videoOverlayGainAt(overlay(), 10)).toBe(0.25)
    expect(videoOverlayGainAt(overlay(), 11.125)).toBeCloseTo(0.625, 12)
    expect(videoOverlayGainAt(overlay(), 12)).toBe(1)
  })

  it('keeps the change on the same source seconds behind a 2× speed segment before it', () => {
    // Source 0 to 2 plays at 2× in 1 s on screen, so source s ≥ 2 shows
    // s − 1 s after the overlay appears.
    const sped = overlay({ remaps: [{ id: 's1', kind: 'speed', start: 0, end: 2, factor: 2 }] })
    // 3.5 s on screen is source 4.5, inside the change; unmapped it would be 1.
    expect(videoOverlayGainAt(sped, 8.5)).toBe(0.25)
    // 2.9 s on screen is source 3.9, 0.1 s before the change: 0.25 + 0.75 × 0.4.
    expect(videoOverlayGainAt(sped, 7.9)).toBeCloseTo(0.55, 12)
    // 5.5 s on screen is source 6.5, past the ramp out; unmapped it would be 0.25.
    expect(videoOverlayGainAt(sped, 10.5)).toBe(1)
  })

  it('keeps the change on the same source seconds behind a pause before it', () => {
    // A 3 s pause at source 2: source s > 2 shows s + 3 s after the overlay appears.
    const paused = overlay({ remaps: [{ id: 'p1', kind: 'pause', at: 2, hold: 3 }] })
    // 7.5 s on screen is source 4.5, inside the change; unmapped it would be 1.
    expect(videoOverlayGainAt(paused, 12.5)).toBe(0.25)
    // 5 s on screen is the held source 2, well clear of the change; unmapped it would be 0.25.
    expect(videoOverlayGainAt(paused, 10)).toBe(1)
    // 6.875 s on screen is source 3.875, mid ramp.
    expect(videoOverlayGainAt(paused, 11.875)).toBeCloseTo(0.625, 12)
  })

  it('multiplies with the fades, stays silent when muted, and clamps Volume × Level to MAX_VOLUME', () => {
    // 5 s into the 12 s window, a 12 s fade-out is at 7/12.
    expect(videoOverlayGainAt(overlay({ volume: 0.8, fadeOut: 12 }), 10)).toBeCloseTo(0.25 * 0.8 * (7 / 12), 12)
    expect(videoOverlayGainAt(overlay({ muted: true }), 10)).toBe(0)
    const loud = overlay({ volume: 2, volumeChanges: [{ id: 'v1', start: 4, length: 2, level: MAX_VOLUME }] })
    expect(videoOverlayGainAt(loud, 10)).toBe(MAX_VOLUME)
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
