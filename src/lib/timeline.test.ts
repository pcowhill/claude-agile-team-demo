import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { TimelineState } from './timeline'
import { emptyTimeline, timelineDuration, timelineReducer } from './timeline'

const clip = (id: string, duration: number): LibraryClip => ({
  id,
  name: `${id}.mp4`,
  duration,
  url: `blob:${id}`,
})

const stateOf = (...clipIds: string[]): TimelineState => ({
  entries: clipIds.map((clipId, i) => ({ id: `e${i + 1}`, clipId })),
})

describe('timelineReducer', () => {
  it('appends added entries in order', () => {
    let state = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: { id: 'e1', clipId: 'a' },
    })
    state = timelineReducer(state, { type: 'entry-added', entry: { id: 'e2', clipId: 'b' } })
    expect(state.entries.map((e) => e.clipId)).toEqual(['a', 'b'])
  })

  it('allows the same clip to appear more than once', () => {
    let state = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: { id: 'e1', clipId: 'a' },
    })
    state = timelineReducer(state, { type: 'entry-added', entry: { id: 'e2', clipId: 'a' } })
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0].id).not.toBe(state.entries[1].id)
  })

  it('removes an entry by id', () => {
    const state = timelineReducer(stateOf('a', 'b', 'c'), {
      type: 'entry-removed',
      entryId: 'e2',
    })
    expect(state.entries.map((e) => e.clipId)).toEqual(['a', 'c'])
  })

  it('moves an entry up and down', () => {
    let state = timelineReducer(stateOf('a', 'b', 'c'), {
      type: 'entry-moved',
      entryId: 'e3',
      direction: 'up',
    })
    expect(state.entries.map((e) => e.clipId)).toEqual(['a', 'c', 'b'])
    state = timelineReducer(state, { type: 'entry-moved', entryId: 'e3', direction: 'down' })
    expect(state.entries.map((e) => e.clipId)).toEqual(['a', 'b', 'c'])
  })

  it('ignores moves past either boundary', () => {
    const state = stateOf('a', 'b')
    expect(timelineReducer(state, { type: 'entry-moved', entryId: 'e1', direction: 'up' })).toBe(
      state,
    )
    expect(timelineReducer(state, { type: 'entry-moved', entryId: 'e2', direction: 'down' })).toBe(
      state,
    )
  })

  it('ignores operations on unknown entry ids', () => {
    const state = stateOf('a')
    expect(timelineReducer(state, { type: 'entry-moved', entryId: 'nope', direction: 'up' })).toBe(
      state,
    )
    expect(
      timelineReducer(state, { type: 'entry-removed', entryId: 'nope' }).entries,
    ).toHaveLength(1)
  })

  it('does not mutate previous state', () => {
    const state = stateOf('a', 'b')
    timelineReducer(state, { type: 'entry-moved', entryId: 'e2', direction: 'up' })
    expect(state.entries.map((e) => e.clipId)).toEqual(['a', 'b'])
  })
})

describe('timelineDuration', () => {
  const clips = [clip('a', 10), clip('b', 2.5)]

  it('is zero for an empty timeline', () => {
    expect(timelineDuration(emptyTimeline, clips)).toBe(0)
  })

  it('sums entry durations, counting repeated clips each time', () => {
    expect(timelineDuration(stateOf('a', 'b', 'a'), clips)).toBe(22.5)
  })

  it('counts entries with missing clips as zero', () => {
    expect(timelineDuration(stateOf('a', 'ghost'), clips)).toBe(10)
  })
})
