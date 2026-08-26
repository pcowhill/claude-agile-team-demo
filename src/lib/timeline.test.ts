import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { TimelineState, TimelineTransition, ZoomSpec } from './timeline'
import {
  audioTrackFromClip,
  audioTracksOf,
  boundaryTransitions,
  effectiveDuration,
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
  totalDuration,
  transitionsOf,
  zoomsForEntry,
  zoomsOf,
} from './timeline'
import type { ZoomEffect } from './timeline'

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
