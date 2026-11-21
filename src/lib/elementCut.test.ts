import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineState, ZoomEffect } from './timeline'
import { audioTracksOf, remapsOf, timelineReducer, videoOverlaysOf, zoomsOf } from './timeline'
import type { RemapEffect } from './remap'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { OverlayRemap, OverlayZoom, VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'
import { audioTrackPlaybackAt, videoOverlayPlaybackAt } from './playback'
import { audioTrackGainAt, videoOverlayGainAt } from './gain'
import { overlayZoomAt } from './zoom'
import { DEFAULT_TEXT } from './textOverlay'

// Cut… on a video overlay and an audio track (#828): the part between the
// clamps is removed, the later part closes up behind the earlier, and
// nothing else moves. The sequence is one 30 s clip; the elements sit on it
// by their own start times, with a subtitle, a text and a marker besides.

const base = (): TimelineState => ({
  entries: [
    { id: 'a', clipId: 'clip-a', name: 'a.mp4', duration: 30, url: 'blob:a', inPoint: 0, outPoint: 30 },
  ],
  remaps: [{ id: 'slow', entryId: 'a', kind: 'speed', start: 20, end: 22, factor: 0.5 }],
  markers: [{ id: 'm', time: 12, name: 'Chapter 1' }],
  // A subtitle after the cut: an overlay or track cut must not move it.
  texts: [{ ...DEFAULT_TEXT, id: 'sub', content: 'Hello', offset: 9, duration: 2, subtitle: true }],
  // Empty lists as the reducer's normalization writes them, so a deep
  // comparison of the untouched fields compares like with like.
  transitions: [],
  zooms: [],
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

const cut = (
  state: TimelineState,
  kind: 'audio-track' | 'video-overlay',
  from: number,
  to: number,
  id = kind === 'audio-track' ? 'music' : 'pip',
  newId = 'tail',
): TimelineState => timelineReducer(state, { type: 'element-cut', kind, id, from, to, newId })

/** Every field of the state but the one collection the cut may change. */
const allBut = (state: TimelineState, key: keyof TimelineState) => {
  const { [key]: _changed, ...rest } = state
  return rest
}

describe('Cut… on an audio track (#828)', () => {
  it('leaves two parts that cover the original less the removed part, the tail closing up behind the head', () => {
    // Source 2..12 at 4 s; cut source 5..8 out. The head plays source 2..5
    // from 4 to 7 s, and the tail source 8..12 from 7 to 11 s.
    const state = { ...base(), audioTracks: [track()] }
    const [head, tail] = audioTracksOf(cut(state, 'audio-track', 5, 8))
    expect([head.id, head.offset, head.inPoint, head.outPoint]).toEqual(['music', 4, 2, 5])
    expect([tail.id, tail.offset, tail.inPoint, tail.outPoint]).toEqual(['tail', 7, 8, 12])
    // 10 s of track, less the 3 s removed.
    expect(head.outPoint - head.inPoint + (tail.outPoint - tail.inPoint)).toBe(7)
  })

  it('changes no other field of the timeline', () => {
    const state: TimelineState = {
      ...base(),
      audioTracks: [track(), track({ id: 'bed', offset: 0, inPoint: 0, outPoint: 30 })],
      videoOverlays: [overlay()],
    }
    const after = cut(state, 'audio-track', 5, 8)
    expect(audioTracksOf(after)).toHaveLength(3)
    expect(allBut(after, 'audioTracks')).toEqual(allBut(state, 'audioTracks'))
    // The other track is the very same, untouched and unmoved.
    expect(audioTracksOf(after)[2]).toEqual(audioTracksOf(state)[1])
  })

  it('copies volume and duck to both parts, the fade-in to the head and the fade-out to the tail', () => {
    const state = {
      ...base(),
      audioTracks: [track({ volume: 0.5, fadeIn: 1, fadeOut: 1.5, duck: true, duckLevel: 0.25 })],
    }
    const [head, tail] = audioTracksOf(cut(state, 'audio-track', 5, 8))
    expect([head.volume, head.duck, head.duckLevel, head.fadeIn, head.fadeOut]).toEqual([
      0.5,
      true,
      0.25,
      1,
      undefined,
    ])
    expect([tail.volume, tail.duck, tail.duckLevel, tail.fadeIn, tail.fadeOut]).toEqual([
      0.5,
      true,
      0.25,
      undefined,
      1.5,
    ])
  })

  it('lists the tail right after the head', () => {
    const state = {
      ...base(),
      audioTracks: [track(), track({ id: 'voice', clipId: 'clip-voice' })],
    }
    expect(audioTracksOf(cut(state, 'audio-track', 5, 8)).map((t) => t.id)).toEqual(['music', 'tail', 'voice'])
  })

  it.each([
    ['Cut from on In', 2, 6],
    ['Cut to on Out', 5, 12],
    ['the clamps inverted', 8, 5],
    ['the clamps equal', 6, 6],
    ['a clamp outside the trim', 1, 6],
    ['a clamp not a number', Number.NaN, 6],
  ])('is refused with %s', (_, from, to) => {
    const state = { ...base(), audioTracks: [track()] }
    expect(cut(state, 'audio-track', from, to)).toBe(state)
  })

  it('is refused for an unknown id, a taken id and an empty id', () => {
    const state = { ...base(), audioTracks: [track(), track({ id: 'voice' })] }
    expect(cut(state, 'audio-track', 5, 8, 'nobody')).toBe(state)
    expect(cut(state, 'audio-track', 5, 8, 'music', 'voice')).toBe(state)
    expect(cut(state, 'audio-track', 5, 8, 'music', '')).toBe(state)
  })

  it('plays every instant of the head as before, and every instant of the tail as the original did 3 s later', () => {
    const original = track({ volume: 0.8, fadeIn: 1, fadeOut: 1.5 })
    const state = { ...base(), audioTracks: [original] }
    const [head, tail] = audioTracksOf(cut(state, 'audio-track', 5, 8))
    let samples = 0
    for (let at = 0; at < 20; at += 0.01) {
      // Head 4..7, tail 7..11; the original's 7..10 is what was removed.
      const part = at < 7 ? head : tail
      const shifted = at < 7 ? at : at + 3
      const now = audioTrackPlaybackAt(part, at)
      const then = audioTrackPlaybackAt(original, shifted)
      expect(now.shouldPlay).toBe(then.shouldPlay)
      if (!then.shouldPlay) continue
      expect(now.sourceTime).toBeCloseTo(then.sourceTime, 9)
      expect(audioTrackGainAt(part, at)).toBeCloseTo(audioTrackGainAt(original, shifted), 9)
      samples++
    }
    expect(samples).toBeGreaterThan(690)
  })
})

describe('Cut… on a video overlay (#828)', () => {
  it('starts the tail at the head\'s remapped end, with a 2× speed segment before the cut and a pause inside it', () => {
    // Trimmed 10 s (source 1..11): 2× over trimmed [0.5, 4), a 1 s pause
    // at trimmed 5. Output: trimmed 2 is 0.5 + 1.5 / 2 = 1.25 s; trimmed 4
    // is 2.25 s; the pause holds 3.25 → 4.25; trimmed 6 is 5.25 s; the
    // whole is 9.25 s.
    const remaps: OverlayRemap[] = [
      { id: 's', kind: 'speed', start: 0.5, end: 4, factor: 2 },
      { id: 'p', kind: 'pause', at: 5, hold: 1 },
    ]
    const original = overlay({ remaps })
    expect(overlayOutputDuration(original)).toBe(9.25)
    // Cut source 3..7, trimmed 2..6: output 1.25 → 5.25, so 4 s go.
    const after = cut({ ...base(), videoOverlays: [original] }, 'video-overlay', 3, 7)
    const [head, tail] = videoOverlaysOf(after)
    expect([head.offset, head.inPoint, head.outPoint]).toEqual([3, 1, 3])
    expect(head.remaps).toEqual([{ id: 's', kind: 'speed', start: 0.5, end: 2, factor: 2 }])
    expect(overlayOutputDuration(head)).toBe(1.25)
    expect([tail.id, tail.offset, tail.inPoint, tail.outPoint]).toEqual(['tail', 4.25, 7, 11])
    // The pause was inside the removed part, and went with it.
    expect(tail.remaps).toBeUndefined()
    expect(overlayOutputDuration(head) + overlayOutputDuration(tail)).toBe(9.25 - 4)
  })

  it('removes a pause on Cut from\'s instant and keeps one on Cut to\'s, as the entry\'s Cut… does (#827)', () => {
    const remaps: OverlayRemap[] = [
      { id: 'on-from', kind: 'pause', at: 2, hold: 1 },
      { id: 'on-to', kind: 'pause', at: 6, hold: 1.5 },
    ]
    const [head, tail] = videoOverlaysOf(
      cut({ ...base(), videoOverlays: [overlay({ remaps })] }, 'video-overlay', 3, 7),
    )
    // The frame on Cut from is the first one removed, so its hold goes;
    // the frame on Cut to is the first one kept, so its hold stays.
    expect(head.remaps).toBeUndefined()
    expect(overlayOutputDuration(head)).toBe(2)
    expect(tail.remaps).toEqual([{ id: 'on-to', kind: 'pause', at: 0, hold: 1.5 }])
    expect(tail.offset).toBe(3 + 2)
    expect(overlayOutputDuration(tail)).toBe(4 + 1.5)
  })

  it('cuts its speed segments, pauses and zooms exactly as Cut out marked range cuts an entry\'s', () => {
    // The same clip and effects as a sequence entry starting at 0, cut by
    // `range-cut` over the same span of output time, must give the same
    // two parts' effects: one rule, two entry points.
    const remaps: OverlayRemap[] = [
      { id: 's', kind: 'speed', start: 0.5, end: 3, factor: 2 },
      { id: 'p', kind: 'pause', at: 4, hold: 1 },
      { id: 'q', kind: 'speed', start: 6, end: 8, factor: 0.5 },
    ]
    const zooms: OverlayZoom[] = [
      { id: 'z1', start: 0.2, rampIn: 0.5, hold: 3, rampOut: 0.5, scale: 2, centerX: 0.3, centerY: 0.4 },
      { id: 'z2', start: 5.5, rampIn: 0.25, hold: 3, rampOut: 0.25, scale: 1.5, centerX: 0.5, centerY: 0.5 },
    ]
    // Cut source 3..8: trimmed 2..7, inside z1's hold and z2's hold, and
    // inside the 2× segment and the 0.5× segment.
    const [head, tail] = videoOverlaysOf(
      cut({ ...base(), videoOverlays: [overlay({ remaps, zooms })] }, 'video-overlay', 3, 8),
    )
    // Output times by hand: trimmed 2 is 0.5 + 1.5 / 2 = 1.25; trimmed 3
    // is 1.75, 4 is 2.75, the pause holds to 3.75, 6 is 5.75, and trimmed
    // 7 is 5.75 + 1 / 0.5 = 7.75.
    const entryState: TimelineState = {
      entries: [
        { id: 'a', clipId: 'clip-pip', name: 'pip.mp4', duration: 40, url: 'blob:pip', inPoint: 1, outPoint: 11 },
        { id: 'z', clipId: 'clip-z', name: 'z.mp4', duration: 5, url: 'blob:z', inPoint: 0, outPoint: 5 },
      ],
      remaps: remaps.map((r): RemapEffect => ({ ...r, entryId: 'a' })),
      zooms: zooms.map((z): ZoomEffect => ({ ...z, entryId: 'a' })),
    }
    const entryCut = timelineReducer(entryState, {
      type: 'range-cut',
      from: 1.25,
      to: 7.75,
      newEntryIds: ['h', 't'],
    })
    const [entryHead, entryTail] = entryCut.entries
    expect([entryHead.inPoint, entryHead.outPoint]).toEqual([head.inPoint, head.outPoint])
    expect([entryTail.inPoint, entryTail.outPoint]).toEqual([tail.inPoint, tail.outPoint])
    // Ids aside: an entry's effect ids are unique across the sequence, so
    // `range-cut` prefixes the tail's, while an overlay's need only be
    // unique within it, so each part keeps the original's, as Split… does.
    const strip = <T extends { entryId: string; id: string }>(list: T[], entryId: string) =>
      list.filter((item) => item.entryId === entryId).map(({ entryId: _e, id: _i, ...rest }) => rest)
    const bare = <T extends { id: string }>(list: T[] | undefined) =>
      (list ?? []).map(({ id: _i, ...rest }) => rest)
    expect(bare(head.remaps)).toEqual(strip(remapsOf(entryCut), entryHead.id))
    expect(bare(tail.remaps)).toEqual(strip(remapsOf(entryCut), entryTail.id))
    expect(bare(head.zooms)).toEqual(strip(zoomsOf(entryCut), entryHead.id))
    expect(bare(tail.zooms)).toEqual(strip(zoomsOf(entryCut), entryTail.id))
    // And they are not empty: the comparison compared something.
    expect(head.remaps).toHaveLength(1)
    expect(tail.remaps).toHaveLength(1)
    expect(head.zooms).toHaveLength(1)
    expect(tail.zooms).toHaveLength(1)
  })

  it('plays every instant of the head as before, and every instant of the tail as the original did, removed part later', () => {
    const original = overlay({
      fadeIn: 0.75,
      fadeOut: 1,
      volume: 0.9,
      remaps: [
        { id: 's', kind: 'speed', start: 0.5, end: 4, factor: 2 },
        { id: 'p', kind: 'pause', at: 5, hold: 1 },
        { id: 'q', kind: 'pause', at: 8, hold: 0.5 },
      ],
      zooms: [{ id: 'z', start: 1, rampIn: 0.5, hold: 7, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 }],
    })
    // Cut source 3..7 (trimmed 2..6): output 1.25 → 5.25, so 4 s go. The
    // head plays 3 → 4.25 s in the sequence and the tail from 4.25 s.
    const [head, tail] = videoOverlaysOf(
      cut({ ...base(), videoOverlays: [original] }, 'video-overlay', 3, 7),
    )
    expect(tail.offset).toBe(4.25)
    let samples = 0
    for (let at = 0; at < 20; at += 0.01) {
      const part = at < 4.25 ? head : tail
      const shifted = at < 4.25 ? at : at + 4
      const now = videoOverlayPlaybackAt(part, at)
      const then = videoOverlayPlaybackAt(original, shifted)
      expect(now.shouldPlay).toBe(then.shouldPlay)
      if (!then.shouldPlay) continue
      expect(now.sourceTime).toBeCloseTo(then.sourceTime, 9)
      expect(now.rate).toBeCloseTo(then.rate, 9)
      expect(videoOverlayGainAt(part, at)).toBeCloseTo(videoOverlayGainAt(original, shifted), 9)
      expect(overlayZoomAt(part, now.sourceTime).scale).toBeCloseTo(
        overlayZoomAt(original, then.sourceTime).scale,
        9,
      )
      samples++
    }
    expect(samples).toBeGreaterThan(500)
  })

  it('copies every look setting and redaction to both parts', () => {
    const original = overlay({
      muted: true,
      volume: 0.4,
      orientation: { rotation: 90, flipH: true, flipV: false },
      crop: { left: 0.1, top: 0.1 },
      redactions: [{ id: 'r', start: 2, end: 9, left: 0.1, top: 0.1, width: 0.2, height: 0.2, style: 'blur' }],
    })
    const [head, tail] = videoOverlaysOf(
      cut({ ...base(), videoOverlays: [original] }, 'video-overlay', 3, 7),
    )
    for (const part of [head, tail]) {
      expect(part.muted).toBe(true)
      expect(part.volume).toBe(0.4)
      expect(part.orientation).toEqual(original.orientation)
      expect(part.crop).toEqual(original.crop)
      expect(part.redactions).toEqual(original.redactions)
      expect([part.x, part.y, part.width, part.height]).toEqual([0.6, 0.6, 0.3, 0.3])
    }
  })

  it('changes no other field of the timeline, and keeps the stacking order', () => {
    const state: TimelineState = {
      ...base(),
      audioTracks: [track()],
      videoOverlays: [overlay(), overlay({ id: 'top', clipId: 'clip-top' })],
    }
    const after = cut(state, 'video-overlay', 3, 7)
    expect(videoOverlaysOf(after).map((o) => o.id)).toEqual(['pip', 'tail', 'top'])
    expect(allBut(after, 'videoOverlays')).toEqual(allBut(state, 'videoOverlays'))
    expect(videoOverlaysOf(after)[2]).toEqual(videoOverlaysOf(state)[1])
  })

  it.each([
    ['Cut from on In', 1, 6],
    ['Cut to on Out', 4, 11],
    ['the clamps inverted', 7, 3],
    ['the clamps equal', 5, 5],
  ])('is refused with %s', (_, from, to) => {
    const state = { ...base(), videoOverlays: [overlay()] }
    expect(cut(state, 'video-overlay', from, to)).toBe(state)
  })

  it('is refused on an image overlay and for a taken id', () => {
    const logo = overlay({ id: 'logo', kind: 'image', inPoint: 0, outPoint: 5, duration: 5 })
    const state = { ...base(), videoOverlays: [overlay(), logo] }
    expect(cut(state, 'video-overlay', 1, 4, 'logo')).toBe(state)
    expect(cut(state, 'video-overlay', 3, 7, 'pip', 'logo')).toBe(state)
  })
})

describe('Cut… on a track or an overlay is one undo step (#828)', () => {
  it('one Undo restores the timeline exactly', () => {
    const state: TimelineState = { ...base(), audioTracks: [track()], videoOverlays: [overlay()] }
    let history = timelineHistoryReducer(emptyTimelineHistory, { type: 'timeline-replaced', timeline: state })
    const before = history.present
    for (const kind of ['audio-track', 'video-overlay'] as const) {
      history = timelineHistoryReducer(history, {
        type: 'element-cut',
        kind,
        id: kind === 'audio-track' ? 'music' : 'pip',
        from: 5,
        to: 8,
        newId: `${kind}-tail`,
      })
    }
    expect(audioTracksOf(history.present)).toHaveLength(2)
    expect(videoOverlaysOf(history.present)).toHaveLength(2)
    expect(history.past).toHaveLength(2)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(audioTracksOf(history.present)).toHaveLength(2)
    expect(videoOverlaysOf(history.present)).toHaveLength(1)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })
})
