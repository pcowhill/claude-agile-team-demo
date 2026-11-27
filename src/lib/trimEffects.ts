/**
 * What a trim in the Trim window would do to the entry's effects (#709,
 * from the approved design #703 §3): where its zooms, speed segments,
 * pauses and picture effects (#862) would sit, which of them the clamps as they stand would cut into,
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
 * - what no longer fits **collapses to zero length** at the new end —
 *   nothing of it plays, so the window says it *removes* it. It is kept,
 *   so its row stays, but a later retrim back out does not lengthen it
 *   again: the sweep only ever clamps. Undo of the trim restores it
 *   (#1013);
 * - what still has some length but less is *shortened*;
 * - a pause keeps its hold, and when the trim's end passes it, it is
 *   pulled back to the end — *moves*.
 *
 * Moving In therefore moves every mark with it, and can cut into effects at
 * the end as surely as moving Out.
 *
 * Times returned are in **source seconds**, the strip's own units.
 *
 * **An overlay's on-screen lists.** A video overlay's Moves (#834) and
 * picture effects (#872) are windows in its *on-screen* time, seconds since
 * it appears, not seconds into its trim. A trim that shortens the overlay's
 * time on screen clamps them against the new on-screen length (#1008).
 * They are warned of, by the same rule, but not marked on the strip: the
 * strip is in source seconds, and an on-screen window maps onto it only
 * through the overlay's speed segments and pauses, where a window over a
 * pause is many seconds on screen and one instant of source.
 *
 * **An audio track's volume changes** (#1025) are windows in seconds into
 * the track's trimmed range, as a zoom's are, so they ride with In and are
 * both warned of and marked by the same rule. A track has no other effects
 * and sits on no boundary.
 */

import { remapEnd, remapStart, sourceTimeAtOutput } from './remap'
import type { RemapSpec } from './remap'
import {
  audioTracksOf,
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  pictureEffectsForEntry,
  remapsForEntry,
  timelineReducer,
  videoOverlaysOf,
  zoomWindowDuration,
  zoomsForEntry,
} from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
import type { TrimRange } from './trim'
import { isImageOverlay, overlayOutputDuration, overlayPlacementOf } from './videoOverlay'
import type { VideoOverlay } from './videoOverlay'
import { pictureEffectNames } from './pictureEffect'
import type { PictureEffect } from './pictureEffect'
import type { OverlayMove } from './overlayMove'
import type { VolumeChange } from './volumeChange'

/**
 * `picture-effect` is a Vignette, Blur or other registered picture effect
 * (#862), whatever its type. `move` is an overlay's Move (#834), which is
 * only ever warned of, never marked (see "An overlay's on-screen lists").
 * `volume-change` is an audio track's volume change (#1025).
 */
export type TrimEffectKind = 'zoom' | RemapSpec['kind'] | 'picture-effect' | 'move' | 'volume-change'

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
  /** The row's own name for it: "Zoom 1", "Speed segment 2", "Pause 1", "Move 1", "Volume change 1". */
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

/**
 * An element's effects, named as the row names them, in seconds into its
 * trim. Structural, so an entry's (`ZoomEffect`, `RemapEffect`) and a video
 * overlay's own (`OverlayZoom`, `OverlayRemap`, #711) both fit.
 */
function placedEffects(
  zooms: readonly (ZoomSpec & { id: string })[],
  remaps: readonly (RemapSpec & { id: string })[],
  pictureEffects: readonly PictureEffect[] = [],
): Placed[] {
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
  // Picture effects (#862) by the row's names, "Vignette 1" or "blur 1
  // (unavailable)" (`pictureEffectNames`). Their windows clamp and collapse
  // on a retrim as a zoom's do, so the same outcomes apply.
  const names = pictureEffectNames(pictureEffects)
  const picturePlaced = pictureEffects.map((effect) => ({
    id: effect.id,
    kind: 'picture-effect' as const,
    name: names.get(effect.id) ?? effect.type,
    start: effect.start,
    end: effect.end,
  }))
  return [...zoomPlaced, ...remapPlaced, ...picturePlaced]
}

/**
 * A track's volume changes (#1025), named as their rows name them: numbered
 * in the normalized list's order (`VolumeChangeFieldsRow`). Their windows
 * clamp and collapse on a retrim as a zoom's do, so the same outcomes apply.
 */
function placedVolumeChanges(changes: readonly VolumeChange[]): Placed[] {
  return changes.map((change, index) => ({
    id: change.id,
    kind: 'volume-change' as const,
    name: `Volume change ${index + 1}`,
    start: change.start,
    end: change.start + change.length,
  }))
}

/** What the sweep did to one effect, or null when it left it whole and in place. */
function outcomeOf(before: Placed, after: Placed): TrimEffectOutcome | null {
  if (before.kind === 'pause') {
    return Math.abs(after.start - before.start) > EPSILON ? 'moves' : null
  }
  const had = before.end - before.start
  const has = after.end - after.start
  // Already at length zero (#1013): an earlier trim removed it, and it plays
  // nothing wherever the sweep now puts it, so there is nothing to warn of
  // (#1031). A pause is the one kind with no length that still plays, above.
  if (had <= EPSILON) return null
  if (has <= EPSILON) return 'removes'
  if (has < had - EPSILON) return 'shortens'
  return Math.abs(after.start - before.start) > EPSILON ? 'moves' : null
}

/**
 * The marks and warnings for one element (#709, #711): `before` is its
 * effects as stored, `after` as the candidate trim leaves them, and
 * `inPoint` the candidate's In, which puts trim seconds on the source strip.
 */
function comparedEffects(
  beforePlaced: readonly Placed[],
  afterPlaced: readonly Placed[],
  inPoint: number,
): Pick<TrimEffectsPreview, 'marks' | 'warnings'> {
  const before = new Map(beforePlaced.map((placed) => [placed.id, placed]))
  const after = afterPlaced
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
      start: inPoint + placed.start,
      end: inPoint + placed.end,
    })
  }
  return { marks, warnings }
}

/** One on-screen window of an overlay (#1008), and whether it still shows at all. */
interface OnScreen {
  id: string
  kind: 'move' | 'picture-effect'
  name: string
  /** Seconds since the overlay appears. */
  start: number
  end: number
  /** Clamped against the end of the overlay's time on screen, so it never shows. */
  collapsed: boolean
}

/**
 * An overlay's Moves and picture effects, named as their rows name them, in
 * on-screen seconds against its on-screen `length`.
 *
 * A Move's window is its glide, `start` to `start + glide`. One that starts
 * at or past the end of the overlay's time on screen is collapsed: the
 * overlay is gone before it moves, so it never reaches that destination. A
 * picture effect is collapsed when its window has no length left, as an
 * entry's is.
 */
function onScreenEffects(overlay: VideoOverlay): OnScreen[] {
  const length = overlayOutputDuration(overlay)
  // The Move rows are numbered in the normalized list's order (`MoveFieldsRow`).
  const moves = (overlay.moves ?? []).map((move: OverlayMove, index) => ({
    id: move.id,
    kind: 'move' as const,
    name: `Move ${index + 1}`,
    start: move.start,
    end: move.start + move.glide,
    collapsed: move.start >= length - EPSILON,
  }))
  const effects = overlay.pictureEffects ?? []
  const names = pictureEffectNames(effects)
  const pictures = effects.map((effect) => ({
    id: effect.id,
    kind: 'picture-effect' as const,
    name: names.get(effect.id) ?? effect.type,
    start: effect.start,
    end: effect.end,
    collapsed: effect.end - effect.start <= EPSILON,
  }))
  return [...moves, ...pictures]
}

/**
 * The warnings for an overlay's on-screen windows (#1008), in on-screen
 * order. A window the trim collapses is *removed*. One whose end the trim
 * pulls back is *shortened*: for a Move, its glide is cut, so the box
 * reaches its destination only as the overlay leaves. A trim only ever
 * shortens the time on screen, so nothing is moved without being one of
 * those. A window already collapsed before the trim is not warned of.
 */
function comparedOnScreen(before: readonly OnScreen[], after: readonly OnScreen[]): TrimEffectWarning[] {
  const was = new Map(before.map((window) => [window.id, window]))
  const warnings: TrimEffectWarning[] = []
  for (const window of [...after].sort((a, b) => a.start - b.start)) {
    const previous = was.get(window.id)
    if (previous === undefined || previous.collapsed) continue
    const outcome: TrimEffectOutcome | null = window.collapsed
      ? 'removes'
      : window.end < previous.end - EPSILON
        ? 'shortens'
        : null
    // Named as the row names it now, before Apply: that is what the user reads.
    if (outcome !== null) warnings.push({ id: window.id, kind: window.kind, name: previous.name, outcome })
  }
  return warnings
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

  const remaps = remapsForEntry(trimmed, entryId)
  const { marks, warnings } = comparedEffects(
    placedEffects(
      zoomsForEntry(state, entryId),
      remapsForEntry(state, entryId),
      pictureEffectsForEntry(state, entryId),
    ),
    placedEffects(zoomsForEntry(trimmed, entryId), remaps, pictureEffectsForEntry(trimmed, entryId)),
    entry.inPoint,
  )

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
 * The Trim window's view of `range` for the **video overlay** `overlayId`
 * (#711): `trimEffectsPreview`'s rule, with the overlay's own action and
 * lists. The candidate is the `video-overlay-updated` Apply dispatches —
 * the overlay's placement with the new In and Out — and the overlay's own
 * zooms and speed segments and pauses are compared before and after, then
 * its Moves and picture effects (#1008), which are warned of after them but
 * not marked. An overlay sits on no boundary, so there are no transition
 * spans. An image overlay has no source to trim, and shows nothing.
 */
export function overlayTrimEffectsPreview(
  state: TimelineState,
  overlayId: string,
  range: TrimRange,
): TrimEffectsPreview {
  const current = videoOverlaysOf(state).find((overlay) => overlay.id === overlayId)
  if (current === undefined || isImageOverlay(current)) return EMPTY
  const unchanged = range.inPoint === current.inPoint && range.outPoint === current.outPoint
  const trimmed = unchanged
    ? state
    : timelineReducer(state, {
        type: 'video-overlay-updated',
        id: overlayId,
        placement: { ...overlayPlacementOf(current), inPoint: range.inPoint, outPoint: range.outPoint },
      })
  // A refused trim: as for an entry, show nothing rather than the current
  // trim's effects against clamps somewhere else.
  if (trimmed === state && !unchanged) return EMPTY
  const overlay = videoOverlaysOf(trimmed).find((candidate) => candidate.id === overlayId)
  if (overlay === undefined) return EMPTY
  const { marks, warnings } = comparedEffects(
    placedEffects(current.zooms ?? [], current.remaps ?? []),
    placedEffects(overlay.zooms ?? [], overlay.remaps ?? []),
    overlay.inPoint,
  )
  const onScreen = comparedOnScreen(onScreenEffects(current), onScreenEffects(overlay))
  return { marks, warnings: [...warnings, ...onScreen], transitions: [] }
}

/**
 * The Trim window's view of `range` for the **audio track** `trackId`
 * (#1025): `trimEffectsPreview`'s rule, with the `audio-track-trimmed` Apply
 * dispatches and the track's volume changes, compared before and after and
 * marked on the strip. A track sits on no boundary, so there are no
 * transition spans. A track that is not in `state`, or a trim the reducer
 * refuses, shows nothing.
 */
export function audioTrackTrimEffectsPreview(
  state: TimelineState,
  trackId: string,
  range: TrimRange,
): TrimEffectsPreview {
  const current = audioTracksOf(state).find((track) => track.id === trackId)
  if (current === undefined) return EMPTY
  const unchanged = range.inPoint === current.inPoint && range.outPoint === current.outPoint
  const trimmed = unchanged
    ? state
    : timelineReducer(state, {
        type: 'audio-track-trimmed',
        id: trackId,
        inPoint: range.inPoint,
        outPoint: range.outPoint,
      })
  // A refused trim: as for an entry, show nothing rather than the current
  // trim's changes against clamps somewhere else.
  if (trimmed === state && !unchanged) return EMPTY
  const track = audioTracksOf(trimmed).find((candidate) => candidate.id === trackId)
  if (track === undefined) return EMPTY
  const { marks, warnings } = comparedEffects(
    placedVolumeChanges(current.volumeChanges ?? []),
    placedVolumeChanges(track.volumeChanges ?? []),
    track.inPoint,
  )
  return { marks, warnings, transitions: [] }
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
