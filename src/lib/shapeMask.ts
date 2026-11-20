/**
 * Per-overlay shape mask (#266): clip a video overlay's picture to an
 * inscribed ellipse (a circle when the picture is square) or a rounded
 * rectangle — the established picture-in-picture treatment (a webcam bubble
 * over a screen recording). The mask shapes only the visible outline, in
 * frame space, after crop (#255) and orientation (#232) have produced the
 * picture: crop selects source pixels, the picture letterboxes inside the
 * placed rectangle, and the mask shapes that picture (#791) — so a crop
 * that narrows the picture narrows the ellipse with it. Placement, timing,
 * audio, and color adjustments are untouched.
 *
 * This module is the shared rule (#66 pattern): `inscribedEllipse` and
 * `roundedCornerRadius` describe the mask geometry over the overlay's
 * outline rectangle (`overlayPictureRect` in exportVideo.ts)
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
      /** The ellipse inscribed in the overlay's picture (a circle when square). */
      kind: 'ellipse'
    }
  | {
      /**
       * A rounded rectangle. `radius` is the corner radius as a fraction of
       * the picture's shorter side, in (0, 0.5] — 0.5 rounds the
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
 * The ellipse inscribed in an overlay's outline rectangle: centred, radii half the
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
 * A rounded mask's effective corner radius over an outline rectangle, in the
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

/** A rectangle in frame fractions: an overlay's placement, or its picture. */
interface FrameRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The CSS `clip-path` the preview clips a masked overlay card with. `box` is
 * the overlay's placed rectangle in frame fractions — the card's own box —
 * and `outline` the part of it the picture covers (`overlayPictureRect`,
 * #791), which defaults to the whole box. The shape is drawn on the
 * outline, so the clip is the outline's position inside the card in
 * percentages of the card: the ellipse's centre and radii, the rounded
 * rectangle's insets. The rounded corner radius needs a length in frame
 * terms — the frame is the preview's size container (cq units,
 * #176/#259), so `min(<w>cqw, <h>cqh)` evaluates exactly
 * `roundedCornerRadius` (the fraction of the outline's shorter side) at
 * whatever size the frame renders. An outline that fills the box gives the
 * strings this rule has always given. Absent mask = `undefined`: no style at
 * all, keeping mask-free overlays byte-identical (#255 discipline).
 */
export function maskClipPath(
  mask: ShapeMask | undefined,
  box: FrameRect,
  outline: FrameRect = box,
): string | undefined {
  if (mask === undefined) return undefined
  const percentOf = (part: number, whole: number) => (whole > 0 ? styleNumber((part / whole) * 100) : 0)
  const insetLeft = percentOf(outline.x - box.x, box.width)
  const insetTop = percentOf(outline.y - box.y, box.height)
  const insetRight = percentOf(box.x + box.width - (outline.x + outline.width), box.width)
  const insetBottom = percentOf(box.y + box.height - (outline.y + outline.height), box.height)
  const fills = insetLeft === 0 && insetTop === 0 && insetRight === 0 && insetBottom === 0
  if (mask.kind === 'ellipse') {
    if (fills) return 'ellipse(50% 50% at 50% 50%)'
    const rx = percentOf(outline.width / 2, box.width)
    const ry = percentOf(outline.height / 2, box.height)
    const cx = percentOf(outline.x + outline.width / 2 - box.x, box.width)
    const cy = percentOf(outline.y + outline.height / 2 - box.y, box.height)
    return `ellipse(${rx}% ${ry}% at ${cx}% ${cy}%)`
  }
  const horizontal = styleNumber(mask.radius * outline.width * 100)
  const vertical = styleNumber(mask.radius * outline.height * 100)
  const insets = fills ? '0' : `${insetTop}% ${insetRight}% ${insetBottom}% ${insetLeft}%`
  return `inset(${insets} round min(${horizontal}cqw, ${vertical}cqh))`
}
