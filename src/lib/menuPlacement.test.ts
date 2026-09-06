import { describe, expect, it } from 'vitest'
import { placementFor } from './menuPlacement'
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

const viewport = { width: 1000, height: 800 }

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
      const narrow = { width: 200, height: 800 }
      // 160 - 300 = -140 < 0: flipping would overflow the other way.
      expect(placementFor(panel, anchor, narrow, false).end).toBe(false)
    })

    it('flips at exactly zero room, the boundary being inclusive', () => {
      const anchor = box(100, 40, 100, 24) // right edge 200
      const panel = box(100, 68, 200, 100) // 200 - 200 = 0
      const narrow = { width: 250, height: 800 }
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
      const narrow = { width: 900, height: 800 } // overflows by 80
      // 600 - 220 = 380 >= 0: genuinely room.
      expect(placementFor(panel, anchor, narrow, true).end).toBe(true)
    })

    it('refuses the flip the old rule allowed, when only the anchor’s width made it look possible', () => {
      // The regression case. anchor.left - width is negative (no room), but
      // anchor.right - width is positive, so the pre-#430 rule flipped here
      // and the submenu overflowed the left edge instead of the right.
      const anchor = box(150, 100, 200, 28) // left 150, right 350
      const panel = box(350, 100, 250, 200) // right edge 600
      const narrow = { width: 500, height: 800 } // overflows by 100
      expect(anchor.right - panel.width).toBeGreaterThanOrEqual(0) // the old rule said yes
      expect(anchor.left - panel.width).toBeLessThan(0) // the truth says no
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })

    it('decides the same panel differently depending on which kind it is', () => {
      // One box, one anchor, one viewport: only `submenu` differs. This is
      // the whole of #430 in a single assertion.
      const anchor = box(150, 100, 200, 28)
      const panel = box(350, 100, 250, 200)
      const narrow = { width: 500, height: 800 }
      expect(placementFor(panel, anchor, narrow, false).end).toBe(true)
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })
  })

  describe('vertical flipping is the same rule for both kinds', () => {
    it('flips up when the space above the anchor fits the panel', () => {
      const anchor = box(100, 400, 120, 24) // top 400
      const panel = box(100, 428, 200, 300) // bottom 728
      const short = { width: 1000, height: 700 } // overflows by 28
      // 400 - 300 = 100 >= 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(true)
      expect(placementFor(panel, anchor, short, true).up).toBe(true)
    })

    it('does not flip up when the panel is taller than the space above', () => {
      const anchor = box(100, 120, 120, 24)
      const panel = box(100, 148, 200, 300)
      const short = { width: 1000, height: 400 }
      // 120 - 300 = -180 < 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(false)
    })

    it('flips both ways at once when both overflow and both have room', () => {
      const anchor = box(800, 500, 120, 24)
      const panel = box(800, 528, 200, 300)
      const small = { width: 900, height: 700 }
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
