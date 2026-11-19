/**
 * What a trim in the Trim window would do to the entry's effects (#709,
 * from the approved design #703 §3): where its zooms, speed segments and
 * pauses would sit, which of them the clamps as they stand would cut into,
 * and which source span a transition at either end would cover.
 *
 * **One rule.** Nothing here re-derives the trim's consequences. The
 * candidate trim is run through `timelineReducer` as the `entry-trimmed`
 * that Apply would dispatch, and each effect is compared before and after.
 * So the warning says what Apply then does, by construction.
 *
 * **Effects ride with In.** A zoom's `start`, a speed segment's window and a
 * pause's `at` are seconds into the entry's *trimmed* range, not into the
 * source. On a retrim the reducer re-sweeps them against the new length:
 * - what no longer fits **collapses to zero length**, and is kept so that
 *   un-trimming restores it — nothing of it plays, so the window says it
 *   *removes* it;
 * - what still has some length but less is *shortened*;
 * - a pause keeps its hold, and when the trim's end passes it, it is
 *   pulled back to the end — *moves*.
 *
 * Moving In therefore moves every mark with it, and can cut into effects at
 * the end as surely as moving Out.
 *
 * Times returned are in **source seconds**, the strip's own units.
 */

import { remapEnd, remapStart, sourceTimeAtOutput } from './remap'
import type { RemapEffect, RemapSpec } from './remap'
import {
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  remapsForEntry,
  timelineReducer,
  zoomWindowDuration,
  zoomsForEntry,
} from './timeline'
import type { TimelineState, ZoomEffect } from './timeline'
import type { TrimRange } from './trim'

export type TrimEffectKind = 'zoom' | RemapSpec['kind']

/**
 * What the row calls each remap kind. A `Record` over the union, so a new
 * kind added to `RemapSpec` does not compile until it is named here.
 */
const REMAP_NAMES: Record<RemapSpec['kind'], string> = {
  speed: 'Speed segment',
  pause: 'Pause',
}

/** One effect as it would sit after Apply, on the strip. */
export interface TrimEffectMark {
  id: string
  kind: TrimEffectKind
  /** The row's own name for it: "Zoom 1", "Speed segment 2", "Pause 1". */
  name: string
  /** Source seconds. A pause occupies one instant: `start === end`. */
  start: number
  end: number
}

/** What Apply would do to one effect. */
export type TrimEffectOutcome = 'shortens' | 'removes' | 'moves'

export interface TrimEffectWarning {
  id: string
  kind: TrimEffectKind
  name: string
  outcome: TrimEffectOutcome
}

/** The source span a transition at one end of the entry would cover. */
export interface TrimTransitionSpan {
  edge: 'start' | 'end'
  /** Source seconds. */
  start: number
  end: number
}

export interface TrimEffectsPreview {
  /** Effects that still play after Apply, where they would sit. */
  marks: TrimEffectMark[]
  /** Effects the clamps as they stand would cut into, in strip order. */
  warnings: TrimEffectWarning[]
  /** At most one span per end of the entry. */
  transitions: TrimTransitionSpan[]
}

const EMPTY: TrimEffectsPreview = { marks: [], warnings: [], transitions: [] }

/** Differences smaller than this are float noise from the sweep, not a cut. */
const EPSILON = 1e-9

interface Placed {
  id: string
  kind: TrimEffectKind
  name: string
  /** Seconds into the trimmed range. */
  start: number
  end: number
}

/** An entry's effects, named as the row names them, in seconds into its trim. */
function placedEffects(zooms: readonly ZoomEffect[], remaps: readonly RemapEffect[]): Placed[] {
  // The row numbers zooms per entry and each remap kind separately, in the
  // normalized state's order (`Timeline.tsx`, `RemapFieldRows`).
  const zoomPlaced = zooms.map((zoom, index) => ({
    id: zoom.id,
    kind: 'zoom' as const,
    name: `Zoom ${index + 1}`,
    start: zoom.start,
    end: zoom.start + zoomWindowDuration(zoom),
  }))
  const kindCount = new Map<RemapSpec['kind'], number>()
  const remapPlaced = remaps.map((remap) => {
    const count = (kindCount.get(remap.kind) ?? 0) + 1
    kindCount.set(remap.kind, count)
    return {
      id: remap.id,
      kind: remap.kind,
      name: `${REMAP_NAMES[remap.kind]} ${count}`,
      start: remapStart(remap),
      end: remapEnd(remap),
    }
  })
  return [...zoomPlaced, ...remapPlaced]
}

/** What the sweep did to one effect, or null when it left it whole and in place. */
function outcomeOf(before: Placed, after: Placed): TrimEffectOutcome | null {
  if (before.kind === 'pause') {
    return Math.abs(after.start - before.start) > EPSILON ? 'moves' : null
  }
  const had = before.end - before.start
  const has = after.end - after.start
  if (had > EPSILON && has <= EPSILON) return 'removes'
  if (has < had - EPSILON) return 'shortens'
  return Math.abs(after.start - before.start) > EPSILON ? 'moves' : null
}

/**
 * The Trim window's view of `range` for the entry `entryId` (#709): marks,
 * warnings and transition spans, all from the state `entry-trimmed` would
 * produce. An entry that is not in `state`, or a trim the reducer refuses,
 * shows nothing.
 */
export function trimEffectsPreview(
  state: TimelineState,
  entryId: string,
  range: TrimRange,
): TrimEffectsPreview {
  const index = state.entries.findIndex((entry) => entry.id === entryId)
  if (index === -1) return EMPTY
  const current = state.entries[index]
  const trimmed =
    range.inPoint === current.inPoint && range.outPoint === current.outPoint
      ? state
      : timelineReducer(state, {
          type: 'entry-trimmed',
          id: entryId,
          inPoint: range.inPoint,
          outPoint: range.outPoint,
        })
  const entry = trimmed.entries[index]
  if (entry === undefined || entry.id !== entryId) return EMPTY
  // A refused trim leaves the state as it was; showing the current trim's
  // effects against clamps somewhere else would mislead, so show nothing.
  if (trimmed === state && (range.inPoint !== current.inPoint || range.outPoint !== current.outPoint)) {
    return EMPTY
  }

  const before = new Map(
    placedEffects(zoomsForEntry(state, entryId), remapsForEntry(state, entryId)).map((placed) => [
      placed.id,
      placed,
    ]),
  )
  const remaps = remapsForEntry(trimmed, entryId)
  const after = placedEffects(zoomsForEntry(trimmed, entryId), remaps)
    // Named as the row names them now, before Apply: that is what the user reads.
    .map((placed) => ({ ...placed, name: before.get(placed.id)?.name ?? placed.name }))
    .sort((a, b) => a.start - b.start)

  const marks: TrimEffectMark[] = []
  const warnings: TrimEffectWarning[] = []
  for (const placed of after) {
    const was = before.get(placed.id)
    const outcome = was === undefined ? null : outcomeOf(was, placed)
    if (outcome !== null) warnings.push({ id: placed.id, kind: placed.kind, name: placed.name, outcome })
    // A collapsed effect plays nothing, so it has no place on the strip.
    // An effect already collapsed before this trim is neither drawn nor warned of.
    if (placed.kind !== 'pause' && placed.end - placed.start <= EPSILON) continue
    marks.push({
      id: placed.id,
      kind: placed.kind,
      name: placed.name,
      start: entry.inPoint + placed.start,
      end: entry.inPoint + placed.end,
    })
  }

  // Transitions are in output seconds; the strip is source. The incoming
  // side of a transition plays the entry's first `duration` output
  // seconds, the outgoing side its last, so each maps back through the
  // entry's own remaps.
  const length = effectiveDuration(entry)
  const output = entryOutputDuration(entry, remaps)
  const boundaries = boundaryTransitions(trimmed)
  const transitions: TrimTransitionSpan[] = []
  const atStart = index > 0 ? boundaries[index - 1] : undefined
  if (atStart !== undefined) {
    transitions.push({
      edge: 'start',
      start: entry.inPoint,
      end: entry.inPoint + sourceTimeAtOutput(length, remaps, atStart.duration),
    })
  }
  const atEnd = boundaries[index]
  if (atEnd !== undefined) {
    transitions.push({
      edge: 'end',
      start: entry.inPoint + sourceTimeAtOutput(length, remaps, output - atEnd.duration),
      end: entry.outPoint,
    })
  }
  return { marks, warnings, transitions }
}

/**
 * The warning line's sentence (#709): "Trimming here shortens Zoom 1 and
 * removes Speed segment 2." Null when the trim cuts into nothing.
 */
export function trimWarningText(warnings: readonly TrimEffectWarning[]): string | null {
  if (warnings.length === 0) return null
  // A pause moves only when the trim's end passes it: the sweep pulls it
  // back onto the end, still holding. Nothing else is moved by a trim
  // without being shortened first, but the word stays honest if it were.
  const phrases = warnings.map(({ kind, name, outcome }) =>
    outcome === 'moves' && kind === 'pause' ? `moves ${name} to the new end` : `${outcome} ${name}`,
  )
  const listed =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
  return `Trimming here ${listed}.`
}
