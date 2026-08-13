import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { TimelineState, TimelineTransition } from './timeline'
import {
  boundaryTransitions,
  effectiveDuration,
  emptyTimeline,
  entryFromClip,
  timelineReducer,
  totalDuration,
  transitionsOf,
} from './timeline'

const clip = (overrides: Partial<LibraryClip> = {}): LibraryClip => ({
  id: 'clip-1',
  name: 'clip.mp4',
  duration: 10,
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
