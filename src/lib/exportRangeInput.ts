import type { ExportRange } from './exportVideo'

/**
 * Typed export ranges (#400): the export modal's Custom range takes a start
 * and an end as text, so the customer can export a span without setting
 * marks first. These helpers are the pure half — how the text parses, how a
 * time is written back into the fields, and which pairs form a range the
 * export may run — kept out of the component so they are unit-testable
 * against exact numbers.
 */

/**
 * Parses a time typed into a range field: plain seconds (`12`, `12.5`),
 * `m:ss`, `m:ss.f`, or `h:mm:ss(.f)`. Returns null for anything else —
 * empty text, negatives, letters, a minutes or seconds segment of 60 or
 * more (`1:75` is a typo, not 135 s), or a fractional segment other than
 * the last. Whitespace around the text is ignored.
 */
export function parseTimeInput(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const segments = trimmed.split(':')
  if (segments.length > 3) return null
  const numbers: number[] = []
  for (const [index, segment] of segments.entries()) {
    if (!/^\d+(\.\d+)?$/.test(segment)) return null
    const value = Number(segment)
    // Only the last segment may carry a fraction; the others are whole units.
    if (index < segments.length - 1 && !Number.isInteger(value)) return null
    // Minutes and seconds after a colon run 0–59.
    if (index > 0 && value >= 60) return null
    numbers.push(value)
  }
  return numbers.reduce((total, value) => total * 60 + value, 0)
}

/**
 * Writes a time into a range field: `m:ss`, with up to two decimals when the
 * time is not whole (`0:08.5`, `0:01.97`) and hours only when there are
 * any. `parseTimeInput` reads every output back to the same value (to the
 * hundredth), so pre-filled fields round-trip; a non-finite or negative
 * input yields the empty string rather than a lie.
 */
export function formatTimeInput(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const hundredths = Math.round(seconds * 100)
  const whole = Math.floor(hundredths / 100)
  const fraction = hundredths % 100
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const fractionText =
    fraction === 0 ? '' : `.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
  const ss = `${String(s).padStart(2, '0')}${fractionText}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The two fields as typed. */
export interface CustomRangeInput {
  start: string
  end: string
}

/** Either the range the export may run, or the one message that says why not. */
export type CustomRangeResult =
  | { range: ExportRange; error: null }
  | { range: null; error: string }

/**
 * A pre-filled end reads `formatTimeInput(total)`, which rounds to the
 * hundredth — so an end a hair past `total` through that rounding alone is
 * the sequence's end, not an error. Anything further past it is.
 */
const END_TOLERANCE = 0.005

/**
 * Validates a typed range against the sequence length (#400): both fields
 * must parse, the end must lie within the sequence, and the start must come
 * before the end. The returned range clamps its end to `total`, so the
 * pipeline's own clamp (`resolveExportRange`) has nothing left to do.
 * Messages are the ones the modal shows beside the fields.
 */
export function customExportRange(input: CustomRangeInput, total: number): CustomRangeResult {
  const start = parseTimeInput(input.start)
  if (start === null) return { range: null, error: 'Enter the start as m:ss or in seconds.' }
  const end = parseTimeInput(input.end)
  if (end === null) return { range: null, error: 'Enter the end as m:ss or in seconds.' }
  if (end > total + END_TOLERANCE) {
    return {
      range: null,
      error: `The end cannot be past the end of the sequence (${formatTimeInput(total)}).`,
    }
  }
  const clampedEnd = Math.min(end, total)
  if (start >= clampedEnd) return { range: null, error: 'The end must come after the start.' }
  return { range: { start, end: clampedEnd }, error: null }
}
