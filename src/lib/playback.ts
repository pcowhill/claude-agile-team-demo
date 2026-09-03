import type { AudioTrack, TimelineEntry, TimelineState, TransitionType } from './timeline'
import {
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  isSplittablePoint,
  remapsForEntry,
  remapsOf,
  totalDuration,
} from './timeline'
import { outputTimeAtSource, sourceTimeAtOutput } from './remap'

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
  const remaps = remapsOf(state)
  let start = 0
  for (let i = 0; i < index; i++) {
    start += entryOutputDuration(state.entries[i], remaps) - (overlaps[i]?.duration ?? 0)
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
  const remaps = remapsOf(state)
  // Where inside the entry's *source* clip an output time this far into the
  // entry falls: 1:1 for an unremapped entry, and through the entry's remap
  // effects (#138) otherwise — a pause plateaus, a speed segment stretches
  // or compresses.
  const sourceAt = (entry: TimelineEntry, intoEntry: number): number =>
    entry.inPoint +
    sourceTimeAtOutput(effectiveDuration(entry), remapsForEntry(state, entry.id), intoEntry)
  const time = Math.max(0, sequenceTime)
  let start = 0
  for (let index = 0; index < entries.length - 1; index++) {
    const entry = entries[index]
    const end = start + entryOutputDuration(entry, remaps)
    const overlap = overlaps[index]
    const nextStart = end - (overlap?.duration ?? 0)
    // `< end` (not ≤) sends boundary times to the next entry's start.
    if (time < end) {
      const location: PlaybackLocation = {
        index,
        entry,
        sourceTime: sourceAt(entry, time - start),
      }
      if (overlap !== undefined && time >= nextStart) {
        const next = entries[index + 1]
        location.transition = {
          type: overlap.type,
          progress: (time - nextStart) / overlap.duration,
          index: index + 1,
          entry: next,
          sourceTime: sourceAt(next, time - nextStart),
        }
      }
      return location
    }
    start = nextStart
  }
  const index = entries.length - 1
  const entry = entries[index]
  return { index, entry, sourceTime: Math.min(sourceAt(entry, time - start), entry.outPoint) }
}

/**
 * Inverse of locateInSequence: sequence time of `sourceTime` within entry
 * `index`. Under a remap (#138) a paused instant spans a plateau of sequence
 * times; this returns the earliest — where the frame is first shown.
 */
export function sequenceTimeAt(state: TimelineState, index: number, sourceTime: number): number {
  const entry = state.entries[index]
  const clamped = Math.min(Math.max(sourceTime, entry.inPoint), entry.outPoint)
  return (
    entryStartTime(state, index) +
    outputTimeAtSource(
      effectiveDuration(entry),
      remapsForEntry(state, entry.id),
      clamped - entry.inPoint,
    )
  )
}

/**
 * The location the preview may front, which is never an entry playback has
 * already left (#318).
 *
 * `locateInSequence` resolves the *published* sequence time, and at a
 * handover that time comes off the incoming element's own clock, which lags
 * by tens of milliseconds — so it can still fall inside the overlap the
 * player has just finished. `locateInSequence` then reports the overlap's
 * **outgoing** entry as the fronting one, and every layer keyed to the
 * location follows it backwards: a slate or an image still is painted again,
 * full-frame and (correctly, the transition being over) with no transition
 * style at all, over the clip that should now be playing; a video entry's
 * crop, orientation, and color adjustments are taken from the entry that
 * just ended. #61 fixed this for the *incoming* overlay by keying it to
 * actual engagement (`isTransitionOverlayActive`); this is the same rule for
 * the fronting side, and applying it to the location itself covers every
 * layer derived from it rather than one of them.
 *
 * `playedIndex` is the entry the player has advanced to — the index the
 * transport actually cued, which a seek sets to the sought entry, so
 * scrubbing backwards inside an overlap is unaffected (there `playedIndex`
 * *is* the location's index). Only a played index ahead of the location's is
 * corrected, and then to the earliest instant that entry can be at: its
 * start plus the transition that brought it in — the geometric handover
 * point the lagging clock is short of.
 */
export function frontedLocation(
  state: TimelineState,
  location: PlaybackLocation | null,
  playedIndex: number,
): PlaybackLocation | null {
  if (location === null || playedIndex <= location.index) return location
  if (playedIndex >= state.entries.length) return location
  const into = boundaryTransitions(state)[playedIndex - 1]?.duration ?? 0
  return locateInSequence(state, entryStartTime(state, playedIndex) + into)
}

/**
 * Whether the secondary <video> element genuinely renders a transition
 * overlay. The published location alone cannot decide this: element clocks
 * drift by tens of milliseconds, so right after a handover the published
 * sequence time can still fall just inside the overlap while the roles have
 * already swapped — and then the element holding the *outgoing* clip's
 * paused frame would be styled onto the top layer at progress ≈ 1 (#61).
 * The overlay is only real while the secondary element is actually engaged
 * for the location's outgoing entry.
 */
export function isTransitionOverlayActive(
  location: PlaybackLocation | null,
  engagedFor: number | null,
): boolean {
  return location?.transition !== undefined && engagedFor === location.index
}

/** True when `sequenceTime` is at (or past) the end of the sequence. */
export function isAtSequenceEnd(state: TimelineState, sequenceTime: number): boolean {
  return sequenceTime >= totalDuration(state)
}

/** What the Split control (#190) would cut, resolved from the playhead. */
export interface SplitTarget {
  entryId: string
  /** Absolute source-clip seconds, strictly inside the entry's trim window. */
  atSourceTime: number
}

/**
 * Resolves a playhead position to the entry-split it would perform (#190),
 * or null where splitting is disabled:
 *
 * - an empty timeline, or a playhead at an entry boundary (the location's
 *   source time sits on the trim window's edge — there is nothing to split);
 * - inside a transition overlap: two clips are playing, and cutting the
 *   outgoing entry there would shorten a half below the transition's
 *   duration, re-clamping it — the split would no longer play back
 *   identically, so the control disables instead;
 * - inside a pause plateau holding the entry's first frame: the frozen
 *   instant *is* the in-point, so no strictly-inside source point exists.
 *
 * The mapping from the playhead's *output* time to the source instant is
 * `locateInSequence`'s — remap effects (#138) are already accounted for.
 * Splitting at the returned point keeps every boundary outside a transition
 * overlap, so no transition re-clamps and playback is unchanged (#190).
 */
export function splitTargetAt(state: TimelineState, sequenceTime: number): SplitTarget | null {
  const location = locateInSequence(state, sequenceTime)
  if (location === null || location.transition !== undefined) return null
  const { entry, sourceTime } = location
  if (!isSplittablePoint(entry, sourceTime)) return null
  return { entryId: entry.id, atSourceTime: sourceTime }
}

/** Where an audio track stands at one timeline position (#103). */
export interface AudioTrackPlayback {
  /** Whether the track's audible window covers this position. */
  shouldPlay: boolean
  /**
   * Time within the source clip, in seconds, clamped into
   * [inPoint, outPoint]: before the window it is the in-point (where playback
   * would start), past the window the out-point.
   */
  sourceTime: number
}

/**
 * Maps a timeline position to one audio track's playback state — the audio
 * counterpart of locateInSequence. The audible window is
 * [offset, offset + trimmedLength): a position exactly on the window's end
 * does not play, mirroring how a hard-cut boundary resolves to the *next*
 * entry rather than replaying the previous one's last instant.
 *
 * The mapping is pure and sequence-agnostic: a track outlasting the video
 * sequence (the silent tail allowed by #102) still maps to shouldPlay inside
 * its whole window. Preview playback, however, only ever publishes positions
 * within [0, totalDuration] — it is driven by the video elements' clocks — so
 * a tail past the video sequence's end is not audible in preview. Whether
 * export renders the tail is #105's decision.
 */
export function audioTrackPlaybackAt(track: AudioTrack, sequenceTime: number): AudioTrackPlayback {
  const length = effectiveDuration(track)
  if (sequenceTime < track.offset) return { shouldPlay: false, sourceTime: track.inPoint }
  if (sequenceTime >= track.offset + length) {
    return { shouldPlay: false, sourceTime: track.outPoint }
  }
  return { shouldPlay: true, sourceTime: track.inPoint + (sequenceTime - track.offset) }
}
