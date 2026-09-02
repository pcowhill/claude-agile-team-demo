import type { AudioTrack, TimelineEntry, TimelineState } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { audioTracksOf, effectiveDuration } from './timeline'

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

/**
 * Audio ducking (#241): while a duck-enabled audio track plays, every other
 * sound source is lowered to that track's duck level — one more
 * multiplicative factor in this shared rule, so the preview mix and the
 * export mix duck identically by construction. The factor ramps linearly
 * over `DUCK_RAMP_SECONDS` just *outside* each window — down before it
 * starts, back up after it ends — so the drop is smooth and the ducking
 * track's own first audible instant is already fully clear of the others.
 */

/** Fixed ramp length at each duck window edge, in seconds. */
export const DUCK_RAMP_SECONDS = 0.25

/** Gain other audio drops to while ducked, when a track sets no level. */
export const DEFAULT_DUCK_LEVEL = 0.25

/** One resolved span of ducking on the sequence clock, merged and sorted. */
export interface DuckWindow {
  start: number
  end: number
  /** The gain other sources drop to inside the span, 0..1. */
  level: number
}

/**
 * The sequence spans during which other audio ducks: the audible window of
 * every duck-enabled track that can actually be heard — a muted (zero- or
 * zero-clamped-volume) track ducks nothing. Windows separated by less than
 * the ramp time merge, so brief gaps in a voice-over do not audibly pump;
 * where merged windows disagree on level, the deeper duck wins.
 */
export function duckWindows(timeline: TimelineState): DuckWindow[] {
  const windows = audioTracksOf(timeline)
    .filter(
      (track) =>
        track.duck === true && clamp01(track.volume ?? 1) > 0 && effectiveDuration(track) > 0,
    )
    .map((track) => ({
      start: track.offset,
      end: track.offset + effectiveDuration(track),
      level: clamp01(track.duckLevel ?? DEFAULT_DUCK_LEVEL),
    }))
    .sort((a, b) => a.start - b.start)
  const merged: DuckWindow[] = []
  for (const window of windows) {
    const last = merged[merged.length - 1]
    if (last !== undefined && window.start - last.end < DUCK_RAMP_SECONDS) {
      last.end = Math.max(last.end, window.end)
      last.level = Math.min(last.level, window.level)
    } else {
      merged.push({ ...window })
    }
  }
  return merged
}

/**
 * The multiplicative duck factor a non-exempt source applies at one sequence
 * position: 1 outside every duck window (and beyond its ramps), the window's
 * level inside it, linear between over the fixed ramps at each edge. Where
 * two windows' ramps overlap (a gap of one to two ramp lengths), the lower
 * factor wins — the mix never briefly recovers louder than either duck.
 */
export function duckFactorAt(windows: readonly DuckWindow[], sequenceTime: number): number {
  let factor = 1
  for (const window of windows) {
    if (sequenceTime <= window.start - DUCK_RAMP_SECONDS) break
    let inWindow: number
    if (sequenceTime < window.start) {
      inWindow =
        window.level + ((window.start - sequenceTime) / DUCK_RAMP_SECONDS) * (1 - window.level)
    } else if (sequenceTime <= window.end) {
      inWindow = window.level
    } else if (sequenceTime < window.end + DUCK_RAMP_SECONDS) {
      inWindow =
        window.level + ((sequenceTime - window.end) / DUCK_RAMP_SECONDS) * (1 - window.level)
    } else {
      continue
    }
    factor = Math.min(factor, inWindow)
  }
  return clamp01(factor)
}

/**
 * The duck factor one audio track applies (#241): duck-enabled tracks are
 * exempt — the ducking voice (and any fellow duck-enabled track) is never
 * itself ducked — while every other track ducks like the rest of the mix.
 */
export function trackDuckFactorAt(
  track: AudioTrack,
  windows: readonly DuckWindow[],
  sequenceTime: number,
): number {
  return track.duck === true ? 1 : duckFactorAt(windows, sequenceTime)
}
