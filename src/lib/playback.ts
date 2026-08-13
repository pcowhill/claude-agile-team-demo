import type { TimelineEntry, TimelineState } from './timeline'
import { effectiveDuration, totalDuration } from './timeline'

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
}

/** Sequence time (seconds from the start of the whole edit) where entry `index` begins. */
export function entryStartTime(state: TimelineState, index: number): number {
  return state.entries.slice(0, index).reduce((sum, entry) => sum + effectiveDuration(entry), 0)
}

/**
 * Maps a sequence time to the entry playing at that moment and the
 * corresponding source-clip time. Returns null for an empty timeline.
 *
 * Times are clamped into [0, total]. A time exactly on a boundary between
 * two entries resolves to the *start of the later entry*, so advancing
 * playback lands on the next clip; the sequence end resolves to the last
 * entry at its out-point.
 */
export function locateInSequence(state: TimelineState, sequenceTime: number): PlaybackLocation | null {
  const { entries } = state
  if (entries.length === 0) return null

  const time = Math.max(0, sequenceTime)
  let start = 0
  for (let index = 0; index < entries.length - 1; index++) {
    const entry = entries[index]
    const end = start + effectiveDuration(entry)
    // `< end` (not ≤) sends boundary times to the next entry's start.
    if (time < end) {
      return { index, entry, sourceTime: entry.inPoint + (time - start) }
    }
    start = end
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
