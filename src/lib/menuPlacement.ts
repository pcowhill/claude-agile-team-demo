/**
 * Where a menu panel that would leave the viewport goes instead (#430, from
 * the shared `Menu` of #412).
 *
 * Pure and separate from the component because the effect that calls it
 * cannot be tested through the DOM: jsdom reports zero-size boxes, so the
 * flip never runs there, and until #415 no shipped menu had a submenu for a
 * browser to exercise. The arithmetic is the part worth pinning.
 */

export interface Placement {
  /** Flip horizontally, to the other side of the anchor. */
  end: boolean
  /** Flip vertically, above the anchor. */
  up: boolean
}

/** A box, as `getBoundingClientRect` reports one — the part this needs. */
export interface PlacementBox {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

/**
 * The edges a panel must stay inside, in viewport coordinates. Usually the
 * viewport itself; smaller wherever an ancestor with a non-visible
 * `overflow` clips the panel before the window does (#416).
 */
export interface PlacementBounds {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Where a panel is actually free to be drawn: the viewport, narrowed by the
 * nearest ancestor that clips its overflow (#416).
 *
 * A panel is positioned inside its trigger's row, so an ancestor scrolling
 * box cuts it off long before the window does — and the browser's answer to
 * a clipped panel is to scroll that box when focus lands in it, which yanks
 * the list out from under the pointer that just opened the menu. The media
 * library's clip list is such a box (`max-height: 50vh; overflow-y: auto`,
 * #308), and a row in its lower half opened a panel that hung past the
 * bottom edge: measured at 1280×720 with eight clips, opening the fifth
 * row's ⋯ scrolled the list by 198 px.
 *
 * Flipping against these bounds instead puts the panel above its trigger
 * where the room below has run out, so it lies inside the visible box and
 * nothing scrolls. With no clipping ancestor the bounds *are* the viewport,
 * so every menu outside a scrolling panel is decided exactly as before.
 */
export function boundsOf(
  clipper: PlacementBox | undefined,
  viewport: { width: number; height: number },
): PlacementBounds {
  const bounds = { left: 0, top: 0, right: viewport.width, bottom: viewport.height }
  if (clipper === undefined) return bounds
  return {
    left: Math.max(bounds.left, clipper.left),
    top: Math.max(bounds.top, clipper.top),
    right: Math.min(bounds.right, clipper.right),
    bottom: Math.min(bounds.bottom, clipper.bottom),
  }
}

/**
 * A flip is offered only when the other side genuinely has the room — and
 * "the other side" is not the same edge for the two kinds of panel, which is
 * the defect this replaces. Each formula comes from where `Menu.css`
 * actually puts a flipped panel:
 *
 * - a **root** panel sits at `left: 0` of its anchor and flips to `right: 0`,
 *   so its flipped left edge is `anchor.right - width`;
 * - a **submenu** sits at `left: 100%` (its left edge on the anchor's right)
 *   and flips to `right: 100%` (its *right* edge on the anchor's *left*), so
 *   its flipped left edge is `anchor.left - width`.
 *
 * The original rule used the root's formula for both, overstating a
 * submenu's room by the anchor's own width — so a submenu near the left of
 * the window could flip and still overflow, the exact failure the flip
 * exists to prevent.
 *
 * Vertically both flip to `bottom: 100%`, so one rule covers them.
 *
 * With no anchor to measure (a detached panel) there is no room to check, so
 * the overflow alone decides on both axes. Preserved from the original rule
 * rather than reconsidered: nothing renders such a panel, and changing it
 * here would be a silent behaviour change riding along with #430's fix.
 *
 * `bounds` is where the panel may be drawn — the viewport, or the tighter
 * box a clipping ancestor leaves (`boundsOf`, #416). Passing the viewport's
 * own bounds reproduces the original rule exactly.
 */
export function placementFor(
  panel: PlacementBox,
  anchor: PlacementBox | undefined,
  bounds: PlacementBounds,
  submenu: boolean,
): Placement {
  const flippedLeft =
    anchor === undefined ? bounds.left : (submenu ? anchor.left : anchor.right) - panel.width
  return {
    end: panel.right > bounds.right && flippedLeft >= bounds.left,
    up:
      panel.bottom > bounds.bottom &&
      (anchor === undefined || anchor.top - panel.height >= bounds.top),
  }
}
