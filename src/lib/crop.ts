/**
 * Per-clip crop (#255): trim a fraction of the frame from each edge of a
 * video/image sequence entry or a video overlay, so only the kept region
 * renders — scaled into the output frame like any source. This module is
 * the shared rule (#66 pattern): `cropSourceRect` and `croppedDimensions`
 * describe the kept region for BOTH renderers, and `cropMediaPlacement`
 * maps it to the element-box geometry the preview styles from — the export
 * (#256) consumes `cropSourceRect` as its `drawImage` source rectangle, so
 * what plays is what exports.
 *
 * **Order of operations is meaning:** crop applies in the source's own
 * pixel space, BEFORE orientation (#232) — crop selects sensor content;
 * orientation then turns (and mirrors) the kept region. A cropped clip's
 * effective dimensions are therefore `croppedDimensions` first, then
 * `orientedDimensions`, and that composed shape is what the fit-to-frame
 * rule (#176) sees — everything downstream (zooms, transitions, overlay
 * rectangles) operates on the cropped-and-oriented picture with zero
 * special-casing.
 */

/**
 * The stored crop: the fraction of the source trimmed from each edge.
 * Every field is optional and each absent field behaves as identity (no
 * trim) — the `colorAdjustments`/`orientation` shape (#192/#232) — so
 * pre-crop states and files stay valid unchanged. A normalized crop (see
 * `normalizeCrop`) carries only non-zero fields, and the no-op crop is
 * represented as the item's `crop` key being absent, never as `{}` — that
 * is what keeps crop-free project files byte-identical.
 */
export interface Crop {
  /** Fraction of the source width trimmed from the left edge; absent = 0. */
  left?: number
  /** Fraction of the source width trimmed from the right edge; absent = 0. */
  right?: number
  /** Fraction of the source height trimmed from the top edge; absent = 0. */
  top?: number
  /** Fraction of the source height trimmed from the bottom edge; absent = 0. */
  bottom?: number
}

/**
 * The smallest fraction of either axis a crop may keep (#255): opposing
 * edges can never meet or cross, so a degenerate (zero- or negative-size)
 * kept region is unrepresentable — the established clamping idiom (a zoom
 * centre clamps, a fade clamps to its window). `normalizeCrop` scales an
 * over-deep pair of edges back proportionally to this floor.
 */
export const MIN_KEPT_FRACTION = 0.1

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Whether a crop is acceptable input at all: present fields are finite
 * numbers. Ranges are not rejected — they clamp (`normalizeCrop`), like a
 * color dial or a zoom centre.
 */
export function isValidCrop(crop: Crop): boolean {
  return [crop.left, crop.right, crop.top, crop.bottom].every(
    (value) => value === undefined || Number.isFinite(value),
  )
}

/**
 * The canonical stored form: each edge clamped into [0, 1), each axis's
 * pair scaled back proportionally when it would keep less than
 * `MIN_KEPT_FRACTION`, and zero fields dropped — so the same visible result
 * is never stored two ways. A crop that normalizes to all-zero is
 * `undefined` — the caller stores no `crop` key at all, which is what keeps
 * crop-free project files byte-identical (#255).
 */
export function normalizeCrop(crop: Crop): Crop | undefined {
  const edge = (value: number | undefined) => clamp(value ?? 0, 0, 1)
  const axis = (a: number, b: number): [number, number] => {
    const kept = 1 - a - b
    if (kept >= MIN_KEPT_FRACTION || a + b === 0) return [a, b]
    // Scale both edges back so exactly MIN_KEPT_FRACTION survives; the
    // edges keep their ratio, so the kept region stays where it was aimed.
    const scale = (1 - MIN_KEPT_FRACTION) / (a + b)
    return [a * scale, b * scale]
  }
  const [left, right] = axis(edge(crop.left), edge(crop.right))
  const [top, bottom] = axis(edge(crop.top), edge(crop.bottom))
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return undefined
  return {
    ...(left === 0 ? {} : { left }),
    ...(right === 0 ? {} : { right }),
    ...(top === 0 ? {} : { top }),
    ...(bottom === 0 ? {} : { bottom }),
  }
}

/** Structural equality over stored (normalized) crops. */
export function cropsEqual(a: Crop | undefined, b: Crop | undefined): boolean {
  return (
    (a?.left ?? 0) === (b?.left ?? 0) &&
    (a?.right ?? 0) === (b?.right ?? 0) &&
    (a?.top ?? 0) === (b?.top ?? 0) &&
    (a?.bottom ?? 0) === (b?.bottom ?? 0)
  )
}

/** The fraction of each source axis a crop keeps. Assumes normalized input. */
export function keptFractions(crop: Crop | undefined): { x: number; y: number } {
  return {
    x: 1 - (crop?.left ?? 0) - (crop?.right ?? 0),
    y: 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0),
  }
}

/**
 * The kept region in source pixels — the export's `drawImage` source
 * rectangle (#256). An absent crop is the whole source.
 */
export function cropSourceRect(
  crop: Crop | undefined,
  dimensions: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const kept = keptFractions(crop)
  return {
    x: (crop?.left ?? 0) * dimensions.width,
    y: (crop?.top ?? 0) * dimensions.height,
    width: kept.x * dimensions.width,
    height: kept.y * dimensions.height,
  }
}

/**
 * The dimensions a cropped source presents to the fit-to-frame rule (#176)
 * and the output-frame rule — the kept region's pixels, rounded to whole
 * pixels (frame sizes are pixel counts), never below 1. Applied BEFORE
 * `orientedDimensions` (#232): crop selects source content, orientation
 * then turns the kept region. Returns the same object when nothing
 * changes, so crop-free callers pay nothing.
 */
export function croppedDimensions<T extends { width: number; height: number }>(
  dimensions: T,
  crop: Crop | undefined,
): T {
  if (crop === undefined) return dimensions
  const kept = keptFractions(crop)
  return {
    ...dimensions,
    width: Math.max(1, Math.round(dimensions.width * kept.x)),
    height: Math.max(1, Math.round(dimensions.height * kept.y)),
  }
}

/**
 * The preview's element-box geometry for a cropped source (#255): the media
 * element contain-fits the WHOLE source into its box, so showing only the
 * kept region takes three coordinated pieces, all in fractions of the
 * element box —
 *
 * - `inset*`: a clip-path cutting the element to the kept region where the
 *   contain-fit rendered it (clip-path applies to the untransformed box);
 * - `scale`: the factor that grows the kept region from its contain-fit
 *   rendering to ITS OWN contain-fit in the box — as if it were the whole
 *   source;
 * - `translateX/Y`: the shift (of the element's own box, the unit CSS
 *   `translate(%)` uses) that centres the scaled kept region in the box,
 *   applied AFTER the scale in CSS order (`translate(…) scale(…)`, default
 *   centre origin).
 *
 * `boxAspect` is the element box's width ÷ height — the card's aspect, or
 * the transposed card's for a quarter-turned item (#232), which is exactly
 * the box the existing orientation style already swaps to; the same
 * two-contain-ratios argument makes crop and rotation compose with no new
 * cases. `sourceAspect` is the raw source's width ÷ height (pre-crop,
 * pre-orientation). Returns undefined — style nothing — for an absent
 * crop or degenerate inputs, keeping crop-free layers' styles untouched.
 */
export function cropMediaPlacement(
  crop: Crop | undefined,
  sourceAspect: number | undefined,
  boxAspect: number,
): {
  insetTop: number
  insetRight: number
  insetBottom: number
  insetLeft: number
  scale: number
  translateX: number
  translateY: number
} | undefined {
  if (crop === undefined) return undefined
  if (
    sourceAspect === undefined ||
    !Number.isFinite(sourceAspect) ||
    sourceAspect <= 0 ||
    !Number.isFinite(boxAspect) ||
    boxAspect <= 0
  ) {
    return undefined
  }
  // Normalized box: width = boxAspect, height = 1.
  // Contain-fit of the whole source in the box.
  const renderedWidth = sourceAspect >= boxAspect ? boxAspect : sourceAspect
  const renderedHeight = sourceAspect >= boxAspect ? boxAspect / sourceAspect : 1
  // The kept region inside that rendering.
  const kept = keptFractions(crop)
  const keptWidth = kept.x * renderedWidth
  const keptHeight = kept.y * renderedHeight
  const keptX = (boxAspect - renderedWidth) / 2 + (crop.left ?? 0) * renderedWidth
  const keptY = (1 - renderedHeight) / 2 + (crop.top ?? 0) * renderedHeight
  // Contain-fit of the kept region alone, relative to its current size.
  const scale = Math.min(boxAspect / keptWidth, 1 / keptHeight)
  // Move the kept region's centre to the box centre. CSS applies the
  // translate after the scale (both about the box centre), so the shift is
  // the post-scale distance, in fractions of the element's own box.
  const centerX = keptX + keptWidth / 2
  const centerY = keptY + keptHeight / 2
  return {
    insetTop: keptY * 100,
    insetRight: ((boxAspect - keptX - keptWidth) / boxAspect) * 100,
    insetBottom: (1 - keptY - keptHeight) * 100,
    insetLeft: (keptX / boxAspect) * 100,
    scale,
    translateX: ((scale * (boxAspect / 2 - centerX)) / boxAspect) * 100,
    translateY: scale * (0.5 - centerY) * 100,
  }
}
