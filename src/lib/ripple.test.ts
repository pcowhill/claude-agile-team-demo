import { describe, expect, it } from 'vitest'
import type { AudioTrack, ChapterMarker, TimelineState } from './timeline'
import {
  audioTracksOf,
  markersOf,
  rangeCutRipple,
  shapeGroupsOf,
  textsOf,
  timelineReducer,
  totalDuration,
  videoOverlaysOf,
} from './timeline'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { TextOverlay } from './textOverlay'
import { DEFAULT_TEXT } from './textOverlay'
import type { ShapeGroup } from './shapes'
import { defaultShape } from './shapes'
import type { VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'
import { outputTimeAtSource, remappedDuration } from './remap'
import type { RemapSpec } from './remap'
import { rippleSummary, splitRemapsAtOutput, windowCut } from './ripple'

// Cut out marked range's ripple (#824): every element placed in sequence
// time follows the picture. The sequence is two 10 s clips, total 20, and
// the cut removes [6, 10) — 4 s, the whole end of `a`.

const FROM = 6
const TO = 10

const sequence = (): TimelineState => ({
  entries: ['a', 'b'].map((id) => ({
    id,
    clipId: `clip-${id}`,
    name: `${id}.mp4`,
    duration: 10,
    url: `blob:${id}`,
    inPoint: 0,
    outPoint: 10,
  })),
})

const cut = (state: TimelineState, from = FROM, to = TO): TimelineState =>
  timelineReducer(state, { type: 'range-cut', from, to, newEntryIds: ['mid', 'tail'] })

/**
 * The five windows each kind is tested at, plus one before the range, as
 * [start, length] → what the cut must leave: [start, length], or null for
 * removed.
 */
const CASES: Array<{ name: string; start: number; length: number; after: [number, number] | null }> = [
  { name: 'before the range (untouched)', start: 1, length: 2, after: [1, 2] },
  { name: 'after the range (moves earlier)', start: 12, length: 2, after: [8, 2] },
  { name: 'on the Out mark (moves to In)', start: 10, length: 2, after: [6, 2] },
  { name: 'inside it (removed)', start: 7, length: 2, after: null },
  { name: 'straddling its start (loses its tail)', start: 4, length: 4, after: [4, 2] },
  { name: 'straddling its end (loses its head, starts at In)', start: 9, length: 3, after: [6, 2] },
  { name: 'covering it (loses the range from its end)', start: 5, length: 7, after: [5, 3] },
]

const track = (id: string, offset: number, length: number): AudioTrack => ({
  id,
  clipId: 'clip-music',
  name: 'music.mp3',
  duration: 30,
  url: 'blob:music',
  offset,
  inPoint: 1,
  outPoint: 1 + length,
})

const overlay = (id: string, offset: number, length: number): VideoOverlay => ({
  id,
  clipId: 'clip-pip',
  name: 'pip.mp4',
  duration: 30,
  url: 'blob:pip',
  offset,
  inPoint: 1,
  outPoint: 1 + length,
  x: 0.6,
  y: 0.6,
  width: 0.3,
  height: 0.3,
})

const image = (id: string, offset: number, length: number): VideoOverlay => ({
  ...overlay(id, offset, length),
  kind: 'image',
  clipId: 'clip-logo',
  name: 'logo.png',
  url: 'blob:logo',
  duration: length,
  inPoint: 0,
  outPoint: length,
})

const text = (id: string, offset: number, length: number, subtitle = false): TextOverlay => ({
  ...DEFAULT_TEXT,
  id,
  content: id,
  offset,
  duration: length,
  ...(subtitle ? { subtitle: true } : {}),
})

const group = (id: string, offset: number, length: number): ShapeGroup => ({
  id,
  offset,
  duration: length,
  shapes: [defaultShape(`${id}-s`, 'rectangle')],
})

describe('the ripple, per kind (#824)', () => {
  // [start, length] as each kind stores it, after the cut.
  const kinds: Array<{
    kind: string
    place: (state: TimelineState, start: number, length: number) => TimelineState
    read: (state: TimelineState) => [number, number] | null
  }> = [
    {
      kind: 'audio track',
      place: (state, start, length) => ({ ...state, audioTracks: [track('el', start, length)] }),
      read: (state) => {
        const found = audioTracksOf(state)[0]
        return found === undefined ? null : [found.offset, found.outPoint - found.inPoint]
      },
    },
    {
      kind: 'video overlay',
      place: (state, start, length) => ({ ...state, videoOverlays: [overlay('el', start, length)] }),
      read: (state) => {
        const found = videoOverlaysOf(state)[0]
        return found === undefined ? null : [found.offset, overlayOutputDuration(found)]
      },
    },
    {
      kind: 'image overlay',
      place: (state, start, length) => ({ ...state, videoOverlays: [image('el', start, length)] }),
      read: (state) => {
        const found = videoOverlaysOf(state)[0]
        if (found === undefined) return null
        // An image's window is pinned to [0, duration].
        expect(found.inPoint).toBe(0)
        expect(found.outPoint).toBe(found.duration)
        return [found.offset, found.duration]
      },
    },
    {
      kind: 'text overlay',
      place: (state, start, length) => ({ ...state, texts: [text('el', start, length)] }),
      read: (state) => {
        const found = textsOf(state)[0]
        return found === undefined ? null : [found.offset, found.duration]
      },
    },
    {
      kind: 'subtitle',
      place: (state, start, length) => ({ ...state, texts: [text('el', start, length, true)] }),
      read: (state) => {
        const found = textsOf(state)[0]
        if (found === undefined) return null
        expect(found.subtitle).toBe(true)
        return [found.offset, found.duration]
      },
    },
    {
      kind: 'shape group',
      place: (state, start, length) => ({ ...state, shapeGroups: [group('el', start, length)] }),
      read: (state) => {
        const found = shapeGroupsOf(state)[0]
        return found === undefined ? null : [found.offset, found.duration]
      },
    },
  ]

  for (const { kind, place, read } of kinds) {
    describe(kind, () => {
      for (const { name, start, length, after } of CASES) {
        it(name, () => {
          const next = cut(place(sequence(), start, length))
          expect(totalDuration(next)).toBeCloseTo(16, 9)
          const got = read(next)
          if (after === null) expect(got).toBeNull()
          else {
            expect(got).not.toBeNull()
            expect(got?.[0]).toBeCloseTo(after[0], 9)
            expect(got?.[1]).toBeCloseTo(after[1], 9)
          }
        })
      }
    })
  }

  describe('an audio track and a video overlay are trimmed in source time', () => {
    it('a head cut moves In, a tail cut moves Out, and covering keeps the head', () => {
      const state: TimelineState = {
        ...sequence(),
        audioTracks: [track('head', 9, 3), track('tail', 4, 4), track('cover', 5, 7)],
      }
      const byId = new Map(audioTracksOf(cut(state)).map((t) => [t.id, t]))
      expect([byId.get('head')?.inPoint, byId.get('head')?.outPoint]).toEqual([2, 4])
      expect([byId.get('tail')?.inPoint, byId.get('tail')?.outPoint]).toEqual([1, 3])
      expect([byId.get('cover')?.inPoint, byId.get('cover')?.outPoint]).toEqual([1, 4])
    })
  })

  describe('chapter markers', () => {
    const withMarkers = (...times: number[]): TimelineState => ({
      ...sequence(),
      markers: times.map((time, index): ChapterMarker => ({ id: `m${index}`, time, name: `M${index}` })),
    })
    const times = (state: TimelineState) => markersOf(state).map((marker) => [marker.id, marker.time])

    it('before the range stays; exactly on the In mark stays', () => {
      expect(times(cut(withMarkers(3, 6)))).toEqual([
        ['m0', 3],
        ['m1', 6],
      ])
    })
    it('inside the range is removed', () => {
      expect(times(cut(withMarkers(3, 8)))).toEqual([['m0', 3]])
    })
    it('after the range moves earlier; on the Out mark moves to the In mark', () => {
      expect(times(cut(withMarkers(10, 15)))).toEqual([
        ['m0', 6],
        ['m1', 11],
      ])
    })
    it('a marker moving onto one kept on the In mark is removed, not doubled', () => {
      expect(times(cut(withMarkers(6, 10)))).toEqual([['m0', 6]])
      expect(rangeCutRipple(withMarkers(6, 10), FROM, TO)).toEqual([
        { kind: 'marker', id: 'm1', outcome: 'removed' },
      ])
    })
  })
})

describe('what moves with an element', () => {
  it("a shortened element's fades and draw-on are clamped to its new length", () => {
    const state: TimelineState = {
      ...sequence(),
      texts: [{ ...text('t', 4, 4), fadeIn: 1.5, fadeOut: 1.5 }],
      shapeGroups: [{ ...group('g', 9, 3), drawOn: 2.5 }],
      audioTracks: [{ ...track('a', 4, 4), fadeIn: 1.5, fadeOut: 1.5 }],
    }
    const next = cut(state)
    const t = textsOf(next)[0]
    expect((t.fadeIn ?? 0) + (t.fadeOut ?? 0)).toBeLessThanOrEqual(t.duration + 1e-9)
    expect(shapeGroupsOf(next)[0].drawOn).toBe(2)
    const a = audioTracksOf(next)[0]
    expect((a.fadeIn ?? 0) + (a.fadeOut ?? 0)).toBeLessThanOrEqual(a.outPoint - a.inPoint + 1e-9)
  })

  it("a video overlay's zooms stay on the picture they magnified when its head is cut", () => {
    // Window [9, 12) over source [1, 4); the cut takes its first second, so
    // In moves to 2 and a zoom 2 s into the trim (source 3) is 1 s in.
    const state: TimelineState = {
      ...sequence(),
      videoOverlays: [
        {
          ...overlay('o', 9, 3),
          zooms: [{ id: 'z', start: 2, rampIn: 0.25, hold: 0.5, rampOut: 0.25, scale: 2, centerX: 0.5, centerY: 0.5 }],
        },
      ],
    }
    const next = videoOverlaysOf(cut(state))[0]
    expect(next.inPoint).toBe(2)
    expect(next.zooms?.[0].start).toBeCloseTo(1, 9)
  })

  it("an image overlay's zooms, redactions and spotlights shift with its head cut", () => {
    const state: TimelineState = {
      ...sequence(),
      videoOverlays: [
        {
          ...image('i', 9, 3),
          zooms: [{ id: 'z', start: 2, rampIn: 0.25, hold: 0.5, rampOut: 0.25, scale: 2, centerX: 0.5, centerY: 0.5 }],
          redactions: [
            { id: 'r0', left: 0, top: 0, width: 0.5, height: 0.5, start: 0, end: 0.5, style: 'solid', color: '#000000' },
            { id: 'r1', left: 0, top: 0, width: 0.5, height: 0.5, start: 0.5, end: 2.5, style: 'solid', color: '#000000' },
          ],
        },
      ],
    }
    const next = videoOverlaysOf(cut(state))[0]
    expect(next.zooms?.[0].start).toBeCloseTo(1, 9)
    // r0 lay wholly in the removed second; r1 straddled it.
    expect(next.redactions?.map((r) => [r.id, r.start, r.end])).toEqual([['r1', 0, 1.5]])
  })

  it("a video overlay with its own speed segment and pause loses exactly the cut's length", () => {
    // 4 s of source with a half-speed second and a 1 s pause: 6 s on screen,
    // [5, 11). The cut [6, 10) covers it, so it keeps its first 2 s.
    const remaps: VideoOverlay['remaps'] = [
      { id: 's', kind: 'speed', start: 0.5, end: 1.5, factor: 0.5 },
      { id: 'p', kind: 'pause', at: 2.5, hold: 1 },
    ]
    const state: TimelineState = {
      ...sequence(),
      videoOverlays: [{ ...overlay('o', 5, 4), remaps }],
    }
    expect(overlayOutputDuration(videoOverlaysOf(state)[0])).toBeCloseTo(6, 9)
    const next = videoOverlaysOf(cut(state))[0]
    expect(next.offset).toBe(5)
    expect(overlayOutputDuration(next)).toBeCloseTo(2, 9)
  })
})

describe('splitRemapsAtOutput: each side lasts exactly its share', () => {
  const remaps: RemapSpec[] = [
    { kind: 'pause', at: 0, hold: 0.7 },
    { kind: 'speed', start: 1, end: 2, factor: 0.5 },
    { kind: 'pause', at: 2.5, hold: 1.2 },
    { kind: 'speed', start: 3, end: 4, factor: 2 },
    { kind: 'pause', at: 5, hold: 0.4 },
  ]
  const length = 5
  const total = remappedDuration(length, remaps)

  it("at every output instant, pauses' plateaus included", () => {
    // Where each pause holds, in output seconds: a cut there divides its hold.
    const plateaus = remaps.flatMap((remap) =>
      remap.kind === 'pause'
        ? [[outputTimeAtSource(length, remaps, remap.at), outputTimeAtSource(length, remaps, remap.at) + remap.hold]]
        : [],
    )
    let inside = 0
    for (let u = 0.013; u < total; u += 0.037) {
      const { at, before, after } = splitRemapsAtOutput(length, remaps, u)
      expect(remappedDuration(at, before), `before at ${u}`).toBeCloseTo(u, 9)
      expect(remappedDuration(length - at, after), `after at ${u}`).toBeCloseTo(total - u, 9)
      if (plateaus.some(([start, end]) => u > start && u < end)) inside++
    }
    // The sweep did land inside pauses, where the hold is divided.
    expect(inside).toBeGreaterThan(10)
  })
})

describe('windowCut', () => {
  it('treats a window ending exactly on the In mark as before the range', () => {
    expect(windowCut(2, 4, 6, 10)).toEqual({ kind: 'keep' })
  })
  it('treats a window starting a rounding error inside the range as inside it', () => {
    expect(windowCut(6 - 1e-9, 4, 6, 10)).toEqual({ kind: 'remove' })
  })
})

describe('the confirmation (#824)', () => {
  it('counts what the cut does, by kind and outcome', () => {
    const state: TimelineState = {
      ...sequence(),
      texts: [text('s1', 12, 2, true), text('s2', 15, 2, true), text('s0', 1, 2, true)],
      videoOverlays: [overlay('o', 11, 3)],
      audioTracks: [track('a', 5, 7)],
      markers: [{ id: 'm', time: 8, name: 'Inside' }],
    }
    const changes = rangeCutRipple(state, FROM, TO)
    expect(rippleSummary(changes, TO - FROM)).toBe(
      'Removes 4 s. 2 subtitles and 1 video overlay after it move earlier; 1 audio track that overlaps it is shortened; 1 chapter marker inside it is removed.',
    )
    // The counts are what the reducer then does.
    const next = cut(state)
    expect(textsOf(next).map((t) => [t.id, t.offset])).toEqual([
      ['s1', 8],
      ['s2', 11],
      ['s0', 1],
    ])
    expect(videoOverlaysOf(next)[0].offset).toBe(7)
    expect(markersOf(next)).toEqual([])
  })

  it('says nothing when only entries are touched', () => {
    const state: TimelineState = { ...sequence(), texts: [text('early', 1, 2)] }
    expect(rangeCutRipple(state, FROM, TO)).toEqual([])
    expect(rippleSummary([], TO - FROM)).toBeNull()
  })

  it('agrees in number', () => {
    expect(
      rippleSummary(
        [
          { kind: 'text', id: 'a', outcome: 'moves' },
          { kind: 'shape-group', id: 'b', outcome: 'shortened' },
          { kind: 'shape-group', id: 'c', outcome: 'shortened' },
        ],
        0.75,
      ),
    ).toBe('Removes 0.75 s. 1 text overlay after it moves earlier; 2 shape groups that overlap it are shortened.')
  })
})

describe('one undo step (#824)', () => {
  it('restores every collection exactly', () => {
    let history = emptyTimelineHistory
    history = timelineHistoryReducer(history, {
      type: 'timeline-replaced',
      timeline: {
        ...sequence(),
        audioTracks: [track('a', 9, 3)],
        videoOverlays: [overlay('o', 12, 2), image('i', 7, 2)],
        texts: [text('t', 4, 4), text('s', 12, 2, true)],
        shapeGroups: [group('g', 5, 7)],
        markers: [
          { id: 'm0', time: 8, name: 'Inside' },
          { id: 'm1', time: 15, name: 'After' },
        ],
      },
    })
    const before = history.present
    history = timelineHistoryReducer(history, {
      type: 'range-cut',
      from: FROM,
      to: TO,
      newEntryIds: ['mid', 'tail'],
    })
    expect(history.past).toHaveLength(1)
    const after = history.present
    expect(audioTracksOf(after)).not.toEqual(audioTracksOf(before))
    expect(videoOverlaysOf(after)).not.toEqual(videoOverlaysOf(before))
    expect(textsOf(after)).not.toEqual(textsOf(before))
    expect(shapeGroupsOf(after)).not.toEqual(shapeGroupsOf(before))
    expect(markersOf(after)).not.toEqual(markersOf(before))
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })
})
