/**
 * Time remapping (#138): per-entry speed segments and pauses, as pure data
 * and pure math. A timeline entry normally plays its trimmed source range
 * 1:1; remap effects change how much *output* (playback) time parts of that
 * range occupy — a slowed portion takes longer, a sped-up one less, a pause
 * holds one frame for a while. This module owns the effect types, their
 * validation and clamping, and the output↔source time mapping; ownership,
 * actions, and normalization against the timeline live in `timeline.ts`,
 * exactly as they do for zooms (#63/#129).
 *
 * All positions are **seconds into the entry's trimmed range** (0 is the
 * entry's in-point), matching `ZoomSpec.start`: like a zoom, a remap effect
 * keeps its offset when the entry is retrimmed, and normalization re-clamps
 * it into the new range.
 */

/** A speed change over part of an entry's trimmed range. */
export interface SpeedRemapSpec {
  kind: 'speed'
  /** Seconds into the trimmed range where the change begins. */
  start: number
  /** Seconds into the trimmed range where the change ends. start < end. */
  end: number
  /**
   * Playback-rate factor: 0.5 plays the range at half speed (taking twice
   * the output time), 1.5 speeds it up. Finite and > 0; the reducer rejects
   * anything else. 1 is allowed — a no-change segment is valid input.
   */
  factor: number
}

/** A freeze at one instant of an entry's trimmed range. */
export interface PauseRemapSpec {
  kind: 'pause'
  /** Seconds into the trimmed range of the frame to freeze on. */
  at: number
  /** How long the freeze lasts, in output (playback) seconds. > 0. */
  hold: number
}

export type RemapSpec = SpeedRemapSpec | PauseRemapSpec

/** A remap effect owned by one timeline entry. An entry may carry several. */
export type RemapEffect = RemapSpec & {
  /** Unique per effect — the handle add/update/remove act on. */
  id: string
  entryId: string
}

/**
 * Whether a remap spec is acceptable input at all: every field finite, a
 * factor above 0 (the issue's contract — 0 or negative is not a playback
 * rate), a positive hold (a zero-length pause is not a pause, mirroring the
 * zero-duration transition rule), and a non-empty source range. Rejected
 * rather than clamped, like an invalid zoom spec.
 */
export function isValidRemapSpec(spec: RemapSpec): boolean {
  if (spec.kind === 'pause') {
    return Number.isFinite(spec.at) && Number.isFinite(spec.hold) && spec.hold > 0
  }
  return (
    Number.isFinite(spec.start) &&
    Number.isFinite(spec.end) &&
    Number.isFinite(spec.factor) &&
    spec.factor > 0 &&
    spec.start < spec.end
  )
}

/** Where an effect's source window begins, for sorting and sweeping. */
export function remapStart(spec: RemapSpec): number {
  return spec.kind === 'pause' ? spec.at : spec.start
}

/** Where an effect's source window ends — a pause occupies a single instant. */
export function remapEnd(spec: RemapSpec): number {
  return spec.kind === 'pause' ? spec.at : spec.end
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Clamps one effect against its entry's trimmed length and the window floor
 * set by the entry's earlier effects, mirroring `clampZoom`: the window
 * starts no earlier than `floor` and never leaves [0, trimmedLength]. A
 * speed segment squeezed against the end collapses to zero width (kept, not
 * dropped — a later un-trim restores it, exactly as a collapsed zoom phase
 * is restored); a pause always keeps its hold, freezing whatever frame it
 * lands on. Returns the same object when nothing changes, so no-op edits
 * are cheap to detect.
 */
export function clampRemap(effect: RemapEffect, trimmedLength: number, floor = 0): RemapEffect {
  if (effect.kind === 'pause') {
    const at = clamp(effect.at, Math.min(floor, trimmedLength), trimmedLength)
    return at === effect.at ? effect : { ...effect, at }
  }
  const start = clamp(effect.start, Math.min(floor, trimmedLength), trimmedLength)
  const end = clamp(effect.end, start, trimmedLength)
  return start === effect.start && end === effect.end ? effect : { ...effect, start, end }
}

export function remapsEqual(a: RemapEffect, b: RemapEffect): boolean {
  if (a.id !== b.id || a.entryId !== b.entryId) return false
  if (a.kind === 'pause' && b.kind === 'pause') return a.at === b.at && a.hold === b.hold
  if (a.kind === 'speed' && b.kind === 'speed') {
    return a.start === b.start && a.end === b.end && a.factor === b.factor
  }
  return false
}

/**
 * The output (playback) seconds the trimmed range occupies once its effects
 * apply: unaffected spans map 1:1, a speed segment's span takes its length
 * divided by the factor, and each pause adds its hold. Effects must be
 * normalized (sorted, disjoint, within [0, trimmedLength]) — reducer and
 * open-time normalization guarantee that for any published state.
 */
export function remappedDuration(trimmedLength: number, effects: readonly RemapSpec[]): number {
  let duration = trimmedLength
  for (const effect of effects) {
    if (effect.kind === 'pause') {
      duration += effect.hold
    } else {
      duration += (effect.end - effect.start) / effect.factor - (effect.end - effect.start)
    }
  }
  return duration
}

/**
 * One span of the piecewise-linear output↔source mapping: source
 * [sourceStart, sourceEnd] plays during output [outputStart, outputEnd].
 * A pause is a source-degenerate piece (sourceStart === sourceEnd); a
 * collapsed speed segment is degenerate on both axes.
 */
interface RemapPiece {
  sourceStart: number
  sourceEnd: number
  outputStart: number
  outputEnd: number
}

function remapPieces(trimmedLength: number, effects: readonly RemapSpec[]): RemapPiece[] {
  const pieces: RemapPiece[] = []
  let source = 0
  let output = 0
  for (const effect of effects) {
    const windowStart = remapStart(effect)
    if (windowStart > source) {
      // The unaffected gap before this effect plays 1:1.
      pieces.push({
        sourceStart: source,
        sourceEnd: windowStart,
        outputStart: output,
        outputEnd: output + (windowStart - source),
      })
      output += windowStart - source
      source = windowStart
    }
    if (effect.kind === 'pause') {
      pieces.push({
        sourceStart: source,
        sourceEnd: source,
        outputStart: output,
        outputEnd: output + effect.hold,
      })
      output += effect.hold
    } else {
      const outputLength = (effect.end - effect.start) / effect.factor
      pieces.push({
        sourceStart: source,
        sourceEnd: effect.end,
        outputStart: output,
        outputEnd: output + outputLength,
      })
      output += outputLength
      source = effect.end
    }
  }
  if (source < trimmedLength) {
    pieces.push({
      sourceStart: source,
      sourceEnd: trimmedLength,
      outputStart: output,
      outputEnd: output + (trimmedLength - source),
    })
  }
  return pieces
}

/**
 * Maps an output (playback) time within the remapped entry to the source
 * time playing at that moment — the remap counterpart of what
 * `locateInSequence` does linearly. Monotonically non-decreasing: during a
 * pause every output time maps to the frozen instant (the plateau). Input
 * is clamped into [0, remappedDuration]; both times are relative to the
 * trimmed range. Effects must be normalized, as for `remappedDuration`.
 */
export function sourceTimeAtOutput(
  trimmedLength: number,
  effects: readonly RemapSpec[],
  outputTime: number,
): number {
  const time = clamp(outputTime, 0, remappedDuration(trimmedLength, effects))
  for (const piece of remapPieces(trimmedLength, effects)) {
    if (time > piece.outputEnd) continue
    // A pause plateau (or a collapsed segment) has no span to interpolate.
    if (piece.sourceEnd === piece.sourceStart || piece.outputEnd === piece.outputStart) {
      return piece.sourceStart
    }
    return (
      piece.sourceStart +
      ((time - piece.outputStart) / (piece.outputEnd - piece.outputStart)) *
        (piece.sourceEnd - piece.sourceStart)
    )
  }
  return trimmedLength
}

/**
 * Maps a source time to the output (playback) time at which it is **first
 * shown** — the inverse of `sourceTimeAtOutput` everywhere the mapping is
 * strictly increasing. At a paused instant the whole plateau shows one
 * frame, so this returns the plateau's start. Input is clamped into
 * [0, trimmedLength]; both times are relative to the trimmed range.
 * Effects must be normalized, as for `remappedDuration`.
 */
export function outputTimeAtSource(
  trimmedLength: number,
  effects: readonly RemapSpec[],
  sourceTime: number,
): number {
  const time = clamp(sourceTime, 0, trimmedLength)
  for (const piece of remapPieces(trimmedLength, effects)) {
    if (piece.sourceEnd === piece.sourceStart) {
      // A source-degenerate piece (pause or collapsed segment): the instant
      // is first shown where the piece begins. Reached only when no earlier
      // piece already covered the time — a pause preceded by a 1:1 gap
      // resolves in that gap's piece, to the same output time.
      if (time === piece.sourceStart) return piece.outputStart
      continue
    }
    if (time <= piece.sourceEnd) {
      return (
        piece.outputStart +
        ((time - piece.sourceStart) / (piece.sourceEnd - piece.sourceStart)) *
          (piece.outputEnd - piece.outputStart)
      )
    }
  }
  return remappedDuration(trimmedLength, effects)
}
