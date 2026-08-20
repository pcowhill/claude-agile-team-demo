import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { TimelineState, TimelineTransition, ZoomSpec } from './timeline'
import {
  boundaryTransitions,
  effectiveDuration,
  emptyTimeline,
  entryFromClip,
  normalizedTimelineState,
  timelineReducer,
  totalDuration,
  transitionsOf,
  zoomForEntry,
  zoomsOf,
} from './timeline'

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

  it('refuses an audio clip — the sequence carries video only (#101)', () => {
    const audio = clip({ name: 'music.mp3', kind: 'audio' })
    expect(() => entryFromClip(audio, 'e1')).toThrow(
      'cannot add "music.mp3" to the sequence: it is not a video clip',
    )
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

const setZoom = (state: TimelineState, entryId: string, spec: Partial<ZoomSpec> = {}) =>
  timelineReducer(state, { type: 'zoom-set', entryId, zoom: zoom(spec) })

describe('zoom-set', () => {
  it('stores a zoom on an existing entry', () => {
    const state = setZoom(stateOf(['a']), 'a')
    expect(zoomsOf(state)).toEqual([{ entryId: 'a', ...zoom() }])
    expect(zoomForEntry(state, 'a')).toBeDefined()
  })

  it('keeps at most one zoom per entry: a second set replaces the first', () => {
    let state = setZoom(stateOf(['a']), 'a', { scale: 2 })
    state = setZoom(state, 'a', { scale: 3, centerX: 0.6 })
    expect(zoomsOf(state)).toHaveLength(1)
    expect(zoomForEntry(state, 'a')?.scale).toBe(3)
  })

  it('rejects a zoom for an entry that does not exist', () => {
    const state = stateOf(['a'])
    expect(setZoom(state, 'ghost')).toBe(state)
  })

  it('rejects non-finite values and a scale of 1 or less (not a zoom at all)', () => {
    const state = stateOf(['a'])
    expect(setZoom(state, 'a', { scale: 1 })).toBe(state)
    expect(setZoom(state, 'a', { scale: 0.5 })).toBe(state)
    expect(setZoom(state, 'a', { scale: Number.NaN })).toBe(state)
    expect(setZoom(state, 'a', { hold: Number.POSITIVE_INFINITY })).toBe(state)
  })

  it('clamps an over-long window to the trimmed duration, absorbing in phase order', () => {
    // Entry a plays 4s (trim 2..6). start 1 leaves 3s: rampIn keeps its 1s,
    // hold is cut from 5s to 2s, rampOut is cut to nothing.
    const state = setZoom(stateOf(['a', 10, 2, 6]), 'a', {
      start: 1,
      rampIn: 1,
      hold: 5,
      rampOut: 2,
    })
    expect(zoomForEntry(state, 'a')).toMatchObject({ start: 1, rampIn: 1, hold: 2, rampOut: 0 })
  })

  it('clamps a start beyond the trimmed duration into range', () => {
    const state = setZoom(stateOf(['a', 10, 0, 4]), 'a', { start: 99 })
    expect(zoomForEntry(state, 'a')).toMatchObject({ start: 4, rampIn: 0, hold: 0, rampOut: 0 })
  })

  it('clamps an off-frame centre against the scale', () => {
    // At scale 2 the visible region extends 0.25 from its centre, so the
    // centre must stay within [0.25, 0.75] on both axes.
    const state = setZoom(stateOf(['a']), 'a', { scale: 2, centerX: 0.05, centerY: 0.99 })
    expect(zoomForEntry(state, 'a')).toMatchObject({ centerX: 0.25, centerY: 0.75 })
  })

  it('is a no-op (same reference) when the clamp lands on what is already stored', () => {
    const state = setZoom(stateOf(['a']), 'a', { centerX: 0.05 })
    // 0.01 clamps to the same 0.25 the stored zoom already has.
    expect(setZoom(state, 'a', { centerX: 0.01 })).toBe(state)
  })
})

describe('zoom-removed', () => {
  it('removes the entry zoom and is a no-op when there is none', () => {
    const state = setZoom(stateOf(['a']), 'a')
    const removed = timelineReducer(state, { type: 'zoom-removed', entryId: 'a' })
    expect(zoomsOf(removed)).toEqual([])
    expect(timelineReducer(removed, { type: 'zoom-removed', entryId: 'a' })).toBe(removed)
  })
})

describe('zooms across entry edits', () => {
  it('drops the zoom when its entry is removed, keeping others', () => {
    let state = setZoom(stateOf(['a'], ['b']), 'a')
    state = setZoom(state, 'b', { scale: 3 })
    const removed = timelineReducer(state, { type: 'entry-removed', id: 'a' })
    expect(zoomsOf(removed).map((entryZoom) => entryZoom.entryId)).toEqual(['b'])
  })

  it('re-clamps the zoom when a retrim shrinks the window, rather than dropping it', () => {
    let state = setZoom(stateOf(['a']), 'a', { start: 1, rampIn: 1, hold: 6, rampOut: 1 })
    state = timelineReducer(state, { type: 'entry-trimmed', id: 'a', inPoint: 0, outPoint: 3 })
    expect(zoomForEntry(state, 'a')).toMatchObject({ start: 1, rampIn: 1, hold: 1, rampOut: 0 })
  })

  it('keeps the zoom with its entry through a move', () => {
    let state = setZoom(stateOf(['a'], ['b']), 'a', { scale: 4, centerX: 0.6 })
    state = timelineReducer(state, { type: 'entry-moved', id: 'a', direction: 'down' })
    expect(order(state)).toEqual(['b', 'a'])
    expect(zoomForEntry(state, 'a')).toMatchObject({ scale: 4, centerX: 0.6 })
  })

  it('leaves transitions untouched by zoom edits, and vice versa', () => {
    let state = setTransition(stateOf(['a'], ['b']), 'a', 'b', 2)
    state = setZoom(state, 'a')
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
    expect(zoomForEntry(state, 'a')).toBeUndefined()
    expect(totalDuration(state)).toBe(10)
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
        { entryId: 'e1', start: 0, rampIn: 4, hold: 4, rampOut: 4, scale: 2, centerX: 0.5, centerY: 0.5 },
        // Unknown entry → dropped.
        { entryId: 'gone', start: 0, rampIn: 1, hold: 1, rampOut: 1, scale: 2, centerX: 0.5, centerY: 0.5 },
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
