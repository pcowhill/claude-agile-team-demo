import { describe, expect, it } from 'vitest'
import type { TimelineEntry, TimelineState } from './timeline'
import { entryStartTime, isAtSequenceEnd, locateInSequence, sequenceTimeAt } from './playback'

const entry = (overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry => ({
  clipId: 'clip-a',
  name: 'clip.webm',
  duration: 10,
  url: 'blob:clip-a',
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

/**
 * Three entries, two of them the same source clip with different trims —
 * the acceptance-criteria shape from issue #8:
 *   e1: source [2, 5)  → sequence [0, 3)
 *   e2: source [0, 10) → sequence [3, 13)
 *   e3: source [4, 6)  → sequence [13, 15)   (same source clip as e1)
 */
const timeline: TimelineState = {
  entries: [
    entry({ id: 'e1', clipId: 'clip-a', inPoint: 2, outPoint: 5 }),
    entry({ id: 'e2', clipId: 'clip-b', url: 'blob:clip-b' }),
    entry({ id: 'e3', clipId: 'clip-a', inPoint: 4, outPoint: 6 }),
  ],
}

describe('entryStartTime', () => {
  it('accumulates trimmed durations of preceding entries', () => {
    expect(entryStartTime(timeline, 0)).toBe(0)
    expect(entryStartTime(timeline, 1)).toBe(3)
    expect(entryStartTime(timeline, 2)).toBe(13)
  })
})

describe('locateInSequence', () => {
  it('returns null for an empty timeline', () => {
    expect(locateInSequence({ entries: [] }, 0)).toBeNull()
  })

  it('maps a time inside the first entry, offset by its in-point', () => {
    const location = locateInSequence(timeline, 1)
    expect(location).toMatchObject({ index: 0, sourceTime: 3 })
    expect(location?.entry.id).toBe('e1')
  })

  it('maps times across entries, including duplicated sources with different trims', () => {
    expect(locateInSequence(timeline, 5)).toMatchObject({ index: 1, sourceTime: 2 })
    expect(locateInSequence(timeline, 14.5)).toMatchObject({ index: 2, sourceTime: 5.5 })
  })

  it('resolves an exact boundary to the start of the later entry', () => {
    expect(locateInSequence(timeline, 3)).toMatchObject({ index: 1, sourceTime: 0 })
    expect(locateInSequence(timeline, 13)).toMatchObject({ index: 2, sourceTime: 4 })
  })

  it('clamps times before the start and past the end', () => {
    expect(locateInSequence(timeline, -1)).toMatchObject({ index: 0, sourceTime: 2 })
    expect(locateInSequence(timeline, 99)).toMatchObject({ index: 2, sourceTime: 6 })
  })

  it('resolves the exact sequence end to the last entry at its out-point', () => {
    expect(locateInSequence(timeline, 15)).toMatchObject({ index: 2, sourceTime: 6 })
  })

  it('handles a single-entry timeline', () => {
    const single: TimelineState = { entries: [entry({ id: 'only', inPoint: 1, outPoint: 4 })] }
    expect(locateInSequence(single, 0)).toMatchObject({ index: 0, sourceTime: 1 })
    expect(locateInSequence(single, 2.5)).toMatchObject({ index: 0, sourceTime: 3.5 })
    expect(locateInSequence(single, 3)).toMatchObject({ index: 0, sourceTime: 4 })
  })
})

describe('sequenceTimeAt', () => {
  it('is the inverse of locateInSequence within an entry', () => {
    expect(sequenceTimeAt(timeline, 0, 3)).toBe(1)
    expect(sequenceTimeAt(timeline, 1, 2)).toBe(5)
    expect(sequenceTimeAt(timeline, 2, 5.5)).toBe(14.5)
  })

  it('clamps source times outside the trimmed range', () => {
    expect(sequenceTimeAt(timeline, 0, 0)).toBe(0)
    expect(sequenceTimeAt(timeline, 0, 9)).toBe(3)
  })

  it('round-trips every representative sequence time', () => {
    for (const time of [0, 0.5, 3, 7.25, 13, 14.99]) {
      const location = locateInSequence(timeline, time)!
      expect(sequenceTimeAt(timeline, location.index, location.sourceTime)).toBeCloseTo(time, 10)
    }
  })
})

describe('isAtSequenceEnd', () => {
  it('is true only at or past the total trimmed duration', () => {
    expect(isAtSequenceEnd(timeline, 14.99)).toBe(false)
    expect(isAtSequenceEnd(timeline, 15)).toBe(true)
    expect(isAtSequenceEnd(timeline, 16)).toBe(true)
  })
})
