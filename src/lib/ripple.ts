/**
 * The ripple of Cut out marked range (#824, PR 2 of the approved #731).
 *
 * The cut (#823, `range-cut`) removes the sequence's output time
 * `[from, to)`. Everything placed **in sequence time** follows the picture
 * it belonged to:
 *
 * - an element starting at or after `to` moves earlier by `to - from`;
 * - an element lying wholly inside the range is removed;
 * - an element straddling `from` loses its tail, from `from` on;
 * - an element straddling `to` loses its head, up to `to`, and then starts
 *   at `from`;
 * - an element covering the whole range loses the range's length **from
 *   its end** and stays one element. A trimmed element has no single-trim
 *   form for a missing middle, so this is #731's stated rule: it keeps its
 *   head.
 *
 * A chapter marker is a point: before `from` or exactly on it, it stays;
 * inside the range it is removed; at or after `to` it moves earlier. A
 * marker that would land on one already kept (within `MARKER_TIME_EPSILON`)
 * is removed rather than doubled: two markers at one instant is a state
 * the marker actions refuse.
 *
 * **The collections this covers**, which are every `TimelineState` field
 * placed in sequence time: `audioTracks`, `videoOverlays` (video and image
 * kinds), `texts` (hand-made and `subtitle: true`), `shapeGroups` and
 * `markers`. `entries`, `transitions`, `zooms` and `remaps` are the
 * sequence itself or are keyed to an entry, and the cut handles them.
 * **A collection added to `TimelineState` later that is placed in sequence
 * time must be added here, in `rippleCut` and in `RippleKind`**: otherwise
 * a cut leaves it out of sync with the picture. That is the widened-kinds
 * hazard of `review.md`.
 *
 * One function decides each element's outcome (`windowCut`, `pointCut`), and
 * both the reducer (`rippleCut`) and the confirmation's counts
 * (`rippleChanges`) read it, so the counts are what the cut does.
 */
import { RANGE_CUT_EPSILON } from './rangeCut'
import type { RemapSpec } from './remap'
import { outputTimeAtSource, sourceTimeAtOutput } from './remap'
import type { RedactionRegion } from './redaction'
import type { ShapeGroup } from './shapes'
import type { SpotlightRegion } from './spotlight'
import type { TextOverlay } from './textOverlay'
import type { AudioTrack, ChapterMarker, ZoomSpec } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { isImageOverlay, overlayOutputDuration } from './videoOverlay'
import { splitMovesAt } from './overlayMove'

const EPSILON = RANGE_CUT_EPSILON

/** Two marker times this close are one instant (`MARKER_TIME_EPSILON`). */
const MARKER_EPSILON = 1e-6

/** What the cut does to one element's window, in sequence seconds. */
export type WindowCut =
  | { kind: 'keep' }
  | { kind: 'move'; start: number }
  /** `head` seconds come off the front, `tail` off the back; one is 0. */
  | { kind: 'shorten'; start: number; head: number; tail: number }
  | { kind: 'remove' }

/**
 * The outcome for a window `[start, start + length)` when `[from, to)` is
 * cut out. Times within `RANGE_CUT_EPSILON` of a mark count as on it, as
 * the cut's own plan does, so no sliver of an element survives a cut.
 */
export function windowCut(start: number, length: number, from: number, to: number): WindowCut {
  const removed = to - from
  const end = start + length
  if (end <= from + EPSILON) return { kind: 'keep' }
  if (start >= to - EPSILON) return { kind: 'move', start: Math.max(0, start - removed) }
  if (start < from - EPSILON) {
    // Begins before the range: loses its tail, or, covering the range,
    // loses the range's length from its end.
    const tail = end <= to + EPSILON ? end - from : removed
    return { kind: 'shorten', start, head: 0, tail }
  }
  if (end <= to + EPSILON) return { kind: 'remove' }
  return { kind: 'shorten', start: from, head: to - start, tail: 0 }
}

/** The outcome for a point in time: a chapter marker. */
export function pointCut(time: number, from: number, to: number): WindowCut {
  if (time <= from + EPSILON) return { kind: 'keep' }
  if (time < to - EPSILON) return { kind: 'remove' }
  return { kind: 'move', start: Math.max(0, time - (to - from)) }
}

/**
 * The kinds the confirmation counts. A `Record` over this union names each,
 * so a new kind does not compile until it has a name.
 */
export type RippleKind =
  | 'subtitle'
  | 'text'
  | 'video-overlay'
  | 'image-overlay'
  | 'audio-track'
  | 'shape-group'
  | 'marker'

export type RippleOutcome = 'moves' | 'shortened' | 'removed'

/** One element the cut moves, shortens or removes. */
export interface RippleChange {
  kind: RippleKind
  id: string
  outcome: RippleOutcome
}

const OUTCOMES: Record<WindowCut['kind'], RippleOutcome | null> = {
  keep: null,
  move: 'moves',
  shorten: 'shortened',
  remove: 'removed',
}

/** The collections the ripple acts on, as `TimelineState` holds them. */
export interface RippleCollections {
  audioTracks: AudioTrack[]
  videoOverlays: VideoOverlay[]
  texts: TextOverlay[]
  shapeGroups: ShapeGroup[]
  markers: ChapterMarker[]
}

/**
 * Splits a zoom window at `at` seconds into its trimmed range, by the razor's
 * rule (`entry-split`, #190): a window wholly before the cut stays before,
 * one wholly after moves after (its start re-anchored to the cut), and one
 * whose *hold* contains the cut becomes two zooms that render identically.
 * A cut inside a ramp has no exact `ZoomSpec` form, so that zoom stays
 * whole on the first side, as the razor keeps it. `after` starts are
 * relative to the cut.
 */
export function splitZoomAt<T extends ZoomSpec>(
  zoom: T,
  at: number,
): { before: T | null; after: T | null } {
  const length = zoom.rampIn + zoom.hold + zoom.rampOut
  if (zoom.start + length <= at) return { before: zoom, after: null }
  if (zoom.start >= at) return { before: null, after: { ...zoom, start: zoom.start - at } }
  const holdStart = zoom.start + zoom.rampIn
  if (at >= holdStart && at <= holdStart + zoom.hold) {
    return {
      before: { ...zoom, hold: at - holdStart, rampOut: 0 },
      after: { ...zoom, start: 0, rampIn: 0, hold: holdStart + zoom.hold - at },
    }
  }
  return { before: zoom, after: null }
}

/**
 * Cuts a remapped window at output time `u` seconds into it, so the part
 * before lasts exactly `u` and the part after exactly the rest: speed
 * segments split at the source instant, and a pause whose hold contains `u`
 * divides its hold between the two sides. Positions are seconds into the
 * trimmed range; `after`'s are relative to `at`, the source instant of the
 * cut. Remaps must be normalized (sorted, disjoint).
 */
export function splitRemapsAtOutput<T extends RemapSpec>(
  trimmedLength: number,
  remaps: readonly T[],
  u: number,
): { at: number; before: T[]; after: T[] } {
  const at = sourceTimeAtOutput(trimmedLength, remaps, u)
  const before: T[] = []
  const after: T[] = []
  for (const remap of remaps) {
    if (remap.kind === 'pause') {
      if (remap.at < at - EPSILON) before.push(remap)
      else if (remap.at > at + EPSILON) after.push({ ...remap, at: remap.at - at })
      else {
        // The cut falls on this pause's instant: its hold is shared.
        const plateau = outputTimeAtSource(trimmedLength, remaps, remap.at)
        const kept = Math.min(Math.max(u - plateau, 0), remap.hold)
        if (kept > EPSILON) before.push({ ...remap, hold: kept })
        if (remap.hold - kept > EPSILON) after.push({ ...remap, at: 0, hold: remap.hold - kept })
      }
      continue
    }
    if (remap.end <= at + EPSILON) before.push(remap)
    else if (remap.start >= at - EPSILON) {
      after.push({ ...remap, start: Math.max(0, remap.start - at), end: remap.end - at })
    } else {
      before.push({ ...remap, end: at })
      after.push({ ...remap, start: 0, end: remap.end - at })
    }
  }
  return { at, before, after }
}

/** Shifts source-time windows `by` seconds earlier, dropping what ends before 0. */
function shiftWindows<T extends RedactionRegion | SpotlightRegion>(
  regions: readonly T[] | undefined,
  by: number,
): T[] | undefined {
  if (regions === undefined) return undefined
  return regions
    .filter((region) => region.end - by > EPSILON)
    .map((region) => ({ ...region, start: Math.max(0, region.start - by), end: region.end - by }))
}

/** Drops an optional list's key when the list came out empty. */
function withList<T extends object, K extends keyof T>(element: T, key: K, list: T[K] | undefined): T {
  const { [key]: _old, ...rest } = element
  return (list === undefined || (Array.isArray(list) && list.length === 0)
    ? rest
    : { ...rest, [key]: list }) as T
}

/**
 * A video or image overlay with `head` output seconds cut off its front, or
 * `tail` off its back (one of them is 0), starting at `start`.
 *
 * A video overlay is trimmed in source time: its own speed segments and
 * pauses (#700) are split at the cut's output instant so exactly the cut's
 * length goes, and its zooms (#699), keyed to seconds into the trimmed
 * range, are split by the razor's rule. Its redactions and spotlights are in
 * the clip's own source seconds, so moving In keeps them on the same
 * picture untouched.
 *
 * An image overlay's window is its duration, and its zooms, redactions and
 * spotlights are seconds into that window, so a head cut shifts them all
 * earlier by `head`. A tail cut leaves them; normalization clamps the zooms.
 */
function shortenOverlay(overlay: VideoOverlay, start: number, head: number, tail: number): VideoOverlay {
  return withMovesShortened(overlay, shortenOverlayWindow(overlay, start, head, tail), head, tail)
}

/**
 * The shortened overlay's Moves (#834), which are keyed to its on-screen
 * time: a tail cut keeps those before the new end, and a head cut keeps
 * those after the cut, shifted earlier by `head`, with the placement it had
 * at the cut as its own — `splitMovesAt`, as Split… and Cut… divide them.
 */
function withMovesShortened(
  overlay: VideoOverlay,
  next: VideoOverlay,
  head: number,
  tail: number,
): VideoOverlay {
  if (overlay.moves === undefined) return next
  if (tail > 0) {
    const { before } = splitMovesAt(overlay, overlayOutputDuration(overlay) - tail)
    return withList(next, 'moves', before)
  }
  const { after, afterRect } = splitMovesAt(overlay, head)
  return withList({ ...next, ...afterRect }, 'moves', after)
}

/** `shortenOverlay`'s window, picture and effects, Moves aside. */
function shortenOverlayWindow(
  overlay: VideoOverlay,
  start: number,
  head: number,
  tail: number,
): VideoOverlay {
  if (isImageOverlay(overlay)) {
    const duration = overlay.duration - head - tail
    let next: VideoOverlay = { ...overlay, offset: start, duration, inPoint: 0, outPoint: duration }
    if (head > 0) {
      next = withList(next, 'zooms', shiftedZooms(overlay.zooms, head))
      next = withList(next, 'redactions', shiftWindows(overlay.redactions, head))
      next = withList(next, 'spotlights', shiftWindows(overlay.spotlights, head))
    }
    return next
  }
  const trimmedLength = overlay.outPoint - overlay.inPoint
  const remaps = overlay.remaps ?? []
  const output = overlayOutputDuration(overlay)
  if (tail > 0) {
    const { at, before } = splitRemapsAtOutput(trimmedLength, remaps, output - tail)
    const zooms = overlay.zooms?.flatMap((zoom) => {
      const { before: kept } = splitZoomAt(zoom, at)
      return kept === null ? [] : [kept]
    })
    let next: VideoOverlay = { ...overlay, offset: start, outPoint: overlay.inPoint + at }
    next = withList(next, 'remaps', overlay.remaps === undefined ? undefined : before)
    return withList(next, 'zooms', zooms)
  }
  const { at, after } = splitRemapsAtOutput(trimmedLength, remaps, head)
  let next: VideoOverlay = { ...overlay, offset: start, inPoint: overlay.inPoint + at }
  next = withList(next, 'remaps', overlay.remaps === undefined ? undefined : after)
  return withList(next, 'zooms', shiftedZooms(overlay.zooms, at))
}

/** Zooms after a head cut of `at` seconds: the razor's second half. */
function shiftedZooms<T extends ZoomSpec>(zooms: readonly T[] | undefined, at: number): T[] | undefined {
  return zooms?.flatMap((zoom) => {
    const { after } = splitZoomAt(zoom, at)
    return after === null ? [] : [after]
  })
}

/**
 * Applies the ripple to every collection placed in sequence time, and says
 * what it did to each element it touched. Clamping (fades, draw-on, zoom
 * and remap windows) is left to the reducer's normalization, which runs on
 * the result as on any edit.
 */
export function rippleCut(
  collections: RippleCollections,
  from: number,
  to: number,
): RippleCollections & { changes: RippleChange[] } {
  const changes: RippleChange[] = []
  const note = (kind: RippleKind, id: string, cut: WindowCut) => {
    const outcome = OUTCOMES[cut.kind]
    if (outcome !== null) changes.push({ kind, id, outcome })
  }

  const audioTracks = collections.audioTracks.flatMap((track): AudioTrack[] => {
    const cut = windowCut(track.offset, track.outPoint - track.inPoint, from, to)
    note('audio-track', track.id, cut)
    switch (cut.kind) {
      case 'keep':
        return [track]
      case 'move':
        return [{ ...track, offset: cut.start }]
      case 'remove':
        return []
      case 'shorten':
        return [
          {
            ...track,
            offset: cut.start,
            inPoint: track.inPoint + cut.head,
            outPoint: track.outPoint - cut.tail,
          },
        ]
    }
  })

  const videoOverlays = collections.videoOverlays.flatMap((overlay): VideoOverlay[] => {
    const cut = windowCut(overlay.offset, overlayOutputDuration(overlay), from, to)
    note(isImageOverlay(overlay) ? 'image-overlay' : 'video-overlay', overlay.id, cut)
    switch (cut.kind) {
      case 'keep':
        return [overlay]
      case 'move':
        return [{ ...overlay, offset: cut.start }]
      case 'remove':
        return []
      case 'shorten':
        return [shortenOverlay(overlay, cut.start, cut.head, cut.tail)]
    }
  })

  // Text overlays and shape groups are an offset and a duration.
  const timed = <T extends { id: string; offset: number; duration: number }>(
    element: T,
    kind: RippleKind,
  ): T[] => {
    const cut = windowCut(element.offset, element.duration, from, to)
    note(kind, element.id, cut)
    switch (cut.kind) {
      case 'keep':
        return [element]
      case 'move':
        return [{ ...element, offset: cut.start }]
      case 'remove':
        return []
      case 'shorten':
        return [{ ...element, offset: cut.start, duration: element.duration - cut.head - cut.tail }]
    }
  }
  const texts = collections.texts.flatMap((text) =>
    timed(text, text.subtitle === true ? 'subtitle' : 'text'),
  )
  const shapeGroups = collections.shapeGroups.flatMap((group) => timed(group, 'shape-group'))

  // Markers: the kept ones first, so a moved one landing on a kept instant
  // is the one that goes.
  const verdicts = collections.markers.map((marker) => ({
    marker,
    cut: pointCut(marker.time, from, to),
  }))
  const kept = verdicts.filter(({ cut }) => cut.kind === 'keep').map(({ marker }) => marker.time)
  const landed: number[] = []
  const markers = verdicts.flatMap(({ marker, cut }): ChapterMarker[] => {
    if (cut.kind === 'keep') {
      note('marker', marker.id, cut)
      return [marker]
    }
    if (cut.kind === 'move') {
      const taken = [...kept, ...landed].some((time) => Math.abs(time - cut.start) <= MARKER_EPSILON)
      if (!taken) {
        landed.push(cut.start)
        note('marker', marker.id, cut)
        return [{ ...marker, time: cut.start }]
      }
    }
    note('marker', marker.id, { kind: 'remove' })
    return []
  })

  return { audioTracks, videoOverlays, texts, shapeGroups, markers, changes }
}

/** What the confirmation calls each kind, singular and plural. */
const KIND_NAMES: Record<RippleKind, [string, string]> = {
  subtitle: ['subtitle', 'subtitles'],
  text: ['text overlay', 'text overlays'],
  'video-overlay': ['video overlay', 'video overlays'],
  'image-overlay': ['image overlay', 'image overlays'],
  'audio-track': ['audio track', 'audio tracks'],
  'shape-group': ['shape group', 'shape groups'],
  marker: ['chapter marker', 'chapter markers'],
}

const KIND_ORDER: readonly RippleKind[] = [
  'subtitle',
  'text',
  'video-overlay',
  'image-overlay',
  'audio-track',
  'shape-group',
  'marker',
]

/** "2 subtitles and 1 video overlay", or "" when there are none. */
function countPhrase(changes: readonly RippleChange[]): { text: string; total: number } {
  const parts = KIND_ORDER.flatMap((kind) => {
    const count = changes.filter((change) => change.kind === kind).length
    if (count === 0) return []
    return [`${count} ${KIND_NAMES[kind][count === 1 ? 0 : 1]}`]
  })
  const text =
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return { text, total: changes.length }
}

/** Seconds as the confirmation states them: "4.2", "0.75", "12". */
function formatCutSeconds(seconds: number): string {
  return String(Math.round(seconds * 100) / 100)
}

/**
 * The confirmation's one line (#824), e.g. *"Removes 4.2 s. 3 subtitles and
 * 1 video overlay after it move earlier."*, or null when the cut touches
 * nothing but sequence entries and so runs without asking.
 */
export function rippleSummary(changes: readonly RippleChange[], seconds: number): string | null {
  if (changes.length === 0) return null
  const clause = (outcome: RippleOutcome, single: string, plural: string): string[] => {
    const { text, total } = countPhrase(changes.filter((change) => change.outcome === outcome))
    return total === 0 ? [] : [`${text} ${total === 1 ? single : plural}`]
  }
  const clauses = [
    ...clause('moves', 'after it moves earlier', 'after it move earlier'),
    ...clause('shortened', 'that overlaps it is shortened', 'that overlap it are shortened'),
    ...clause('removed', 'inside it is removed', 'inside it are removed'),
  ]
  return `Removes ${formatCutSeconds(seconds)} s. ${clauses.join('; ')}.`
}
