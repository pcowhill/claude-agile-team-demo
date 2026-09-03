import { describe, expect, it } from 'vitest'
import type { AudioTrack, TimelineEntry, TimelineState } from './timeline'
import {
  audioTrackPlaybackAt,
  entryStartTime,
  frontedLocation,
  isAtSequenceEnd,
  isTransitionOverlayActive,
  locateInSequence,
  sequenceTimeAt,
  splitTargetAt,
} from './playback'
import { timelineReducer, totalDuration } from './timeline'
import { zoomAt } from './zoom'

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

describe('audioTrackPlaybackAt (#103)', () => {
  const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
    id: 't1',
    clipId: 'music-1',
    name: 'music.mp3',
    duration: 30,
    url: 'blob:music',
    offset: 5,
    inPoint: 10,
    outPoint: 22,
    ...overrides,
  })

  it('does not play before the window, cued at the in-point', () => {
    expect(audioTrackPlaybackAt(track(), 0)).toEqual({ shouldPlay: false, sourceTime: 10 })
    expect(audioTrackPlaybackAt(track(), 4.99)).toEqual({ shouldPlay: false, sourceTime: 10 })
    expect(audioTrackPlaybackAt(track(), -1)).toEqual({ shouldPlay: false, sourceTime: 10 })
  })

  it('plays from exactly the window start', () => {
    expect(audioTrackPlaybackAt(track(), 5)).toEqual({ shouldPlay: true, sourceTime: 10 })
  })

  it('maps positions inside the window through the trim', () => {
    // Trimmed length 12s at offset 5: window [5, 17), source [10, 22).
    expect(audioTrackPlaybackAt(track(), 8.5)).toEqual({ shouldPlay: true, sourceTime: 13.5 })
    expect(audioTrackPlaybackAt(track(), 16.99)).toEqual({
      shouldPlay: true,
      sourceTime: 21.99,
    })
  })

  it('stops at exactly the window end (half-open, like hard-cut boundaries)', () => {
    expect(audioTrackPlaybackAt(track(), 17)).toEqual({ shouldPlay: false, sourceTime: 22 })
    expect(audioTrackPlaybackAt(track(), 99)).toEqual({ shouldPlay: false, sourceTime: 22 })
  })

  it('is independent per track: overlapping tracks each resolve on their own', () => {
    const first = track()
    const second = track({ id: 't2', offset: 0, inPoint: 0, outPoint: 30 })
    // Position 8 is inside both windows — both play, each at its own source time.
    expect(audioTrackPlaybackAt(first, 8)).toEqual({ shouldPlay: true, sourceTime: 13 })
    expect(audioTrackPlaybackAt(second, 8)).toEqual({ shouldPlay: true, sourceTime: 8 })
  })

  it('keeps playing across the video sequence end (the #102 silent tail)', () => {
    // The mapping is sequence-agnostic: a track whose window extends past the
    // video sequence still resolves inside its whole window. The preview only
    // publishes positions up to the sequence total, so the tail is inaudible
    // there — but that is the caller's clamp, not the mapping's.
    const tail = track({ offset: 100, inPoint: 0, outPoint: 30 })
    expect(audioTrackPlaybackAt(tail, 110)).toEqual({ shouldPlay: true, sourceTime: 10 })
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

describe('time remapping in sequence math (#138)', () => {
  // e1: 10 s untrimmed, half speed over source [2, 4] (that span plays for
  // 4 s) and a 3 s pause at source 6 — output duration 15.
  // e2: 10 s untrimmed, no remap — starts at sequence 15.
  const remapped: TimelineState = {
    entries: [
      entry({ id: 'e1', clipId: 'clip-a' }),
      entry({ id: 'e2', clipId: 'clip-b', url: 'blob:clip-b' }),
    ],
    remaps: [
      { id: 'r1', entryId: 'e1', kind: 'speed', start: 2, end: 4, factor: 0.5 },
      { id: 'r2', entryId: 'e1', kind: 'pause', at: 6, hold: 3 },
    ],
  }

  it('entryStartTime accumulates remapped output durations', () => {
    expect(entryStartTime(remapped, 0)).toBe(0)
    expect(entryStartTime(remapped, 1)).toBe(15)
  })

  it('locateInSequence maps output time through the effects', () => {
    // 1:1 before the slow segment.
    expect(locateInSequence(remapped, 1)).toEqual({
      index: 0,
      entry: remapped.entries[0],
      sourceTime: 1,
    })
    // Inside the slow segment: output 4 is 2 s into a half-speed span that
    // began at source 2, so the source has advanced 1 s.
    expect(locateInSequence(remapped, 4)?.sourceTime).toBe(3)
    // The pause plateau: output [8, 11] all shows source 6.
    expect(locateInSequence(remapped, 8)?.sourceTime).toBe(6)
    expect(locateInSequence(remapped, 10)?.sourceTime).toBe(6)
    // After the pause, 1:1 again.
    expect(locateInSequence(remapped, 13)?.sourceTime).toBe(8)
    // The boundary lands on e2's start; e2 itself is unremapped.
    expect(locateInSequence(remapped, 15)).toEqual({
      index: 1,
      entry: remapped.entries[1],
      sourceTime: 0,
    })
    expect(locateInSequence(remapped, 18)?.sourceTime).toBe(3)
    // The sequence end clamps to the last entry's out-point.
    expect(locateInSequence(remapped, 99)?.sourceTime).toBe(10)
  })

  it('sequenceTimeAt is the inverse, returning where a frame is first shown', () => {
    expect(sequenceTimeAt(remapped, 0, 1)).toBe(1)
    expect(sequenceTimeAt(remapped, 0, 3)).toBe(4)
    // The paused instant spans output [8, 11]; the frame is first shown at 8.
    expect(sequenceTimeAt(remapped, 0, 6)).toBe(8)
    expect(sequenceTimeAt(remapped, 0, 8)).toBe(13)
    expect(sequenceTimeAt(remapped, 1, 3)).toBe(18)
  })

  it('a transition overlap maps the incoming remapped entry through its effects', () => {
    // e2 opens with a 1 s pause on its first frame; a 2 s crossfade overlaps
    // the boundary, so during the whole overlap the incoming entry still
    // shows source 0 (its held first frame), then advances only after its
    // pause ends.
    const state: TimelineState = {
      entries: [
        entry({ id: 'e1', clipId: 'clip-a' }),
        entry({ id: 'e2', clipId: 'clip-b', url: 'blob:clip-b' }),
      ],
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 2 }],
      remaps: [{ id: 'r1', entryId: 'e2', kind: 'pause', at: 0, hold: 1 }],
    }
    const midOverlap = locateInSequence(state, 8.5)
    expect(midOverlap?.index).toBe(0)
    expect(midOverlap?.transition?.index).toBe(1)
    expect(midOverlap?.transition?.progress).toBe(0.25)
    expect(midOverlap?.transition?.sourceTime).toBe(0)
    const lateOverlap = locateInSequence(state, 9.5)
    expect(lateOverlap?.transition?.sourceTime).toBe(0.5)
  })

  it('a remap shifts when a zoom appears in the output, not what it zooms on', () => {
    const zoomed: TimelineState = {
      entries: [entry({ id: 'e1', clipId: 'clip-a' })],
      zooms: [
        { id: 'z1', entryId: 'e1', start: 4, rampIn: 0, hold: 1, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
    }
    const slowed: TimelineState = {
      ...zoomed,
      remaps: [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 0, end: 2, factor: 0.5 }],
    }
    // Zooms key off source time (#63): the same source instant zooms
    // identically with and without the remap...
    expect(zoomAt(slowed, 0, 4.5)).toEqual(zoomAt(zoomed, 0, 4.5))
    expect(zoomAt(slowed, 0, 4.5).scale).toBe(2)
    // ...but the slowed opening delays the *sequence* moment it appears.
    expect(sequenceTimeAt(zoomed, 0, 4)).toBe(4)
    expect(sequenceTimeAt(slowed, 0, 4)).toBe(6)
  })
})

describe('splitTargetAt and split playback equivalence (#190)', () => {
  it('resolves a mid-entry playhead to the entry and the absolute source instant', () => {
    // 1.5s into e2 (sequence 4.5): source 0 + 1.5.
    expect(splitTargetAt(timeline, 4.5)).toEqual({ entryId: 'e2', atSourceTime: 1.5 })
    // 1s into e1 (trimmed [2, 5]): source 3.
    expect(splitTargetAt(timeline, 1)).toEqual({ entryId: 'e1', atSourceTime: 3 })
  })

  it('is null on an empty timeline, at boundaries, and at the sequence end', () => {
    expect(splitTargetAt({ entries: [] }, 0)).toBeNull()
    // Sequence start and the e1→e2 hard cut resolve to an entry's in-point.
    expect(splitTargetAt(timeline, 0)).toBeNull()
    expect(splitTargetAt(timeline, 3)).toBeNull()
    // The sequence end resolves to the last entry's out-point.
    expect(splitTargetAt(timeline, 15)).toBeNull()
    expect(splitTargetAt(timeline, 99)).toBeNull()
  })

  it('is null inside a transition overlap', () => {
    const withTransition: TimelineState = {
      ...timeline,
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
    }
    // The overlap covers sequence [2, 3): e1's tail and e2's head both play.
    expect(splitTargetAt(withTransition, 2.5)).toBeNull()
    // Just before the overlap, e1 splits normally.
    expect(splitTargetAt(withTransition, 1.9)).toEqual({ entryId: 'e1', atSourceTime: 3.9 })
  })

  it('maps a playhead inside a pause plateau to the frozen instant — and is null when that instant is the in-point', () => {
    const paused: TimelineState = {
      entries: [entry({ id: 'e1' })],
      remaps: [{ id: 'r1', entryId: 'e1', kind: 'pause', at: 4, hold: 2 }],
    }
    // Sequence 5 is inside the plateau (output [4, 6]) — the frozen source
    // instant, strictly inside the trim, is the cut.
    expect(splitTargetAt(paused, 5)).toEqual({ entryId: 'e1', atSourceTime: 4 })
    const pausedAtStart: TimelineState = {
      entries: [entry({ id: 'e1' })],
      remaps: [{ id: 'r1', entryId: 'e1', kind: 'pause', at: 0, hold: 2 }],
    }
    // The plateau holds the very first frame: no strictly-inside instant.
    expect(splitTargetAt(pausedAtStart, 1)).toBeNull()
  })

  it('an untouched split plays back indistinguishably from the original (the #190 core criterion)', () => {
    // A remapped, zoomed, transitioned timeline: e2 carries a half-speed
    // segment and a zoom; crossfades sit on both of e2's boundaries.
    const before: TimelineState = {
      entries: [
        entry({ id: 'e1', clipId: 'clip-a', inPoint: 2, outPoint: 5 }),
        entry({ id: 'e2', clipId: 'clip-b', url: 'blob:clip-b' }),
        entry({ id: 'e3', clipId: 'clip-a', inPoint: 4, outPoint: 6 }),
      ],
      transitions: [
        { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
        { beforeId: 'e2', afterId: 'e3', type: 'slide-from-left', duration: 1 },
      ],
      zooms: [
        { id: 'z1', entryId: 'e2', start: 1, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
      remaps: [{ id: 'r1', entryId: 'e2', kind: 'speed', start: 4, end: 6, factor: 0.5 }],
    }
    // Split e2 at source 5 — inside the speed segment, away from both
    // overlaps (e2 occupies sequence [2, 13] before its output lengthens).
    const after = timelineReducer(before, {
      type: 'entry-split',
      id: 'e2',
      atSourceTime: 5,
      newEntryId: 'e2b',
    })
    expect(after.entries).toHaveLength(4)
    expect(totalDuration(after)).toBeCloseTo(totalDuration(before), 10)
    // Probe the whole sequence densely: the same media must show the same
    // source instant, under the same zoom, with a transition overlap at the
    // same progress, at every moment.
    const total = totalDuration(before)
    for (let time = 0; time < total; time += 0.05) {
      const original = locateInSequence(before, time)
      const split = locateInSequence(after, time)
      expect(split, `at ${time}`).not.toBeNull()
      expect(split?.entry.url, `url at ${time}`).toBe(original?.entry.url)
      expect(split?.sourceTime, `source at ${time}`).toBeCloseTo(original?.sourceTime ?? -1, 10)
      expect(split?.transition?.type, `transition at ${time}`).toBe(original?.transition?.type)
      expect(split?.transition?.progress ?? -1, `progress at ${time}`).toBeCloseTo(
        original?.transition?.progress ?? -1,
        10,
      )
      expect(
        zoomAt(after, split?.index ?? 0, split?.sourceTime ?? 0),
        `zoom at ${time}`,
      ).toEqual(zoomAt(before, original?.index ?? 0, original?.sourceTime ?? 0))
    }
  })
})

describe('frontedLocation (#318)', () => {
  /**
   * Two entries with a 1s crossfade: e1 covers sequence [0, 4), e2 begins at
   * 3, so the overlap is [3, 4) and the sequence totals 7.
   */
  const withTransition: TimelineState = {
    entries: [
      entry({ id: 'e1', clipId: 'clip-a', inPoint: 0, outPoint: 4 }),
      entry({ id: 'e2', clipId: 'clip-b', url: 'blob:clip-b', inPoint: 0, outPoint: 4 }),
    ],
    transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
  }
  const at = (time: number) => locateInSequence(withTransition, time)

  it('corrects a published time still inside the overlap the player has left', () => {
    // The handover happened (index 1 is cued) but the incoming element's
    // clock lags, so the published time is 50ms short of the overlap's end.
    const raw = at(3.95)
    expect(raw?.index).toBe(0)
    expect(raw?.transition?.index).toBe(1)

    const fronted = frontedLocation(withTransition, raw, 1)
    // The incoming entry fronts, at the geometric handover point — one
    // transition duration into it — and the finished transition is gone.
    expect(fronted?.index).toBe(1)
    expect(fronted?.entry.id).toBe('e2')
    expect(fronted?.sourceTime).toBeCloseTo(1, 10)
    expect(fronted?.transition).toBeUndefined()
  })

  it('leaves a location alone while the player is still on it', () => {
    // Mid-overlap before the handover: index 0 is cued, so the transition is
    // genuinely running and must keep rendering.
    const raw = at(3.5)
    expect(frontedLocation(withTransition, raw, 0)).toBe(raw)
    // And outside any overlap.
    const plain = at(1)
    expect(frontedLocation(withTransition, plain, 0)).toBe(plain)
  })

  it('does not hold the playhead forward when the player moves back', () => {
    // Scrubbing back into the overlap re-cues entry 0, so playedIndex is 0
    // again and the transition renders — the guard only ever looks forward.
    const raw = at(3.5)
    expect(frontedLocation(withTransition, raw, 0)?.transition?.index).toBe(1)
  })

  it('passes through a null location and a played index past the end', () => {
    expect(frontedLocation({ entries: [] }, null, 0)).toBeNull()
    // An edit can drop entries between a cue and the next render; a played
    // index no entry answers to is not a correction we can make.
    const raw = at(3.95)
    expect(frontedLocation(withTransition, raw, 2)).toBe(raw)
  })

  it('is the identity on a timeline without transitions', () => {
    // Every hard-cut position resolves to the entry the player is on, so
    // nothing is ever corrected — the pre-#318 behavior, unchanged.
    const total = totalDuration(timeline)
    for (let time = 0; time <= total; time += 0.25) {
      const raw = locateInSequence(timeline, time)
      expect(frontedLocation(timeline, raw, raw?.index ?? 0), `at ${time}`).toBe(raw)
    }
  })
})
