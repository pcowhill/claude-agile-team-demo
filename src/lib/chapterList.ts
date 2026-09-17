/**
 * The chapter list an export can be copied with (#488, part 2 of the
 * approved suggestion #461): the chapter markers (#487) inside the exported
 * span, written as the plain-text `mm:ss Name` list YouTube and most
 * players parse, with the times offset to the span's start.
 *
 * The offset is the whole point. Markers are placed in *sequence* time
 * against the picture, but a partial export — the transport marks' range or
 * a typed one (#385 / #400) — produces a file whose first frame is the
 * range's start. A list of raw sequence times would be wrong by the range's
 * start on every line, which is the kind of wrong nobody notices until a
 * viewer clicks a chapter and lands somewhere else.
 *
 * Pure and separately tested, for the reason #488 gives: the formatting is
 * the part with all the edge cases (the hour form, the inserted first line,
 * two markers in one second), and none of them needs a dialog to exercise.
 */

import type { ChapterMarker } from './timeline'
import type { ExportRange } from './exportVideo'

/**
 * The name given to the line inserted at `00:00` when no marker sits at the
 * range's start. Players that recognise a chapter list require the first
 * entry to be at zero, so a list that did not start there would simply be
 * ignored — a silent failure the user would read as "the button is broken".
 */
export const INTRO_CHAPTER_NAME = 'Intro'

/** An hour, in seconds: the point where every line grows an hours field. */
const HOUR = 3600

/**
 * One line's time, `mm:ss` or `h:mm:ss`. Minutes are padded in both forms
 * and the hours field is not, which is the shape players expect and the
 * shape #488 asks for. `useHours` is decided once for the whole list rather
 * than per line, so the column does not change width halfway down.
 */
function formatChapterTime(seconds: number, useHours: boolean): string {
  const s = seconds % 60
  const m = Math.floor(seconds / 60) % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return useHours ? `${Math.floor(seconds / HOUR)}:${mmss}` : mmss
}

/**
 * The seconds a marker is written at: **floored**, not rounded, and
 * deliberately — an engineering decision, recorded here because the app's
 * own readouts round (`formatDuration`), so the two can differ by a second
 * on a marker at, say, 2.5 s (the tick reads *0:03*, this list writes
 * `00:02`).
 *
 * Rounding up would start the chapter *after* the moment the user marked,
 * so the first instant of what they pointed at would still belong to the
 * previous chapter. Flooring starts it a fraction early, which is
 * invisible. Between a chapter that begins slightly before its content and
 * one that begins slightly after it, only the second is ever noticeable.
 */
const lineSeconds = (time: number, start: number) => Math.floor(time - start)

/**
 * A marker's name as one line of text. Markers reaching this from the app
 * are already trimmed and non-empty (`normalizedMarkers`), but this is a
 * pure function over someone's data and the output format is line-based:
 * one newline in a name would silently split a chapter into two malformed
 * ones, so whitespace runs collapse to a single space.
 */
const lineName = (name: string) => name.replace(/\s+/g, ' ').trim()

/**
 * The chapter list for `range`, or an empty string when the range holds no
 * markers — which is what the export dialog disables its button on.
 *
 * The range is half-open at the end (`start <= time < end`), matching how a
 * range's end works everywhere else: it is where the export stops, so a
 * marker sitting exactly there marks the first moment the file does not
 * contain. Markers outside the range are dropped — including the ones past
 * the sequence end that the model deliberately keeps (#487).
 */
export function formatChapterList(
  markers: readonly ChapterMarker[],
  range: ExportRange,
): string {
  const inRange = markers
    .filter((marker) => marker.time >= range.start && marker.time < range.end)
    // Stable, so two markers in the same second keep the order the timeline
    // holds them in rather than being reordered by a sort that cannot tell
    // them apart. `markersOf` is already sorted; arbitrary input may not be.
    .slice()
    .sort((a, b) => a.time - b.time)
  if (inRange.length === 0) return ''
  const lines = inRange.map((marker) => ({
    seconds: lineSeconds(marker.time, range.start),
    name: lineName(marker.name),
  }))
  // Only the earliest line can land on zero, so this tests the whole list.
  if (lines[0].seconds !== 0) lines.unshift({ seconds: 0, name: INTRO_CHAPTER_NAME })
  const useHours = lines.some((line) => line.seconds >= HOUR)
  return lines.map((line) => `${formatChapterTime(line.seconds, useHours)} ${line.name}`).join('\n')
}
