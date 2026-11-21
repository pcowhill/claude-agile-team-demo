import { describe, expect, it } from 'vitest'
import { placementBounds, placementFor } from './menuPlacement'
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

const viewport = { left: 0, top: 0, right: 1000, bottom: 800 }

describe('bounds that are not the whole window (#653)', () => {
  // The customer's host page at 1280×720: an 80px header above the app and
  // a 60px footer below it (#651/#652), so the app spans y 80 → 660.
  const app = box(0, 80, 1280, 580)
  const bounds = placementBounds({ width: 1280, height: 720 }, app)

  it('narrows the window to the app’s box', () => {
    expect(bounds).toEqual({ left: 0, top: 80, right: 1280, bottom: 660 })
  })

  it('flips up a panel that fits the window but would pass the app’s bottom', () => {
    // The + Effect trigger near the app's bottom: the panel ends at 700,
    // inside the window (720) and under the footer (660).
    const anchor = box(60, 560, 90, 24)
    const panel = box(60, 588, 220, 112)
    expect(placementFor(panel, anchor, { left: 0, top: 0, right: 1280, bottom: 720 }, false).up).toBe(false)
    expect(placementFor(panel, anchor, bounds, false).up).toBe(true)
  })

  it('does not flip up into the host’s header: the room above counts from the app’s top', () => {
    // A panel 100 tall that passes the bottom (250) needs 100 above its
    // anchor: the window has 150 there, the app only 70.
    const anchor = box(60, 150, 90, 24)
    const panel = box(60, 178, 220, 100)
    expect(placementFor(panel, anchor, { left: 0, top: 0, right: 1280, bottom: 250 }, false).up).toBe(true)
    expect(placementFor(panel, anchor, { left: 0, top: 80, right: 1280, bottom: 250 }, false).up).toBe(false)
  })

  it('flips to the end against the app’s right, and only when the app has the room on the left', () => {
    const narrowApp = placementBounds({ width: 1280, height: 720 }, box(100, 0, 800, 720))
    expect(narrowApp).toEqual({ left: 100, top: 0, right: 900, bottom: 720 })
    const anchor = box(700, 40, 80, 24)
    expect(placementFor(box(700, 68, 250, 200), anchor, narrowApp, false).end).toBe(true)
    // Flipped, its left edge would be 780 − 700 = 80: outside the app's 100.
    expect(placementFor(box(700, 68, 700, 200), anchor, narrowApp, false).end).toBe(false)
  })

  it('is the window when there is no app box, or when the app lies wholly outside it', () => {
    const whole = { left: 0, top: 0, right: 1280, bottom: 720 }
    expect(placementBounds({ width: 1280, height: 720 }, undefined)).toEqual(whole)
    expect(placementBounds({ width: 1280, height: 720 }, box(0, -900, 1280, 580))).toEqual(whole)
    // An app taller than the window is cut to the window, as on GitHub Pages.
    expect(placementBounds({ width: 1280, height: 720 }, box(0, -10, 1280, 900))).toEqual(whole)
  })
})

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
      const narrow = { left: 0, top: 0, right: 200, bottom: 800 }
      // 160 - 300 = -140 < 0: flipping would overflow the other way.
      expect(placementFor(panel, anchor, narrow, false).end).toBe(false)
    })

    it('slides a panel that fits on neither side until its right edge meets the bound (#831)', () => {
      // Frame ▾ in CI's Firefox at 360px: the trigger at 108.6 → 171.7, the
      // panel about 269.6 wide. Natural, it ends at 378.2; flipped, it would
      // start at 171.7 − 269.6 < 0.
      const anchor = box(108.6, 40, 63.1, 24)
      const panel = box(108.6, 68, 269.6, 200)
      const window360 = { left: 0, top: 0, right: 360, bottom: 800 }
      const placement = placementFor(panel, anchor, window360, false)
      expect(placement.end).toBe(false)
      expect(placement.shift).toBeCloseTo(360 - 269.6 - 108.6, 6)
      expect(panel.left + placement.shift!).toBeCloseTo(360 - 269.6, 6)
    })

    it('slides a panel wider than the bounds only as far as the left bound (#831)', () => {
      const anchor = box(60, 40, 100, 24)
      const panel = box(60, 68, 300, 100)
      const narrow = { left: 20, top: 0, right: 200, bottom: 800 }
      // Right-aligned it would start at −100; the left bound (20) wins.
      expect(placementFor(panel, anchor, narrow, false).shift).toBe(20 - 60)
    })

    it('does not slide a panel that fits, or one a flip already fits (#831)', () => {
      const anchor = box(100, 40, 80, 24)
      expect(placementFor(box(100, 68, 200, 300), anchor, viewport, false).shift).toBeUndefined()
      const flipping = placementFor(box(880, 68, 200, 300), box(880, 40, 100, 24), viewport, false)
      expect(flipping).toEqual({ end: true, up: false })
      expect('shift' in flipping).toBe(false)
    })

    it('flips at exactly zero room, the boundary being inclusive', () => {
      const anchor = box(100, 40, 100, 24) // right edge 200
      const panel = box(100, 68, 200, 100) // 200 - 200 = 0
      const narrow = { left: 0, top: 0, right: 250, bottom: 800 }
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
      const narrow = { left: 0, top: 0, right: 900, bottom: 800 } // overflows by 80
      // 600 - 220 = 380 >= 0: genuinely room.
      expect(placementFor(panel, anchor, narrow, true).end).toBe(true)
    })

    it('refuses the flip the old rule allowed, when only the anchor’s width made it look possible', () => {
      // The regression case. anchor.left - width is negative (no room), but
      // anchor.right - width is positive, so the pre-#430 rule flipped here
      // and the submenu overflowed the left edge instead of the right.
      const anchor = box(150, 100, 200, 28) // left 150, right 350
      const panel = box(350, 100, 250, 200) // right edge 600
      const narrow = { left: 0, top: 0, right: 500, bottom: 800 } // overflows by 100
      expect(anchor.right - panel.width).toBeGreaterThanOrEqual(0) // the old rule said yes
      expect(anchor.left - panel.width).toBeLessThan(0) // the truth says no
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })

    it('never slides, even where a root panel would (#831)', () => {
      const anchor = box(60, 40, 100, 24)
      const panel = box(160, 40, 300, 100)
      const narrow = { left: 0, top: 0, right: 300, bottom: 800 }
      expect(placementFor(panel, anchor, narrow, true)).toEqual({ end: false, up: false })
      expect('shift' in placementFor(panel, anchor, narrow, true)).toBe(false)
    })

    it('decides the same panel differently depending on which kind it is', () => {
      // One box, one anchor, one viewport: only `submenu` differs. This is
      // the whole of #430 in a single assertion.
      const anchor = box(150, 100, 200, 28)
      const panel = box(350, 100, 250, 200)
      const narrow = { left: 0, top: 0, right: 500, bottom: 800 }
      expect(placementFor(panel, anchor, narrow, false).end).toBe(true)
      expect(placementFor(panel, anchor, narrow, true).end).toBe(false)
    })
  })

  describe('vertical flipping is the same rule for both kinds', () => {
    it('flips up when the space above the anchor fits the panel', () => {
      const anchor = box(100, 400, 120, 24) // top 400
      const panel = box(100, 428, 200, 300) // bottom 728
      const short = { left: 0, top: 0, right: 1000, bottom: 700 } // overflows by 28
      // 400 - 300 = 100 >= 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(true)
      expect(placementFor(panel, anchor, short, true).up).toBe(true)
    })

    it('does not flip up when the panel is taller than the space above', () => {
      const anchor = box(100, 120, 120, 24)
      const panel = box(100, 148, 200, 300)
      const short = { left: 0, top: 0, right: 1000, bottom: 400 }
      // 120 - 300 = -180 < 0.
      expect(placementFor(panel, anchor, short, false).up).toBe(false)
    })

    it('flips both ways at once when both overflow and both have room', () => {
      const anchor = box(800, 500, 120, 24)
      const panel = box(800, 528, 200, 300)
      const small = { left: 0, top: 0, right: 900, bottom: 700 }
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
