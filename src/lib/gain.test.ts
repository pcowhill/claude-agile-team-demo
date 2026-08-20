import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineEntry } from './timeline'
import { audioTrackGainAt, videoEntryGain } from './gain'

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
