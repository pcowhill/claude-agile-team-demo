/**
 * The Trim window's arithmetic (#707, from the approved design #703 for the
 * customer's #701): where the two clamps may sit, where a point on the strip
 * lands in the source, and what Play trim does at each tick. Pure, so the
 * window's rules are tested without a browser; `TrimDialog` only wires them
 * to pointers, keys and a media element.
 *
 * Every time here is in seconds **into the source clip**, the units the
 * entry's own `inPoint` / `outPoint` are stored in, so Apply hands them to
 * `entry-trimmed` unchanged.
 */

/**
 * The shortest part a trim may keep. `entry-trimmed` only requires the kept
 * part to be longer than zero; the window asks for more, so a clamp dragged
 * onto the other always leaves something you can see and play. A tenth of a
 * second is three frames at 30 fps — short enough never to stop a real
 * trim, long enough that Play trim has a moment to show.
 */
export const MIN_TRIM_LENGTH = 0.1

/**
 * One frame, for ◀ frame and frame ▶. A browser does not tell a page a
 * clip's frame rate, so the step is a 30 fps frame (#703 §8): on a 30 fps
 * recording it is exactly one frame, and on any other rate it lands on the
 * frame showing at that time.
 */
export const TRIM_FRAME_STEP = 1 / 30

/**
 * One frame back (`-1`) or on (`1`) from `time`: onto the 30 fps frame grid
 * rather than `time ± TRIM_FRAME_STEP`, so stepping thirty times moves
 * exactly a second, however each step was rounded to the millisecond.
 */
export function frameStep(time: number, direction: -1 | 1, duration: number): number {
  const frame = Math.round(time / TRIM_FRAME_STEP)
  return sourceTime((frame + direction) * TRIM_FRAME_STEP, duration)
}

export interface TrimRange {
  inPoint: number
  outPoint: number
}

/** Times are kept to the millisecond, as the fields show them. */
const round = (value: number) => Math.round(value * 1000) / 1000
// The bounds a clamp may reach, rounded *inward*, so rounding never brings
// the clamps closer than the minimum. The 1e-6 absorbs float noise such as
// 2.968 - 0.1 = 2.8679999….
const floorMs = (value: number) => Math.floor(value * 1000 + 1e-6) / 1000
const ceilMs = (value: number) => Math.ceil(value * 1000 - 1e-6) / 1000

/**
 * A time on the source, clamped to it: 0 and the clip's own duration are
 * kept exactly (a duration need not be a whole millisecond), anything
 * between is rounded to the millisecond.
 */
export function sourceTime(value: number, duration: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= duration) return duration
  return round(value)
}

/**
 * Where the In clamp lands when asked for `value`: on the source, and never
 * closer to Out than `MIN_TRIM_LENGTH`. A clip shorter than that minimum
 * cannot honour it, so there the clamps keep the whole clip.
 */
export function clampIn(value: number, range: TrimRange, duration: number): number {
  const highest = Math.max(0, floorMs(range.outPoint - MIN_TRIM_LENGTH))
  return Math.min(sourceTime(value, duration), highest)
}

/** The Out clamp's counterpart of `clampIn`: never closer to In than the minimum. */
export function clampOut(value: number, range: TrimRange, duration: number): number {
  const lowest = Math.min(duration, ceilMs(range.inPoint + MIN_TRIM_LENGTH))
  return Math.max(sourceTime(value, duration), lowest)
}

/** How much of the source the trim keeps. */
export function keptLength(range: TrimRange): number {
  return range.outPoint - range.inPoint
}

/** Where `time` sits along the strip, 0 at its left edge and 1 at its right. */
export function stripFraction(time: number, duration: number): number {
  if (!(duration > 0)) return 0
  return Math.min(Math.max(time / duration, 0), 1)
}

/** The source time at a point `fraction` of the way along the strip. */
export function timeAtStripFraction(fraction: number, duration: number): number {
  return sourceTime(fraction * duration, duration)
}

/**
 * How close to Out the playhead may be and still count as "inside the
 * trim" when Play trim is pressed. Closer than this, playing would stop at
 * once, so it starts again from In instead.
 */
const AT_OUT_EPSILON = 0.02

/**
 * Where Play trim starts: from the playhead when it is inside the kept part,
 * so a pause and a second press carry on; from In otherwise, which is where
 * the window opens and where a finished play has left nothing more to play.
 */
export function playTrimStart(playhead: number, range: TrimRange): number {
  return playhead >= range.inPoint && playhead < range.outPoint - AT_OUT_EPSILON
    ? playhead
    : range.inPoint
}

/**
 * What Play trim does with the element's clock at one tick: carry on, stop
 * at Out, or — with Loop on — go back to In. `at` is where the playhead
 * should show; `seekTo` is set when the element must be moved there.
 */
export type PlayTrimStep =
  | { kind: 'play'; at: number }
  | { kind: 'stop'; at: number }
  | { kind: 'wrap'; at: number; seekTo: number }

export function playTrimStep(current: number, range: TrimRange, loop: boolean): PlayTrimStep {
  if (current < range.outPoint) return { kind: 'play', at: Math.max(current, range.inPoint) }
  if (loop) return { kind: 'wrap', at: range.inPoint, seekTo: range.inPoint }
  return { kind: 'stop', at: range.outPoint }
}

/** A time as the window's readouts show it: m:ss.cc, to the hundredth. */
export function formatTrimTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const hundredths = Math.round(safe * 100)
  const minutes = Math.floor(hundredths / 6000)
  const rest = hundredths - minutes * 6000
  const whole = Math.floor(rest / 100)
  const fraction = rest % 100
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}
