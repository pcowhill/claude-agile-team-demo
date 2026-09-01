import type { AudioTrack, TimelineEntry } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { effectiveDuration } from './timeline'

/**
 * Effective audio gain (#104): the single source of truth composing volume,
 * mute, fade envelopes, and transition ramps into the value a media
 * element's `volume` is set to. Preview and export (#105) both call these —
 * the same idiom as `TRANSITION_TYPES` — so the two renders cannot drift.
 */

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

/**
 * The linear fade envelope (#104/#220) at `into` seconds into a play window
 * `length` seconds long: the fade-in ramps from 0 at the window start to
 * full at `fadeIn` seconds in, the fade-out from full at `fadeOut` seconds
 * before the window end to 0 at the end. Normalization clamps
 * `fadeIn + fadeOut` to the length, so the two ramps meet (at full volume)
 * but never overlap; the envelope still takes their minimum so an unclamped
 * state degrades gracefully rather than exceeding either ramp. Absent or
 * zero fades are the identity envelope.
 */
export function fadeRampAt(
  fadeIn: number | undefined,
  fadeOut: number | undefined,
  into: number,
  length: number,
): number {
  const inRamp = fadeIn !== undefined && fadeIn > 0 ? Math.min(into / fadeIn, 1) : 1
  const outRamp = fadeOut !== undefined && fadeOut > 0 ? Math.min((length - into) / fadeOut, 1) : 1
  return clamp01(Math.min(inRamp, outRamp))
}

/**
 * Gain of a video entry's own audio: 0 when muted (mute wins over
 * everything), otherwise its volume scaled by `transitionRamp` — the
 * transition volume crossfade the preview already applies (1 outside a
 * transition, `1 − progress` for the outgoing entry and `progress` for the
 * incoming one inside it). Absent fields mean full volume, unmuted.
 * Position-independent; the fade envelope (#220) composes on top in
 * `videoEntryGainAt`, which every renderer call site uses.
 */
export function videoEntryGain(entry: TimelineEntry, transitionRamp = 1): number {
  if (entry.muted) return 0
  return clamp01(entry.volume ?? 1) * clamp01(transitionRamp)
}

/**
 * Gain of a video entry's own audio at a position (#220): the
 * volume × mute × transition-ramp base (`videoEntryGain`) scaled by the
 * entry's fade envelope. `outputInto`/`outputLength` are in *output*
 * seconds into the entry (#141) — the presentation window fades are
 * measured in, so a speed segment never stretches an audible ramp. Ramps
 * multiply: a fade inside a transition overlap rides the crossfade.
 */
export function videoEntryGainAt(
  entry: TimelineEntry,
  outputInto: number,
  outputLength: number,
  transitionRamp = 1,
): number {
  return (
    videoEntryGain(entry, transitionRamp) *
    fadeRampAt(entry.fadeIn, entry.fadeOut, outputInto, outputLength)
  )
}

/**
 * Gain of an overlay video layer's own audio at a sequence position (#220):
 * volume × mute (`videoEntryGain`, applied structurally as everywhere)
 * scaled by the overlay's fade envelope over its window
 * `[offset, offset + trimmedLength)` — the audio-track window shape the
 * overlay model shares (#145).
 */
export function videoOverlayGainAt(overlay: VideoOverlay, sequenceTime: number): number {
  return (
    videoEntryGain(overlay) *
    fadeRampAt(overlay.fadeIn, overlay.fadeOut, sequenceTime - overlay.offset, effectiveDuration(overlay))
  )
}

/**
 * Gain of an audio track at one timeline position: 0 outside the track's
 * audible window `[offset, offset + trimmedLength)`, otherwise its volume
 * scaled by the fade envelope (`fadeRampAt`, #104).
 */
export function audioTrackGainAt(track: AudioTrack, sequenceTime: number): number {
  const length = effectiveDuration(track)
  const into = sequenceTime - track.offset
  if (into < 0 || into >= length) return 0
  return clamp01(track.volume ?? 1) * fadeRampAt(track.fadeIn, track.fadeOut, into, length)
}
