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

export type TransitionType = 'crossfade' | 'slide-from-above'

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

export interface TimelineState {
  entries: TimelineEntry[]
  /**
   * Transitions between adjacent entries, at most one per boundary. Optional
   * so pre-transition states (and plain `{ entries }` literals) remain valid;
   * a missing or empty list means every boundary is a hard cut.
   */
  transitions?: TimelineTransition[]
}

export const emptyTimeline: TimelineState = { entries: [] }

export const DEFAULT_TRANSITION_DURATION = 1

export type TimelineAction =
  | { type: 'entry-added'; entry: TimelineEntry }
  | { type: 'entry-removed'; id: string }
  | { type: 'entries-removed-for-clip'; clipId: string }
  | { type: 'entry-moved'; id: string; direction: 'up' | 'down' }
  | { type: 'entry-trimmed'; id: string; inPoint: number; outPoint: number }
  | { type: 'transition-set'; beforeId: string; afterId: string; transition: TransitionSpec }
  | { type: 'transition-removed'; beforeId: string; afterId: string }

export function entryFromClip(clip: LibraryClip, id: string): TimelineEntry {
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

function withTransitions(entries: TimelineEntry[], transitions: TimelineTransition[]): TimelineState {
  return {
    entries,
    transitions: normalizedBoundaries(entries, transitions).filter(
      (transition): transition is TimelineTransition => transition !== undefined,
    ),
  }
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  const transitions = transitionsOf(state)
  switch (action.type) {
    case 'entry-added':
      return withTransitions([...state.entries, action.entry], transitions)
    case 'entry-removed':
      return withTransitions(
        state.entries.filter((entry) => entry.id !== action.id),
        transitions,
      )
    case 'entries-removed-for-clip': {
      const entries = state.entries.filter((entry) => entry.clipId !== action.clipId)
      // Same reference when nothing matched: a library removal that touches
      // no entries must not read as a timeline edit (which stops playback).
      return entries.length === state.entries.length ? state : withTransitions(entries, transitions)
    }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return withTransitions(entries, transitions)
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
      return withTransitions(entries, transitions)
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
      const next = withTransitions(state.entries, [
        ...transitions.filter(
          (transition) =>
            transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
        ),
        candidate,
      ])
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
      return withTransitions(state.entries, remaining)
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
