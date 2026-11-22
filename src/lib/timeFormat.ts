import { parseTimeInput } from './exportRangeInput'

/**
 * How time fields show and take a time (#848, from customer feedback #847):
 * plain seconds — today's `83.5` with an `s` drawn in the box — or
 * `minutes:seconds.milliseconds`, `1:23.500`.
 *
 * The rule for what follows the setting is the one #848 drew: every
 * editable field whose unit is seconds, and the visual editors' live
 * preview-time readouts. Readouts already in minutes (the preview's
 * `0:12 / 1:05`, the Trim window's `0:12.50`) and the Settings dialog's
 * step sizes are not times on the media in that sense and stay as they are.
 */
export type TimeFormat = 'seconds' | 'minutes'

/** The choices in the order the Settings dialog lists them; seconds first, the default. */
export const TIME_FORMAT_CHOICES: readonly TimeFormat[] = ['seconds', 'minutes']

/** How the Settings dialog labels a choice, each with an example of what it shows. */
export function timeFormatLabel(format: TimeFormat): string {
  return format === 'seconds' ? 'Seconds (83.5 s)' : 'Minutes and seconds (1:23.500)'
}

/**
 * A time as a minutes-mode field shows it: `m:ss.mmm`, always three
 * decimals (the customer's "milliseconds"), and `h:mm:ss.mmm` from an hour
 * on. Rounded to the millisecond; a non-finite or negative time reads as
 * zero, since a field always holds some value.
 */
export function formatMinutesField(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const millis = Math.round(safe * 1000)
  const whole = Math.floor(millis / 1000)
  const fraction = millis % 1000
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = `${String(s).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * Reads what was typed into a minutes-mode field: `m:ss.mmm`, `m:ss`,
 * `m:ss.f`, `h:mm:ss(.mmm)`, or bare seconds (`83.5`), the forms the
 * export's Custom range already takes (#400) — one parser, not two.
 * Null for anything else, including a segment after a colon of 60 or more.
 */
export function parseMinutesField(text: string): number | null {
  return parseTimeInput(text)
}

/**
 * What a minutes-mode field commits for `text` when it holds `value`
 * (#848): the parsed time, or null for nothing to commit — text that does
 * not parse, or a time equal to `value` at the millisecond the box shows.
 * The second is what keeps a focus-and-blur, or retyping what is there,
 * from rounding a finer stored value (criterion 4).
 */
export function minutesFieldCommit(text: string, value: number): number | null {
  const parsed = parseMinutesField(text)
  if (parsed === null || Math.round(parsed * 1000) === Math.round(value * 1000)) return null
  return parsed
}

/**
 * A live preview time as the visual editors show it (#848's criterion 6):
 * today's `12.50 s`, or the minutes-mode field's own `0:12.500`.
 */
export function formatTimeReadout(seconds: number, format: TimeFormat): string {
  return format === 'minutes' ? formatMinutesField(seconds) : `${seconds.toFixed(2)} s`
}

/**
 * The value ↑ / ↓ give a minutes-mode field (#848's criterion 5): one
 * `step` from `value` in `direction`, kept in `[min, max]`, and rounded to
 * the millisecond the field shows so repeated steps do not collect float
 * noise (0.1 + 0.2).
 */
export function steppedTime(
  value: number,
  step: number,
  direction: 1 | -1,
  min: number,
  max: number,
): number {
  const next = Math.min(Math.max(value + direction * step, min), max)
  return Math.round(next * 1000) / 1000
}
