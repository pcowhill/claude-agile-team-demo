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
 */
export function placementFor(
  panel: PlacementBox,
  anchor: PlacementBox | undefined,
  viewport: { width: number; height: number },
  submenu: boolean,
): Placement {
  const flippedLeft =
    anchor === undefined ? 0 : (submenu ? anchor.left : anchor.right) - panel.width
  return {
    end: panel.right > viewport.width && flippedLeft >= 0,
    up: panel.bottom > viewport.height && (anchor === undefined || anchor.top - panel.height >= 0),
  }
}
