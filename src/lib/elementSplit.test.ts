import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineState, ZoomEffect } from './timeline'
import { audioTracksOf, remapsOf, timelineReducer, videoOverlaysOf, zoomsOf } from './timeline'
import type { RemapEffect } from './remap'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { OverlayRemap, OverlayZoom, VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'
import { audioTrackPlaybackAt, videoOverlayPlaybackAt } from './playback'
import {
  audioTrackGainAt,
  duckWindows,
  trackDuckFactorAt,
  videoOverlayGainAt,
} from './gain'
import { activeVideoOverlays } from './exportVideo'
import { canSplitElementAt } from './elementSplit'

// Split… on a video overlay and an audio track (#826). The sequence is one
// 30 s clip; the elements sit on it by their own start times.

const base = (): TimelineState => ({
  entries: [
    {
      id: 'a',
      clipId: 'clip-a',
      name: 'a.mp4',
      duration: 30,
      url: 'blob:a',
      inPoint: 0,
      outPoint: 30,
    },
  ],
})

const track = (fields: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 'music',
  clipId: 'clip-music',
  name: 'music.mp3',
  duration: 60,
  url: 'blob:music',
  offset: 4,
  inPoint: 2,
  outPoint: 12,
  ...fields,
})

const overlay = (fields: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'pip',
  clipId: 'clip-pip',
  name: 'pip.mp4',
  duration: 40,
  url: 'blob:pip',
  offset: 3,
  inPoint: 1,
  outPoint: 11,
  x: 0.6,
  y: 0.6,
  width: 0.3,
  height: 0.3,
  ...fields,
})

const split = (
  state: TimelineState,
  kind: 'audio-track' | 'video-overlay',
  atSourceTime: number,
  id = kind === 'audio-track' ? 'music' : 'pip',
  newId = 'second',
): TimelineState => timelineReducer(state, { type: 'element-split', kind, id, atSourceTime, newId })

/** [start, end) of an element's window in sequence seconds. */
const trackWindow = (t: AudioTrack): [number, number] => [t.offset, t.offset + t.outPoint - t.inPoint]
const overlayWindow = (o: VideoOverlay): [number, number] => [
  o.offset,
  o.offset + overlayOutputDuration(o),
]

describe('Split… on an audio track (#826)', () => {
  it('makes two parts whose windows cover exactly the original, In and Out meeting at the point', () => {
    const state = { ...base(), audioTracks: [track()] }
    const [first, second] = audioTracksOf(split(state, 'audio-track', 5))
    expect(first).toMatchObject({ id: 'music', offset: 4, inPoint: 2, outPoint: 5 })
    expect(second).toMatchObject({ id: 'second', offset: 7, inPoint: 5, outPoint: 12 })
    expect(trackWindow(first)[0]).toBe(trackWindow(track())[0])
    expect(trackWindow(first)[1]).toBe(trackWindow(second)[0])
    expect(trackWindow(second)[1]).toBe(trackWindow(track())[1])
  })

  it('copies volume and duck to both parts, the fade-in to the first and the fade-out to the second', () => {
    const state = {
      ...base(),
      audioTracks: [track({ volume: 0.5, duck: true, duckLevel: 0.4, fadeIn: 1, fadeOut: 2 })],
    }
    const [first, second] = audioTracksOf(split(state, 'audio-track', 6))
    for (const part of [first, second]) {
      expect(part).toMatchObject({ volume: 0.5, duck: true, duckLevel: 0.4, name: 'music.mp3' })
    }
    expect(first.fadeIn).toBe(1)
    expect(first.fadeOut ?? 0).toBe(0)
    expect(second.fadeIn ?? 0).toBe(0)
    expect(second.fadeOut).toBe(2)
  })

  it('lists the second part right after the first', () => {
    const state = {
      ...base(),
      audioTracks: [track(), track({ id: 'voice', offset: 20 }), track({ id: 'last', offset: 0 })],
    }
    expect(audioTracksOf(split(state, 'audio-track', 5)).map((t) => t.id)).toEqual([
      'music',
      'second',
      'voice',
      'last',
    ])
  })

  it('is refused at In, at Out, outside the trim, for an unknown id and for a taken id', () => {
    const state = { ...base(), audioTracks: [track(), track({ id: 'voice', offset: 20 })] }
    for (const at of [2, 12, 1, 13, Number.NaN]) {
      expect(split(state, 'audio-track', at)).toBe(state)
    }
    expect(split(state, 'audio-track', 5, 'nobody')).toBe(state)
    expect(split(state, 'audio-track', 5, 'music', 'voice')).toBe(state)
    expect(split(state, 'audio-track', 5, 'music', '')).toBe(state)
  })
})

describe('Split… on a video overlay (#826)', () => {
  it('makes two parts whose windows cover exactly the original, with no effects', () => {
    const original = overlay({ fadeIn: 0.5, fadeOut: 1, volume: 0.7, muted: true })
    const state = { ...base(), videoOverlays: [original] }
    const [first, second] = videoOverlaysOf(split(state, 'video-overlay', 4))
    expect(first).toMatchObject({ id: 'pip', offset: 3, inPoint: 1, outPoint: 4, fadeIn: 0.5 })
    expect(second).toMatchObject({ id: 'second', offset: 6, inPoint: 4, outPoint: 11, fadeOut: 1 })
    expect(first.fadeOut ?? 0).toBe(0)
    expect(second.fadeIn ?? 0).toBe(0)
    expect(overlayWindow(first)[1]).toBe(overlayWindow(second)[0])
    expect(overlayWindow(second)[1]).toBe(overlayWindow(original)[1])
  })

  it('copies every look setting to both parts', () => {
    const look: Partial<VideoOverlay> = {
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.5,
      volume: 0.3,
      muted: true,
      colorAdjustments: { brightness: 0.2, contrast: 1.1, saturation: 0.9 },
      orientation: { rotation: 90, flipH: true },
      crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 },
      shapeMask: { kind: 'rounded', radius: 0.2 },
      border: { color: '#ff0000', thickness: 0.01 },
      shadow: { color: '#000000', opacity: 0.5, blur: 0.02, offsetX: 0.01, offsetY: 0.01 },
      redactions: [
        { id: 'r', left: 0.1, top: 0.1, width: 0.2, height: 0.2, start: 1.5, end: 9, style: 'blur' },
      ],
    }
    const original = overlay(look)
    const [first, second] = videoOverlaysOf(
      split({ ...base(), videoOverlays: [original] }, 'video-overlay', 5),
    )
    for (const part of [first, second]) {
      for (const key of Object.keys(look)) expect(part).toHaveProperty(key)
    }
    const settings = (o: VideoOverlay) => {
      const { id: _id, offset: _offset, inPoint: _in, outPoint: _out, ...rest } = o
      return rest
    }
    expect(settings(first)).toEqual(settings(original))
    expect(settings(second)).toEqual(settings(original))
  })

  it('starts the second part at the first part\'s remapped end, with a 2× speed segment before the cut', () => {
    // 2× over [1, 3) of the trim: those 2 s take 1 s. Cut at source 5 (4 s
    // into the trim): the first part lasts 1 + 1 + 1 = 3 s.
    const remaps: OverlayRemap[] = [{ id: 'fast', kind: 'speed', start: 1, end: 3, factor: 2 }]
    const original = overlay({ remaps })
    const [first, second] = videoOverlaysOf(
      split({ ...base(), videoOverlays: [original] }, 'video-overlay', 5),
    )
    expect(overlayOutputDuration(first)).toBeCloseTo(3, 9)
    expect(second.offset).toBeCloseTo(original.offset + 3, 9)
    expect(first.remaps).toEqual(remaps)
    expect(second.remaps).toBeUndefined()
    expect(overlayWindow(second)[1]).toBeCloseTo(overlayWindow(original)[1], 9)
  })

  it('starts the second part after a pause before the cut, the pause staying with the first part', () => {
    const remaps: OverlayRemap[] = [{ id: 'hold', kind: 'pause', at: 2, hold: 1.5 }]
    const original = overlay({ remaps })
    const [first, second] = videoOverlaysOf(
      split({ ...base(), videoOverlays: [original] }, 'video-overlay', 5),
    )
    expect(overlayOutputDuration(first)).toBeCloseTo(4 + 1.5, 9)
    expect(second.offset).toBeCloseTo(original.offset + 5.5, 9)
    expect(first.remaps).toEqual(remaps)
    expect(second.remaps).toBeUndefined()
  })

  it('cuts its speed segments, pauses and zooms exactly as entry-split cuts an entry\'s', () => {
    // The same effects on an entry and on an overlay, cut at the same
    // instant: the overlay's parts must hold what the entry's halves hold.
    const remaps: OverlayRemap[] = [
      { id: 's1', kind: 'speed', start: 0.5, end: 2, factor: 0.5 },
      { id: 'p1', kind: 'pause', at: 3, hold: 1 }, // at the cut: stays first
      { id: 's2', kind: 'speed', start: 3.5, end: 6, factor: 2 }, // contains... no: after
      { id: 'p2', kind: 'pause', at: 7, hold: 0.5 },
    ]
    const zooms: OverlayZoom[] = [
      { id: 'z1', start: 0, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 },
      // hold contains the cut (trim seconds 3): split in two
      { id: 'z2', start: 2.5, rampIn: 0.25, hold: 1, rampOut: 0.25, scale: 1.5, centerX: 0.3, centerY: 0.3 },
      // wholly after
      { id: 'z3', start: 6, rampIn: 0.5, hold: 0.5, rampOut: 0.5, scale: 3, centerX: 0.7, centerY: 0.7 },
    ]
    const cutAt = 3 // seconds into the trim
    const overlayState = { ...base(), videoOverlays: [overlay({ remaps, zooms })] }
    const [first, second] = videoOverlaysOf(
      split(overlayState, 'video-overlay', overlay().inPoint + cutAt),
    )

    const entryState: TimelineState = {
      entries: [{ ...base().entries[0], inPoint: 1, outPoint: 11 }],
      remaps: remaps.map((r): RemapEffect => ({ ...r, entryId: 'a' })),
      zooms: zooms.map((z): ZoomEffect => ({ ...z, entryId: 'a' })),
    }
    const entrySplit = timelineReducer(entryState, {
      type: 'entry-split',
      id: 'a',
      atSourceTime: 1 + cutAt,
      newEntryId: 'b',
    })
    const strip = <T extends { id: string; entryId: string }>(list: T[], entryId: string) =>
      list
        .filter((item) => item.entryId === entryId)
        .map(({ id: _id, entryId: _entryId, ...rest }) => rest)
    const bare = <T extends { id: string }>(list: T[] | undefined) =>
      (list ?? []).map(({ id: _id, ...rest }) => rest)
    expect(bare(first.remaps)).toEqual(strip(remapsOf(entrySplit), 'a'))
    expect(bare(second.remaps)).toEqual(strip(remapsOf(entrySplit), 'b'))
    expect(bare(first.zooms)).toEqual(strip(zoomsOf(entrySplit), 'a'))
    expect(bare(second.zooms)).toEqual(strip(zoomsOf(entrySplit), 'b'))
    // And the cases the test means to reach were reached.
    expect(first.zooms).toHaveLength(2)
    expect(second.zooms).toHaveLength(2)
    expect(first.remaps?.some((r) => r.kind === 'pause' && r.at === 3)).toBe(true)
  })

  it('divides a speed segment that contains the point into two with the same factor', () => {
    const remaps: OverlayRemap[] = [{ id: 'slow', kind: 'speed', start: 1, end: 6, factor: 0.5 }]
    const [first, second] = videoOverlaysOf(
      split({ ...base(), videoOverlays: [overlay({ remaps })] }, 'video-overlay', 4),
    )
    expect(first.remaps).toEqual([{ id: 'slow', kind: 'speed', start: 1, end: 3, factor: 0.5 }])
    expect(second.remaps).toEqual([{ id: 'slow', kind: 'speed', start: 0, end: 3, factor: 0.5 }])
  })

  it('is refused at In, at Out, outside the trim, on an image overlay and for a taken id', () => {
    const image: VideoOverlay = {
      ...overlay({ id: 'logo', kind: 'image', inPoint: 0, outPoint: 5, duration: 5 }),
    }
    const state = { ...base(), videoOverlays: [overlay(), image] }
    for (const at of [1, 11, 0.5, 12]) {
      expect(split(state, 'video-overlay', at)).toBe(state)
    }
    expect(split(state, 'video-overlay', 2, 'logo')).toBe(state)
    expect(split(state, 'video-overlay', 5, 'pip', 'logo')).toBe(state)
  })

  it('keeps the stacking order: the second part is listed right after the first', () => {
    const state = {
      ...base(),
      videoOverlays: [overlay({ id: 'under' }), overlay(), overlay({ id: 'over' })],
    }
    expect(videoOverlaysOf(split(state, 'video-overlay', 5)).map((o) => o.id)).toEqual([
      'under',
      'pip',
      'second',
      'over',
    ])
  })
})

describe('Split… on a track or an overlay plays back as before (#826)', () => {
  // What the preview and the export ask at each instant: which overlays are
  // active (`activeVideoOverlays`), at which source time and gain each plays
  // (`videoOverlayPlaybackAt`, `videoOverlayGainAt`), and each track's
  // source time and gain with ducking (`audioTrackPlaybackAt`,
  // `audioTrackGainAt`, `trackDuckFactorAt`).
  const heard = (state: TimelineState, at: number) => {
    const windows = duckWindows(state)
    return {
      overlays: activeVideoOverlays(state, at).map((o) => {
        const playback = videoOverlayPlaybackAt(o, at)
        return [o.clipId, playback.sourceTime, playback.rate, videoOverlayGainAt(o, at)]
      }),
      tracks: audioTracksOf(state).flatMap((t) => {
        const playback = audioTrackPlaybackAt(t, at)
        if (!playback.shouldPlay) return []
        return [[t.clipId, playback.sourceTime, audioTrackGainAt(t, at) * trackDuckFactorAt(t, windows, at)]]
      }),
    }
  }

  it('samples identical source times and gains either side of each cut', () => {
    const state: TimelineState = {
      ...base(),
      audioTracks: [
        track({ fadeIn: 1, fadeOut: 1.5, volume: 0.8, duck: true, duckLevel: 0.3 }),
        track({ id: 'bed', clipId: 'clip-bed', offset: 0, inPoint: 0, outPoint: 30, volume: 0.6 }),
      ],
      videoOverlays: [
        overlay({
          fadeIn: 0.75,
          fadeOut: 1,
          volume: 0.9,
          remaps: [
            { id: 's', kind: 'speed', start: 0.5, end: 4, factor: 2 },
            { id: 'p', kind: 'pause', at: 5, hold: 1 },
          ],
        }),
      ],
    }
    let after = split(state, 'audio-track', 7, 'music', 'music-2')
    after = split(after, 'video-overlay', 4.2, 'pip', 'pip-2')
    expect(audioTracksOf(after)).toHaveLength(3)
    expect(videoOverlaysOf(after)).toHaveLength(2)
    let samples = 0
    for (let at = 0; at < 30; at += 0.01) {
      const before = heard(state, at)
      const now = heard(after, at)
      expect(now.overlays).toHaveLength(before.overlays.length)
      now.overlays.forEach((values, i) =>
        values.forEach((value, j) =>
          typeof value === 'number'
            ? expect(value).toBeCloseTo(before.overlays[i][j] as number, 9)
            : expect(value).toBe(before.overlays[i][j]),
        ),
      )
      expect(now.tracks).toHaveLength(before.tracks.length)
      now.tracks.forEach((values, i) =>
        values.forEach((value, j) =>
          typeof value === 'number'
            ? expect(value).toBeCloseTo(before.tracks[i][j] as number, 9)
            : expect(value).toBe(before.tracks[i][j]),
        ),
      )
      samples++
    }
    expect(samples).toBeGreaterThan(2900)
  })

  it('is one undo step: one Undo restores the timeline exactly', () => {
    const state: TimelineState = { ...base(), audioTracks: [track()], videoOverlays: [overlay()] }
    let history = timelineHistoryReducer(emptyTimelineHistory, { type: 'timeline-replaced', timeline: state })
    const before = history.present
    history = timelineHistoryReducer(history, {
      type: 'element-split',
      kind: 'video-overlay',
      id: 'pip',
      atSourceTime: 5,
      newId: 'pip-2',
    })
    expect(videoOverlaysOf(history.present)).toHaveLength(2)
    expect(history.past).toHaveLength(1)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })
})

describe('canSplitElementAt (#826)', () => {
  it('is strictly inside the trim', () => {
    expect(canSplitElementAt({ inPoint: 1, outPoint: 3 }, 1)).toBe(false)
    expect(canSplitElementAt({ inPoint: 1, outPoint: 3 }, 3)).toBe(false)
    expect(canSplitElementAt({ inPoint: 1, outPoint: 3 }, 2)).toBe(true)
    expect(canSplitElementAt({ inPoint: 1, outPoint: 3 }, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
