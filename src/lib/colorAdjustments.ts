/**
 * Per-clip color adjustments (#192): optional brightness, contrast, and
 * saturation dials plus one-click looks (grayscale, sepia) on video/image
 * sequence entries and video overlays. This module is the shared rule (#66
 * pattern): `colorFilterFor` resolves an adjustment set into one canonical
 * filter string that BOTH renderers consume — the preview sets it as the
 * element's CSS `filter`, and the export (#195) will set the same string as
 * the canvas context's `filter` — so what plays is what exports.
 *
 * **Filter-function constraint:** only functions with universal support in
 * the target browsers for both CSS `filter` and canvas 2D `filter` may be
 * emitted here — brightness(), contrast(), saturate(), grayscale(), and
 * sepia() are safe everywhere both properties exist. Do not add functions
 * (e.g. blur, hue-rotate, drop-shadow) without re-checking canvas `filter`
 * support, and keep the emitted syntax to simple percentage arguments,
 * which both parsers accept identically.
 */

/** The one-click looks (#192). Applied after the three dials. */
export const COLOR_LOOKS = ['grayscale', 'sepia'] as const
export type ColorLook = (typeof COLOR_LOOKS)[number]

/**
 * The stored adjustment set. Every field is optional, and each absent field
 * behaves as identity (100% for the dials, no look) — exactly how text-fade
 * fields behave (#177) — so pre-#192 states and files stay valid unchanged.
 * A normalized set (see `normalizeColorAdjustments`) carries only
 * non-identity fields, and a fully-identity set is represented as the
 * entry's `colorAdjustments` key being absent, never as `{}` — that is what
 * keeps adjustment-free project files byte-identical.
 */
export interface ColorAdjustments {
  /** Brightness percentage, 0–200; absent = 100 (identity). */
  brightness?: number
  /** Contrast percentage, 0–200; absent = 100 (identity). */
  contrast?: number
  /** Saturation percentage, 0–200; absent = 100 (identity). */
  saturation?: number
  /** One-click look; absent = none. */
  look?: ColorLook
}

/** The dials' shared range (#192): 0% (none) to 200% (doubled). */
export const COLOR_ADJUSTMENT_MIN = 0
export const COLOR_ADJUSTMENT_MAX = 200
/** The dials' identity value: 100% = as shot. */
export const COLOR_ADJUSTMENT_IDENTITY = 100

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Whether a set is acceptable input at all: present dials are finite numbers
 * and a present look is a known one. Ranges are not rejected — they clamp
 * (`normalizeColorAdjustments`), like a zoom centre.
 */
export function isValidColorAdjustments(adjustments: ColorAdjustments): boolean {
  const dials = [adjustments.brightness, adjustments.contrast, adjustments.saturation]
  return (
    dials.every((value) => value === undefined || Number.isFinite(value)) &&
    (adjustments.look === undefined || COLOR_LOOKS.includes(adjustments.look))
  )
}

/**
 * The canonical stored form: dials clamped into [0, 200] and identity fields
 * dropped, so the same visible result is never stored two ways. A set that
 * normalizes to all-identity is `undefined` — the caller stores no
 * `colorAdjustments` key at all, which is what keeps adjustment-free
 * project files byte-identical (#192).
 */
export function normalizeColorAdjustments(
  adjustments: ColorAdjustments,
): ColorAdjustments | undefined {
  const dial = (value: number | undefined): number | undefined => {
    if (value === undefined) return undefined
    const clamped = clamp(value, COLOR_ADJUSTMENT_MIN, COLOR_ADJUSTMENT_MAX)
    return clamped === COLOR_ADJUSTMENT_IDENTITY ? undefined : clamped
  }
  const brightness = dial(adjustments.brightness)
  const contrast = dial(adjustments.contrast)
  const saturation = dial(adjustments.saturation)
  const look = adjustments.look
  if (brightness === undefined && contrast === undefined && saturation === undefined && look === undefined) {
    return undefined
  }
  return {
    ...(brightness === undefined ? {} : { brightness }),
    ...(contrast === undefined ? {} : { contrast }),
    ...(saturation === undefined ? {} : { saturation }),
    ...(look === undefined ? {} : { look }),
  }
}

/** Structural equality, treating absent and identity-normalized alike only
 * insofar as both sides are already normalized — compare stored values. */
export function colorAdjustmentsEqual(
  a: ColorAdjustments | undefined,
  b: ColorAdjustments | undefined,
): boolean {
  return (
    a?.brightness === b?.brightness &&
    a?.contrast === b?.contrast &&
    a?.saturation === b?.saturation &&
    a?.look === b?.look
  )
}

/**
 * The shared rule (#66): one canonical filter string both renderers consume.
 * Fixed function order — brightness, contrast, saturate, then the look — so
 * the same set always yields the same string (filter functions compose in
 * written order, so order is meaning, not just style). Identity fields emit
 * nothing; the fully-identity set (or absent adjustments) is 'none', the
 * value both CSS and canvas treat as no filtering.
 */
export function colorFilterFor(adjustments: ColorAdjustments | undefined): string {
  if (adjustments === undefined) return 'none'
  const parts: string[] = []
  if (adjustments.brightness !== undefined && adjustments.brightness !== COLOR_ADJUSTMENT_IDENTITY) {
    parts.push(`brightness(${adjustments.brightness}%)`)
  }
  if (adjustments.contrast !== undefined && adjustments.contrast !== COLOR_ADJUSTMENT_IDENTITY) {
    parts.push(`contrast(${adjustments.contrast}%)`)
  }
  if (adjustments.saturation !== undefined && adjustments.saturation !== COLOR_ADJUSTMENT_IDENTITY) {
    parts.push(`saturate(${adjustments.saturation}%)`)
  }
  if (adjustments.look !== undefined) parts.push(`${adjustments.look}(100%)`)
  return parts.length === 0 ? 'none' : parts.join(' ')
}
