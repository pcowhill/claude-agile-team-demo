/**
 * A coloured border around an overlay (#697): an outline in a colour and a
 * thickness, hugging the overlay's silhouette — the placed rectangle, or the
 * ellipse or rounded rectangle its shape mask (#266) cuts it to.
 *
 * The band is drawn **outside** the silhouette: the picture keeps every
 * pixel, and the outline sits around it. Both renderers make it the same
 * way, which is what keeps them in agreement — the silhouette's path is
 * stroked at twice the thickness, centred on the path, and the silhouette's
 * inside is then removed, leaving exactly the outside offset of the shape
 * (sharp corners on a rectangle, as a CSS border has; an arc of radius
 * r + thickness at a rounded corner). The export does it on a scratch
 * canvas; the preview with an SVG mask of the same geometry.
 *
 * The thickness is a fraction of the output frame's shorter side, as a
 * shape's border is (#683), so the border keeps its look at every export
 * size; the row shows it in px at the current output frame.
 */

/** The stored border: absent (no key at all) means none. */
export interface OverlayBorder {
  /** `#rrggbb`. */
  color: string
  /** A fraction of the output frame's shorter side, in (0, MAX_OVERLAY_BORDER]. */
  thickness: number
}

/** The thickest border: a tenth of the frame's shorter side, as for shapes (#683). */
export const MAX_OVERLAY_BORDER = 0.1

/** The colour a border starts in: the customer's first example, a black outline (#695). */
export const DEFAULT_OVERLAY_BORDER_COLOR = '#000000'

/**
 * The thickness, in output pixels, a border starts at when its colour is
 * chosen before any thickness: a visible but modest outline.
 */
export const DEFAULT_OVERLAY_BORDER_PX = 4

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Whether an edit is acceptable input at all: a `#rrggbb` colour and a finite thickness. */
export function isValidOverlayBorderInput(border: OverlayBorder): boolean {
  return HEX_COLOR.test(border.color) && Number.isFinite(border.thickness)
}

/**
 * The canonical stored form: the thickness clamps into [0,
 * MAX_OVERLAY_BORDER], a thickness of 0 is no border (`undefined` — the
 * caller stores no key, so border-free files stay byte-identical), and the
 * colour is stored lower-case so one colour is never stored two ways.
 */
export function normalizeOverlayBorder(border: OverlayBorder): OverlayBorder | undefined {
  const thickness = Math.min(Math.max(border.thickness, 0), MAX_OVERLAY_BORDER)
  if (thickness === 0) return undefined
  return { color: border.color.toLowerCase(), thickness }
}

/** Structural equality over stored (normalized) borders. */
export function overlayBordersEqual(
  a: OverlayBorder | undefined,
  b: OverlayBorder | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.color === b.color && a.thickness === b.thickness
}
