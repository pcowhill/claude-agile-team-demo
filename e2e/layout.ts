import { expect } from '@playwright/test'

type Locator = import('@playwright/test').Locator
type Page = import('@playwright/test').Page

/**
 * Shared rendered-layout assertions for the browser specs (#347).
 *
 * `development.md` asks a UI-affecting change for geometry a browser can
 * measure, because jsdom has no layout — two visible defects reached the
 * customer under green CI for want of exactly that (#268/#270, #287/#289).
 * The same claims kept being hand-written at each site, and the
 * horizontal-scroll one was copied verbatim between specs, so the checks
 * live here once. Each says what it measures and why any tolerance exists;
 * a spec that needs something else should still measure it inline rather
 * than bend one of these.
 *
 * These are assertions, not predicates: each throws through Playwright's
 * `expect` with the measured numbers in the message, so a failure names the
 * geometry rather than saying `false !== true`.
 */

/** A locator's box, failing loudly rather than returning null. */
async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox()
  expect(box, `${what} has no bounding box — not rendered?`).not.toBeNull()
  return box!
}

/**
 * The page lays out within its viewport instead of scrolling sideways
 * (#208's guard). `documentElement.scrollWidth` counts every overflowing
 * descendant, so this catches any panel's min-content floor widening the
 * grid, not just the one a spec is looking at.
 *
 * Measured against `clientWidth`, not `window.innerWidth`: `clientWidth`
 * excludes the vertical scrollbar, which is the width content actually has
 * to fit into. Using `innerWidth` would let an overflow narrower than the
 * scrollbar pass unnoticed.
 */
export async function expectNoHorizontalScroll(page: Page, when = ''): Promise<void> {
  const { scrollWidth, clientWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    scrollWidth,
    `page scrollWidth ${scrollWidth}px exceeds clientWidth ${clientWidth}px ` +
      `at a ${innerWidth}px viewport${when ? ` (${when})` : ''}`,
  ).toBeLessThanOrEqual(clientWidth)
}

/**
 * The child's box lies inside the container's — the check that fails when a
 * dialog's content hangs outside it (#268).
 *
 * `tolerance` defaults to 1px and is not decoration: sub-pixel layout and a
 * 1px border routinely put an edge a fraction outside a parent that visibly
 * contains it, and an exact comparison turns that into a false failure. Say
 * why in the calling spec if a larger one is needed.
 *
 * `axis` exists because the interesting containment is often one-dimensional
 * — a picker overflowing a dialog sideways while the dialog scrolls
 * vertically on purpose, so asserting the vertical edges too would fail on
 * correct layout.
 */
export async function expectWithin(
  child: Locator,
  container: Locator,
  options: { tolerance?: number; axis?: 'both' | 'x' | 'y'; what?: string } = {},
): Promise<void> {
  const { tolerance = 1, axis = 'both', what = 'element' } = options
  const inner = await boxOf(child, what)
  const outer = await boxOf(container, 'container')
  const where = `${what} ${JSON.stringify(inner)} vs container ${JSON.stringify(outer)}`

  if (axis !== 'y') {
    expect(inner.x, `${where}: left edge outside`).toBeGreaterThanOrEqual(outer.x - tolerance)
    expect(inner.x + inner.width, `${where}: right edge outside`).toBeLessThanOrEqual(
      outer.x + outer.width + tolerance,
    )
  }
  if (axis !== 'x') {
    expect(inner.y, `${where}: top edge outside`).toBeGreaterThanOrEqual(outer.y - tolerance)
    expect(inner.y + inner.height, `${where}: bottom edge outside`).toBeLessThanOrEqual(
      outer.y + outer.height + tolerance,
    )
  }
}

/**
 * The child fills the container's box rather than sitting in a corner of it
 * — "the card shows the media, it does not merely contain it" (#311).
 *
 * A ratio rather than an exact match, and this is the tolerance the rule in
 * `development.md` warns about specifically: an absolutely positioned
 * `inset: 0` child fills its parent's *padding* box, so with a 1px border it
 * is a couple of pixels shorter than the border box `boundingBox()` reports.
 * `toBeCloseTo` on raw pixels is the wrong instrument — it either rejects
 * correct layout or, loosened enough to accept it, stops distinguishing a
 * covering child from a slightly-inset one at any realistic size. A ratio
 * scales with the box.
 */
export async function expectCovers(
  child: Locator,
  container: Locator,
  options: { minRatio?: number; what?: string } = {},
): Promise<void> {
  const { minRatio = 0.98, what = 'element' } = options
  const inner = await boxOf(child, what)
  const outer = await boxOf(container, 'container')

  expect(
    inner.width / outer.width,
    `${what} covers ${inner.width}px of its container's ${outer.width}px width`,
  ).toBeGreaterThan(minRatio)
  expect(
    inner.height / outer.height,
    `${what} covers ${inner.height}px of its container's ${outer.height}px height`,
  ).toBeGreaterThan(minRatio)
  // Anchored at the same corner, so a child that is the right size but
  // offset does not pass on ratios alone.
  expect(inner.x, `${what} left edge`).toBeCloseTo(outer.x, 0)
  expect(inner.y, `${what} top edge`).toBeCloseTo(outer.y, 0)
}
