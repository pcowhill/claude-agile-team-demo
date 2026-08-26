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
 * The instantaneous playback state a player needs at one output time into a
 * remapped entry (#141): the source instant showing, the rate the source is
 * advancing at, and — inside a pause — the plateau being held.
 */
export interface RemapPlayback {
  /** Source seconds (into the trimmed range) showing at this output time. */
  sourceTime: number
  /**
   * How fast the source advances here, as a media-element playback rate: the
   * active speed segment's factor, 1 outside every segment, 0 on a pause
   * plateau (`hold` describes it — an element freezes rather than plays
   * at 0).
   */
  rate: number
  /**
   * The pause plateau containing this output time, or null outside one. The
   * bounds are output seconds into the entry, so `outputEnd − outputTime` is
   * the hold remaining.
   */
  hold: { outputStart: number; outputEnd: number } | null
}

/**
 * Resolves the playback state at an output time into the entry. Pieces are
 * half-open on their output span, so a time exactly at a plateau's start is
 * *inside* the hold (the frame freezes the moment the plateau begins) and a
 * time exactly at its end has moved on. Input is clamped into
 * [0, remappedDuration]. Effects must be normalized, as for
 * `remappedDuration`.
 */
export function remapPlaybackAt(
  trimmedLength: number,
  effects: readonly RemapSpec[],
  outputTime: number,
): RemapPlayback {
  const time = clamp(outputTime, 0, remappedDuration(trimmedLength, effects))
  for (const piece of remapPieces(trimmedLength, effects)) {
    // A collapsed segment has no output span to be inside of.
    if (piece.outputEnd === piece.outputStart) continue
    if (time >= piece.outputEnd) continue
    if (piece.sourceEnd === piece.sourceStart) {
      return {
        sourceTime: piece.sourceStart,
        rate: 0,
        hold: { outputStart: piece.outputStart, outputEnd: piece.outputEnd },
      }
    }
    const progress = (time - piece.outputStart) / (piece.outputEnd - piece.outputStart)
    return {
      sourceTime: piece.sourceStart + progress * (piece.sourceEnd - piece.sourceStart),
      rate: (piece.sourceEnd - piece.sourceStart) / (piece.outputEnd - piece.outputStart),
      hold: null,
    }
  }
  // At (or clamped to) the very end of the mapping: the last source instant.
  return { sourceTime: trimmedLength, rate: 1, hold: null }
}

/**
 * The playback rate in force at a source instant: the factor of the speed
 * segment containing it (half-open — a time exactly at a segment's end has
 * left it), 1 outside every segment. Pauses do not appear here: a pause is
 * an output-time plateau, not a source-time rate (#141 freezes the element
 * through `remapPlaybackAt`'s hold instead).
 */
export function rateAtSourceTime(effects: readonly RemapSpec[], sourceTime: number): number {
  for (const effect of effects) {
    if (effect.kind === 'speed' && sourceTime >= effect.start && sourceTime < effect.end) {
      return effect.factor
    }
  }
  return 1
}

/** Default factor for a speed segment added from the UI (#141): half speed. */
export const DEFAULT_SPEED_FACTOR = 0.5

/** Preferred source length (seconds) of a speed segment added from the UI. */
export const DEFAULT_SPEED_LENGTH = 2

/** Default hold (output seconds) of a pause added from the UI (#141). */
export const DEFAULT_PAUSE_HOLD = 1

/** The unoccupied source ranges between effect windows, in window order. */
function freeGaps(
  effects: readonly RemapEffect[],
  trimmedLength: number,
): { start: number; length: number }[] {
  const sorted = [...effects].sort((a, b) => remapStart(a) - remapStart(b))
  const gaps: { start: number; length: number }[] = []
  let cursor = 0
  for (const effect of sorted) {
    if (remapStart(effect) > cursor) {
      gaps.push({ start: cursor, length: remapStart(effect) - cursor })
    }
    cursor = Math.max(cursor, remapEnd(effect))
  }
  if (trimmedLength > cursor) gaps.push({ start: cursor, length: trimmedLength - cursor })
  return gaps
}

/**
 * Where a UI-added speed segment should land (#141), mirroring
 * `defaultZoomFor`: the first free gap that fits the preferred length, else
 * the widest gap (shortened to fit), else null — the entry's effects already
 * cover its whole trimmed range and the add affordance disables.
 */
export function defaultSpeedFor(
  effects: readonly RemapEffect[],
  trimmedLength: number,
): SpeedRemapSpec | null {
  const gaps = freeGaps(effects, trimmedLength)
  if (gaps.length === 0) return null
  const gap =
    gaps.find((candidate) => candidate.length >= DEFAULT_SPEED_LENGTH) ??
    gaps.reduce((widest, candidate) => (candidate.length > widest.length ? candidate : widest))
  return {
    kind: 'speed',
    start: gap.start,
    end: gap.start + Math.min(gap.length, DEFAULT_SPEED_LENGTH),
    factor: DEFAULT_SPEED_FACTOR,
  }
}

/**
 * Where a UI-added pause should land (#141): the first genuinely free
 * instant — a gap's start when no pause already sits there, otherwise the
 * gap's midpoint (a gap's interior never holds a window, so it is always
 * free) — or, with every instant covered by segments, the very end of the
 * trimmed range, freezing the final frame. A pause occupies no source
 * width, so a gap's *start* can coincide with an existing pause's instant
 * (a zero-width window bounds a gap without filling any of it); placing a
 * second pause onto an occupied instant is legal model state but never what
 * clicking "+ Pause" again means (#153), so occupied instants are skipped.
 * Null — the affordance disables — for an empty entry (trimmed length 0),
 * or when segments cover the whole range and a pause already holds its end.
 */
export function defaultPauseFor(
  effects: readonly RemapEffect[],
  trimmedLength: number,
): PauseRemapSpec | null {
  if (trimmedLength <= 0) return null
  const occupied = new Set(
    effects.filter((effect) => effect.kind === 'pause').map((effect) => effect.at),
  )
  for (const gap of freeGaps(effects, trimmedLength)) {
    if (!occupied.has(gap.start)) return { kind: 'pause', at: gap.start, hold: DEFAULT_PAUSE_HOLD }
    const midpoint = gap.start + gap.length / 2
    if (!occupied.has(midpoint)) return { kind: 'pause', at: midpoint, hold: DEFAULT_PAUSE_HOLD }
  }
  return occupied.has(trimmedLength)
    ? null
    : { kind: 'pause', at: trimmedLength, hold: DEFAULT_PAUSE_HOLD }
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
