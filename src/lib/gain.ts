import type { AudioTrack, TimelineEntry } from './timeline'
import { effectiveDuration } from './timeline'

/**
 * Effective audio gain (#104): the single source of truth composing volume,
 * mute, fade envelopes, and transition ramps into the value a media
 * element's `volume` is set to. Preview and export (#105) both call these —
 * the same idiom as `TRANSITION_TYPES` — so the two renders cannot drift.
 */

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

/**
 * Gain of a video entry's own audio: 0 when muted (mute wins over
 * everything), otherwise its volume scaled by `transitionRamp` — the
 * transition volume crossfade the preview already applies (1 outside a
 * transition, `1 − progress` for the outgoing entry and `progress` for the
 * incoming one inside it). Absent fields mean full volume, unmuted.
 */
export function videoEntryGain(entry: TimelineEntry, transitionRamp = 1): number {
  if (entry.muted) return 0
  return clamp01(entry.volume ?? 1) * clamp01(transitionRamp)
}

/**
 * Gain of an audio track at one timeline position: 0 outside the track's
 * audible window `[offset, offset + trimmedLength)`, otherwise its volume
 * scaled by the fade envelope. Fades are linear (#104): the fade-in ramps
 * from 0 at the window start to full at `fadeIn` seconds in, the fade-out
 * from full at `fadeOut` seconds before the window end to 0 at the end.
 * The reducer clamps `fadeIn + fadeOut` to the trimmed length, so the two
 * ramps meet (at full volume) but never overlap; the envelope still takes
 * their minimum so an unclamped state degrades gracefully rather than
 * exceeding either ramp.
 */
export function audioTrackGainAt(track: AudioTrack, sequenceTime: number): number {
  const length = effectiveDuration(track)
  const into = sequenceTime - track.offset
  if (into < 0 || into >= length) return 0
  const fadeIn = track.fadeIn ?? 0
  const fadeOut = track.fadeOut ?? 0
  const inRamp = fadeIn > 0 ? Math.min(into / fadeIn, 1) : 1
  const outRamp = fadeOut > 0 ? Math.min((length - into) / fadeOut, 1) : 1
  return clamp01(track.volume ?? 1) * Math.min(inRamp, outRamp)
}
