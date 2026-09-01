import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { TimelineState, TimelineTransition, ZoomSpec } from './timeline'
import {
  audioTrackFromClip,
  audioTracksOf,
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  remapsOf,
  emptyTimeline,
  entryFromClip,
  defaultZoomFor,
  DEFAULT_SLATE_COLOR,
  DEFAULT_STILL_DURATION,
  DEFAULT_ZOOM,
  isSlateEntry,
  isStillEntry,
  isValidSlateColor,
  slateEntry,
  normalizedTimelineState,
  timelineReducer,
  textsOf,
  videoOverlaysOf,
  totalDuration,
  transitionsOf,
  zoomsForEntry,
  zoomsOf,
} from './timeline'
import type { RemapEffect, TextOverlay, VideoOverlay, ZoomEffect } from './timeline'
import { DEFAULT_TEXT, MAX_TEXT_SIZE, MIN_TEXT_SIZE } from './textOverlay'
import { zoomAt } from './zoom'

const clip = (overrides: Partial<LibraryClip> = {}): LibraryClip => ({
  id: 'clip-1',
  name: 'clip.mp4',
  duration: 10,
  kind: 'video',
  url: 'blob:test',
  ...overrides,
})

const stateOf = (
  ...entries: Array<[id: string, duration?: number, inPoint?: number, outPoint?: number]>
): TimelineState => ({
  entries: entries.map(([id, duration = 10, inPoint = 0, outPoint = duration]) => ({
    id,
    clipId: `clip-${id}`,
    name: `${id}.mp4`,
    duration,
    url: `blob:${id}`,
    inPoint,
    outPoint,
  })),
})

const order = (state: TimelineState) => state.entries.map((entry) => entry.id)

describe('entryFromClip', () => {
  it('copies clip data, keeps a reference to the source clip, and starts untrimmed', () => {
    const source = clip({ id: 'lib-9', name: 'beach.mp4', duration: 42, url: 'blob:beach' })
    expect(entryFromClip(source, 'e1')).toEqual({
      id: 'e1',
      clipId: 'lib-9',
      name: 'beach.mp4',
      duration: 42,
      url: 'blob:beach',
      inPoint: 0,
      outPoint: 42,
    })
  })

  it('refuses an audio clip — the sequence carries video and stills only (#101)', () => {
    const audio = clip({ name: 'music.mp3', kind: 'audio' })
    expect(() => entryFromClip(audio, 'e1')).toThrow(
      'cannot add "music.mp3" to the sequence: it is an audio clip',
    )
  })

  it('creates a 5-second still entry from an image clip (#140)', () => {
    const image = clip({
      id: 'lib-7',
      name: 'logo.png',
      duration: 0,
      url: 'blob:logo',
      kind: 'image',
    })
    expect(entryFromClip(image, 'e1')).toEqual({
      id: 'e1',
      clipId: 'lib-7',
      name: 'logo.png',
      duration: DEFAULT_STILL_DURATION,
      url: 'blob:logo',
      inPoint: 0,
      outPoint: DEFAULT_STILL_DURATION,
      kind: 'image',
    })
    expect(DEFAULT_STILL_DURATION).toBe(5)
  })
})

describe('timelineReducer', () => {
  it('appends added entries in order', () => {
    let state = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: entryFromClip(clip(), 'a'),
    })
    state = timelineReducer(state, { type: 'entry-added', entry: entryFromClip(clip(), 'b') })
    expect(order(state)).toEqual(['a', 'b'])
  })

  it('allows the same library clip to appear more than once', () => {
    const source = clip()
    let state = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: entryFromClip(source, 'first'),
    })
    state = timelineReducer(state, {
      type: 'entry-added',
      entry: entryFromClip(source, 'second'),
    })
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0].clipId).toBe(state.entries[1].clipId)
    expect(state.entries[0].id).not.toBe(state.entries[1].id)
  })

  it('removes an entry by id, leaving the rest in order', () => {
    const state = timelineReducer(stateOf(['a'], ['b'], ['c']), {
      type: 'entry-removed',
      id: 'b',
    })
    expect(order(state)).toEqual(['a', 'c'])
  })

  describe('entries-removed-for-clip', () => {
    it('removes every entry created from the clip, leaving the rest in order', () => {
      const source = clip({ id: 'lib-1' })
      const other = clip({ id: 'lib-2', name: 'other.mp4' })
      let state = timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(source, 'a'),
      })
      state = timelineReducer(state, { type: 'entry-added', entry: entryFromClip(other, 'b') })
      state = timelineReducer(state, { type: 'entry-added', entry: entryFromClip(source, 'c') })

      const next = timelineReducer(state, { type: 'entries-removed-for-clip', clipId: 'lib-1' })
      expect(order(next)).toEqual(['b'])
    })

    it('returns the same state when no entry uses the clip', () => {
      const start = stateOf(['a'], ['b'])
      expect(
        timelineReducer(start, { type: 'entries-removed-for-clip', clipId: 'unused' }),
      ).toBe(start)
    })
  })

  it('moves an entry up and down', () => {
    const start = stateOf(['a'], ['b'], ['c'])
    expect(order(timelineReducer(start, { type: 'entry-moved', id: 'c', direction: 'up' }))).toEqual(
      ['a', 'c', 'b'],
    )
    expect(
      order(timelineReducer(start, { type: 'entry-moved', id: 'a', direction: 'down' })),
    ).toEqual(['b', 'a', 'c'])
  })

  it('ignores moves past either end and moves of unknown ids', () => {
    const start = stateOf(['a'], ['b'])
    expect(timelineReducer(start, { type: 'entry-moved', id: 'a', direction: 'up' })).toBe(start)
    expect(timelineReducer(start, { type: 'entry-moved', id: 'b', direction: 'down' })).toBe(start)
    expect(timelineReducer(start, { type: 'entry-moved', id: 'zz', direction: 'up' })).toBe(start)
  })

  it('does not mutate the previous state', () => {
    const start = stateOf(['a'], ['b'])
    timelineReducer(start, { type: 'entry-moved', id: 'b', direction: 'up' })
    timelineReducer(start, { type: 'entry-removed', id: 'a' })
    timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: 2, outPoint: 8 })
    expect(order(start)).toEqual(['a', 'b'])
    expect(start.entries[0]).toMatchObject({ inPoint: 0, outPoint: 10 })
  })

  describe('entry-trimmed', () => {
    it('sets in and out points within the source duration', () => {
      const state = timelineReducer(stateOf(['a'], ['b']), {
        type: 'entry-trimmed',
        id: 'a',
        inPoint: 2.5,
        outPoint: 7,
      })
      expect(state.entries[0]).toMatchObject({ inPoint: 2.5, outPoint: 7 })
      expect(state.entries[1]).toMatchObject({ inPoint: 0, outPoint: 10 })
    })

    it('clamps points into [0, source duration]', () => {
      const state = timelineReducer(stateOf(['a', 10]), {
        type: 'entry-trimmed',
        id: 'a',
        inPoint: -5,
        outPoint: 99,
      })
      expect(state.entries[0]).toMatchObject({ inPoint: 0, outPoint: 10 })
    })

    it('rejects empty or inverted ranges', () => {
      const start = stateOf(['a', 10, 2, 8])
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: 8, outPoint: 8 }),
      ).toBe(start)
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: 9, outPoint: 3 }),
      ).toBe(start)
      // Clamping both above the duration collapses the range — also rejected.
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: 50, outPoint: 60 }),
      ).toBe(start)
    })

    it('rejects non-finite points and unknown ids', () => {
      const start = stateOf(['a'])
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: NaN, outPoint: 5 }),
      ).toBe(start)
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: Infinity }),
      ).toBe(start)
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'zz', inPoint: 0, outPoint: 5 }),
      ).toBe(start)
    })

    it('trims one entry independently of another sharing the same source clip', () => {
      const source = clip({ duration: 20 })
      let state = timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(source, 'first'),
      })
      state = timelineReducer(state, {
        type: 'entry-added',
        entry: entryFromClip(source, 'second'),
      })
      state = timelineReducer(state, {
        type: 'entry-trimmed',
        id: 'first',
        inPoint: 5,
        outPoint: 10,
      })
      expect(state.entries[0]).toMatchObject({ inPoint: 5, outPoint: 10 })
      expect(state.entries[1]).toMatchObject({ inPoint: 0, outPoint: 20 })
    })
  })

  describe('still entries (#140)', () => {
    const imageClip = clip({ id: 'img-1', name: 'logo.png', duration: 0, kind: 'image' })
    const stillState = () =>
      timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(imageClip, 'still'),
      })

    it('sets a still duration: duration and outPoint move together, inPoint stays 0', () => {
      const state = timelineReducer(stillState(), {
        type: 'still-duration-set',
        id: 'still',
        duration: 2.5,
      })
      expect(state.entries[0]).toMatchObject({
        duration: 2.5,
        inPoint: 0,
        outPoint: 2.5,
        kind: 'image',
      })
      expect(effectiveDuration(state.entries[0])).toBe(2.5)
      expect(isStillEntry(state.entries[0])).toBe(true)
    })

    it('accepts any positive duration, however long', () => {
      const state = timelineReducer(stillState(), {
        type: 'still-duration-set',
        id: 'still',
        duration: 600,
      })
      expect(effectiveDuration(state.entries[0])).toBe(600)
    })

    it('rejects a non-positive or non-finite duration, and unknown ids', () => {
      const start = stillState()
      expect(timelineReducer(start, { type: 'still-duration-set', id: 'still', duration: 0 })).toBe(start)
      expect(timelineReducer(start, { type: 'still-duration-set', id: 'still', duration: -1 })).toBe(start)
      expect(timelineReducer(start, { type: 'still-duration-set', id: 'still', duration: NaN })).toBe(start)
      expect(
        timelineReducer(start, { type: 'still-duration-set', id: 'still', duration: Infinity }),
      ).toBe(start)
      expect(timelineReducer(start, { type: 'still-duration-set', id: 'zz', duration: 3 })).toBe(start)
    })

    it('is a no-op at the current duration (reference-equal, so not an edit)', () => {
      const start = stillState()
      expect(
        timelineReducer(start, { type: 'still-duration-set', id: 'still', duration: 5 }),
      ).toBe(start)
    })

    it('does not apply to video entries — their length is their trim', () => {
      const start = timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(clip({ duration: 10 }), 'v'),
      })
      expect(timelineReducer(start, { type: 'still-duration-set', id: 'v', duration: 3 })).toBe(start)
    })

    it('rejects trims on a still — its one dimension is the duration', () => {
      const start = stillState()
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 'still', inPoint: 1, outPoint: 3 }),
      ).toBe(start)
    })

    it('shortening a still re-clamps its transitions and zooms like a retrim', () => {
      let state = stillState()
      state = timelineReducer(state, {
        type: 'entry-added',
        entry: entryFromClip(clip({ duration: 10 }), 'v'),
      })
      state = timelineReducer(state, {
        type: 'transition-set',
        beforeId: 'still',
        afterId: 'v',
        transition: { type: 'crossfade', duration: 4 },
      })
      state = timelineReducer(state, {
        type: 'zoom-added',
        zoom: { id: 'z1', entryId: 'still', ...DEFAULT_ZOOM, start: 2 },
      })
      state = timelineReducer(state, { type: 'still-duration-set', id: 'still', duration: 2 })
      // The 4s transition no longer fits the 2s still; the zoom window
      // (previously starting at 2) is clamped back inside [0, 2].
      expect(transitionsOf(state)[0]).toMatchObject({ duration: 2 })
      const zoom = zoomsForEntry(state, 'still')[0]
      expect(zoom.start + zoom.rampIn + zoom.hold + zoom.rampOut).toBeLessThanOrEqual(2)
    })
  })

  describe('color slates (#143)', () => {
    const slateState = () =>
      timelineReducer(emptyTimeline, { type: 'entry-added', entry: slateEntry('s1') })

    it('slateEntry: a 5-second red still with no clip and no media URL', () => {
      expect(slateEntry('s1')).toEqual({
        id: 's1',
        clipId: '',
        name: 'Color slate',
        duration: DEFAULT_STILL_DURATION,
        url: '',
        inPoint: 0,
        outPoint: DEFAULT_STILL_DURATION,
        kind: 'slate',
        color: DEFAULT_SLATE_COLOR,
      })
      expect(DEFAULT_SLATE_COLOR).toBe('#ff0000')
      expect(isStillEntry(slateEntry('s1'))).toBe(true)
      expect(isSlateEntry(slateEntry('s1'))).toBe(true)
      expect(isSlateEntry(entryFromClip(clip(), 'v'))).toBe(false)
    })

    it('slateEntry accepts any lowercase #rrggbb color and rejects other shapes', () => {
      expect(slateEntry('s1', '#0a1b2c').color).toBe('#0a1b2c')
      for (const bad of ['#FF0000', 'red', '#f00', '#ff00001', 'ff0000', '#ff000g']) {
        expect(() => slateEntry('s1', bad)).toThrow('expected lowercase #rrggbb')
        expect(isValidSlateColor(bad)).toBe(false)
      }
    })

    it('slate-color-set changes the color; invalid input, other kinds, and no-ops leave the state', () => {
      const start = slateState()
      const recolored = timelineReducer(start, { type: 'slate-color-set', id: 's1', color: '#00cc66' })
      expect(recolored.entries[0]).toMatchObject({ kind: 'slate', color: '#00cc66' })
      expect(timelineReducer(start, { type: 'slate-color-set', id: 's1', color: '#FF0000' })).toBe(start)
      expect(timelineReducer(start, { type: 'slate-color-set', id: 's1', color: DEFAULT_SLATE_COLOR })).toBe(start)
      expect(timelineReducer(start, { type: 'slate-color-set', id: 'zz', color: '#00cc66' })).toBe(start)
      const withVideo = timelineReducer(start, {
        type: 'entry-added',
        entry: entryFromClip(clip(), 'v'),
      })
      expect(timelineReducer(withVideo, { type: 'slate-color-set', id: 'v', color: '#00cc66' })).toBe(withVideo)
    })

    it('shares the still rules: settable duration, no trim', () => {
      const start = slateState()
      const resized = timelineReducer(start, { type: 'still-duration-set', id: 's1', duration: 2 })
      expect(resized.entries[0]).toMatchObject({ duration: 2, inPoint: 0, outPoint: 2 })
      expect(
        timelineReducer(start, { type: 'entry-trimmed', id: 's1', inPoint: 1, outPoint: 3 }),
      ).toBe(start)
    })

    it('a library clip removal never touches slates (their clipId matches no clip)', () => {
      const start = timelineReducer(slateState(), {
        type: 'entry-added',
        entry: entryFromClip(clip({ id: 'lib-1' }), 'v'),
      })
      const state = timelineReducer(start, { type: 'entries-removed-for-clip', clipId: 'lib-1' })
      expect(order(state)).toEqual(['s1'])
    })

    it('carries transitions on both boundaries like any entry', () => {
      let state = timelineReducer(slateState(), {
        type: 'entry-added',
        entry: entryFromClip(clip({ duration: 10 }), 'v'),
      })
      state = timelineReducer(state, {
        type: 'transition-set',
        beforeId: 's1',
        afterId: 'v',
        transition: { type: 'crossfade', duration: 1 },
      })
      expect(transitionsOf(state)[0]).toMatchObject({ beforeId: 's1', afterId: 'v', duration: 1 })
      // 5s slate + 10s video − 1s overlap.
      expect(totalDuration(state)).toBe(14)
    })
  })
})

const crossfade = (
  beforeId: string,
  afterId: string,
  duration: number,
  type: TimelineTransition['type'] = 'crossfade',
): TimelineTransition => ({ beforeId, afterId, type, duration })

const setTransition = (
  state: TimelineState,
  beforeId: string,
  afterId: string,
  duration: number,
  type: TimelineTransition['type'] = 'crossfade',
) => timelineReducer(state, { type: 'transition-set', beforeId, afterId, transition: { type, duration } })

describe('transition-set', () => {
  it('adds a transition at an adjacent boundary', () => {
    const state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 1.5, 'slide-from-above')
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 1.5, 'slide-from-above')])
  })

  it('replaces the transition already at the boundary', () => {
    let state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 1)
    state = setTransition(state, 'a', 'b', 2, 'slide-from-above')
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 2, 'slide-from-above')])
  })

  it('rejects pairs that are not adjacent in that order', () => {
    const start = stateOf(['a'], ['b'], ['c'])
    expect(setTransition(start, 'a', 'c', 1)).toBe(start)
    expect(setTransition(start, 'b', 'a', 1)).toBe(start)
    expect(setTransition(start, 'a', 'zz', 1)).toBe(start)
    expect(setTransition(start, 'zz', 'b', 1)).toBe(start)
  })

  it('rejects non-positive and non-finite durations', () => {
    const start = stateOf(['a'], ['b'])
    expect(setTransition(start, 'a', 'b', 0)).toBe(start)
    expect(setTransition(start, 'a', 'b', -1)).toBe(start)
    expect(setTransition(start, 'a', 'b', NaN)).toBe(start)
    expect(setTransition(start, 'a', 'b', Infinity)).toBe(start)
  })

  it('clamps the duration to the shorter neighbor', () => {
    // a plays 10s, b plays 3s (trimmed) — a 5s overlap cannot fit b.
    const state = setTransition(stateOf(['a'], ['b', 10, 2, 5]), 'a', 'b', 5)
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 3)])
  })

  it('keeps the transitions around one entry within its duration, earlier boundary first', () => {
    // b plays 4s; its head already overlaps a by 3s, so only 1s of tail is left for c.
    let state = setTransition(stateOf(['a'], ['b', 4], ['c']), 'a', 'b', 3)
    state = setTransition(state, 'b', 'c', 3)
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 3), crossfade('b', 'c', 1)])
  })

  it('returns the same state when nothing would change', () => {
    const state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 2)
    expect(setTransition(state, 'a', 'b', 2)).toBe(state)
    // A commit above the clamp resolves to the value already stored.
    const clamped = setTransition(stateOf(['a'], ['b', 10, 0, 3]), 'a', 'b', 99)
    expect(setTransition(clamped, 'a', 'b', 50)).toBe(clamped)
  })
})

describe('transition-removed', () => {
  it('removes the transition at the boundary, leaving others', () => {
    let state = setTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b', 1)
    state = setTransition(state, 'b', 'c', 2)
    state = timelineReducer(state, { type: 'transition-removed', beforeId: 'a', afterId: 'b' })
    expect(transitionsOf(state)).toEqual([crossfade('b', 'c', 2)])
  })

  it('returns the same state when no such transition exists', () => {
    const start = setTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b', 1)
    expect(
      timelineReducer(start, { type: 'transition-removed', beforeId: 'b', afterId: 'c' }),
    ).toBe(start)
  })
})

describe('transitions across entry edits', () => {
  const withBothTransitions = () => {
    const state = setTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b', 1)
    return setTransition(state, 'b', 'c', 2)
  }

  it('reordering drops the transitions at dissolved boundaries only', () => {
    const start = setTransition(
      setTransition(stateOf(['a'], ['b'], ['c'], ['d']), 'a', 'b', 1),
      'c',
      'd',
      2,
    )
    // [a,b,d,c]: a|b stays adjacent, c|d dissolved (now d before c).
    const state = timelineReducer(start, { type: 'entry-moved', id: 'd', direction: 'up' })
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 1)])
  })

  it('removing an entry drops the transitions on both of its boundaries', () => {
    const state = timelineReducer(withBothTransitions(), { type: 'entry-removed', id: 'b' })
    // a and c are newly adjacent but never had a transition of their own.
    expect(transitionsOf(state)).toEqual([])
    expect(state.entries).toHaveLength(2)
  })

  it('removing entries by clip drops their transitions', () => {
    const state = timelineReducer(withBothTransitions(), {
      type: 'entries-removed-for-clip',
      clipId: 'clip-a',
    })
    expect(transitionsOf(state)).toEqual([crossfade('b', 'c', 2)])
  })

  it('re-clamps a transition when a later trim shrinks a neighbor below it', () => {
    let state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 5)
    state = timelineReducer(state, { type: 'entry-trimmed', id: 'b', inPoint: 0, outPoint: 2 })
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 2)])
  })

  it('keeps a transition untouched by unrelated edits', () => {
    let state = setTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b', 1)
    state = timelineReducer(state, { type: 'entry-trimmed', id: 'c', inPoint: 1, outPoint: 9 })
    expect(transitionsOf(state)).toEqual([crossfade('a', 'b', 1)])
  })
})

describe('boundaryTransitions', () => {
  it('maps transitions to boundary indexes, undefined for hard cuts', () => {
    const state = setTransition(stateOf(['a'], ['b'], ['c']), 'b', 'c', 1.5)
    expect(boundaryTransitions(state)).toEqual([undefined, crossfade('b', 'c', 1.5)])
  })

  it('ignores stale transitions in hand-built states', () => {
    const state: TimelineState = {
      ...stateOf(['a'], ['b'], ['c']),
      transitions: [crossfade('a', 'c', 1), crossfade('b', 'a', 1)],
    }
    expect(boundaryTransitions(state)).toEqual([undefined, undefined])
  })

  it('is empty for empty and single-entry timelines', () => {
    expect(boundaryTransitions(emptyTimeline)).toEqual([])
    expect(boundaryTransitions(stateOf(['a']))).toEqual([])
  })
})

describe('effectiveDuration', () => {
  it('is the trimmed span, not the source duration', () => {
    const [entry] = stateOf(['a', 30, 5, 12.5]).entries
    expect(effectiveDuration(entry)).toBe(7.5)
  })
})

describe('totalDuration', () => {
  it('is zero for an empty timeline', () => {
    expect(totalDuration(emptyTimeline)).toBe(0)
  })

  it('sums entry durations', () => {
    expect(totalDuration(stateOf(['a', 12.5], ['b', 7.5], ['c', 30]))).toBe(50)
  })

  it('honors trims', () => {
    expect(totalDuration(stateOf(['a', 30, 10, 20], ['b', 7.5], ['c', 60, 0, 5]))).toBe(22.5)
  })

  it('shrinks by each transition’s duration', () => {
    let state = setTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b', 1)
    state = setTransition(state, 'b', 'c', 2.5)
    expect(totalDuration(state)).toBe(26.5)
  })
})

const zoom = (overrides: Partial<ZoomSpec> = {}): ZoomSpec => ({
  start: 1,
  rampIn: 0.5,
  hold: 2,
  rampOut: 0.5,
  scale: 2,
  centerX: 0.5,
  centerY: 0.5,
  ...overrides,
})

const addZoom = (state: TimelineState, entryId: string, id: string, spec: Partial<ZoomSpec> = {}) =>
  timelineReducer(state, { type: 'zoom-added', zoom: { id, entryId, ...zoom(spec) } })

const updateZoom = (state: TimelineState, id: string, spec: Partial<ZoomSpec> = {}) =>
  timelineReducer(state, { type: 'zoom-updated', id, zoom: zoom(spec) })

const zoomById = (state: TimelineState, id: string) =>
  zoomsOf(state).find((entryZoom) => entryZoom.id === id)

/** Each zoom's window as [start, end], for asserting non-overlap. */
const windowsOf = (zooms: ZoomEffect[]) =>
  zooms.map((entryZoom) => [
    entryZoom.start,
    entryZoom.start + entryZoom.rampIn + entryZoom.hold + entryZoom.rampOut,
  ])

describe('zoom-added (#63, #129)', () => {
  it('stores a zoom on an existing entry', () => {
    const state = addZoom(stateOf(['a']), 'a', 'z1')
    expect(zoomsOf(state)).toEqual([{ id: 'z1', entryId: 'a', ...zoom() }])
    expect(zoomsForEntry(state, 'a')).toHaveLength(1)
  })

  it('an entry accepts several zooms, kept sorted with disjoint windows', () => {
    // z1 [1, 4] and z2 [5, 8] on a 10s entry, added out of order.
    let state = addZoom(stateOf(['a']), 'a', 'z2', { start: 5 })
    state = addZoom(state, 'a', 'z1', { start: 1 })
    expect(zoomsForEntry(state, 'a').map((entryZoom) => entryZoom.id)).toEqual(['z1', 'z2'])
    expect(windowsOf(zoomsForEntry(state, 'a'))).toEqual([
      [1, 4],
      [5, 8],
    ])
  })

  it('resolves an added overlap by pushing the later window after the earlier one', () => {
    // z1 [1, 4], z2 [5, 8]; z3 asks for [4, 7], overlapping z2 — the sweep
    // keeps z3 (earlier start) whole and pushes z2 to start at 7, where its
    // 3s window still fits the 10s entry exactly.
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 1 })
    state = addZoom(state, 'a', 'z2', { start: 5 })
    state = addZoom(state, 'a', 'z3', { start: 4 })
    expect(zoomsForEntry(state, 'a').map((entryZoom) => entryZoom.id)).toEqual(['z1', 'z3', 'z2'])
    expect(windowsOf(zoomsForEntry(state, 'a'))).toEqual([
      [1, 4],
      [4, 7],
      [7, 10],
    ])
  })

  it('rejects a zoom for an entry that does not exist', () => {
    const state = stateOf(['a'])
    expect(addZoom(state, 'ghost', 'z1')).toBe(state)
  })

  it('rejects a duplicate zoom id — ids are the handle edits act on', () => {
    const state = addZoom(stateOf(['a'], ['b']), 'a', 'z1')
    expect(addZoom(state, 'b', 'z1')).toBe(state)
  })

  it('rejects non-finite values and a scale of 1 or less (not a zoom at all)', () => {
    const state = stateOf(['a'])
    expect(addZoom(state, 'a', 'z1', { scale: 1 })).toBe(state)
    expect(addZoom(state, 'a', 'z1', { scale: 0.5 })).toBe(state)
    expect(addZoom(state, 'a', 'z1', { scale: Number.NaN })).toBe(state)
    expect(addZoom(state, 'a', 'z1', { hold: Number.POSITIVE_INFINITY })).toBe(state)
  })

  it('vetoes an add the entry has no room for, like a no-room transition', () => {
    // z1's window covers the whole 3s trim; a second zoom could only get a
    // zero-length window, so the add is refused outright.
    const full = addZoom(stateOf(['a', 10, 0, 3]), 'a', 'z1', { start: 0 })
    expect(windowsOf(zoomsForEntry(full, 'a'))).toEqual([[0, 3]])
    expect(addZoom(full, 'a', 'z2', { start: 1 })).toBe(full)
    // A start past the trimmed duration leaves no room either.
    const state = stateOf(['a', 10, 0, 4])
    expect(addZoom(state, 'a', 'z1', { start: 99 })).toBe(state)
  })

  it('clamps an over-long window to the trimmed duration, absorbing in phase order', () => {
    // Entry a plays 4s (trim 2..6). start 1 leaves 3s: rampIn keeps its 1s,
    // hold is cut from 5s to 2s, rampOut is cut to nothing.
    const state = addZoom(stateOf(['a', 10, 2, 6]), 'a', 'z1', {
      start: 1,
      rampIn: 1,
      hold: 5,
      rampOut: 2,
    })
    expect(zoomById(state, 'z1')).toMatchObject({ start: 1, rampIn: 1, hold: 2, rampOut: 0 })
  })

  it('clamps an off-frame centre against the scale', () => {
    // At scale 2 the visible region extends 0.25 from its centre, so the
    // centre must stay within [0.25, 0.75] on both axes.
    const state = addZoom(stateOf(['a']), 'a', 'z1', { scale: 2, centerX: 0.05, centerY: 0.99 })
    expect(zoomById(state, 'z1')).toMatchObject({ centerX: 0.25, centerY: 0.75 })
  })
})

describe('zoom-updated (#129)', () => {
  it('edits one zoom by id, leaving its sibling untouched by reference', () => {
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 1 })
    state = addZoom(state, 'a', 'z2', { start: 5 })
    const sibling = zoomById(state, 'z2')
    const updated = updateZoom(state, 'z1', { start: 1, scale: 4, centerX: 0.6 })
    expect(zoomById(updated, 'z1')).toMatchObject({ scale: 4, centerX: 0.6 })
    expect(zoomById(updated, 'z2')).toBe(sibling)
  })

  it('rejects an unknown id, non-finite values, and a scale of 1 or less', () => {
    const state = addZoom(stateOf(['a']), 'a', 'z1')
    expect(updateZoom(state, 'ghost')).toBe(state)
    expect(updateZoom(state, 'z1', { scale: 1 })).toBe(state)
    expect(updateZoom(state, 'z1', { start: Number.NaN })).toBe(state)
  })

  it('clamps a start beyond the trimmed duration into range, keeping the zoom', () => {
    const state = addZoom(stateOf(['a', 10, 0, 4]), 'a', 'z1', { start: 0 })
    const updated = updateZoom(state, 'z1', { start: 99 })
    expect(zoomById(updated, 'z1')).toMatchObject({ start: 4, rampIn: 0, hold: 0, rampOut: 0 })
  })

  it('resolves an overlap introduced by an edit: the earlier window wins', () => {
    // z1 [0, 2] (tight phases), z2 [3, 6]; growing z1's hold to reach 4s
    // pushes z2 to start at z1's new end.
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 0, rampIn: 0.5, hold: 1, rampOut: 0.5 })
    state = addZoom(state, 'a', 'z2', { start: 3 })
    const updated = updateZoom(state, 'z1', { start: 0, rampIn: 0.5, hold: 3, rampOut: 0.5 })
    expect(windowsOf(zoomsForEntry(updated, 'a'))).toEqual([
      [0, 4],
      [4, 7],
    ])
  })

  it('is a no-op (same reference) when the clamp lands on what is already stored', () => {
    const state = addZoom(stateOf(['a']), 'a', 'z1', { centerX: 0.05 })
    // 0.01 clamps to the same 0.25 the stored zoom already has.
    expect(updateZoom(state, 'z1', { centerX: 0.01 })).toBe(state)
  })
})

describe('zoom-removed', () => {
  it('removes one zoom by id, keeping the entry’s other zoom', () => {
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 1 })
    state = addZoom(state, 'a', 'z2', { start: 5 })
    const removed = timelineReducer(state, { type: 'zoom-removed', id: 'z1' })
    expect(zoomsOf(removed).map((entryZoom) => entryZoom.id)).toEqual(['z2'])
    // Unknown id: a no-op that keeps the state reference.
    expect(timelineReducer(removed, { type: 'zoom-removed', id: 'z1' })).toBe(removed)
  })
})

describe('zooms across entry edits', () => {
  it('drops the zoom when its entry is removed, keeping others', () => {
    let state = addZoom(stateOf(['a'], ['b']), 'a', 'z1')
    state = addZoom(state, 'b', 'z2', { scale: 3 })
    const removed = timelineReducer(state, { type: 'entry-removed', id: 'a' })
    expect(zoomsOf(removed).map((entryZoom) => entryZoom.entryId)).toEqual(['b'])
  })

  it('re-clamps the zoom when a retrim shrinks the window, rather than dropping it', () => {
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 1, rampIn: 1, hold: 6, rampOut: 1 })
    state = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 3 })
    expect(zoomById(state, 'z1')).toMatchObject({ start: 1, rampIn: 1, hold: 1, rampOut: 0 })
  })

  it('re-clamps both zooms under a retrim: the earlier keeps its window first', () => {
    // z1 [0, 2], z2 [3, 5] on 10s; trimming to 4s clamps z2's window to
    // [3, 4], and trimming to 2.5s leaves z2 only a zero-length window at
    // the end — kept and editable, not dropped.
    let state = addZoom(stateOf(['a']), 'a', 'z1', { start: 0, rampIn: 0.5, hold: 1, rampOut: 0.5 })
    state = addZoom(state, 'a', 'z2', { start: 3, rampIn: 0.5, hold: 1, rampOut: 0.5 })
    const shorter = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 4 })
    expect(windowsOf(zoomsForEntry(shorter, 'a'))).toEqual([
      [0, 2],
      [3, 4],
    ])
    const shortest = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 2.5 })
    expect(windowsOf(zoomsForEntry(shortest, 'a'))).toEqual([
      [0, 2],
      [2.5, 2.5],
    ])
    expect(zoomsForEntry(shortest, 'a')).toHaveLength(2)
  })

  it('keeps the zoom with its entry through a move', () => {
    let state = addZoom(stateOf(['a'], ['b']), 'a', 'z1', { scale: 4, centerX: 0.6 })
    state = timelineReducer(state, { type: 'entry-moved', id: 'a', direction: 'down' })
    expect(order(state)).toEqual(['b', 'a'])
    expect(zoomById(state, 'z1')).toMatchObject({ entryId: 'a', scale: 4, centerX: 0.6 })
  })

  it('leaves transitions untouched by zoom edits, and vice versa', () => {
    let state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 2)
    state = addZoom(state, 'a', 'z1')
    expect(transitionsOf(state)).toHaveLength(1)
    expect(zoomsOf(state)).toHaveLength(1)
    const noTransition = timelineReducer(state, {
      type: 'transition-removed',
      beforeId: 'a',
      afterId: 'b',
    })
    expect(zoomsOf(noTransition)).toHaveLength(1)
  })

  it('accepts states without zooms everywhere (pre-zoom states stay valid)', () => {
    const state = stateOf(['a'])
    expect(zoomsOf(state)).toEqual([])
    expect(zoomsForEntry(state, 'a')).toEqual([])
    expect(totalDuration(state)).toBe(10)
  })
})

describe('defaultZoomFor (#129)', () => {
  const effect = (id: string, spec: Partial<ZoomSpec>): ZoomEffect => ({
    id,
    entryId: 'a',
    ...zoom(spec),
  })

  it('is the default zoom at the start of an empty entry', () => {
    expect(defaultZoomFor([], 10)).toEqual(DEFAULT_ZOOM)
  })

  it('places the default window into the first gap that fits it whole', () => {
    // Window [0, 2] occupied; the default 2s window fits at 2.
    const zooms = [effect('z1', { start: 0, rampIn: 0.5, hold: 1, rampOut: 0.5 })]
    expect(defaultZoomFor(zooms, 10)).toEqual({ ...DEFAULT_ZOOM, start: 2 })
  })

  it('shrinks the window proportionally into the widest gap when none fits', () => {
    // Windows [0, 2] and [3, 5] on 5.5s: gaps of 1s and 0.5s. The 1s gap
    // wins with every phase halved, so adding never displaces a neighbor.
    const zooms = [
      effect('z1', { start: 0, rampIn: 0.5, hold: 1, rampOut: 0.5 }),
      effect('z2', { start: 3, rampIn: 0.5, hold: 1, rampOut: 0.5 }),
    ]
    expect(defaultZoomFor(zooms, 5.5)).toEqual({
      ...DEFAULT_ZOOM,
      start: 2,
      rampIn: 0.25,
      hold: 0.5,
      rampOut: 0.25,
    })
  })

  it('is null when the windows already cover the whole trimmed duration', () => {
    const zooms = [effect('z1', { start: 0, rampIn: 0.5, hold: 2, rampOut: 0.5 })]
    expect(defaultZoomFor(zooms, 3)).toBeNull()
  })
})

describe('timeline-replaced (#77)', () => {
  it('stores the given state by reference, so the dirty baseline can match it', () => {
    const clip: LibraryClip = { id: 'c1', name: 'a.webm', duration: 5, url: 'blob:c1', kind: 'video' }
    const replacement: TimelineState = {
      entries: [entryFromClip(clip, 'e1')],
      transitions: [],
      zooms: [],
    }
    const populated = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: entryFromClip(clip, 'other'),
    })
    expect(timelineReducer(populated, { type: 'timeline-replaced', timeline: replacement })).toBe(
      replacement,
    )
  })
})

describe('normalizedTimelineState (#77)', () => {
  it('applies the reducer invariants to externally built state', () => {
    const clip: LibraryClip = { id: 'c1', name: 'a.webm', duration: 5, url: 'blob:c1', kind: 'video' }
    const first = entryFromClip(clip, 'e1')
    const second = entryFromClip(clip, 'e2')
    const state = normalizedTimelineState(
      [first, second],
      [
        // Valid boundary, but longer than either neighbor allows → clamped.
        { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 99 },
        // Not an adjacent ordered pair → dropped.
        { beforeId: 'e2', afterId: 'e1', type: 'crossfade', duration: 1 },
      ],
      [
        // Window longer than the entry → clamped to fit.
        { id: 'z1', entryId: 'e1', start: 0, rampIn: 4, hold: 4, rampOut: 4, scale: 2, centerX: 0.5, centerY: 0.5 },
        // Unknown entry → dropped.
        { id: 'z2', entryId: 'gone', start: 0, rampIn: 1, hold: 1, rampOut: 1, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
    )
    expect(state.transitions).toEqual([
      { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 5 },
    ])
    expect(state.zooms).toEqual([
      expect.objectContaining({ entryId: 'e1', start: 0, rampIn: 4, hold: 1, rampOut: 0 }),
    ])
  })
})

describe('audio tracks (#102)', () => {
  const audioClip = (overrides: Partial<LibraryClip> = {}): LibraryClip =>
    clip({ id: 'music-1', name: 'music.mp3', duration: 30, kind: 'audio', url: 'blob:music', ...overrides })

  const trackIds = (state: TimelineState) => audioTracksOf(state).map((track) => track.id)

  describe('audioTrackFromClip', () => {
    it('copies clip data, starts at the timeline origin, untrimmed', () => {
      expect(audioTrackFromClip(audioClip(), 't1')).toEqual({
        id: 't1',
        clipId: 'music-1',
        name: 'music.mp3',
        duration: 30,
        url: 'blob:music',
        offset: 0,
        inPoint: 0,
        outPoint: 30,
      })
    })

    it('refuses a video clip — its audio stays bound to the sequence entry', () => {
      expect(() => audioTrackFromClip(clip(), 't1')).toThrow(
        'cannot add "clip.mp4" as an audio track: it is not an audio clip',
      )
    })
  })

  describe('audio-track-added', () => {
    it('appends tracks in order, allowing overlap between different clips', () => {
      let state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'a'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip({ id: 'fx-1', name: 'fx.wav', url: 'blob:fx' }), 'b'),
      })
      // Both start at 0 for their full length — fully overlapping is legal
      // (two music tracks at once, #100).
      expect(trackIds(state)).toEqual(['a', 'b'])
      expect(audioTracksOf(state).every((track) => track.offset === 0)).toBe(true)
    })

    it('allows the same audio clip to appear more than once', () => {
      const source = audioClip()
      let state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(source, 'first'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(source, 'second'),
      })
      expect(trackIds(state)).toEqual(['first', 'second'])
      expect(audioTracksOf(state).map((track) => track.clipId)).toEqual(['music-1', 'music-1'])
    })

    it('does not disturb the video sequence or its effects', () => {
      let state = timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(clip(), 'e1'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 't1'),
      })
      expect(order(state)).toEqual(['e1'])
      expect(totalDuration(state)).toBe(10)
    })
  })

  describe('audio-track-removed', () => {
    it('removes exactly the named track', () => {
      let state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'a'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'b'),
      })
      state = timelineReducer(state, { type: 'audio-track-removed', id: 'a' })
      expect(trackIds(state)).toEqual(['b'])
    })

    it('is a same-reference no-op for an unknown id', () => {
      const state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'a'),
      })
      expect(timelineReducer(state, { type: 'audio-track-removed', id: 'ghost' })).toBe(state)
    })
  })

  describe('audio-track-retimed', () => {
    const placed = () =>
      timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 't1'),
      })

    it('moves the track to the new offset', () => {
      const state = timelineReducer(placed(), { type: 'audio-track-retimed', id: 't1', offset: 4.5 })
      expect(audioTracksOf(state)[0].offset).toBe(4.5)
    })

    it('clamps a negative offset to zero', () => {
      let state = timelineReducer(placed(), { type: 'audio-track-retimed', id: 't1', offset: 3 })
      state = timelineReducer(state, { type: 'audio-track-retimed', id: 't1', offset: -2 })
      expect(audioTracksOf(state)[0].offset).toBe(0)
    })

    it('allows an offset beyond the video sequence end (silent tail)', () => {
      // The sequence is empty (0s long); the track still sits at 100s.
      const state = timelineReducer(placed(), { type: 'audio-track-retimed', id: 't1', offset: 100 })
      expect(audioTracksOf(state)[0].offset).toBe(100)
    })

    it('rejects a non-finite offset and no-ops with the same reference', () => {
      const state = placed()
      expect(timelineReducer(state, { type: 'audio-track-retimed', id: 't1', offset: Number.NaN })).toBe(state)
      expect(timelineReducer(state, { type: 'audio-track-retimed', id: 't1', offset: 0 })).toBe(state)
      expect(timelineReducer(state, { type: 'audio-track-retimed', id: 'ghost', offset: 1 })).toBe(state)
    })
  })

  describe('audio-track-trimmed', () => {
    const placed = () =>
      timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 't1'),
      })

    it('stores a valid trim range', () => {
      const state = timelineReducer(placed(), {
        type: 'audio-track-trimmed',
        id: 't1',
        inPoint: 5,
        outPoint: 20,
      })
      expect(audioTracksOf(state)[0]).toMatchObject({ inPoint: 5, outPoint: 20 })
      expect(effectiveDuration(audioTracksOf(state)[0])).toBe(15)
    })

    it('clamps the range to the source duration', () => {
      const state = timelineReducer(placed(), {
        type: 'audio-track-trimmed',
        id: 't1',
        inPoint: -3,
        outPoint: 99,
      })
      expect(audioTracksOf(state)[0]).toMatchObject({ inPoint: 0, outPoint: 30 })
    })

    it('rejects empty, inverted, or non-finite ranges with the same reference', () => {
      const state = placed()
      expect(
        timelineReducer(state, { type: 'audio-track-trimmed', id: 't1', inPoint: 8, outPoint: 8 }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'audio-track-trimmed', id: 't1', inPoint: 9, outPoint: 2 }),
      ).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'audio-track-trimmed',
          id: 't1',
          inPoint: Number.NaN,
          outPoint: 5,
        }),
      ).toBe(state)
    })
  })

  describe('interaction with the library and video edits', () => {
    it('entries-removed-for-clip removes the clip audio tracks too', () => {
      let state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'a'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip({ id: 'fx-1', name: 'fx.wav' }), 'b'),
      })
      state = timelineReducer(state, { type: 'entries-removed-for-clip', clipId: 'music-1' })
      expect(trackIds(state)).toEqual(['b'])
    })

    it('entries-removed-for-clip keeps the same reference when nothing matched', () => {
      const state = timelineReducer(emptyTimeline, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 'a'),
      })
      expect(timelineReducer(state, { type: 'entries-removed-for-clip', clipId: 'ghost' })).toBe(state)
    })

    it('shortening the video sequence never retimes or retrims audio (silent tail)', () => {
      // A 10s video entry with a 30s music track laid over it, offset 8:
      // the track already extends past the sequence end.
      let state = timelineReducer(emptyTimeline, {
        type: 'entry-added',
        entry: entryFromClip(clip(), 'e1'),
      })
      state = timelineReducer(state, {
        type: 'audio-track-added',
        track: audioTrackFromClip(audioClip(), 't1'),
      })
      state = timelineReducer(state, { type: 'audio-track-retimed', id: 't1', offset: 8 })
      const before = audioTracksOf(state)[0]
      // Trim the video down to 2s — the sequence now ends before the track starts.
      state = timelineReducer(state, { type: 'entry-trimmed', id: 'e1', inPoint: 0, outPoint: 2 })
      expect(totalDuration(state)).toBe(2)
      expect(audioTracksOf(state)[0]).toEqual(before)
      // Removing the video entry entirely leaves the track untouched as well.
      state = timelineReducer(state, { type: 'entry-removed', id: 'e1' })
      expect(audioTracksOf(state)[0]).toEqual(before)
    })
  })

  describe('normalizedTimelineState with audio tracks', () => {
    it('carries tracks through and defaults to none', () => {
      const track = audioTrackFromClip(audioClip(), 't1')
      expect(audioTracksOf(normalizedTimelineState([], [], [], [track]))).toEqual([track])
      expect(audioTracksOf(normalizedTimelineState([], [], []))).toEqual([])
    })
  })
})

describe('gain: volume, mute, fades (#104)', () => {
  const audioClip = (overrides: Partial<LibraryClip> = {}): LibraryClip =>
    clip({ id: 'music-1', name: 'music.mp3', duration: 30, kind: 'audio', url: 'blob:music', ...overrides })

  const withEntry = () =>
    timelineReducer(emptyTimeline, { type: 'entry-added', entry: entryFromClip(clip(), 'e1') })

  const withTrack = () =>
    timelineReducer(emptyTimeline, {
      type: 'audio-track-added',
      track: audioTrackFromClip(audioClip(), 't1'),
    })

  describe('entry-volume-set', () => {
    it('stores a clamped volume', () => {
      expect(
        timelineReducer(withEntry(), { type: 'entry-volume-set', id: 'e1', volume: 0.4 })
          .entries[0].volume,
      ).toBe(0.4)
      expect(
        timelineReducer(withEntry(), { type: 'entry-volume-set', id: 'e1', volume: -2 })
          .entries[0].volume,
      ).toBe(0)
      // Clamping above lands on full volume — the default — so an untouched
      // entry no-ops rather than storing a redundant field.
      const state = withEntry()
      expect(timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: 7 })).toBe(state)
      const halved = timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: 0.5 })
      expect(
        timelineReducer(halved, { type: 'entry-volume-set', id: 'e1', volume: 7 }).entries[0].volume,
      ).toBe(1)
    })

    it('no-ops with the same reference on unknown id, non-finite, or unchanged value', () => {
      const state = withEntry()
      expect(timelineReducer(state, { type: 'entry-volume-set', id: 'nope', volume: 0.5 })).toBe(state)
      expect(
        timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: Number.NaN }),
      ).toBe(state)
      // Full volume is the default: setting it on an untouched entry is a no-op.
      expect(timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: 1 })).toBe(state)
      const halved = timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: 0.5 })
      expect(timelineReducer(halved, { type: 'entry-volume-set', id: 'e1', volume: 0.5 })).toBe(halved)
    })
  })

  describe('entry-mute-set', () => {
    it('stores the mute flag both ways', () => {
      const muted = timelineReducer(withEntry(), { type: 'entry-mute-set', id: 'e1', muted: true })
      expect(muted.entries[0].muted).toBe(true)
      expect(
        timelineReducer(muted, { type: 'entry-mute-set', id: 'e1', muted: false }).entries[0].muted,
      ).toBe(false)
    })

    it('no-ops with the same reference on unknown id or unchanged value', () => {
      const state = withEntry()
      expect(timelineReducer(state, { type: 'entry-mute-set', id: 'nope', muted: true })).toBe(state)
      // Unmuted is the default.
      expect(timelineReducer(state, { type: 'entry-mute-set', id: 'e1', muted: false })).toBe(state)
    })
  })

  describe('audio-track-volume-set', () => {
    it('stores a clamped volume and no-ops like the entry action', () => {
      const state = withTrack()
      expect(
        audioTracksOf(timelineReducer(state, { type: 'audio-track-volume-set', id: 't1', volume: 0.25 }))[0]
          .volume,
      ).toBe(0.25)
      // Clamping above lands on the default, so an untouched track no-ops.
      expect(timelineReducer(state, { type: 'audio-track-volume-set', id: 't1', volume: 9 })).toBe(state)
      expect(timelineReducer(state, { type: 'audio-track-volume-set', id: 'nope', volume: 0.5 })).toBe(state)
      expect(timelineReducer(state, { type: 'audio-track-volume-set', id: 't1', volume: 1 })).toBe(state)
      expect(
        timelineReducer(state, { type: 'audio-track-volume-set', id: 't1', volume: Number.POSITIVE_INFINITY }),
      ).toBe(state)
    })
  })

  describe('audio-track-fades-set', () => {
    it('stores non-negative fades that fit the trimmed length', () => {
      const state = timelineReducer(withTrack(), {
        type: 'audio-track-fades-set',
        id: 't1',
        fadeIn: 2,
        fadeOut: 3,
      })
      expect(audioTracksOf(state)[0]).toMatchObject({ fadeIn: 2, fadeOut: 3 })
    })

    it('allows fades meeting exactly in the middle', () => {
      // Track length 30: fadeIn + fadeOut = 30 is legal, more is clamped.
      const state = timelineReducer(withTrack(), {
        type: 'audio-track-fades-set',
        id: 't1',
        fadeIn: 15,
        fadeOut: 15,
      })
      expect(audioTracksOf(state)[0]).toMatchObject({ fadeIn: 15, fadeOut: 15 })
    })

    it('clamps: negatives to 0, fadeIn to the length, fadeOut to what remains', () => {
      const state = withTrack()
      // Negatives clamp to 0 — the default — so an untouched track no-ops.
      expect(
        timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: -1, fadeOut: -2 }),
      ).toBe(state)
      expect(
        audioTracksOf(
          timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: 99, fadeOut: 5 }),
        )[0],
      ).toMatchObject({ fadeIn: 30, fadeOut: 0 })
      expect(
        audioTracksOf(
          timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: 20, fadeOut: 20 }),
        )[0],
      ).toMatchObject({ fadeIn: 20, fadeOut: 10 })
    })

    it('no-ops with the same reference on unknown id, non-finite, or unchanged values', () => {
      const state = withTrack()
      expect(
        timelineReducer(state, { type: 'audio-track-fades-set', id: 'nope', fadeIn: 1, fadeOut: 1 }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: Number.NaN, fadeOut: 1 }),
      ).toBe(state)
      // No fades is the default; a clamp back to the stored values is a no-op too.
      expect(
        timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: 0, fadeOut: 0 }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'audio-track-fades-set', id: 't1', fadeIn: -5, fadeOut: 0 }),
      ).toBe(state)
    })
  })

  describe('fades under retrim', () => {
    it('retrimming a track re-clamps its fades to the new length', () => {
      let state = timelineReducer(withTrack(), {
        type: 'audio-track-fades-set',
        id: 't1',
        fadeIn: 10,
        fadeOut: 10,
      })
      // Trim 30s down to 12s: fadeIn keeps its 10, fadeOut absorbs the loss.
      state = timelineReducer(state, {
        type: 'audio-track-trimmed',
        id: 't1',
        inPoint: 10,
        outPoint: 22,
      })
      expect(audioTracksOf(state)[0]).toMatchObject({ fadeIn: 10, fadeOut: 2 })
    })

    it('normalizedTimelineState clamps overlong fades from a foreign writer', () => {
      const track = { ...audioTrackFromClip(audioClip(), 't1'), inPoint: 0, outPoint: 10, fadeIn: 8, fadeOut: 8 }
      expect(audioTracksOf(normalizedTimelineState([], [], [], [track]))[0]).toMatchObject({
        fadeIn: 8,
        fadeOut: 2,
      })
    })
  })
})

describe('time remapping (#138)', () => {
  const speedEffect = (
    id: string,
    entryId: string,
    start: number,
    end: number,
    factor: number,
  ): RemapEffect => ({ id, entryId, kind: 'speed', start, end, factor })
  const pauseEffect = (id: string, entryId: string, at: number, hold: number): RemapEffect => ({
    id,
    entryId,
    kind: 'pause',
    at,
    hold,
  })
  const added = (state: TimelineState, remap: RemapEffect) =>
    timelineReducer(state, { type: 'remap-added', remap })

  describe('remap-added', () => {
    it('adds effects and keeps an entry\'s list sorted by window start', () => {
      const one = added(stateOf(['e1']), pauseEffect('r-late', 'e1', 6, 2))
      const two = added(one, speedEffect('r-early', 'e1', 1, 3, 0.5))
      expect(remapsOf(two)).toEqual([
        speedEffect('r-early', 'e1', 1, 3, 0.5),
        pauseEffect('r-late', 'e1', 6, 2),
      ])
    })

    it('rejects an effect for an entry that does not exist', () => {
      const state = stateOf(['e1'])
      expect(added(state, speedEffect('r1', 'ghost', 1, 3, 0.5))).toBe(state)
    })

    it('rejects a duplicate effect id', () => {
      const state = added(stateOf(['e1']), pauseEffect('r1', 'e1', 2, 1))
      expect(added(state, speedEffect('r1', 'e1', 5, 7, 2))).toBe(state)
    })

    it('rejects invalid specs outright', () => {
      const state = stateOf(['e1'])
      expect(added(state, speedEffect('r1', 'e1', 1, 3, 0))).toBe(state)
      expect(added(state, speedEffect('r1', 'e1', 1, 3, -1))).toBe(state)
      expect(added(state, speedEffect('r1', 'e1', 1, 3, Number.POSITIVE_INFINITY))).toBe(state)
      expect(added(state, speedEffect('r1', 'e1', 3, 3, 0.5))).toBe(state)
      expect(added(state, speedEffect('r1', 'e1', 4, 3, 0.5))).toBe(state)
      expect(added(state, pauseEffect('r1', 'e1', 2, 0))).toBe(state)
      expect(added(state, pauseEffect('r1', 'e1', Number.NaN, 1))).toBe(state)
    })

    it('clamps the window into the trimmed range', () => {
      const state = added(stateOf(['e1', 10, 2, 8]), speedEffect('r1', 'e1', 4, 9, 0.5))
      // The trimmed range is 6 s long; positions are relative to it.
      expect(remapsOf(state)).toEqual([speedEffect('r1', 'e1', 4, 6, 0.5)])
    })

    it('vetoes a segment that normalization collapses to nothing', () => {
      const state = added(stateOf(['e1']), speedEffect('r-all', 'e1', 0, 10, 2))
      expect(added(state, speedEffect('r-late', 'e1', 10, 12, 0.5))).toBe(state)
    })

    it('a pause squeezed past the end survives, freezing the last instant', () => {
      const withSegment = added(stateOf(['e1']), speedEffect('r-all', 'e1', 0, 10, 2))
      const state = added(withSegment, pauseEffect('r-hold', 'e1', 99, 2))
      expect(remapsOf(state)).toEqual([
        speedEffect('r-all', 'e1', 0, 10, 2),
        pauseEffect('r-hold', 'e1', 10, 2),
      ])
    })

    it('rejects effects on stills — an image entry and a slate', () => {
      const image = entryFromClip(clip({ id: 'img', kind: 'image', duration: 0 }), 'e-img')
      const slate = slateEntry('e-slate')
      const state = normalizedTimelineState([image, slate], [], [])
      expect(added(state, speedEffect('r1', 'e-img', 0, 2, 0.5))).toBe(state)
      expect(added(state, pauseEffect('r2', 'e-slate', 1, 2))).toBe(state)
    })
  })

  describe('remap-updated', () => {
    const base = added(stateOf(['e1']), speedEffect('r1', 'e1', 1, 3, 0.5))

    it('replaces the spec, keeping id and entryId', () => {
      const state = timelineReducer(base, {
        type: 'remap-updated',
        id: 'r1',
        remap: { kind: 'speed', start: 2, end: 5, factor: 2 },
      })
      expect(remapsOf(state)).toEqual([speedEffect('r1', 'e1', 2, 5, 2)])
    })

    it('can change the effect kind', () => {
      const state = timelineReducer(base, {
        type: 'remap-updated',
        id: 'r1',
        remap: { kind: 'pause', at: 4, hold: 1.5 },
      })
      expect(remapsOf(state)).toEqual([pauseEffect('r1', 'e1', 4, 1.5)])
    })

    it('clamps the edited window and treats a clamp back to the stored value as a no-op', () => {
      const clamped = timelineReducer(base, {
        type: 'remap-updated',
        id: 'r1',
        remap: { kind: 'speed', start: 1, end: 30, factor: 0.5 },
      })
      expect(remapsOf(clamped)).toEqual([speedEffect('r1', 'e1', 1, 10, 0.5)])
      const noop = timelineReducer(clamped, {
        type: 'remap-updated',
        id: 'r1',
        remap: { kind: 'speed', start: 1, end: 99, factor: 0.5 },
      })
      expect(noop).toBe(clamped)
    })

    it('ignores unknown ids and invalid specs', () => {
      expect(
        timelineReducer(base, {
          type: 'remap-updated',
          id: 'ghost',
          remap: { kind: 'pause', at: 1, hold: 1 },
        }),
      ).toBe(base)
      expect(
        timelineReducer(base, {
          type: 'remap-updated',
          id: 'r1',
          remap: { kind: 'speed', start: 1, end: 3, factor: 0 },
        }),
      ).toBe(base)
    })
  })

  describe('remap-removed', () => {
    it('removes the effect and leaves siblings alone', () => {
      const both = added(
        added(stateOf(['e1']), speedEffect('r1', 'e1', 1, 3, 0.5)),
        pauseEffect('r2', 'e1', 5, 2),
      )
      const state = timelineReducer(both, { type: 'remap-removed', id: 'r1' })
      expect(remapsOf(state)).toEqual([pauseEffect('r2', 'e1', 5, 2)])
      expect(state.remaps).toBeDefined()
      // Removing the last effect drops the key, restoring the pre-remap shape.
      const empty = timelineReducer(state, { type: 'remap-removed', id: 'r2' })
      expect(empty.remaps).toBeUndefined()
    })

    it('ignores unknown ids', () => {
      const state = added(stateOf(['e1']), pauseEffect('r1', 'e1', 2, 1))
      expect(timelineReducer(state, { type: 'remap-removed', id: 'ghost' })).toBe(state)
    })
  })

  describe('normalization across edits', () => {
    it('overlapping windows sweep like zooms: the earlier wins, the later is pushed', () => {
      const first = added(stateOf(['e1']), speedEffect('r1', 'e1', 1, 4, 0.5))
      const second = added(first, speedEffect('r2', 'e1', 2, 6, 2))
      expect(remapsOf(second)).toEqual([
        speedEffect('r1', 'e1', 1, 4, 0.5),
        speedEffect('r2', 'e1', 4, 6, 2),
      ])
      const third = added(second, pauseEffect('r3', 'e1', 3, 2))
      // The pause instant inside r1's window is pushed to its end; the sweep
      // then re-floors r2 at the same spot, where it already begins.
      expect(remapsOf(third)).toEqual([
        speedEffect('r1', 'e1', 1, 4, 0.5),
        pauseEffect('r3', 'e1', 4, 2),
        speedEffect('r2', 'e1', 4, 6, 2),
      ])
    })

    it('a retrim re-clamps effects into the shrunk range', () => {
      const state = added(
        added(stateOf(['e1']), speedEffect('r1', 'e1', 2, 6, 0.5)),
        pauseEffect('r2', 'e1', 8, 3),
      )
      const trimmed = timelineReducer(state, {
        type: 'entry-trimmed',
        id: 'e1',
        inPoint: 0,
        outPoint: 5,
      })
      expect(remapsOf(trimmed)).toEqual([
        speedEffect('r1', 'e1', 2, 5, 0.5),
        pauseEffect('r2', 'e1', 5, 3),
      ])
    })

    it('removing an entry drops its effects, other entries keep theirs', () => {
      const state = added(
        added(stateOf(['e1'], ['e2']), speedEffect('r1', 'e1', 1, 3, 0.5)),
        pauseEffect('r2', 'e2', 2, 1),
      )
      const removed = timelineReducer(state, { type: 'entry-removed', id: 'e1' })
      expect(remapsOf(removed)).toEqual([pauseEffect('r2', 'e2', 2, 1)])
    })

    it('normalizedTimelineState drops effects aimed at stills', () => {
      const slate = slateEntry('e-slate')
      const state = normalizedTimelineState(
        [slate],
        [],
        [],
        [],
        [pauseEffect('r1', 'e-slate', 1, 2)],
      )
      expect(state.remaps).toBeUndefined()
    })
  })

  describe('sequence math under remaps', () => {
    it('entryOutputDuration adjusts the trimmed length by every effect', () => {
      const state = added(
        added(stateOf(['e1'], ['e2']), speedEffect('r1', 'e1', 0, 4, 0.5)),
        pauseEffect('r2', 'e1', 6, 3),
      )
      // 10 + (8 − 4) + 3 = 17; e2 is untouched.
      expect(entryOutputDuration(state.entries[0], remapsOf(state))).toBe(17)
      expect(entryOutputDuration(state.entries[1], remapsOf(state))).toBe(10)
      expect(totalDuration(state)).toBe(27)
    })

    it('a transition clamps against the remapped (shortened) output duration', () => {
      const spedUp = added(stateOf(['e1'], ['e2']), speedEffect('r1', 'e1', 0, 10, 2))
      expect(entryOutputDuration(spedUp.entries[0], remapsOf(spedUp))).toBe(5)
      const withTransition = timelineReducer(spedUp, {
        type: 'transition-set',
        beforeId: 'e1',
        afterId: 'e2',
        transition: { type: 'crossfade', duration: 8 },
      })
      expect(transitionsOf(withTransition)[0].duration).toBe(5)
      expect(totalDuration(withTransition)).toBe(10)
    })

    it('adding a remap re-clamps an existing transition that no longer fits', () => {
      const withTransition = timelineReducer(stateOf(['e1'], ['e2']), {
        type: 'transition-set',
        beforeId: 'e1',
        afterId: 'e2',
        transition: { type: 'crossfade', duration: 6 },
      })
      const spedUp = added(withTransition, speedEffect('r1', 'e1', 0, 10, 2))
      expect(transitionsOf(spedUp)[0].duration).toBe(5)
    })

    it('slowing an entry re-widens a previously clamped transition edit', () => {
      const slowed = added(stateOf(['e1', 4], ['e2']), speedEffect('r1', 'e1', 0, 4, 0.5))
      // e1's 4 trimmed seconds now occupy 8 output seconds, so a 6 s
      // transition fits where it could not without the remap.
      const state = timelineReducer(slowed, {
        type: 'transition-set',
        beforeId: 'e1',
        afterId: 'e2',
        transition: { type: 'crossfade', duration: 6 },
      })
      expect(transitionsOf(state)[0].duration).toBe(6)
    })
  })
})

describe('text overlays (#139)', () => {
  const overlay = (id: string, overrides: Partial<TextOverlay> = {}): TextOverlay => ({
    ...DEFAULT_TEXT,
    id,
    ...overrides,
  })
  const textIds = (state: TimelineState) => textsOf(state).map((text) => text.id)

  describe('text-added', () => {
    it('appends overlays in order — the stacking order', () => {
      let state = timelineReducer(emptyTimeline, { type: 'text-added', text: overlay('t1') })
      state = timelineReducer(state, {
        type: 'text-added',
        text: overlay('t2', { content: 'Subtitle', offset: 2 }),
      })
      expect(textIds(state)).toEqual(['t1', 't2'])
      expect(textsOf(state)[1]).toMatchObject({ content: 'Subtitle', offset: 2 })
    })

    it('rejects a duplicate id and an invalid spec, keeping the state reference', () => {
      const state = timelineReducer(emptyTimeline, { type: 'text-added', text: overlay('t1') })
      expect(timelineReducer(state, { type: 'text-added', text: overlay('t1') })).toBe(state)
      expect(
        timelineReducer(state, { type: 'text-added', text: overlay('t2', { content: '' }) }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'text-added', text: overlay('t2', { duration: 0 }) }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'text-added', text: overlay('t2', { color: 'red' }) }),
      ).toBe(state)
    })

    it('clamps out-of-range position and size on add', () => {
      const state = timelineReducer(emptyTimeline, {
        type: 'text-added',
        text: overlay('t1', { x: 1.5, y: -0.5, size: 2, offset: -3 }),
      })
      expect(textsOf(state)[0]).toMatchObject({ x: 1, y: 0, size: MAX_TEXT_SIZE, offset: 0 })
    })
  })

  describe('text-updated', () => {
    const base = timelineReducer(emptyTimeline, { type: 'text-added', text: overlay('t1') })
    const spec = (overrides: Partial<TextOverlay>): TextOverlay => overlay('ignored', overrides)

    it('replaces the editable fields, keeping the id', () => {
      const state = timelineReducer(base, {
        type: 'text-updated',
        id: 't1',
        text: spec({ content: 'New\nlines', font: 'serif', bold: true, color: '#00ff00' }),
      })
      expect(textsOf(state)[0]).toMatchObject({
        id: 't1',
        content: 'New\nlines',
        font: 'serif',
        bold: true,
        color: '#00ff00',
      })
    })

    it('rejects invalid specs and unknown ids, keeping the state reference', () => {
      expect(
        timelineReducer(base, { type: 'text-updated', id: 't1', text: spec({ content: '' }) }),
      ).toBe(base)
      expect(
        timelineReducer(base, { type: 'text-updated', id: 'gone', text: spec({ offset: 1 }) }),
      ).toBe(base)
    })

    it('an edit that clamps back to the stored state is a no-op', () => {
      // x clamps to 1; if the stored overlay already sits at 1, nothing moved.
      const atEdge = timelineReducer(emptyTimeline, {
        type: 'text-added',
        text: overlay('t1', { x: 1 }),
      })
      expect(
        timelineReducer(atEdge, { type: 'text-updated', id: 't1', text: spec({ x: 7 }) }),
      ).toBe(atEdge)
    })

    it('clamps fades into the duration, fadeOut absorbing the shortfall (#177)', () => {
      // Default duration 3: a 2+2 pair leaves only 1s for the fade-out.
      const state = timelineReducer(base, {
        type: 'text-updated',
        id: 't1',
        text: spec({ fadeIn: 2, fadeOut: 2 }),
      })
      expect(textsOf(state)[0]).toMatchObject({ fadeIn: 2, fadeOut: 1 })
      // Shortening the duration re-clamps the stored fades.
      const shortened = timelineReducer(state, {
        type: 'text-updated',
        id: 't1',
        text: spec({ duration: 1, fadeIn: 2, fadeOut: 1 }),
      })
      expect(textsOf(shortened)[0]).toMatchObject({ duration: 1, fadeIn: 1, fadeOut: 0 })
      // A non-finite fade is an invalid spec, not a silent 0.
      expect(
        timelineReducer(base, { type: 'text-updated', id: 't1', text: spec({ fadeIn: NaN }) }),
      ).toBe(base)
    })
  })

  describe('text-removed', () => {
    it('removes by id; removing nothing keeps the reference', () => {
      let state = timelineReducer(emptyTimeline, { type: 'text-added', text: overlay('t1') })
      state = timelineReducer(state, { type: 'text-added', text: overlay('t2') })
      const removed = timelineReducer(state, { type: 'text-removed', id: 't1' })
      expect(textIds(removed)).toEqual(['t2'])
      expect(timelineReducer(removed, { type: 'text-removed', id: 'gone' })).toBe(removed)
      // Removing the last overlay drops the key entirely, restoring the
      // pre-text state shape.
      const empty = timelineReducer(removed, { type: 'text-removed', id: 't2' })
      expect(empty).not.toHaveProperty('texts')
    })
  })

  describe('independence from video edits (the #102 anchoring decision)', () => {
    it('overlays survive entry edits and removals unchanged', () => {
      let state = stateOf(['a'], ['b'])
      state = timelineReducer(state, {
        type: 'text-added',
        text: overlay('t1', { offset: 15, duration: 4 }),
      })
      // Shorten the sequence below the overlay's window, then drop an entry:
      // the overlay keeps its absolute offset (its window may now lie past
      // the sequence end and simply never show).
      state = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 1 })
      state = timelineReducer(state, { type: 'entry-removed', id: 'b' })
      expect(textsOf(state)).toEqual([expect.objectContaining({ id: 't1', offset: 15, duration: 4 })])
    })

    it('the texts key never appears on text-free states', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'entry-trimmed',
        id: 'a',
        inPoint: 0,
        outPoint: 5,
      })
      expect(state).not.toHaveProperty('texts')
    })
  })

  describe('normalizedTimelineState with text overlays', () => {
    it('clamps a foreign writer-shaped overlay on open', () => {
      const state = normalizedTimelineState(
        [],
        [],
        [],
        [],
        [],
        [overlay('t1', { x: 2, size: 0.001, offset: -1 })],
      )
      expect(textsOf(state)[0]).toMatchObject({ x: 1, size: MIN_TEXT_SIZE, offset: 0 })
    })
  })
})

describe('overlay video layers (#145)', () => {
  const layer = (id: string, overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
    id,
    clipId: 'clip-cam',
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

  describe('video-overlay-added', () => {
    it('appends overlays in order — the stacking order', () => {
      let state = timelineReducer(stateOf(['a']), { type: 'video-overlay-added', overlay: layer('v1') })
      state = timelineReducer(state, { type: 'video-overlay-added', overlay: layer('v2') })
      expect(videoOverlaysOf(state).map((overlay) => overlay.id)).toEqual(['v1', 'v2'])
    })

    it('rejects a duplicate id, an invalid placement, and an empty trim, keeping the state reference', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1'),
      })
      expect(timelineReducer(state, { type: 'video-overlay-added', overlay: layer('v1') })).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'video-overlay-added',
          overlay: layer('v2', { x: Number.NaN }),
        }),
      ).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'video-overlay-added',
          overlay: layer('v2', { inPoint: 5, outPoint: 5 }),
        }),
      ).toBe(state)
    })

    it('clamps an out-of-range rectangle and offset on add', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1', { offset: -2, x: 0.9, width: 0.4, height: 3 }),
      })
      expect(videoOverlaysOf(state)[0]).toMatchObject({ offset: 0, width: 0.4, height: 1, y: 0 })
      expect(videoOverlaysOf(state)[0].x).toBeCloseTo(0.6, 10)
    })
  })

  describe('video-overlay-updated', () => {
    it('replaces the placement fields, keeping the identity and source binding', () => {
      let state = timelineReducer(stateOf(['a']), { type: 'video-overlay-added', overlay: layer('v1') })
      state = timelineReducer(state, {
        type: 'video-overlay-updated',
        id: 'v1',
        placement: {
          offset: 3,
          inPoint: 1,
          outPoint: 6,
          x: 0.05,
          y: 0.05,
          width: 0.5,
          height: 0.5,
          volume: 0.4,
          muted: true,
        },
      })
      expect(videoOverlaysOf(state)[0]).toEqual({
        id: 'v1',
        clipId: 'clip-cam',
        name: 'cam.webm',
        duration: 8,
        url: 'blob:cam',
        offset: 3,
        inPoint: 1,
        outPoint: 6,
        x: 0.05,
        y: 0.05,
        width: 0.5,
        height: 0.5,
        volume: 0.4,
        muted: true,
      })
    })

    it('rejects invalid placements, unknown ids, and empty trims, keeping the state reference', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1'),
      })
      const placement = (overrides: Partial<VideoOverlay>) => {
        const { offset, inPoint, outPoint, x, y, width, height } = { ...layer('v1'), ...overrides }
        return { offset, inPoint, outPoint, x, y, width, height }
      }
      expect(
        timelineReducer(state, {
          type: 'video-overlay-updated',
          id: 'v1',
          placement: placement({ width: Number.NaN }),
        }),
      ).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'video-overlay-updated',
          id: 'missing',
          placement: placement({}),
        }),
      ).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'video-overlay-updated',
          id: 'v1',
          placement: placement({ inPoint: 8, outPoint: 9 }),
        }),
      ).toBe(state)
    })

    it('an edit that clamps back to the stored state is a no-op', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1', { x: 0.7, width: 0.3 }),
      })
      // x clamps to 1 − width = 0.7 — exactly what is stored already.
      const next = timelineReducer(state, {
        type: 'video-overlay-updated',
        id: 'v1',
        placement: { offset: 1, inPoint: 0, outPoint: 8, x: 0.95, y: 0.6, width: 0.3, height: 0.3 },
      })
      expect(next).toBe(state)
    })

    it('a real edit is clamped by normalization on the way in', () => {
      const state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1'),
      })
      const next = timelineReducer(state, {
        type: 'video-overlay-updated',
        id: 'v1',
        placement: { offset: -5, inPoint: 0, outPoint: 8, x: 2, y: 0.6, width: 0.3, height: 0.3 },
      })
      expect(videoOverlaysOf(next)[0]).toMatchObject({ offset: 0, x: 0.7 })
    })
  })

  describe('video-overlay-removed', () => {
    it('removes by id; removing nothing keeps the reference', () => {
      let state = timelineReducer(stateOf(['a']), { type: 'video-overlay-added', overlay: layer('v1') })
      state = timelineReducer(state, { type: 'video-overlay-added', overlay: layer('v2') })
      const next = timelineReducer(state, { type: 'video-overlay-removed', id: 'v1' })
      expect(videoOverlaysOf(next).map((overlay) => overlay.id)).toEqual(['v2'])
      expect(timelineReducer(next, { type: 'video-overlay-removed', id: 'missing' })).toBe(next)
    })
  })

  describe('independence from video edits (the #102 anchoring decision)', () => {
    it('overlays survive entry trims, moves, and removals unchanged', () => {
      let state = timelineReducer(stateOf(['a'], ['b']), {
        type: 'video-overlay-added',
        overlay: layer('v1', { offset: 15 }),
      })
      const stored = videoOverlaysOf(state)
      state = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 2 })
      state = timelineReducer(state, { type: 'entry-moved', id: 'a', direction: 'down' })
      state = timelineReducer(state, { type: 'entry-removed', id: 'b' })
      // The window now lies past the sequence's end — kept verbatim, the
      // allowed-tail decision: it simply never shows.
      expect(videoOverlaysOf(state)).toEqual(stored)
    })

    it('removing a library clip removes the overlays created from it', () => {
      let state = timelineReducer(stateOf(['a']), {
        type: 'video-overlay-added',
        overlay: layer('v1', { clipId: 'clip-a' }),
      })
      state = timelineReducer(state, { type: 'video-overlay-added', overlay: layer('v2') })
      const next = timelineReducer(state, { type: 'entries-removed-for-clip', clipId: 'clip-a' })
      expect(next.entries).toEqual([])
      expect(videoOverlaysOf(next).map((overlay) => overlay.id)).toEqual(['v2'])
    })
  })

  it('the videoOverlays key never appears on overlay-free states', () => {
    const state = timelineReducer(stateOf(['a']), {
      type: 'entry-trimmed',
      id: 'a',
      inPoint: 1,
      outPoint: 9,
    })
    expect(state).not.toHaveProperty('videoOverlays')
    let withOverlay = timelineReducer(state, { type: 'video-overlay-added', overlay: layer('v1') })
    withOverlay = timelineReducer(withOverlay, { type: 'video-overlay-removed', id: 'v1' })
    expect(withOverlay).not.toHaveProperty('videoOverlays')
  })

  describe('normalizedTimelineState with overlay layers', () => {
    it('clamps a foreign writer-shaped overlay on open', () => {
      const state = normalizedTimelineState(
        [],
        [],
        [],
        [],
        [],
        [],
        [layer('v1', { offset: -1, x: 0.9, width: 0.5 })],
      )
      expect(videoOverlaysOf(state)[0]).toMatchObject({ offset: 0, x: 0.5, width: 0.5 })
    })
  })
})

describe('entry-split (#190)', () => {
  const split = (
    state: TimelineState,
    id: string,
    atSourceTime: number,
    newEntryId = 'e-new',
  ): TimelineState => timelineReducer(state, { type: 'entry-split', id, atSourceTime, newEntryId })

  it('splits a trimmed video entry into two halves covering the exact source range', () => {
    const state = stateOf(['e1', 10, 2, 8])
    const next = split(state, 'e1', 5)
    expect(next.entries).toHaveLength(2)
    const [first, second] = next.entries
    expect(first).toMatchObject({ id: 'e1', inPoint: 2, outPoint: 5, duration: 10 })
    expect(second).toMatchObject({ id: 'e-new', inPoint: 5, outPoint: 8, duration: 10 })
    // Identity fields carry to both halves — same source clip, same media.
    expect(second.clipId).toBe(first.clipId)
    expect(second.url).toBe(first.url)
    expect(second.name).toBe(first.name)
    expect(totalDuration(next)).toBe(totalDuration(state))
  })

  it('keeps entry order: the halves replace the original in place', () => {
    const state = stateOf(['e1'], ['e2'], ['e3'])
    expect(order(split(state, 'e2', 4))).toEqual(['e1', 'e2', 'e-new', 'e3'])
  })

  it('splits a still by duration, keeping the [0, duration] window invariant', () => {
    const state = timelineReducer(emptyTimeline, { type: 'entry-added', entry: slateEntry('s1') })
    const next = split(state, 's1', 2)
    const [first, second] = next.entries
    expect(first).toMatchObject({ id: 's1', kind: 'slate', duration: 2, inPoint: 0, outPoint: 2 })
    expect(second).toMatchObject({ id: 'e-new', kind: 'slate', duration: 3, inPoint: 0, outPoint: 3 })
    expect(second.color).toBe(first.color)
    expect(totalDuration(next)).toBe(DEFAULT_STILL_DURATION)
  })

  it('copies per-entry gain to both halves (the gain rule: carries)', () => {
    let state = stateOf(['e1'])
    state = timelineReducer(state, { type: 'entry-volume-set', id: 'e1', volume: 0.4 })
    state = timelineReducer(state, { type: 'entry-mute-set', id: 'e1', muted: true })
    const next = split(state, 'e1', 5)
    expect(next.entries[0]).toMatchObject({ volume: 0.4, muted: true })
    expect(next.entries[1]).toMatchObject({ volume: 0.4, muted: true })
  })

  it('vetoes a split at or outside the trim edges — nothing to split there', () => {
    const state = stateOf(['e1', 10, 2, 8])
    expect(split(state, 'e1', 2)).toBe(state)
    expect(split(state, 'e1', 8)).toBe(state)
    expect(split(state, 'e1', 1)).toBe(state)
    expect(split(state, 'e1', 9)).toBe(state)
    expect(split(state, 'e1', Number.NaN)).toBe(state)
  })

  it('vetoes an unknown entry and a duplicate new id', () => {
    const state = stateOf(['e1'], ['e2'])
    expect(split(state, 'ghost', 5)).toBe(state)
    expect(split(state, 'e1', 5, 'e2')).toBe(state)
  })

  describe('transitions', () => {
    const withTransitions = (): TimelineState => {
      let state = stateOf(['e1'], ['e2'], ['e3'])
      state = timelineReducer(state, {
        type: 'transition-set',
        beforeId: 'e1',
        afterId: 'e2',
        transition: { type: 'crossfade', duration: 1 },
      })
      return timelineReducer(state, {
        type: 'transition-set',
        beforeId: 'e2',
        afterId: 'e3',
        transition: { type: 'wipe-from-left', duration: 2 },
      })
    }

    it('keeps the incoming transition on the first half and moves the outgoing one to the second', () => {
      const next = split(withTransitions(), 'e2', 5)
      expect(transitionsOf(next)).toEqual([
        { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
        { beforeId: 'e-new', afterId: 'e3', type: 'wipe-from-left', duration: 2 },
      ])
      expect(totalDuration(next)).toBe(totalDuration(withTransitions()))
    })

    it('a split outside both overlaps leaves every transition duration unchanged', () => {
      // e2 occupies source [0, 10]; the crossfade overlaps its first 1s of
      // output and the wipe its last 2s. Splitting at 5 leaves halves of 5s
      // each — room for both transitions, so nothing re-clamps.
      const before = withTransitions()
      const next = split(before, 'e2', 5)
      expect(boundaryTransitions(next).map((t) => t?.duration)).toEqual([1, undefined, 2])
    })
  })

  describe('zooms', () => {
    const zoom = (id: string, entryId: string, spec: Partial<ZoomSpec> = {}): ZoomEffect => ({
      id,
      entryId,
      start: 1,
      rampIn: 0.5,
      hold: 1,
      rampOut: 0.5,
      scale: 2,
      centerX: 0.5,
      centerY: 0.5,
      ...spec,
    })
    const withZoom = (state: TimelineState, effect: ZoomEffect): TimelineState =>
      timelineReducer(state, { type: 'zoom-added', zoom: effect })

    it('keeps a zoom wholly before the cut with the first half', () => {
      const state = withZoom(stateOf(['e1', 10, 2, 8]), zoom('z1', 'e1'))
      const next = split(state, 'e1', 7) // splitRel 5; window [1, 3]
      expect(zoomsForEntry(next, 'e1')).toEqual([zoom('z1', 'e1')])
      expect(zoomsForEntry(next, 'e-new')).toEqual([])
    })

    it('moves a zoom wholly after the cut to the second half, re-anchored', () => {
      const state = withZoom(stateOf(['e1', 10, 2, 8]), zoom('z1', 'e1', { start: 3 }))
      const next = split(state, 'e1', 4) // splitRel 2; window [3, 5]
      expect(zoomsForEntry(next, 'e1')).toEqual([])
      expect(zoomsForEntry(next, 'e-new')).toEqual([zoom('z1', 'e-new', { start: 1 })])
      // The moved zoom renders at the same absolute source times: probe the
      // ramp middle and the hold.
      for (const sourceTime of [5.25, 5.5, 6, 6.5, 6.9]) {
        expect(zoomAt(next, 1, sourceTime)).toEqual(zoomAt(state, 0, sourceTime))
      }
    })

    it('cuts a zoom whose hold contains the split into two exactly rendering zooms', () => {
      const state = withZoom(stateOf(['e1', 10, 0, 10]), zoom('z1', 'e1', { start: 2, rampIn: 1, hold: 2, rampOut: 1 }))
      const next = split(state, 'e1', 4) // window [2, 6], hold [3, 5], cut at 4
      expect(zoomsForEntry(next, 'e1')).toEqual([
        zoom('z1', 'e1', { start: 2, rampIn: 1, hold: 1, rampOut: 0 }),
      ])
      expect(zoomsForEntry(next, 'e-new')).toEqual([
        zoom('e-new:z1', 'e-new', { start: 0, rampIn: 0, hold: 1, rampOut: 1 }),
      ])
      // Identical rendering across the whole window: first half up to the
      // cut, second half beyond it (probing through each half's own entry).
      for (const sourceTime of [2, 2.5, 3, 3.5, 3.99]) {
        expect(zoomAt(next, 0, sourceTime)).toEqual(zoomAt(state, 0, sourceTime))
      }
      for (const sourceTime of [4, 4.5, 5, 5.5, 5.99, 6.5]) {
        expect(zoomAt(next, 1, sourceTime)).toEqual(zoomAt(state, 0, sourceTime))
      }
    })

    it('a zoom whose ramp contains the cut stays whole with the first half and clamps (the documented fallback)', () => {
      const state = withZoom(stateOf(['e1', 10, 0, 10]), zoom('z1', 'e1', { start: 2, rampIn: 1, hold: 2, rampOut: 1 }))
      const next = split(state, 'e1', 2.5) // cut mid-rampIn
      expect(zoomsForEntry(next, 'e-new')).toEqual([])
      // Clamped into the 2.5s first half: phases collapse from the end.
      expect(zoomsForEntry(next, 'e1')).toEqual([
        zoom('z1', 'e1', { start: 2, rampIn: 0.5, hold: 0, rampOut: 0 }),
      ])
    })
  })

  describe('time remaps', () => {
    const speed = (id: string, entryId: string, start: number, end: number, factor: number): RemapEffect =>
      ({ id, entryId, kind: 'speed', start, end, factor })
    const pause = (id: string, entryId: string, at: number, hold: number): RemapEffect =>
      ({ id, entryId, kind: 'pause', at, hold })
    const withRemap = (state: TimelineState, remap: RemapEffect): TimelineState =>
      timelineReducer(state, { type: 'remap-added', remap })

    it('cuts a speed segment containing the split into two segments with the same factor', () => {
      const state = withRemap(stateOf(['e1', 10, 0, 10]), speed('r1', 'e1', 2, 6, 0.5))
      const next = split(state, 'e1', 4)
      expect(remapsOf(next)).toEqual([
        speed('r1', 'e1', 2, 4, 0.5),
        speed('e-new:r1', 'e-new', 0, 2, 0.5),
      ])
      // Output time is exactly preserved: 10 + 4 (the segment doubles) both
      // before and after, split additively across the halves.
      const remaps = remapsOf(next)
      expect(
        entryOutputDuration(next.entries[0], remaps) + entryOutputDuration(next.entries[1], remaps),
      ).toBe(entryOutputDuration(state.entries[0], remapsOf(state)))
      expect(totalDuration(next)).toBe(totalDuration(state))
    })

    it('keeps a pause at or before the cut with the first half, re-anchoring later ones', () => {
      let state = withRemap(stateOf(['e1', 10, 0, 10]), pause('r1', 'e1', 4, 2))
      state = withRemap(state, pause('r2', 'e1', 7, 1))
      const next = split(state, 'e1', 4) // the cut lands exactly on r1's instant
      expect(remapsOf(next)).toEqual([
        pause('r1', 'e1', 4, 2),
        pause('r2', 'e-new', 3, 1),
      ])
      expect(totalDuration(next)).toBe(totalDuration(state))
    })

    it('respects the trim offset: windows are relative to the in-point', () => {
      // Entry trimmed to [2, 8]; segment over source [4, 6] is window [2, 4].
      const state = withRemap(stateOf(['e1', 10, 2, 8]), speed('r1', 'e1', 2, 4, 2))
      const next = split(state, 'e1', 7) // splitRel 5: the segment is wholly before
      expect(remapsOf(next)).toEqual([speed('r1', 'e1', 2, 4, 2)])
      const nextAtFive = split(state, 'e1', 5) // splitRel 3: cuts the segment
      expect(remapsOf(nextAtFive)).toEqual([
        speed('r1', 'e1', 2, 3, 2),
        speed('e-new:r1', 'e-new', 0, 1, 2),
      ])
      expect(totalDuration(nextAtFive)).toBe(totalDuration(state))
    })
  })
})

describe('color adjustments (#192)', () => {
  const withVideoEntry = () => stateOf(['e1'])

  describe('entry-color-set', () => {
    it('stores the normalized set: identity fields drop away', () => {
      const next = timelineReducer(withVideoEntry(), {
        type: 'entry-color-set',
        id: 'e1',
        adjustments: { brightness: 150, contrast: 100, saturation: 100, look: 'sepia' },
      })
      expect(next.entries[0].colorAdjustments).toEqual({ brightness: 150, look: 'sepia' })
    })

    it('clamps the dials into 0–200', () => {
      const next = timelineReducer(withVideoEntry(), {
        type: 'entry-color-set',
        id: 'e1',
        adjustments: { brightness: 400, saturation: -50 },
      })
      expect(next.entries[0].colorAdjustments).toEqual({ brightness: 200, saturation: 0 })
    })

    it('a fully-identity set removes the key entirely — never stores {}', () => {
      const adjusted = timelineReducer(withVideoEntry(), {
        type: 'entry-color-set',
        id: 'e1',
        adjustments: { brightness: 150 },
      })
      const reset = timelineReducer(adjusted, { type: 'entry-color-set', id: 'e1', adjustments: {} })
      expect('colorAdjustments' in reset.entries[0]).toBe(false)
    })

    it('no-ops with the same reference on unknown id, invalid input, or unchanged values', () => {
      const state = withVideoEntry()
      expect(
        timelineReducer(state, { type: 'entry-color-set', id: 'nope', adjustments: { brightness: 150 } }),
      ).toBe(state)
      expect(
        timelineReducer(state, {
          type: 'entry-color-set',
          id: 'e1',
          adjustments: { brightness: Number.NaN },
        }),
      ).toBe(state)
      // Identity on an untouched entry is a no-op, not an edit.
      expect(
        timelineReducer(state, {
          type: 'entry-color-set',
          id: 'e1',
          adjustments: { brightness: 100, contrast: 100, saturation: 100 },
        }),
      ).toBe(state)
      const adjusted = timelineReducer(state, {
        type: 'entry-color-set',
        id: 'e1',
        adjustments: { look: 'grayscale' },
      })
      expect(
        timelineReducer(adjusted, { type: 'entry-color-set', id: 'e1', adjustments: { look: 'grayscale' } }),
      ).toBe(adjusted)
    })

    it('vetoes adjustments on a slate — its color is set directly (#143)', () => {
      const state = timelineReducer(withVideoEntry(), {
        type: 'entry-added',
        entry: slateEntry('s1'),
      })
      expect(
        timelineReducer(state, { type: 'entry-color-set', id: 's1', adjustments: { brightness: 150 } }),
      ).toBe(state)
    })

    it('adjusts image entries — looks apply to stills too', () => {
      const state = timelineReducer(
        { entries: [] },
        {
          type: 'entry-added',
          entry: entryFromClip(clip({ id: 'clip-img', kind: 'image', duration: 0 }), 'i1'),
        },
      )
      const next = timelineReducer(state, {
        type: 'entry-color-set',
        id: 'i1',
        adjustments: { look: 'sepia' },
      })
      expect(next.entries[0].colorAdjustments).toEqual({ look: 'sepia' })
    })

    it('adjustments survive unrelated edits and follow the entry through a split (#190)', () => {
      const adjusted = timelineReducer(stateOf(['e1'], ['e2']), {
        type: 'entry-color-set',
        id: 'e1',
        adjustments: { contrast: 130 },
      })
      const moved = timelineReducer(adjusted, { type: 'entry-moved', id: 'e2', direction: 'up' })
      expect(moved.entries.find((entry) => entry.id === 'e1')?.colorAdjustments).toEqual({
        contrast: 130,
      })
      const split = timelineReducer(adjusted, {
        type: 'entry-split',
        id: 'e1',
        atSourceTime: 5,
        newEntryId: 'e1b',
      })
      // Both halves show the same footage — both keep the look.
      expect(split.entries[0].colorAdjustments).toEqual({ contrast: 130 })
      expect(split.entries[1].colorAdjustments).toEqual({ contrast: 130 })
    })
  })

  describe('video-overlay-color-set', () => {
    const overlay = (): VideoOverlay => ({
      id: 'v1',
      clipId: 'clip-cam',
      name: 'cam.webm',
      duration: 8,
      url: 'blob:cam',
      offset: 0,
      inPoint: 0,
      outPoint: 8,
      x: 0.6,
      y: 0.6,
      width: 0.3,
      height: 0.3,
    })
    const withOverlay = () =>
      timelineReducer(stateOf(['e1']), { type: 'video-overlay-added', overlay: overlay() })

    it('stores the normalized set on the overlay and resets to no key', () => {
      const adjusted = timelineReducer(withOverlay(), {
        type: 'video-overlay-color-set',
        id: 'v1',
        adjustments: { saturation: 0, brightness: 100 },
      })
      expect(videoOverlaysOf(adjusted)[0].colorAdjustments).toEqual({ saturation: 0 })
      const reset = timelineReducer(adjusted, {
        type: 'video-overlay-color-set',
        id: 'v1',
        adjustments: {},
      })
      expect('colorAdjustments' in videoOverlaysOf(reset)[0]).toBe(false)
    })

    it('no-ops with the same reference on unknown id or unchanged values', () => {
      const state = withOverlay()
      expect(
        timelineReducer(state, {
          type: 'video-overlay-color-set',
          id: 'nope',
          adjustments: { brightness: 150 },
        }),
      ).toBe(state)
      expect(
        timelineReducer(state, { type: 'video-overlay-color-set', id: 'v1', adjustments: {} }),
      ).toBe(state)
    })

    it('survives a placement edit — the placement spread carries the adjustments', () => {
      const adjusted = timelineReducer(withOverlay(), {
        type: 'video-overlay-color-set',
        id: 'v1',
        adjustments: { look: 'grayscale' },
      })
      const moved = timelineReducer(adjusted, {
        type: 'video-overlay-updated',
        id: 'v1',
        placement: { offset: 2, inPoint: 0, outPoint: 8, x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      })
      expect(videoOverlaysOf(moved)[0].colorAdjustments).toEqual({ look: 'grayscale' })
    })
  })
})
