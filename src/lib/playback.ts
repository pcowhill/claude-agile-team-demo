import type { TimelineEntry, TimelineState, TransitionType } from './timeline'
import { boundaryTransitions, effectiveDuration, totalDuration } from './timeline'

/**
 * The second entry playing during a transition overlap: while the outgoing
 * entry's tail runs, the incoming entry's head plays under the effect.
 */
export interface TransitionOverlap {
  type: TransitionType
  /**
   * How far the transition has advanced: 0 where the incoming entry starts,
   * approaching 1 where the outgoing entry ends. Always in [0, 1) — at the
   * exact end of the overlap the incoming entry has become the primary
   * location and the transition is over.
   */
  progress: number
  /** Index of the incoming entry (always the primary index + 1). */
  index: number
  entry: TimelineEntry
  /** Time within the incoming entry's source clip, in seconds. */
  sourceTime: number
}

/**
 * A resolved playback position: which timeline entry is under a given
 * sequence time, and where inside its *source* clip that time falls.
 */
export interface PlaybackLocation {
  /** Index of the entry in the timeline. */
  index: number
  entry: TimelineEntry
  /** Time within the source clip, in seconds. inPoint ≤ sourceTime ≤ outPoint. */
  sourceTime: number
  /**
   * Present while the time falls inside a transition overlap (#41): the
   * primary fields describe the *outgoing* entry (still playing its tail)
   * and this describes the incoming one. Absent at hard cuts.
   */
  transition?: TransitionOverlap
}

/**
 * Sequence time (seconds from the start of the whole edit) where entry
 * `index` begins. A transition overlaps its neighbors, so each one before
 * `index` pulls the start earlier by its duration.
 */
export function entryStartTime(state: TimelineState, index: number): number {
  const overlaps = boundaryTransitions(state)
  let start = 0
  for (let i = 0; i < index; i++) {
    start += effectiveDuration(state.entries[i]) - (overlaps[i]?.duration ?? 0)
  }
  return start
}

/**
 * Maps a sequence time to the entry playing at that moment and the
 * corresponding source-clip time. Returns null for an empty timeline.
 *
 * Times are clamped into [0, total]. A time exactly on a hard-cut boundary
 * resolves to the *start of the later entry*, so advancing playback lands on
 * the next clip; the sequence end resolves to the last entry at its
 * out-point. Inside a transition overlap the *outgoing* entry stays primary
 * until it ends, with the incoming entry exposed via `transition`.
 */
export function locateInSequence(state: TimelineState, sequenceTime: number): PlaybackLocation | null {
  const { entries } = state
  if (entries.length === 0) return null

  const overlaps = boundaryTransitions(state)
  const time = Math.max(0, sequenceTime)
  let start = 0
  for (let index = 0; index < entries.length - 1; index++) {
    const entry = entries[index]
    const end = start + effectiveDuration(entry)
    const overlap = overlaps[index]
    const nextStart = end - (overlap?.duration ?? 0)
    // `< end` (not ≤) sends boundary times to the next entry's start.
    if (time < end) {
      const location: PlaybackLocation = {
        index,
        entry,
        sourceTime: entry.inPoint + (time - start),
      }
      if (overlap !== undefined && time >= nextStart) {
        const next = entries[index + 1]
        location.transition = {
          type: overlap.type,
          progress: (time - nextStart) / overlap.duration,
          index: index + 1,
          entry: next,
          sourceTime: next.inPoint + (time - nextStart),
        }
      }
      return location
    }
    start = nextStart
  }
  const index = entries.length - 1
  const entry = entries[index]
  return { index, entry, sourceTime: Math.min(entry.inPoint + (time - start), entry.outPoint) }
}

/** Inverse of locateInSequence: sequence time of `sourceTime` within entry `index`. */
export function sequenceTimeAt(state: TimelineState, index: number, sourceTime: number): number {
  const entry = state.entries[index]
  const clamped = Math.min(Math.max(sourceTime, entry.inPoint), entry.outPoint)
  return entryStartTime(state, index) + (clamped - entry.inPoint)
}

/** True when `sequenceTime` is at (or past) the end of the sequence. */
export function isAtSequenceEnd(state: TimelineState, sequenceTime: number): boolean {
  return sequenceTime >= totalDuration(state)
}
