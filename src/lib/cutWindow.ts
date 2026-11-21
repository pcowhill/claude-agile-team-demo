/**
 * The Cut window's arithmetic (#827, the customer's request on #731): Trim…
 * keeps the part between two clamps, and Cut… removes it. The window has
 * two clamps, *Cut from* and *Cut to*, in seconds **into the source clip**
 * as the Trim window's are. Apply hands the part between them to Cut out
 * marked range (#823) over the same span of sequence time, so the cut, its
 * effects and its ripple (#824) follow the one rule both entry points share.
 *
 * Pure, so the window's rules are tested without a browser; `CutDialog`
 * only wires them to pointers, keys and a media element.
 */
import { entryStartTime, entrySplitRefusal } from './playback'
import { outputTimeAtSource } from './remap'
import type { TimelineState } from './timeline'
import { effectiveDuration, rangeCutPlanFor, remapsForEntry } from './timeline'
import type { TrimRange } from './trim'

/** The part to remove, in absolute source seconds. */
export interface CutClamps {
  from: number
  to: number
}

/**
 * Why Apply is disabled, or null where it cuts:
 *
 * - `'order'`: *Cut to* is not after *Cut from*, so the part is empty or
 *   inverted;
 * - `'in'`: *Cut from* is on In, so the cut removes the clip's head, which
 *   is a trim;
 * - `'out'`: *Cut to* is on Out, the same for its tail;
 * - `'transition'`: a clamp falls inside a transition's overlap at either
 *   end of the entry, where two clips play and Cut out marked range has no
 *   exact cut;
 * - `'refused'`: Cut out marked range refuses the span for another reason.
 */
export type CutRefusal = 'order' | 'in' | 'out' | 'transition' | 'refused'

/**
 * The window's own refusals: the four the clamps alone decide. Order comes
 * first, since an inverted pair says nothing useful about In or Out.
 */
export function cutClampsRefusal(range: TrimRange, clamps: CutClamps): CutRefusal | null {
  if (!(clamps.to > clamps.from)) return 'order'
  if (clamps.from <= range.inPoint) return 'in'
  if (clamps.to >= range.outPoint) return 'out'
  return null
}

/** Where the window's clamps open: the middle third of the trimmed range, to the millisecond. */
export function initialCutClamps(range: TrimRange): CutClamps {
  const length = range.outPoint - range.inPoint
  const ms = (value: number) => Math.round(value * 1000) / 1000
  return { from: ms(range.inPoint + length / 3), to: ms(range.inPoint + (2 * length) / 3) }
}

/** A clamp, held to the entry's trimmed range and kept to the millisecond. */
export function clampCut(value: number, range: TrimRange): number {
  if (!Number.isFinite(value) || value <= range.inPoint) return range.inPoint
  if (value >= range.outPoint) return range.outPoint
  return Math.round(value * 1000) / 1000
}

/**
 * The span of sequence (output) time the clamps cover on the entry `entryId`:
 * the entry's start plus each clamp's output time through the entry's own
 * speed segments and pauses. A pause on *Cut from*'s instant is inside the
 * span and goes with the removed part; one on *Cut to*'s instant is after
 * it and stays, since the frame it holds is kept. Null for an unknown entry.
 */
export function entryCutSpan(
  state: TimelineState,
  entryId: string,
  clamps: CutClamps,
): { from: number; to: number } | null {
  const index = state.entries.findIndex((entry) => entry.id === entryId)
  if (index === -1) return null
  const entry = state.entries[index]
  const remaps = remapsForEntry(state, entryId)
  const length = effectiveDuration(entry)
  const start = entryStartTime(state, index)
  return {
    from: start + outputTimeAtSource(length, remaps, clamps.from - entry.inPoint),
    to: start + outputTimeAtSource(length, remaps, clamps.to - entry.inPoint),
  }
}

/**
 * Whether Apply may cut, or why not: the clamps' own rule, then Cut out
 * marked range's (`rangeCutPlanFor`) over the span, so Apply is enabled
 * exactly where the cut it dispatches would be carried out.
 */
export function entryCutRefusal(
  state: TimelineState,
  entryId: string,
  clamps: CutClamps,
): CutRefusal | null {
  const entry = state.entries.find((candidate) => candidate.id === entryId)
  if (entry === undefined) return 'refused'
  const own = cutClampsRefusal(entry, clamps)
  if (own !== null) return own
  const span = entryCutSpan(state, entryId, clamps)
  if (span !== null && rangeCutPlanFor(state, span.from, span.to) !== null) return null
  return entrySplitRefusal(state, entryId, clamps.from) === 'transition' ||
    entrySplitRefusal(state, entryId, clamps.to) === 'transition'
    ? 'transition'
    : 'refused'
}

/** The line under the strip when Apply is disabled: what to change. */
export function cutRefusalText(refusal: CutRefusal): string {
  switch (refusal) {
    case 'order':
      return 'Move Cut to after Cut from: there is nothing between them to cut out.'
    case 'in':
      return 'Cut from is on In: that removes the start of the clip, so use Trim… for it.'
    case 'out':
      return 'Cut to is on Out: that removes the end of the clip, so use Trim… for it.'
    case 'transition':
      return 'It cannot cut inside a transition, where two clips play.'
    case 'refused':
      return 'It cannot cut out this part here.'
  }
}

/**
 * How much of the clip ▶ Play cut plays before the join: enough to hear
 * the cut arrive, without replaying a long clip from its In every time.
 */
export const PLAY_CUT_LEAD = 2

/** Where ▶ Play cut starts: a lead-in before *Cut from*, never before In. */
export function playCutStart(range: TrimRange, clamps: CutClamps): number {
  return Math.max(range.inPoint, clamps.from - PLAY_CUT_LEAD)
}

/**
 * What ▶ Play cut does with the element's clock at one tick: carry on,
 * jump over the removed part to *Cut to*, or stop at Out. It plays the clip
 * as it will be after the cut, up to *Cut from* and then straight on from
 * *Cut to*, so the join is heard before it is applied.
 */
export type PlayCutStep =
  | { kind: 'play'; at: number }
  | { kind: 'jump'; at: number }
  | { kind: 'stop'; at: number }

export function playCutStep(current: number, range: TrimRange, clamps: CutClamps): PlayCutStep {
  if (current >= range.outPoint) return { kind: 'stop', at: range.outPoint }
  if (clamps.to > clamps.from && current >= clamps.from && current < clamps.to) {
    return clamps.to >= range.outPoint ? { kind: 'stop', at: range.outPoint } : { kind: 'jump', at: clamps.to }
  }
  return { kind: 'play', at: Math.max(current, range.inPoint) }
}
