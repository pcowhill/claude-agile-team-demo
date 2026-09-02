/**
 * Per-overlay shape mask (#266): clip a video overlay's placed rectangle to
 * an inscribed ellipse (a circle when the rectangle is square) or a rounded
 * rectangle — the established picture-in-picture treatment (a webcam bubble
 * over a screen recording). The mask shapes only the visible outline, in
 * frame space, after crop (#255) and orientation (#232) have produced the
 * picture: crop selects source pixels; the mask shapes the placed
 * silhouette. Placement, timing, audio, and color adjustments are untouched.
 *
 * This module is the shared rule (#66 pattern): `inscribedEllipse` and
 * `roundedCornerRadius` describe the mask geometry over a placed rectangle
 * for BOTH renderers, and `maskClipPath` maps it to the CSS the preview
 * clips with — the export (the #266 follow-up) consumes the same geometry
 * as its canvas clip path, so what plays is what exports.
 */

/**
 * The stored mask: absent (no key at all) means the hard rectangle —
 * today's outline — the `colorAdjustments`/`orientation`/`crop` shape
 * (#192/#232/#255), so mask-free states and files stay valid and
 * byte-identical. A discriminated union so a future mask kind extends
 * rather than reshapes it.
 */
export type ShapeMask =
  | {
      /** The ellipse inscribed in the placed rectangle (a circle when square). */
      kind: 'ellipse'
    }
  | {
      /**
       * A rounded rectangle. `radius` is the corner radius as a fraction of
       * the placed rectangle's shorter side, in (0, 0.5] — 0.5 rounds the
       * shorter axis fully (a capsule). A radius of 0 is the hard rectangle,
       * which is represented as no mask at all (see `normalizeShapeMask`).
       */
      kind: 'rounded'
      radius: number
    }

/**
 * What the editing action carries: the stored shapes plus the explicit
 * `rectangle`, which is how the UI resets — `normalizeShapeMask` maps it to
 * `undefined` (no stored key), the same "identity is absence" rule every
 * optional adjustment follows.
 */
export type ShapeMaskInput = ShapeMask | { kind: 'rectangle' }

/** The largest storable corner-radius fraction: half the shorter side. */
export const MAX_ROUNDED_RADIUS = 0.5

/** The radius the UI starts a fresh `rounded` mask at — a visible, gentle round. */
export const DEFAULT_ROUNDED_RADIUS = 0.15

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Whether a mask is acceptable input at all: a known kind, and for
 * `rounded` a finite radius. Ranges are not rejected — they clamp
 * (`normalizeShapeMask`), like a crop edge or a zoom centre.
 */
export function isValidShapeMaskInput(mask: ShapeMaskInput): boolean {
  if (mask.kind === 'rectangle' || mask.kind === 'ellipse') return true
  return mask.kind === 'rounded' && Number.isFinite(mask.radius)
}

/**
 * The canonical stored form: `rectangle` is `undefined` — the caller stores
 * no `shapeMask` key at all — the rounded radius clamps into
 * [0, MAX_ROUNDED_RADIUS], and a radius that clamps to 0 is the rectangle
 * (undefined too), so the same visible outline is never stored two ways.
 */
export function normalizeShapeMask(mask: ShapeMaskInput): ShapeMask | undefined {
  if (mask.kind === 'rectangle') return undefined
  if (mask.kind === 'ellipse') return { kind: 'ellipse' }
  const radius = clamp(mask.radius, 0, MAX_ROUNDED_RADIUS)
  if (radius === 0) return undefined
  return { kind: 'rounded', radius }
}

/** Structural equality over stored (normalized) masks. */
export function shapeMasksEqual(a: ShapeMask | undefined, b: ShapeMask | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.kind !== b.kind) return false
  return a.kind !== 'rounded' || b.kind !== 'rounded' || a.radius === b.radius
}

/**
 * The ellipse inscribed in a placed rectangle: centred, radii half the
 * sides — a circle exactly when the rectangle is square. Both renderers
 * consume this one shape (the preview as percentages of the card box, the
 * export as canvas `ellipse` arguments), so the cut silhouette matches.
 */
export function inscribedEllipse(rect: { x: number; y: number; width: number; height: number }): {
  cx: number
  cy: number
  rx: number
  ry: number
} {
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: rect.width / 2,
    ry: rect.height / 2,
  }
}

/**
 * A rounded mask's effective corner radius over a placed rectangle, in the
 * rectangle's own units: the stored fraction of the SHORTER side, so the
 * corners are circular whatever the rectangle's aspect (a percentage
 * border-radius would make them elliptical) and the outline scales with
 * the rectangle at any rendered resolution.
 */
export function roundedCornerRadius(
  rect: { width: number; height: number },
  radius: number,
): number {
  return radius * Math.min(rect.width, rect.height)
}

const styleNumber = (value: number) => Math.round(value * 10000) / 10000

/**
 * The CSS `clip-path` the preview clips a masked overlay card with, given
 * the overlay's placed rectangle in frame fractions. The card's box IS the
 * placed rectangle, so the ellipse is percentages of the box; the rounded
 * corner radius needs a length in frame terms — the frame is the preview's
 * size container (cq units, #176/#259), so `min(<w>cqw, <h>cqh)` evaluates
 * exactly `roundedCornerRadius` (the fraction of the shorter side) at
 * whatever size the frame renders. Absent mask = `undefined`: no style at
 * all, keeping mask-free overlays byte-identical (#255 discipline).
 */
export function maskClipPath(
  mask: ShapeMask | undefined,
  overlay: { width: number; height: number },
): string | undefined {
  if (mask === undefined) return undefined
  if (mask.kind === 'ellipse') return 'ellipse(50% 50% at 50% 50%)'
  const horizontal = styleNumber(mask.radius * overlay.width * 100)
  const vertical = styleNumber(mask.radius * overlay.height * 100)
  return `inset(0 round min(${horizontal}cqw, ${vertical}cqh))`
}
