/**
 * Exporting each chapter as its own file (#529, from the approved
 * suggestion #523): the spans one run covers, and the filename each span is
 * written under.
 *
 * Pure and separately tested for the reason #488 gave `chapterList.ts` the
 * same treatment — every edge case this feature has lives here (the leading
 * span, the half-open boundaries, a name that is only punctuation, the index
 * width past nine) and none of them needs a dialog to exercise.
 *
 * **It shares its chapter model with `formatChapterList`, and that is the
 * feature rather than a convenience.** The same markers, the same
 * `INTRO_CHAPTER_NAME` at the front when nothing sits at the start, the same
 * half-open `start <= time < end`. Two features reading one set of markers
 * and disagreeing about how many chapters a project has is a bug report
 * waiting to happen (#529's first decision), so `chapterSpans` is written to
 * produce exactly one span per line `formatChapterList` writes, and
 * `chapterList.test.ts`'s neighbour here asserts that correspondence
 * directly rather than trusting the two to drift together.
 */

import { INTRO_CHAPTER_NAME, lineName } from './chapterList'
import type { ChapterMarker } from './timeline'
import type { ExportRange } from './exportVideo'

/** One chapter of a per-chapter run: what to export, and what to call it. */
export interface ChapterSpan {
  /** 1-based position in the run, after empty spans are dropped. */
  index: number
  /**
   * The chapter's name as the chapter list writes it — whitespace runs
   * already collapsed, so the completion list and the copied list read the
   * same. Filesystem sanitising happens later, in {@link chapterFileName},
   * because it must not change what the dialog shows.
   */
  name: string
  range: ExportRange
}

/**
 * Characters no common filesystem accepts.
 *
 * They become a **space** rather than being deleted. #529 says "dropped",
 * and for the usual case — a separator with spaces already round it — the
 * two are identical once runs collapse. They differ only when the character
 * sits between two non-spaces, and there deleting it makes the name say
 * something false: a chapter called `Part 1/2` would be written as
 * `Part 12`. A filename that misreports which chapter it holds is worse
 * than one with an extra space, so this substitutes and lets the collapse
 * below tidy up. Stated rather than taken quietly, per the issue's own
 * instruction to say what was chosen.
 */
const UNSAFE_IN_FILENAME = /[/\\:*?"<>|]/g

/**
 * A control character. Tested by code point rather than as a regex range
 * because a range of literal control characters in a character class is
 * exactly what `no-control-regex` exists to catch, and the rule is right:
 * the intent is far easier to read stated this way. The whitespace controls
 * (tab, newline, form feed) never reach here — the collapse below has
 * already turned them into spaces.
 */
const isControlCharacter = (character: string) => {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

/**
 * A marker's name as a filename fragment: safe on every common filesystem,
 * and empty when nothing usable survives (the caller then falls back to the
 * index alone).
 *
 * Leading dots go because a name beginning with one produces a hidden file
 * on Unix — the user asked for a chapter, not a dotfile.
 */
function chapterNamePart(name: string): string {
  return [...name]
    .map((character) => (isControlCharacter(character) ? ' ' : character))
    .join('')
    .replace(UNSAFE_IN_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
}

/**
 * The spans a per-chapter export of `range` produces, in order, or an empty
 * list when the range holds no markers — which is what the dialog offers
 * the option on.
 *
 * **The first span always begins at `range.start`.** That is what keeps this
 * and `formatChapterList` in step: the list decides whether to insert an
 * `Intro` line from the *floored* second of the earliest marker, so a marker
 * at 0.4 s counts as sitting at the start and gets no `Intro` line. Taking
 * the leading span's existence from the exact time instead would export a
 * 0.4 s `Intro` file the list never mentions — and taking the marker's own
 * time as the first span's start would silently drop those 0.4 s from every
 * file. Beginning at `range.start` under the list's own test does neither.
 *
 * Spans are half-open, `[marker, next marker)`, and the last ends at
 * `range.end`, so the tail after the last marker belongs to the last chapter
 * and a marker sitting exactly on the end boundary marks the first moment no
 * file contains.
 *
 * Empty spans are dropped and the indices closed up afterwards. Two markers
 * at one instant cannot be made in the app — the reducer refuses a marker
 * within `MARKER_TIME_EPSILON` of an existing one — but a hand-edited
 * project file can carry them, and `resolveExportRange` *throws* on a range
 * of no length, which would abort the whole run over a chapter that holds no
 * frames.
 */
export function chapterSpans(
  markers: readonly ChapterMarker[],
  range: ExportRange,
): ChapterSpan[] {
  const inRange = markers
    .filter((marker) => marker.time >= range.start && marker.time < range.end)
    // Stable, so two markers in the same second keep the order the timeline
    // holds them in — `formatChapterList` sorts the same way for the same
    // reason.
    .slice()
    .sort((a, b) => a.time - b.time)
  if (inRange.length === 0) return []

  // The list inserts `Intro` when the earliest marker does not floor to the
  // range's first second; otherwise that marker names the opening chapter.
  const opensWithIntro = Math.floor(inRange[0].time - range.start) !== 0
  const starts = opensWithIntro
    ? [
        { time: range.start, name: INTRO_CHAPTER_NAME },
        ...inRange.map((marker) => ({ time: marker.time, name: lineName(marker.name) })),
      ]
    : [
        { time: range.start, name: lineName(inRange[0].name) },
        ...inRange.slice(1).map((marker) => ({ time: marker.time, name: lineName(marker.name) })),
      ]

  const spans: ChapterSpan[] = []
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.time ?? range.end
    if (end - start.time <= 0) continue
    spans.push({ index: spans.length + 1, name: start.name, range: { start: start.time, end } })
  }
  return spans
}

/**
 * The file one span is downloaded as: `NN Name.ext`.
 *
 * The 1-based index leads and is zero-padded to the width of the highest
 * number in the run, minimum two digits, so a folder sorts in chapter order
 * however many chapters there are and two markers sharing a name still
 * produce two distinct files.
 *
 * `count` is the run's length rather than something derived from the span,
 * because the padding is a property of the run: chapter 3 of 9 is `03`,
 * chapter 3 of 12 is `03`, and chapter 3 of 100 is `003`.
 */
export function chapterFileName(span: ChapterSpan, count: number, extension: string): string {
  const number = String(span.index).padStart(Math.max(2, String(count).length), '0')
  const name = chapterNamePart(span.name)
  return name === '' ? `${number}.${extension}` : `${number} ${name}.${extension}`
}
