/**
 * Per-clip orientation (#232): rotate 90°/180°/270° and flip
 * horizontal/vertical on video/image sequence entries and video overlays —
 * the fix for sideways phone footage and mirrored webcam shots. This module
 * is the shared rule (#66 pattern): both renderers resolve an orientation
 * through `orientationTransform` and `orientedDimensions`, so what plays is
 * what exports (#233 wires the export side).
 *
 * **Composition order is meaning:** flips apply in the source's own space
 * first, then the rotation — `orientationTransform` returns the pieces in
 * that fixed order (CSS `rotate(r) scale(sx, sy)` applies right-to-left;
 * the export's canvas applies `rotate` then `scale` to its coordinate
 * system, which transforms drawn content in the same order). One order,
 * both renderers, no drift.
 *
 * **Orientation happens at the source-fitting stage** (#227): a clip
 * rotated 90°/270° is treated as a source with swapped dimensions
 * (`orientedDimensions`), so it letterboxes into the frame the way any
 * portrait source already does and everything downstream — zoom windows,
 * transitions, overlay rectangles — operates on the oriented picture with
 * zero special-casing.
 */

/** The quarter-turn rotations an orientation may carry; 0 is stored as no
 * field at all (see `normalizeOrientation`). */
export const ORIENTATION_ROTATIONS = [90, 180, 270] as const
export type OrientationRotation = (typeof ORIENTATION_ROTATIONS)[number]

/**
 * The stored orientation. Every field is optional and each absent field
 * behaves as identity (no rotation, no flip) — the `colorAdjustments`
 * shape (#192) — so pre-#232 states and files stay valid unchanged. A
 * normalized orientation (see `normalizeOrientation`) carries only
 * non-identity fields, and the fully-identity orientation is represented as
 * the item's `orientation` key being absent, never as `{}` — that is what
 * keeps orientation-free project files byte-identical.
 */
export interface Orientation {
  /** Clockwise rotation in degrees; absent = 0 (as shot). */
  rotation?: OrientationRotation
  /** Mirror horizontally (in the source's own space, before rotation). */
  flipH?: boolean
  /** Mirror vertically (in the source's own space, before rotation). */
  flipV?: boolean
}

/**
 * Whether an orientation is acceptable input at all: a present rotation is
 * one of the quarter turns (0 is expressed by absence; arbitrary angles
 * would break the swapped-dimensions fit rule) and present flips are
 * booleans. Unlike the continuous adjustment dials there is nothing to
 * clamp — a value is either one of the discrete states or refused.
 */
export function isValidOrientation(orientation: Orientation): boolean {
  return (
    (orientation.rotation === undefined ||
      ORIENTATION_ROTATIONS.includes(orientation.rotation)) &&
    (orientation.flipH === undefined || typeof orientation.flipH === 'boolean') &&
    (orientation.flipV === undefined || typeof orientation.flipV === 'boolean')
  )
}

/**
 * The canonical stored form: identity fields dropped (`false` flips and the
 * absent rotation), so the same setting is never stored two ways. A fully
 * identity orientation is `undefined` — the caller stores no `orientation`
 * key at all, which is what keeps orientation-free project files
 * byte-identical (#232).
 */
export function normalizeOrientation(orientation: Orientation): Orientation | undefined {
  const rotation = orientation.rotation
  const flipH = orientation.flipH === true
  const flipV = orientation.flipV === true
  if (rotation === undefined && !flipH && !flipV) return undefined
  return {
    ...(rotation === undefined ? {} : { rotation }),
    ...(flipH ? { flipH: true } : {}),
    ...(flipV ? { flipV: true } : {}),
  }
}

/** Structural equality over stored (normalized) orientations. */
export function orientationsEqual(
  a: Orientation | undefined,
  b: Orientation | undefined,
): boolean {
  return a?.rotation === b?.rotation && a?.flipH === b?.flipH && a?.flipV === b?.flipV
}

/** Whether the orientation turns the picture a quarter turn, swapping the
 * roles of its width and height. */
export function orientationSwapsDimensions(orientation: Orientation | undefined): boolean {
  return orientation?.rotation === 90 || orientation?.rotation === 270
}

/**
 * The dimensions an oriented source presents to the fit-to-frame rule
 * (#176): a quarter-turned clip is just a source with swapped width and
 * height — how a sideways phone clip becomes a portrait source — and every
 * other orientation leaves them untouched (flips and 180° preserve shape).
 * Returns the same object when nothing changes, so orientation-free callers
 * pay nothing.
 */
export function orientedDimensions<T extends { width: number; height: number }>(
  dimensions: T,
  orientation: Orientation | undefined,
): T {
  if (!orientationSwapsDimensions(orientation)) return dimensions
  return { ...dimensions, width: dimensions.height, height: dimensions.width }
}

/**
 * The transform an orientation applies to the fitted picture, about its
 * centre: `scaleX`/`scaleY` mirror first (the source's own axes), then
 * `rotation` degrees clockwise. The identity orientation (or none) is the
 * identity transform. The preview maps this to a CSS transform on the media
 * element; the export (#233) maps it to the equivalent canvas transform —
 * neither re-derives the order.
 */
export function orientationTransform(orientation: Orientation | undefined): {
  rotation: 0 | OrientationRotation
  scaleX: 1 | -1
  scaleY: 1 | -1
} {
  return {
    rotation: orientation?.rotation ?? 0,
    scaleX: orientation?.flipH === true ? -1 : 1,
    scaleY: orientation?.flipV === true ? -1 : 1,
  }
}
