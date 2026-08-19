import { describe, expect, it } from 'vitest'
import type { TimelineEntry, TimelineState } from './timeline'
import {
  entryStartTime,
  isAtSequenceEnd,
  isTransitionOverlayActive,
  locateInSequence,
  sequenceTimeAt,
} from './playback'

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

/**
 * The same three entries with transitions at both boundaries (#41):
 *   e1: sequence [0, 3]     ─┐ 1s crossfade: e2 starts at 2
 *   e2: sequence [2, 12]     ─┐ 0.5s slide: e3 starts at 11.5
 *   e3: sequence [11.5, 13.5]
 * Total: 3 + 10 + 2 − 1 − 0.5 = 13.5.
 */
const withTransitions: TimelineState = {
  ...timeline,
  transitions: [
    { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
    { beforeId: 'e2', afterId: 'e3', type: 'slide-from-above', duration: 0.5 },
  ],
}

describe('overlap-aware sequence math', () => {
  it('pulls entry start times earlier by the preceding transitions', () => {
    expect(entryStartTime(withTransitions, 0)).toBe(0)
    expect(entryStartTime(withTransitions, 1)).toBe(2)
    expect(entryStartTime(withTransitions, 2)).toBe(11.5)
  })

  it('outside any overlap, locates exactly as without transitions', () => {
    expect(locateInSequence(withTransitions, 1)).toMatchObject({ index: 0, sourceTime: 3 })
    expect(locateInSequence(withTransitions, 1)?.transition).toBeUndefined()
    expect(locateInSequence(withTransitions, 5)).toMatchObject({ index: 1, sourceTime: 3 })
  })

  it('inside an overlap, keeps the outgoing entry primary and exposes the incoming one', () => {
    const location = locateInSequence(withTransitions, 2.5)!
    expect(location).toMatchObject({ index: 0, sourceTime: 4.5 })
    expect(location.transition).toMatchObject({
      type: 'crossfade',
      progress: 0.5,
      index: 1,
      sourceTime: 0.5,
    })
    expect(location.transition?.entry.id).toBe('e2')
  })

  it('starts the overlap at progress 0 and hands over exactly where the outgoing entry ends', () => {
    const start = locateInSequence(withTransitions, 2)!
    expect(start).toMatchObject({ index: 0, sourceTime: 4 })
    expect(start.transition).toMatchObject({ progress: 0, sourceTime: 0 })
    // At the outgoing entry's end the incoming entry is primary and the
    // transition is over.
    const end = locateInSequence(withTransitions, 3)!
    expect(end).toMatchObject({ index: 1, sourceTime: 1 })
    expect(end.transition).toBeUndefined()
  })

  it('carries the transition type through', () => {
    const location = locateInSequence(withTransitions, 11.75)!
    expect(location).toMatchObject({ index: 1, sourceTime: 9.75 })
    expect(location.transition).toMatchObject({
      type: 'slide-from-above',
      progress: 0.5,
      index: 2,
      sourceTime: 4.25,
    })
  })

  it('shrinks the total and the sequence end accordingly', () => {
    expect(isAtSequenceEnd(withTransitions, 13.49)).toBe(false)
    expect(isAtSequenceEnd(withTransitions, 13.5)).toBe(true)
    expect(locateInSequence(withTransitions, 13.5)).toMatchObject({ index: 2, sourceTime: 6 })
    expect(locateInSequence(withTransitions, 99)).toMatchObject({ index: 2, sourceTime: 6 })
  })

  it('keeps sequenceTimeAt the inverse of the primary location', () => {
    for (const time of [0, 0.5, 2, 2.5, 2.99, 3, 7.25, 11.5, 11.9, 12, 13.49]) {
      const location = locateInSequence(withTransitions, time)!
      expect(sequenceTimeAt(withTransitions, location.index, location.sourceTime)).toBeCloseTo(
        time,
        10,
      )
    }
  })
})

describe('isTransitionOverlayActive', () => {
  it('is active while the secondary element is engaged for the overlap it is inside', () => {
    const location = locateInSequence(withTransitions, 2.5)!
    expect(location.transition).toBeDefined()
    expect(isTransitionOverlayActive(location, location.index)).toBe(true)
  })

  it('is inactive after the handover, even while the published time still trails inside the overlap (#61)', () => {
    // The failing case behind the flash: the roles have swapped (engagement
    // cleared) but the sequence time published from the incoming element's
    // drifting clock still falls just short of the overlap's end, so the
    // location alone would style the outgoing clip onto the top layer at
    // progress ≈ 1.
    const location = locateInSequence(withTransitions, 2.99)!
    expect(location.transition?.progress).toBeCloseTo(0.99, 10)
    expect(isTransitionOverlayActive(location, null)).toBe(false)
  })

  it('is inactive when the engagement belongs to a different boundary', () => {
    const location = locateInSequence(withTransitions, 2.5)!
    expect(isTransitionOverlayActive(location, location.index + 1)).toBe(false)
  })

  it('is inactive outside any overlap, whatever the engagement says', () => {
    const location = locateInSequence(withTransitions, 5)!
    expect(location.transition).toBeUndefined()
    expect(isTransitionOverlayActive(location, location.index)).toBe(false)
    expect(isTransitionOverlayActive(null, 0)).toBe(false)
  })
})
