/**
 * Where a menu panel that would leave the viewport — or, embedded in a host
 * page, the app's part of it (#653) — goes instead (#430, from the shared
 * `Menu` of #412).
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
  /**
   * Slide a root panel this many pixels along x from its natural place
   * (#831) — present, and negative, only when the panel fits the bounds but
   * on neither side of its anchor. Absent otherwise, so every placement
   * that needed no slide reads exactly as it did before.
   */
  shift?: number
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
 * The box a panel must stay inside, in viewport coordinates (#653). The
 * window's own box on a page that is only the app; the part of the window
 * the app occupies when a host page puts a header and footer around it
 * (#652), so a panel near the app's bottom flips up rather than opening
 * under the host's footer. `Menu.tsx` measures it.
 */
export interface PlacementBounds {
  left: number
  top: number
  right: number
  bottom: number
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
  bounds: PlacementBounds,
  submenu: boolean,
): Placement {
  const flippedLeft =
    anchor === undefined ? bounds.left : (submenu ? anchor.left : anchor.right) - panel.width
  const overflowsRight = panel.right > bounds.right
  const end = overflowsRight && flippedLeft >= bounds.left
  const up =
    panel.bottom > bounds.bottom &&
    (anchor === undefined || anchor.top - panel.height >= bounds.top)
  // Neither side of the anchor has the room, but the bounds may (#831): a
  // 270px Frame ▾ under a trigger at 109 → 172 in a 360px window overflowed
  // by 18px on its natural side and by 98px flipped, while fitting the
  // window with 90px to spare. Slide it left just far enough that its right
  // edge meets the bound — and never past the left bound, so a panel wider
  // than the bounds keeps its start (its labels' beginnings) in view. Root
  // panels only: a submenu slid under its parent would cover the item that
  // opened it, and no submenu is wide enough to need this.
  if (!submenu && anchor !== undefined && overflowsRight && !end) {
    const left = Math.max(bounds.left, bounds.right - panel.width)
    if (left < panel.left) return { end, up, shift: left - panel.left }
  }
  return { end, up }
}

/**
 * The bounds a panel flips against: the window, narrowed to the app's own
 * box when the app does not fill it (#653). Pure, so the intersection is
 * pinned by unit tests; `Menu.tsx` supplies the two measured boxes.
 *
 * An app box that does not overlap the window at all — scrolled clean off a
 * host page — leaves nothing to intersect, and the window alone is used
 * rather than an empty box that no panel could ever fit.
 */
export function placementBounds(
  viewport: { width: number; height: number },
  app: PlacementBox | undefined,
): PlacementBounds {
  const whole = { left: 0, top: 0, right: viewport.width, bottom: viewport.height }
  if (app === undefined) return whole
  const left = Math.max(whole.left, app.left)
  const top = Math.max(whole.top, app.top)
  const right = Math.min(whole.right, app.right)
  const bottom = Math.min(whole.bottom, app.bottom)
  return right > left && bottom > top ? { left, top, right, bottom } : whole
}
