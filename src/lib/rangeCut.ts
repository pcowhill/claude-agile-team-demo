/**
 * Cut out marked range (#823, the approved #731): where the two marks of a
 * range of sequence time fall, as the plan the `range-cut` reducer action
 * carries out. Pure, and kept apart from `timeline.ts` so the rule that
 * decides whether the cut is possible is the one the reducer and the
 * Frame ▾ item both read: the item is enabled exactly when this returns a
 * plan, and the reducer refuses exactly when it does not.
 *
 * The cut removes output time `[from, to)`. Each mark becomes an **edge**:
 *
 * - `boundary`: the mark sits on a hard cut (or the sequence's start or
 *   end), so nothing needs splitting there.
 * - `split`: the mark sits strictly inside an entry, which is cut there by
 *   the razor (`entry-split`, #190), so its effects follow Split at
 *   playhead's rules exactly.
 * - `hold`: the mark sits inside a pause held on an entry's first frame (an
 *   Out mark) or its last frame (an In mark). The razor has no strictly
 *   inside point there, and needs none: only the pause's hold changes.
 *
 * A mark inside a pause's hold elsewhere is a `split` at the paused instant
 * that also shortens the hold, because the razor keeps a pause whole on the
 * first half: an In mark keeps the part of the hold before it, and an Out
 * mark gives the second half the part of the hold after it. That is what
 * makes the removed length exactly `to - from` wherever the marks fall.
 *
 * A mark is refused (no plan) inside a transition's overlap, including its
 * first instant, where Split at playhead is also disabled: two clips play
 * there and the razor has no exact cut. Also refused: an empty, inverted or
 * whole-sequence range, and a mark that would leave a kept part holding a
 * frozen frame with no source time of its own.
 */
import type { RemapEffect } from './remap'
import { outputTimeAtSource, remappedDuration, sourceTimeAtOutput } from './remap'

/**
 * How close, in seconds, a mark must be to a boundary or a pause's edge to
 * count as on it. Marks are playhead times, and a playhead landed by ↑ / ↓
 * is computed by the same sums as the boundaries here, but a mark set by
 * scrubbing can sit a rounding error away; a microsecond is far below a
 * frame, and it keeps a sliver of an entry from surviving a cut.
 */
export const RANGE_CUT_EPSILON = 1e-6

/** One entry as the plan sees it: its trim, and its own remap effects. */
export interface RangeCutEntry {
  id: string
  inPoint: number
  outPoint: number
  /** The entry's remap effects, normalized (sorted, disjoint). */
  remaps: readonly RemapEffect[]
}

/** Where one mark falls. Indices are into the entries as given. */
export type RangeCutEdge =
  /**
   * Between `entries[index - 1]` and `entries[index]`; 0 is the sequence
   * start and `entries.length` its end.
   */
  | { kind: 'boundary'; index: number }
  /**
   * Strictly inside `entries[index]`, at an absolute source time. `hold`,
   * when present, is what becomes of a pause at that instant: for an In mark
   * the pause's new hold on the kept first half (0 removes it), for an Out
   * mark the hold the kept second half starts with (0 adds none).
   */
  | {
      kind: 'split'
      index: number
      atSourceTime: number
      hold?: { pauseId: string; seconds: number }
    }
  /**
   * Inside the pause on `entries[index]`'s first frame (Out mark) or last
   * frame (In mark): the entry is kept whole with that pause's hold set to
   * `seconds`.
   */
  | { kind: 'hold'; index: number; pauseId: string; seconds: number }

export type RangeCutPlan =
  | { kind: 'cut'; from: RangeCutEdge; to: RangeCutEdge }
  /**
   * Both marks inside the same pause's hold: nothing is split or removed,
   * the hold is shortened by the range's length.
   */
  | { kind: 'within-hold'; index: number; pauseId: string; seconds: number }

/** Where a mark falls before it becomes an In or an Out edge. */
type MarkPosition =
  | { kind: 'boundary'; index: number }
  | {
      kind: 'inside'
      index: number
      /** Output seconds into the entry. */
      into: number
      /** The pause whose hold the mark lies in, if any. */
      plateau?: { pause: RemapEffect & { kind: 'pause' }; start: number; end: number }
    }

/**
 * The plan for cutting `[from, to)` out of a sequence, or null where the
 * cut is not possible (see the module comment). `overlaps[i]` is the
 * transition duration on the boundary between `entries[i]` and
 * `entries[i + 1]` (0 for a hard cut), as `boundaryTransitions` reports it.
 */
export function planRangeCut(
  entries: readonly RangeCutEntry[],
  overlaps: readonly number[],
  from: number,
  to: number,
): RangeCutPlan | null {
  if (entries.length === 0) return null
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const outputs = entries.map((entry) =>
    remappedDuration(entry.outPoint - entry.inPoint, entry.remaps),
  )
  const starts: number[] = []
  let start = 0
  for (let index = 0; index < entries.length; index++) {
    starts.push(start)
    start += outputs[index] - (index < entries.length - 1 ? (overlaps[index] ?? 0) : 0)
  }
  const total = start
  if (from < -RANGE_CUT_EPSILON || to > total + RANGE_CUT_EPSILON) return null
  if (to - from <= RANGE_CUT_EPSILON) return null
  // Removing everything is what each row's ✕ is for, and leaves no join.
  if (from <= RANGE_CUT_EPSILON && to >= total - RANGE_CUT_EPSILON) return null

  const position = (time: number): MarkPosition | null => {
    if (time <= RANGE_CUT_EPSILON) return { kind: 'boundary', index: 0 }
    if (time >= total - RANGE_CUT_EPSILON) return { kind: 'boundary', index: entries.length }
    for (let index = 0; index < entries.length; index++) {
      const end = starts[index] + outputs[index]
      const overlap = index < entries.length - 1 ? (overlaps[index] ?? 0) : 0
      if (overlap > 0) {
        // The overlap runs from the next entry's start to this one's end;
        // its first instant is refused too, as Split refuses it.
        const nextStart = starts[index + 1]
        if (time >= nextStart - RANGE_CUT_EPSILON && time < end - RANGE_CUT_EPSILON) return null
      } else if (Math.abs(time - end) <= RANGE_CUT_EPSILON) {
        return { kind: 'boundary', index: index + 1 }
      }
      if (time < end) {
        const entry = entries[index]
        const into = time - starts[index]
        const length = entry.outPoint - entry.inPoint
        for (const remap of entry.remaps) {
          if (remap.kind !== 'pause') continue
          const plateauStart = outputTimeAtSource(length, entry.remaps, remap.at)
          const plateauEnd = plateauStart + remap.hold
          if (into >= plateauStart - RANGE_CUT_EPSILON && into < plateauEnd - RANGE_CUT_EPSILON) {
            return {
              kind: 'inside',
              index,
              into: Math.max(into, plateauStart),
              plateau: { pause: remap, start: plateauStart, end: plateauEnd },
            }
          }
        }
        return { kind: 'inside', index, into }
      }
    }
    return null
  }

  const fromPosition = position(from)
  const toPosition = position(to)
  if (fromPosition === null || toPosition === null) return null

  if (
    fromPosition.kind === 'inside' &&
    toPosition.kind === 'inside' &&
    fromPosition.plateau !== undefined &&
    toPosition.plateau !== undefined &&
    fromPosition.index === toPosition.index &&
    fromPosition.plateau.pause.id === toPosition.plateau.pause.id
  ) {
    return {
      kind: 'within-hold',
      index: fromPosition.index,
      pauseId: fromPosition.plateau.pause.id,
      seconds: fromPosition.plateau.pause.hold - (to - from),
    }
  }

  const fromEdge = edge(entries, fromPosition, 'from')
  const toEdge = edge(entries, toPosition, 'to')
  if (fromEdge === null || toEdge === null) return null
  return { kind: 'cut', from: fromEdge, to: toEdge }
}

/** Turns a mark's position into the edge the cut acts on at that side. */
function edge(
  entries: readonly RangeCutEntry[],
  position: MarkPosition,
  side: 'from' | 'to',
): RangeCutEdge | null {
  if (position.kind === 'boundary') return position
  const { index, into, plateau } = position
  const entry = entries[index]
  const length = entry.outPoint - entry.inPoint
  if (plateau !== undefined) {
    const { pause } = plateau
    // The part of the hold the kept side keeps: before an In mark, after an
    // Out mark.
    const seconds = side === 'from' ? into - plateau.start : plateau.end - into
    if (pause.at <= 0) {
      // The entry's first frame. An In mark here would keep a frozen frame
      // with no source of its own; an Out mark keeps the entry whole.
      return side === 'from' ? null : { kind: 'hold', index, pauseId: pause.id, seconds }
    }
    if (pause.at >= length) {
      // The entry's last frame: the mirror image of the case above.
      return side === 'to' ? null : { kind: 'hold', index, pauseId: pause.id, seconds }
    }
    return {
      kind: 'split',
      index,
      atSourceTime: entry.inPoint + pause.at,
      hold: { pauseId: pause.id, seconds },
    }
  }
  const atSourceTime = entry.inPoint + sourceTimeAtOutput(length, entry.remaps, into)
  // Strictly inside the trim window, as the razor requires (#190). A mark
  // this close to an edge was already taken as the boundary above, so this
  // guards only against a degenerate entry.
  if (!(atSourceTime > entry.inPoint && atSourceTime < entry.outPoint)) return null
  return { kind: 'split', index, atSourceTime }
}
