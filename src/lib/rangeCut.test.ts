import { describe, expect, it } from 'vitest'
import type { RemapEffect, TimelineState, ZoomEffect } from './timeline'
import {
  rangeCutPlanFor,
  remapsOf,
  slateEntry,
  timelineReducer,
  totalDuration,
  transitionsOf,
  zoomsOf,
} from './timeline'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import { planRangeCut } from './rangeCut'

// Cut out marked range (#823): the plan (rangeCut.ts) and the `range-cut`
// action that carries it out (timeline.ts).

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

const cut = (state: TimelineState, from: number, to: number): TimelineState =>
  timelineReducer(state, { type: 'range-cut', from, to, newEntryIds: ['mid', 'tail'] })

const trims = (state: TimelineState) =>
  state.entries.map((entry) => [entry.id, entry.inPoint, entry.outPoint])

const speed = (id: string, entryId: string, start: number, end: number, factor: number): RemapEffect => ({
  id,
  entryId,
  kind: 'speed',
  start,
  end,
  factor,
})
const pause = (id: string, entryId: string, at: number, hold: number): RemapEffect => ({
  id,
  entryId,
  kind: 'pause',
  at,
  hold,
})
const withRemap = (state: TimelineState, remap: RemapEffect): TimelineState =>
  timelineReducer(state, { type: 'remap-added', remap })
const zoom = (id: string, entryId: string, start: number): ZoomEffect => ({
  id,
  entryId,
  start,
  rampIn: 0.5,
  hold: 1,
  rampOut: 0.5,
  scale: 2,
  centerX: 0.5,
  centerY: 0.5,
})
const withTransition = (state: TimelineState, beforeId: string, afterId: string, duration = 1) =>
  timelineReducer(state, {
    type: 'transition-set',
    beforeId,
    afterId,
    transition: { type: 'crossfade', duration },
  })

describe('range-cut (#823)', () => {
  describe('where the marks fall', () => {
    it('a range inside one entry leaves its two ends, the second under the new tail id', () => {
      const state = stateOf(['a'])
      const next = cut(state, 2, 5)
      expect(trims(next)).toEqual([
        ['a', 0, 2],
        ['tail', 5, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(7, 9)
    })

    it('a range spanning a cut trims both entries and keeps everything else', () => {
      const state = stateOf(['a'], ['b'], ['c'])
      const next = cut(state, 8, 13)
      expect(trims(next)).toEqual([
        ['a', 0, 8],
        ['tail', 3, 10],
        ['c', 0, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(25, 9)
    })

    it('an entry wholly inside the range is removed', () => {
      const state = stateOf(['a'], ['b'], ['c'])
      const next = cut(state, 5, 25)
      expect(trims(next)).toEqual([
        ['a', 0, 5],
        ['tail', 5, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(10, 9)
    })

    it('a range starting exactly on a cut splits only at its end', () => {
      const state = stateOf(['a'], ['b'])
      const next = cut(state, 10, 13)
      expect(trims(next)).toEqual([
        ['a', 0, 10],
        ['tail', 3, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(17, 9)
    })

    it('a range ending exactly on a cut splits only at its start', () => {
      const state = stateOf(['a'], ['b'])
      const next = cut(state, 5, 10)
      expect(trims(next)).toEqual([
        ['a', 0, 5],
        ['b', 0, 10],
      ])
    })

    it('a range from the sequence start, or to its end, removes the head or the tail', () => {
      const state = stateOf(['a'], ['b'])
      expect(trims(cut(state, 0, 13))).toEqual([['tail', 3, 10]])
      expect(trims(cut(state, 7, 20))).toEqual([['a', 0, 7]])
    })

    it('a mark a rounding error off a cut counts as on it, leaving no sliver', () => {
      const state = stateOf(['a'], ['b'])
      expect(trims(cut(state, 10 - 1e-9, 13))).toEqual([
        ['a', 0, 10],
        ['tail', 3, 10],
      ])
    })

    it('respects the trim offset: marks are output time, splits source time', () => {
      const state = stateOf(['a', 20, 4, 14], ['b'])
      expect(trims(cut(state, 3, 12))).toEqual([
        ['a', 4, 7],
        ['tail', 2, 10],
      ])
    })

    it('cuts a still and a slate by duration, as the razor does', () => {
      let state = timelineReducer({ entries: [] }, { type: 'entry-added', entry: slateEntry('s') })
      state = timelineReducer(state, { type: 'entry-added', entry: stateOf(['a']).entries[0] })
      const next = cut(state, 3, 7) // the slate is 5 s: keep 3 s of it, and a from 2 s
      expect(next.entries.map((entry) => [entry.id, entry.duration, entry.outPoint])).toEqual([
        ['s', 3, 3],
        ['tail', 10, 10],
      ])
      expect(next.entries[1].inPoint).toBe(2)
      expect(totalDuration(next)).toBeCloseTo(11, 9)
    })
  })

  describe('total duration falls by exactly the range', () => {
    it('across an entry carrying a 2× speed segment, output time is what is removed', () => {
      // Source [2, 6] plays at 2× in 2 s, so the entry plays for 8 s:
      // output 3 is source 4, output 5 is source 7.
      const state = withRemap(stateOf(['a'], ['b']), speed('s1', 'a', 2, 6, 2))
      expect(totalDuration(state)).toBeCloseTo(18, 9)
      const next = cut(state, 3, 5)
      expect(trims(next)).toEqual([
        ['a', 0, 4],
        ['tail', 7, 10],
        ['b', 0, 10],
      ])
      expect(remapsOf(next)).toEqual([speed('s1', 'a', 2, 4, 2)])
      expect(totalDuration(next)).toBeCloseTo(16, 9)
    })

    it('across a 2× segment spanning a cut into the next entry', () => {
      const state = withRemap(stateOf(['a'], ['b']), speed('s1', 'a', 6, 10, 2))
      // a plays 6 + 2 = 8 s; cut from inside the segment into b.
      const next = cut(state, 7, 11)
      expect(trims(next)).toEqual([
        ['a', 0, 8],
        ['tail', 3, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(14, 9)
    })

    it('for every pair of marks on a grid over a remapped, transitioned sequence', () => {
      let state = stateOf(['a'], ['b'], ['c'])
      state = withRemap(state, speed('s1', 'a', 1, 3, 0.5))
      state = withRemap(state, pause('p1', 'b', 4, 1.5))
      state = withTransition(state, 'b', 'c', 1)
      const total = totalDuration(state)
      let checked = 0
      for (let from = 0; from < total; from += 0.75) {
        for (let to = from + 0.5; to <= total; to += 0.75) {
          const plan = rangeCutPlanFor(state, from, to)
          const next = cut(state, from, to)
          if (plan === null) {
            expect(next).toBe(state)
            continue
          }
          expect(totalDuration(next)).toBeCloseTo(total - (to - from), 9)
          checked++
        }
      }
      // Most pairs are cuttable; only marks in the overlap or the whole
      // sequence are refused.
      expect(checked).toBeGreaterThan(200)
    })
  })

  describe('effects on the cut entries', () => {
    it('effects inside the range go; those outside stay; one straddling a mark is cut', () => {
      let state = stateOf(['a', 20])
      state = timelineReducer(state, { type: 'zoom-added', zoom: zoom('z-before', 'a', 1) })
      state = timelineReducer(state, { type: 'zoom-added', zoom: zoom('z-inside', 'a', 6) })
      state = timelineReducer(state, { type: 'zoom-added', zoom: zoom('z-after', 'a', 15) })
      state = withRemap(state, pause('p-inside', 'a', 7, 1))
      state = withRemap(state, speed('s-straddle', 'a', 9, 13, 1))
      // Output: a pause of 1 s at source 7, so source 9 is output 10 and
      // source 11 is output 12. Cut output [5, 12).
      const next = cut(state, 5, 12)
      expect(trims(next)).toEqual([
        ['a', 0, 5],
        ['tail', 11, 20],
      ])
      expect(zoomsOf(next).map((effect) => [effect.id, effect.entryId, effect.start])).toEqual([
        ['z-before', 'a', 1],
        ['z-after', 'tail', 4],
      ])
      expect(remapsOf(next)).toEqual([speed('tail:s-straddle', 'tail', 0, 2, 1)])
      expect(totalDuration(next)).toBeCloseTo(21 - 7, 9)
    })

    it('a mark inside a pause keeps the part of the hold on the kept side', () => {
      // Pause at source 4 holds 2 s: output [4, 6) shows source 4.
      const state = withRemap(stateOf(['a']), pause('p', 'a', 4, 2))
      // In mark inside the hold: the first half keeps 1 s of it.
      const fromInside = cut(state, 5, 8)
      expect(trims(fromInside)).toEqual([
        ['a', 0, 4],
        ['tail', 6, 10],
      ])
      expect(remapsOf(fromInside)).toEqual([pause('p', 'a', 4, 1)])
      expect(totalDuration(fromInside)).toBeCloseTo(9, 9)
      // Out mark inside the hold: the second half opens on its last 1 s.
      const toInside = cut(state, 2, 5)
      expect(trims(toInside)).toEqual([
        ['a', 0, 2],
        ['tail', 4, 10],
      ])
      expect(remapsOf(toInside)).toEqual([pause('tail:held', 'tail', 0, 1)])
      expect(totalDuration(toInside)).toBeCloseTo(9, 9)
      // In mark on the hold's first instant: the first half keeps none of it.
      const fromStart = cut(state, 4, 8)
      expect(remapsOf(fromStart)).toEqual([])
      expect(totalDuration(fromStart)).toBeCloseTo(8, 9)
    })

    it('a range inside one pause shortens its hold and splits nothing', () => {
      const state = withRemap(stateOf(['a']), pause('p', 'a', 4, 2))
      const next = cut(state, 4.5, 5.5)
      expect(trims(next)).toEqual([['a', 0, 10]])
      expect(remapsOf(next)).toEqual([pause('p', 'a', 4, 1)])
    })

    it('a pause on an entry’s last frame or first frame is shortened in place', () => {
      // a holds its last frame 2 s (output [10, 12)); b holds its first 2 s.
      let state = withRemap(stateOf(['a'], ['b']), pause('pa', 'a', 10, 2))
      state = withRemap(state, pause('pb', 'b', 0, 2))
      const next = cut(state, 11, 13)
      expect(trims(next)).toEqual([
        ['a', 0, 10],
        ['b', 0, 10],
      ])
      expect(remapsOf(next)).toEqual([pause('pa', 'a', 10, 1), pause('pb', 'b', 0, 1)])
      expect(totalDuration(next)).toBeCloseTo(22, 9)
    })

    it('a held first frame kept after the Out mark sorts before a segment starting with it', () => {
      let state = withRemap(stateOf(['a']), pause('p', 'a', 4, 2))
      state = withRemap(state, speed('s', 'a', 4, 6, 2))
      const next = cut(state, 1, 5)
      expect(remapsOf(next)).toEqual([
        pause('tail:held', 'tail', 0, 1),
        speed('s', 'tail', 0, 2, 2),
      ])
      expect(totalDuration(next)).toBeCloseTo(totalDuration(state) - 4, 9)
    })
  })

  describe('transitions', () => {
    const threeWithTransitions = () =>
      withTransition(withTransition(stateOf(['a'], ['b'], ['c']), 'a', 'b'), 'b', 'c')

    it('a transition on a removed boundary is dropped and the sides meet at a hard cut', () => {
      // Starts: a 0, b 9, c 18; total 28. Cut from inside a to inside b.
      const state = threeWithTransitions()
      const next = cut(state, 5, 15)
      expect(trims(next)).toEqual([
        ['a', 0, 5],
        ['tail', 6, 10],
        ['c', 0, 10],
      ])
      expect(transitionsOf(next)).toEqual([
        { beforeId: 'tail', afterId: 'c', type: 'crossfade', duration: 1 },
      ])
      expect(totalDuration(next)).toBeCloseTo(18, 9)
    })

    it('transitions on surviving boundaries are kept', () => {
      const state = threeWithTransitions()
      const next = cut(state, 12, 15) // inside b, clear of both overlaps
      expect(transitionsOf(next)).toEqual([
        { beforeId: 'a', afterId: 'b', type: 'crossfade', duration: 1 },
        { beforeId: 'tail', afterId: 'c', type: 'crossfade', duration: 1 },
      ])
      expect(totalDuration(next)).toBeCloseTo(25, 9)
    })

    it('a mark at an overlap’s end edge cuts the incoming entry there', () => {
      const state = threeWithTransitions()
      const next = cut(state, 10, 12) // 10 is where a's crossfade into b ends
      expect(trims(next)).toEqual([
        ['a', 0, 10],
        ['b', 0, 1],
        ['tail', 3, 10],
        ['c', 0, 10],
      ])
      expect(totalDuration(next)).toBeCloseTo(26, 9)
    })
  })

  describe('refusals', () => {
    it('refuses a mark inside a transition’s overlap, its first instant included', () => {
      const state = withTransition(stateOf(['a'], ['b']), 'a', 'b')
      // The overlap is [9, 10).
      for (const [from, to] of [
        [9.5, 15],
        [9, 15],
        [2, 9.5],
        [2, 9],
      ]) {
        expect(rangeCutPlanFor(state, from, to)).toBeNull()
        expect(cut(state, from, to)).toBe(state)
      }
    })

    it('refuses the whole sequence, an empty or inverted range, and an empty timeline', () => {
      const state = stateOf(['a'], ['b'])
      for (const [from, to] of [
        [0, 20],
        [5, 5],
        [8, 4],
        [-1, 4],
        [4, 21],
        [Number.NaN, 4],
      ]) {
        expect(rangeCutPlanFor(state, from, to)).toBeNull()
        expect(cut(state, from, to)).toBe(state)
      }
      expect(rangeCutPlanFor({ entries: [] }, 0, 1)).toBeNull()
    })

    it('refuses a cut that would keep only a frozen frame with no source of its own', () => {
      // b holds its first frame 2 s from output 10: an In mark inside that
      // hold would leave b's head as nothing but the frozen frame.
      const first = withRemap(stateOf(['a'], ['b']), pause('pb', 'b', 0, 2))
      expect(rangeCutPlanFor(first, 11, 15)).toBeNull()
      // a holds its last frame 2 s: an Out mark inside it, likewise.
      const last = withRemap(stateOf(['a'], ['b']), pause('pa', 'a', 10, 2))
      expect(rangeCutPlanFor(last, 5, 11)).toBeNull()
    })

    it('refuses new ids that are equal or already taken', () => {
      const state = stateOf(['a'], ['b'])
      const run = (ids: [string, string]) =>
        timelineReducer(state, { type: 'range-cut', from: 2, to: 5, newEntryIds: ids })
      expect(run(['x', 'x'])).toBe(state)
      expect(run(['b', 'y'])).toBe(state)
      expect(run(['x', 'a'])).toBe(state)
    })
  })

  it('is one undo step, and that step restores the state exactly', () => {
    let history = emptyTimelineHistory
    history = timelineHistoryReducer(history, {
      type: 'timeline-replaced',
      timeline: withRemap(stateOf(['a'], ['b']), speed('s', 'a', 2, 6, 2)),
    })
    const before = history.present
    history = timelineHistoryReducer(history, {
      type: 'range-cut',
      from: 3,
      to: 12,
      newEntryIds: ['mid', 'tail'],
    })
    expect(history.present).not.toBe(before)
    expect(history.past).toHaveLength(1)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })
})

describe('planRangeCut (#823)', () => {
  const plain = (id: string, length: number) => ({ id, inPoint: 0, outPoint: length, remaps: [] })

  it('names a boundary, a split, or a held pause for each mark', () => {
    expect(planRangeCut([plain('a', 10), plain('b', 10)], [0], 10, 13)).toEqual({
      kind: 'cut',
      from: { kind: 'boundary', index: 1 },
      to: { kind: 'split', index: 1, atSourceTime: 3 },
    })
    expect(planRangeCut([plain('a', 10), plain('b', 10)], [0], 4, 20)).toEqual({
      kind: 'cut',
      from: { kind: 'split', index: 0, atSourceTime: 4 },
      to: { kind: 'boundary', index: 2 },
    })
  })

  it('reads the overlap durations it is given, not the entries alone', () => {
    // With a 2 s overlap the sequence is 18 s and b starts at 8.
    expect(planRangeCut([plain('a', 10), plain('b', 10)], [2], 12, 18)).toEqual({
      kind: 'cut',
      from: { kind: 'split', index: 1, atSourceTime: 4 },
      to: { kind: 'boundary', index: 2 },
    })
    expect(planRangeCut([plain('a', 10), plain('b', 10)], [2], 9, 12)).toBeNull()
  })
})
