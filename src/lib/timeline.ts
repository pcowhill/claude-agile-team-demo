import type { LibraryClip } from './mediaLibrary'

export interface TimelineEntry {
  /** Unique per entry — the same library clip can appear multiple times. */
  id: string
  /** The library clip this entry was created from. */
  clipId: string
  name: string
  /** Duration of the source clip in seconds. */
  duration: number
  /** Object URL of the source clip, usable as a <video> src. */
  url: string
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration. */
  outPoint: number
}

/**
 * Every transition the timeline can carry, as a runtime list so other layers
 * (UI selects, serialization validation — #75) derive their set from this
 * single source of truth instead of enumerating privately.
 */
export const TRANSITION_TYPES = [
  'crossfade',
  'slide-from-above',
  'slide-from-below',
  'slide-from-left',
  'slide-from-right',
] as const

export type TransitionType = (typeof TRANSITION_TYPES)[number]

export interface TransitionSpec {
  type: TransitionType
  /** Overlap duration in seconds. Always > 0; the reducer clamps it. */
  duration: number
}

/**
 * A transition at the boundary between two *adjacent* entries. It belongs to
 * the ordered pair (beforeId, afterId): reordering or removing either
 * neighbor dissolves that boundary and the transition with it. During the
 * transition the tail of the before-entry and the head of the after-entry
 * play simultaneously, so the sequence shortens by `duration`.
 */
export interface TimelineTransition extends TransitionSpec {
  /** Entry whose tail plays under the transition. */
  beforeId: string
  /** Entry whose head plays under the transition. */
  afterId: string
}

/**
 * A temporary zoom into part of the frame (#63). The window is phased —
 * ramp in, hold, ramp out — and positioned by `start` seconds into the
 * entry's *trimmed* range. Centre + scale (rather than a rectangle) keeps
 * the zoomed region the frame's own aspect ratio by construction: the
 * visible region is always the frame divided by `scale` on both axes.
 */
export interface ZoomSpec {
  /** Seconds into the entry's trimmed range where the zoom-in begins. */
  start: number
  /** Seconds of zoom-in animation. */
  rampIn: number
  /** Seconds held at full zoom. */
  hold: number
  /** Seconds of zoom-out animation. */
  rampOut: number
  /** Magnification at full zoom. Always > 1; the reducer rejects less. */
  scale: number
  /** Centre of the zoomed region, as a fraction of frame width (0..1). */
  centerX: number
  /** Centre of the zoomed region, as a fraction of frame height (0..1). */
  centerY: number
}

/** A zoom owned by one timeline entry, like a transition is owned by a pair. */
export interface ZoomEffect extends ZoomSpec {
  entryId: string
}

export interface TimelineState {
  entries: TimelineEntry[]
  /**
   * Transitions between adjacent entries, at most one per boundary. Optional
   * so pre-transition states (and plain `{ entries }` literals) remain valid;
   * a missing or empty list means every boundary is a hard cut.
   */
  transitions?: TimelineTransition[]
  /**
   * Zooms on entries, at most one per entry (#63 — several per clip would be
   * a follow-up if the customer wants it). Optional for the same reason
   * `transitions` is; a missing or empty list means nothing zooms.
   */
  zooms?: ZoomEffect[]
}

export const emptyTimeline: TimelineState = { entries: [] }

export const DEFAULT_TRANSITION_DURATION = 1

/**
 * What the "+ Zoom" control adds: a 2× zoom into the frame centre at the
 * start of the entry, with gentle ramps. The reducer clamps the window to
 * the entry's trimmed duration, so this is safe on any entry.
 */
export const DEFAULT_ZOOM: ZoomSpec = {
  start: 0,
  rampIn: 0.5,
  hold: 1,
  rampOut: 0.5,
  scale: 2,
  centerX: 0.5,
  centerY: 0.5,
}

export type TimelineAction =
  | {
      /**
       * Wholesale replacement, for opening a project or starting a new one
       * (#77). The action's state is stored as-is — callers pass a state that
       * already satisfies the invariants (see `normalizedTimelineState`) so
       * that the stored reference is exactly the one they hold, which is what
       * the unsaved-changes tracking compares against (#76).
       */
      type: 'timeline-replaced'
      timeline: TimelineState
    }
  | { type: 'entry-added'; entry: TimelineEntry }
  | { type: 'entry-removed'; id: string }
  | { type: 'entries-removed-for-clip'; clipId: string }
  | { type: 'entry-moved'; id: string; direction: 'up' | 'down' }
  | { type: 'entry-trimmed'; id: string; inPoint: number; outPoint: number }
  | { type: 'transition-set'; beforeId: string; afterId: string; transition: TransitionSpec }
  | { type: 'transition-removed'; beforeId: string; afterId: string }
  | { type: 'zoom-set'; entryId: string; zoom: ZoomSpec }
  | { type: 'zoom-removed'; entryId: string }

export function entryFromClip(clip: LibraryClip, id: string): TimelineEntry {
  // The sequence carries video only; audio placement is its own model (#102).
  // The UI never offers this path for audio — reaching here is programmer
  // error, and a silent audio entry would break preview and export.
  if (clip.kind !== 'video') {
    throw new Error(`cannot add "${clip.name}" to the sequence: it is not a video clip`)
  }
  return {
    id,
    clipId: clip.id,
    name: clip.name,
    duration: clip.duration,
    url: clip.url,
    inPoint: 0,
    outPoint: clip.duration,
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** The state's transitions, tolerating pre-transition states. */
export function transitionsOf(state: TimelineState): TimelineTransition[] {
  return state.transitions ?? []
}

/** The state's zooms, tolerating pre-zoom states. */
export function zoomsOf(state: TimelineState): ZoomEffect[] {
  return state.zooms ?? []
}

/** The entry's zoom, if it has one. States are normalized to at most one. */
export function zoomForEntry(state: TimelineState, entryId: string): ZoomEffect | undefined {
  return zoomsOf(state).find((zoom) => zoom.entryId === entryId)
}

/**
 * Restores the transition invariants against a (possibly just edited) entry
 * list, returning one transition per boundary index (between entries[i] and
 * entries[i+1]) or undefined for a hard cut:
 *
 * - a transition survives only while its ordered pair is still adjacent;
 * - its duration never exceeds either neighbor's trimmed duration;
 * - transitions on both sides of one entry never overlap *each other* (their
 *   durations sum to at most the entry's trimmed duration), so no sequence
 *   time ever has more than two clips playing. When boundaries compete for
 *   the same clip time, the earlier boundary wins and the later is clamped.
 */
function normalizedBoundaries(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
): (TimelineTransition | undefined)[] {
  const position = new Map(entries.map((entry, index) => [entry.id, index]))
  const byBoundary = new Map<number, TimelineTransition>()
  for (const transition of transitions) {
    const before = position.get(transition.beforeId)
    if (before !== undefined && position.get(transition.afterId) === before + 1) {
      byBoundary.set(before, transition)
    }
  }
  const boundaries: (TimelineTransition | undefined)[] = []
  let headOverlap = 0
  for (let index = 0; index < entries.length - 1; index++) {
    const transition = byBoundary.get(index)
    if (transition === undefined) {
      boundaries.push(undefined)
      headOverlap = 0
      continue
    }
    const room = Math.min(
      effectiveDuration(entries[index]) - headOverlap,
      effectiveDuration(entries[index + 1]),
    )
    const duration = Math.min(transition.duration, room)
    if (duration <= 0) {
      boundaries.push(undefined)
      headOverlap = 0
      continue
    }
    boundaries.push(duration === transition.duration ? transition : { ...transition, duration })
    headOverlap = duration
  }
  return boundaries
}

/**
 * The transition (if any) at each boundary index, with the invariants above
 * applied. Length is entries.length - 1 (or 0 for an empty timeline).
 */
export function boundaryTransitions(state: TimelineState): (TimelineTransition | undefined)[] {
  return normalizedBoundaries(state.entries, transitionsOf(state))
}

/**
 * Clamps one zoom against its entry's trimmed duration and the frame:
 *
 * - the window never exceeds the trimmed duration — `start` first, then
 *   `rampIn`, `hold`, `rampOut` absorb the shortfall in that order, so
 *   retrimming re-clamps a zoom rather than dropping it;
 * - the zoomed region stays inside the frame: at `scale`, the region extends
 *   1 / (2·scale) from its centre on each axis, so the centre is clamped to
 *   [1 / (2·scale), 1 − 1 / (2·scale)].
 *
 * Returns the same object when nothing changes, so no-op edits are cheap to
 * detect.
 */
function clampZoom(zoom: ZoomEffect, entryDuration: number): ZoomEffect {
  const start = clamp(zoom.start, 0, entryDuration)
  const rampIn = clamp(zoom.rampIn, 0, entryDuration - start)
  const hold = clamp(zoom.hold, 0, entryDuration - start - rampIn)
  const rampOut = clamp(zoom.rampOut, 0, entryDuration - start - rampIn - hold)
  const halfExtent = 1 / (2 * zoom.scale)
  const centerX = clamp(zoom.centerX, halfExtent, 1 - halfExtent)
  const centerY = clamp(zoom.centerY, halfExtent, 1 - halfExtent)
  const next = { ...zoom, start, rampIn, hold, rampOut, centerX, centerY }
  return zoomsEqual(zoom, next) ? zoom : next
}

function zoomsEqual(a: ZoomEffect, b: ZoomEffect): boolean {
  return (
    a.entryId === b.entryId &&
    a.start === b.start &&
    a.rampIn === b.rampIn &&
    a.hold === b.hold &&
    a.rampOut === b.rampOut &&
    a.scale === b.scale &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY
  )
}

/**
 * Restores the zoom invariants against a (possibly just edited) entry list:
 * a zoom survives only while its entry exists, at most one zoom per entry
 * (the latest wins), and each is clamped per `clampZoom`. Results follow
 * entry order so states compare deterministically.
 */
function normalizedZooms(entries: TimelineEntry[], zooms: ZoomEffect[]): ZoomEffect[] {
  const byEntry = new Map<string, ZoomEffect>()
  const durations = new Map(entries.map((entry) => [entry.id, effectiveDuration(entry)]))
  for (const zoom of zooms) {
    const duration = durations.get(zoom.entryId)
    if (duration !== undefined) byEntry.set(zoom.entryId, clampZoom(zoom, duration))
  }
  return entries
    .filter((entry) => byEntry.has(entry.id))
    .map((entry) => byEntry.get(entry.id) as ZoomEffect)
}

function withEffects(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
  zooms: ZoomEffect[],
): TimelineState {
  return {
    entries,
    transitions: normalizedBoundaries(entries, transitions).filter(
      (transition): transition is TimelineTransition => transition !== undefined,
    ),
    zooms: normalizedZooms(entries, zooms),
  }
}

/**
 * A timeline state with the reducer's invariants applied to the given lists:
 * transitions only on surviving adjacent boundaries, zooms clamped to their
 * entries. For building a state outside the reducer (opening a project, #77)
 * so that `timeline-replaced` can store the caller's reference unchanged.
 */
export function normalizedTimelineState(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
  zooms: ZoomEffect[],
): TimelineState {
  return withEffects(entries, transitions, zooms)
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  const transitions = transitionsOf(state)
  const zooms = zoomsOf(state)
  switch (action.type) {
    case 'timeline-replaced':
      return action.timeline
    case 'entry-added':
      return withEffects([...state.entries, action.entry], transitions, zooms)
    case 'entry-removed':
      return withEffects(
        state.entries.filter((entry) => entry.id !== action.id),
        transitions,
        zooms,
      )
    case 'entries-removed-for-clip': {
      const entries = state.entries.filter((entry) => entry.clipId !== action.clipId)
      // Same reference when nothing matched: a library removal that touches
      // no entries must not read as a timeline edit (which stops playback).
      return entries.length === state.entries.length
        ? state
        : withEffects(entries, transitions, zooms)
    }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return withEffects(entries, transitions, zooms)
    }
    case 'entry-trimmed': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.inPoint) || !Number.isFinite(action.outPoint)) return state
      const entry = state.entries[index]
      const inPoint = clamp(action.inPoint, 0, entry.duration)
      const outPoint = clamp(action.outPoint, 0, entry.duration)
      // An empty or inverted range would make the entry unplayable — reject it.
      if (inPoint >= outPoint) return state
      if (inPoint === entry.inPoint && outPoint === entry.outPoint) return state
      const entries = [...state.entries]
      entries[index] = { ...entry, inPoint, outPoint }
      return withEffects(entries, transitions, zooms)
    }
    case 'transition-set': {
      const before = state.entries.findIndex((entry) => entry.id === action.beforeId)
      // Only an existing boundary can carry a transition.
      if (before === -1 || state.entries[before + 1]?.id !== action.afterId) return state
      if (!Number.isFinite(action.transition.duration) || action.transition.duration <= 0) {
        return state
      }
      const candidate: TimelineTransition = {
        beforeId: action.beforeId,
        afterId: action.afterId,
        ...action.transition,
      }
      const next = withEffects(
        state.entries,
        [
          ...transitions.filter(
            (transition) =>
              transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
          ),
          candidate,
        ],
        zooms,
      )
      const applied = next.transitions?.find((transition) => transition.beforeId === action.beforeId)
      // Normalization can veto the whole transition (no room at this
      // boundary) or clamp it back to what is already there — both no-ops.
      if (applied === undefined) return state
      const existing = transitions.find(
        (transition) =>
          transition.beforeId === action.beforeId && transition.afterId === action.afterId,
      )
      if (existing?.type === applied.type && existing.duration === applied.duration) return state
      return next
    }
    case 'transition-removed': {
      const remaining = transitions.filter(
        (transition) =>
          transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
      )
      if (remaining.length === transitions.length) return state
      return withEffects(state.entries, remaining, zooms)
    }
    case 'zoom-set': {
      if (!state.entries.some((entry) => entry.id === action.entryId)) return state
      const zoom = action.zoom
      const values = [
        zoom.start,
        zoom.rampIn,
        zoom.hold,
        zoom.rampOut,
        zoom.scale,
        zoom.centerX,
        zoom.centerY,
      ]
      if (values.some((value) => !Number.isFinite(value))) return state
      // A magnification of 1 or less is not a zoom at all — reject rather
      // than clamp, mirroring the zero-duration transition rule above.
      if (zoom.scale <= 1) return state
      const next = withEffects(state.entries, transitions, [
        ...zooms.filter((existing) => existing.entryId !== action.entryId),
        { entryId: action.entryId, ...zoom },
      ])
      const applied = next.zooms?.find((existing) => existing.entryId === action.entryId)
      if (applied === undefined) return state
      const existing = zooms.find((existing) => existing.entryId === action.entryId)
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      if (existing !== undefined && zoomsEqual(existing, applied)) return state
      return next
    }
    case 'zoom-removed': {
      const remaining = zooms.filter((zoom) => zoom.entryId !== action.entryId)
      if (remaining.length === zooms.length) return state
      return withEffects(state.entries, transitions, remaining)
    }
  }
}

/** The trimmed (playable) duration of one entry, in seconds. */
export function effectiveDuration(entry: TimelineEntry): number {
  return entry.outPoint - entry.inPoint
}

/**
 * Total duration of the sequence in seconds, honoring trims. Each transition
 * overlaps its neighbors rather than adding time, so the total shrinks by
 * every transition's duration.
 */
export function totalDuration(state: TimelineState): number {
  const overlap = boundaryTransitions(state).reduce(
    (sum, transition) => sum + (transition?.duration ?? 0),
    0,
  )
  return state.entries.reduce((sum, entry) => sum + effectiveDuration(entry), 0) - overlap
}
