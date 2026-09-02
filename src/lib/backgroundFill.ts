/**
 * Per-entry background fill (#259): what shows behind a source that doesn't
 * fill the output frame — a portrait clip in a landscape sequence, a
 * quarter-turned clip (#232), a cropped kept region (#255) — instead of the
 * frame's plain black bars. `blur` is the ubiquitous social-video look (the
 * entry's own current frame, scaled to cover the output frame and blurred,
 * behind the normally fitted clip); `color` is the simple flat alternative;
 * absent is today's behavior.
 *
 * This module is the shared rule (#66 pattern): `coverRect` maps the
 * (cropped-then-oriented, #255/#232) source shape onto the frame it must
 * cover, and `backdropBlurRadius` fixes the blur strength as a fraction of
 * the frame — for BOTH renderers. The preview consumes them in #259 (a
 * low-resolution backdrop canvas behind the fitted media element); the
 * export (#260) consumes the same numbers on its own canvas, so what plays
 * is what exports.
 *
 * The fill never changes a source's effective dimensions: the fit-to-frame
 * and output-frame rules (#176) see exactly the shape they always saw — a
 * backdrop fills whatever bars those rules leave, it never shapes the frame.
 */

/**
 * The stored fill: absent (no key at all) means none — today's black bars —
 * the `colorAdjustments`/`orientation`/`crop` shape (#192/#232/#255), so
 * fill-free states and files stay valid and byte-identical. A discriminated
 * union so a future fill kind extends rather than reshapes it.
 */
export type BackgroundFill =
  | {
      /** The entry's own current frame, cover-fit to the output frame and blurred. */
      kind: 'blur'
    }
  | {
      /** A flat backdrop color, lowercase `#rrggbb` (the slate rule, #143). */
      kind: 'color'
      color: string
    }

/**
 * What the editing action carries: the stored shapes plus the explicit
 * `none`, which is how the UI resets — `normalizeBackgroundFill` maps it to
 * `undefined` (no stored key), the same "identity is absence" rule every
 * optional adjustment follows.
 */
export type BackgroundFillInput = BackgroundFill | { kind: 'none' }

/** Lowercase #rrggbb — the one shape `<input type="color">` reads and writes. */
const FILL_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/** The color input's starting value before the user picks one. */
export const DEFAULT_FILL_COLOR = '#000000'

/**
 * Whether a fill is acceptable input at all: a known kind, and for `color`
 * a storable color string. Unlike the numeric adjustments there is nothing
 * to clamp — an unknown kind or malformed color is refused, not coerced.
 */
export function isValidBackgroundFillInput(fill: BackgroundFillInput): boolean {
  if (fill.kind === 'none' || fill.kind === 'blur') return true
  return fill.kind === 'color' && FILL_COLOR_PATTERN.test(fill.color)
}

/**
 * The canonical stored form: `none` is `undefined` — the caller stores no
 * `backgroundFill` key at all — and the stored kinds carry exactly their
 * own fields, so the same fill never serializes two ways.
 */
export function normalizeBackgroundFill(fill: BackgroundFillInput): BackgroundFill | undefined {
  if (fill.kind === 'none') return undefined
  if (fill.kind === 'blur') return { kind: 'blur' }
  return { kind: 'color', color: fill.color }
}

/** Structural equality over stored (normalized) fills. */
export function backgroundFillsEqual(
  a: BackgroundFill | undefined,
  b: BackgroundFill | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.kind !== b.kind) return false
  return a.kind !== 'color' || b.kind !== 'color' || a.color === b.color
}

/**
 * The blur backdrop's strength, as a fraction of the frame's shorter side —
 * resolution-independent, so the preview's low-resolution backdrop buffer
 * and the export's full-size frame (#260) blur to the same visible degree.
 * 2% of the shorter side is the familiar heavy blur-fill look (~22px on a
 * 1080p frame).
 */
export const BACKDROP_BLUR_FRACTION = 0.02

/** The blur radius in pixels for a frame (or backdrop buffer) of this size. */
export function backdropBlurRadius(frame: { width: number; height: number }): number {
  return BACKDROP_BLUR_FRACTION * Math.min(frame.width, frame.height)
}

/**
 * The blur backdrop buffer's fixed width in canvas pixels: the picture is
 * heavily blurred by design, so a small buffer both looks identical and
 * keeps the per-frame copy trivially cheap. Shared by both renderers —
 * the preview's backdrop canvas (#259) and the export's backdrop buffer
 * (#260) — so the blur draws from the same source resolution everywhere.
 */
export const BACKDROP_BUFFER_WIDTH = 192

/**
 * Where a backdrop's picture lands in the frame: the content shape (the
 * cropped-then-oriented dimensions, #255/#232 — the same composed shape the
 * fit rule sees) scaled uniformly to COVER the frame and centered, so the
 * overflow crops evenly off both sides of the long axis. A content shape
 * matching the frame's aspect covers it exactly — no overflow, and also no
 * visible backdrop area for it to matter. Degenerate content (a zero or
 * negative axis) covers the frame 1:1 rather than dividing by zero; there
 * is no picture to place.
 */
export function coverRect(
  content: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (content.width <= 0 || content.height <= 0) {
    return { x: 0, y: 0, width: frame.width, height: frame.height }
  }
  const scale = Math.max(frame.width / content.width, frame.height / content.height)
  const width = content.width * scale
  const height = content.height * scale
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height }
}

/**
 * Where a blur backdrop's picture is actually drawn: the exact cover fit,
 * inflated around its centre by twice the blur fraction. A blur samples
 * past the picture's edge into nothing, so an exactly-covering edge would
 * vignette toward the frame border; the overscan keeps real picture under
 * the blur kernel everywhere, at the cost of pixels nobody sees. Both
 * renderers draw this same rectangle, so preview and export (#260) blur the
 * same picture.
 */
export function backdropRect(
  content: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const base = coverRect(content, frame)
  const grow = BACKDROP_BLUR_FRACTION
  return {
    x: base.x - base.width * grow,
    y: base.y - base.height * grow,
    width: base.width * (1 + 2 * grow),
    height: base.height * (1 + 2 * grow),
  }
}
