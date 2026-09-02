/**
 * SRT subtitle import (#249): a lenient, dependency-free parser for the
 * near-universal `.srt` interchange format, and the mapping from its cues to
 * ordinary text overlays (#139). Only the *getting in* is new — an imported
 * cue is a plain `TextOverlay` afterwards, individually editable and
 * rendered by the existing preview/export text path with no new drawing
 * code.
 *
 * Real-world SRT is messy, so parsing is deliberately forgiving: a UTF-8
 * BOM, any newline convention, extra blank lines, malformed or
 * non-sequential cue indices, `.` as the millisecond separator, and
 * HTML-ish markup (`<i>`, `<font …>`) or ASS-style `{\an8}` tags inside cue
 * text are all tolerated. Blocks that still cannot yield a cue are skipped
 * with a diagnostic naming the block and the reason — the caller reports
 * them in the library's dismissible failure idiom rather than failing the
 * whole import.
 */

import type { TextOverlaySpec } from './textOverlay'

/** One parsed cue: seconds on the sequence clock, markup already stripped. */
export interface SubtitleCue {
  start: number
  end: number
  /** The cue text; internal newlines preserved, tags stripped, never empty. */
  content: string
}

/** One block the parser could not turn into a cue. */
export interface SkippedSubtitleBlock {
  /** 1-based position among the file's non-empty blocks. */
  block: number
  reason: string
}

export interface ParsedSubtitles {
  cues: SubtitleCue[]
  skipped: SkippedSubtitleBlock[]
}

/**
 * `HH:MM:SS,mmm --> HH:MM:SS,mmm`, leniently: hours optional (some writers
 * emit `MM:SS,mmm`), one- or two-digit fields tolerated, `.` accepted for
 * `,` (a common dialect), and anything after the end time (SRT positioning
 * hints like `X1:…`) ignored.
 */
const TIMING_LINE =
  /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/

/** Milliseconds are right-padded: `,5` means 500 ms, `,50` means 500 ms. */
const toSeconds = (
  hours: string | undefined,
  minutes: string,
  seconds: string,
  millis: string,
): number =>
  Number(hours ?? 0) * 3600 +
  Number(minutes) * 60 +
  Number(seconds) +
  Number(millis.padEnd(3, '0')) / 1000

/** Strips `<i>`/`<font …>`-style markup and ASS `{\an8}`-style override
 * tags — SRT dialects embed both, and neither is renderable text. */
const stripMarkup = (line: string): string =>
  line.replace(/<[^>\n]*>/g, '').replace(/\{[^}\n]*\}/g, '')

/**
 * Parses SRT text into cues plus per-block skip diagnostics. Never throws:
 * an entirely unusable file simply yields zero cues (the caller decides
 * that is an import failure). Cues are returned in file order; overlapping
 * cues are legitimate (each becomes its own overlay).
 */
export function parseSrt(text: string): ParsedSubtitles {
  const cues: SubtitleCue[] = []
  const skipped: SkippedSubtitleBlock[] = []
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
  for (const [index, block] of blocks.entries()) {
    const number = index + 1
    const lines = block.split('\n')
    const timingAt = lines.findIndex((line) => TIMING_LINE.test(line.trim()))
    if (timingAt === -1) {
      skipped.push({ block: number, reason: 'has no timing line' })
      continue
    }
    const match = TIMING_LINE.exec(lines[timingAt].trim()) as RegExpExecArray
    const start = toSeconds(match[1], match[2], match[3], match[4])
    const end = toSeconds(match[5], match[6], match[7], match[8])
    if (end <= start) {
      skipped.push({ block: number, reason: 'ends at or before its start' })
      continue
    }
    const content = lines
      .slice(timingAt + 1)
      .map((line) => stripMarkup(line).trim())
      .join('\n')
      .trim()
    if (content === '') {
      skipped.push({ block: number, reason: 'has no text' })
      continue
    }
    cues.push({ start, end, content })
  }
  return { cues, skipped }
}

/**
 * The subtitle-appropriate default style (#249): bottom-center, a readable
 * caption size, white sans-serif — what every imported cue starts as. The
 * overlay stays individually restylable afterwards like any other.
 */
export const SUBTITLE_TEXT_DEFAULTS = {
  x: 0.5,
  y: 0.9,
  font: 'sans',
  size: 0.05,
  color: '#ffffff',
  bold: false,
  italic: false,
} as const

/**
 * A cue as the text overlay it imports to: timed to the cue's window,
 * styled with the subtitle defaults, and carrying the persisted
 * subtitle-provenance marker the default-subtitle-style work (#250)
 * targets. The id is the caller's to mint, exactly as for `DEFAULT_TEXT`.
 */
export function subtitleOverlaySpec(cue: SubtitleCue): TextOverlaySpec {
  return {
    content: cue.content,
    offset: cue.start,
    duration: cue.end - cue.start,
    ...SUBTITLE_TEXT_DEFAULTS,
    subtitle: true,
  }
}
