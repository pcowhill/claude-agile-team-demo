import { describe, expect, it } from 'vitest'
import { boundsOf, placementFor } from './menuPlacement'
import type { PlacementBox } from './menuPlacement'

/**
 * The flip decision (#430). These are the cases the browser cannot be asked
 * about cheaply and jsdom cannot be asked about at all — jsdom reports
 * zero-size boxes, so the effect early-returns and never reaches this.
 * `e2e/menu.spec.ts` asserts the rendered outcome; this pins the rule.
 */

/** A box from a left edge and a size, the way CSS positions one. */
const box = (left: number, top: number, width: number, height: number): PlacementBox => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

// Every case below is a menu with no clipping ancestor, so its bounds are
// the viewport's — `boundsOf(undefined, …)` says exactly that, and the
// numbers are unchanged from before the bounds existed (#416).
const viewport = boundsOf(undefined, { width: 1000, height: 800 })

describe('placementFor (#430)', () => {
  it('leaves a panel that fits where it is', () => {
    const anchor = box(100, 40, 80, 24)
    const panel = box(100, 68, 200, 300)
    expect(placementFor(panel, anchor, viewport, false)).toEqual({ end: false, up: false })
  })

  describe('a root panel flips against its anchor’s right edge', () => {
    // Natural: left: 0 of the anchor. Flipped: right: 0 of the anchor, so the
    // flipped left edge is anchor.right - width.
    it('flips when the room left of the anchor’s right edge fits it', () => {
      const anchor = box(880, 40, 100, 24) // right edge 980
      const panel = box(880, 68, 200, 300) // right edge 1080 — overflows
      // 980 - 200 = 780 >= 0, so there is room.
      expect(placementFor(panel, anchor, viewport, false).end).toBe(true)
    })

    it('does not flip when the flipped panel would leave the left edge', () => {
      const anchor = box(60, 40, 100, 24) // right edge 160
      const panel = box(60, 68, 300, 100)
      // Overflow only exists in a narrow viewport; use one.
      const narrow = boundsOf(undefined, { width: 200, height: 800 })
      // 160 - 300 = -140 < 0: flipping would overflow the other way.
      expect(placementFor(panel, anchor, narrow, false).end).toBe(false)
    })

    it('flips at exactly zero room, the boundary being inclusive', () => {
      const anchor = box(100, 40, 100, 24) // right edge 200
      const panel = box(100, 68, 200, 100) // 200 - 200 = 0
      const narrow = boundsOf(undefined, { width: 250, height: 800 })
      expect(placementFor(panel, anchor, narrow, false).end).toBe(true)
    })
  })

  describe('a submenu flips against its anchor’s left edge', () => {
    // Natural: left: 100% (panel left on the anchor's right). Flipped:
    // right: 100% (panel right on the anchor's LEFT), so the flipped left
    // edge is anchor.left - width — not anchor.right - width.
    it('flips when the room left of the anchor’s left edge fits it', () => {
      const anchor = box(600, 100, 160, 28) // left edge 600
      const panel = box(760, 100, 220, 200) // right edge 980
      const narrow = boundsOf(undefined, { width: 900, height: 800 }) // overflows by 80
      // 600 - 220 = 380 >= 0: genuinely room.
      expect(placementFor(panel, anchor, narrow, true).end).toBe(true)
    })

    it('refuses the flip the old rule allowed, when only the anchor’s width made it look possible', () => {
      // The regression case. anchor.left - width is negative (no room), but
      // anchor.right - width is positive, so the pre-#430 rule flipped here
      // and the submenu overflowed the left edge instead of the right.
      const anchor = box(150, 100, 200, 28) // left 150, right 350
      const panel = box(350, 100, 250, 200) // right edge 600
      const narrow = boundsOf(undefined, { width: 500, height: 800 }) // overflows by 100
      expect(anchor.right - panel.width).toBeGreaterThanOrEqual(0) // the old rule said yes
      expect(anchor.left - panel.width).toBeLessThan(0) // the truth says no
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })

    it('decides the same panel differently depending on which kind it is', () => {
      // One box, one anchor, one viewport: only `submenu` differs. This is
      // the whole of #430 in a single assertion.
      const anchor = box(150, 100, 200, 28)
      const panel = box(350, 100, 250, 200)
      const narrow = boundsOf(undefined, { width: 500, height: 800 })
      expect(placementFor(panel, anchor, narrow, false).end).toBe(true)
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })
  })

  describe('a clipping ancestor bounds the panel before the viewport does (#416)', () => {
    // The media library's clip list, to scale: `max-height: 50vh;
    // overflow-y: auto` (#308) in a 720px-tall window, sitting well inside
    // it. A row's ⋯ panel is 61px tall. Measured from the real thing: the
    // list's box was y 192 → 552 at 1280×720 with eight clips.
    const clipList = box(41, 192, 371, 360)
    const bounds = boundsOf(clipList, { width: 1280, height: 720 })

    it('narrows the viewport to the clipper it lies inside', () => {
      expect(bounds).toEqual({ left: 41, top: 192, right: 412, bottom: 552 })
    })

    it('never widens the viewport: a clipper hanging off-screen is cut to it', () => {
      // A scrolling box wider or taller than the window bounds the panel by
      // the window on those edges — the intersection, not the clipper.
      expect(boundsOf(box(-50, -20, 1400, 900), { width: 1280, height: 720 })).toEqual({
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
      })
    })

    it('flips a panel that overflows the list even though the window has room', () => {
      // A row near the list's bottom: the trigger at y 500, the panel below
      // it running to 585 — inside a 720px window, 33px past the list.
      const anchor = box(52, 500, 30, 24)
      const panel = box(52, 524, 144, 61)
      expect(placementFor(panel, anchor, bounds, false).up).toBe(true)
      // Without the clipper this is the case the old rule saw: no overflow,
      // no flip — and the browser scrolled the list instead.
      const viewportOnly = boundsOf(undefined, { width: 1280, height: 720 })
      expect(placementFor(panel, anchor, viewportOnly, false).up).toBe(false)
    })

    it('does not flip a panel the list still has room for', () => {
      const anchor = box(52, 240, 30, 24)
      const panel = box(52, 264, 144, 61)
      expect(placementFor(panel, anchor, bounds, false)).toEqual({ end: false, up: false })
    })

    it('leaves it alone when flipping up would leave the list at the top', () => {
      // The first row: there is nothing above it inside the box, so the
      // natural side stays the lesser evil — the same rule as the viewport's.
      const anchor = box(52, 200, 30, 24)
      const tall = box(52, 224, 144, 400)
      expect(placementFor(tall, anchor, bounds, false).up).toBe(false)
    })

    it('bounds the horizontal flip by the clipper too', () => {
      // A panel running past the list's right edge (412) with the window far
      // away: it flips, and only because the flipped left edge (anchor.right
      // − width = 400 − 144 = 256) still clears the list's left edge.
      const anchor = box(300, 240, 100, 24)
      const panel = box(300, 264, 144, 61)
      expect(placementFor(panel, anchor, bounds, false).end).toBe(true)
      // A panel wider than the room the flip would leave it does not flip
      // into the opposite overflow: 400 − 400 = 0, left of the list's 41.
      const wide = box(300, 264, 400, 61)
      expect(placementFor(wide, anchor, bounds, false).end).toBe(false)
    })
  })

  describe('vertical flipping is the same rule for both kinds', () => {
    it('flips up when the space above the anchor fits the panel', () => {
      const anchor = box(100, 400, 120, 24) // top 400
      const panel = box(100, 428, 200, 300) // bottom 728
      const short = boundsOf(undefined, { width: 1000, height: 700 }) // overflows by 28
      // 400 - 300 = 100 >= 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(true)
      expect(placementFor(panel, anchor, short, true).up).toBe(true)
    })

    it('does not flip up when the panel is taller than the space above', () => {
      const anchor = box(100, 120, 120, 24)
      const panel = box(100, 148, 200, 300)
      const short = boundsOf(undefined, { width: 1000, height: 400 })
      // 120 - 300 = -180 < 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(false)
    })

    it('flips both ways at once when both overflow and both have room', () => {
      const anchor = box(800, 500, 120, 24)
      const panel = box(800, 528, 200, 300)
      const small = boundsOf(undefined, { width: 900, height: 700 })
      expect(placementFor(panel, anchor, small, false)).toEqual({ end: true, up: true })
    })
  })

  it('without an anchor to measure, an overflow flips on either axis', () => {
    // A detached panel has no room to check against, so the overflow alone
    // decides. Preserved from the original rule rather than changed: nothing
    // renders one, and inventing a different answer here would be a silent
    // behaviour change riding along with #430's fix.
    const panel = box(900, 600, 200, 300)
    expect(placementFor(panel, undefined, viewport, false)).toEqual({ end: true, up: true })
    // …and a panel that fits still does not move.
    expect(placementFor(box(10, 10, 200, 300), undefined, viewport, false)).toEqual({
      end: false,
      up: false,
    })
  })
})
