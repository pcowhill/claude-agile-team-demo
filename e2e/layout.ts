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
 *
 * **Measure on a populated project (#549).** A panel's overflow is a
 * function of its content, so every one of these reads zero on an empty
 * app whatever the viewport: #534 (the editor's panels 109px past the
 * column at 360px, with three slates on the timeline) and #545 (the
 * library's list 24px past its panel at 1280×720, with 14 clips) were both
 * swept at zero on an empty project first. Put clips in the library and
 * rows on the timeline — whatever the panel under test holds — before
 * calling any of these; `app-fit.spec.ts` shows the shape.
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
 *
 * **The editor column is measured too (#534).** #524 made `.app-main` its
 * own scroll container, and a box with `overflow-y: auto` computes
 * `overflow-x` to `auto` as well — so a panel wider than the column now
 * scrolls *the column* sideways while the page reads zero. Measured at
 * 360×640 with three slates on the timeline: page overflow 0, column
 * overflow 133px, every panel 109px past the column's right edge. The
 * page-level check above had quietly stopped covering the editor, the same
 * shape as #524 itself (a horizontal assertion and no vertical one). So the
 * one shared assertion measures whichever box actually scrolls: the page,
 * and the column when it exists. Callers change nothing.
 *
 * The column's 1px tolerance is the vertical twin's: `scrollWidth` is an
 * integer and a sub-pixel content edge rounds up, so an exact comparison
 * rejects a column that fits. A real over-run is a panel — the 109px above.
 */
export async function expectNoHorizontalScroll(page: Page, when = ''): Promise<void> {
  const { scrollWidth, clientWidth, innerWidth, column } = await page.evaluate(() => {
    const main = document.querySelector('main')
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      column:
        main === null ? null : { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth },
    }
  })
  const where = `at a ${innerWidth}px viewport${when ? ` (${when})` : ''}`
  expect(
    scrollWidth,
    `page scrollWidth ${scrollWidth}px exceeds clientWidth ${clientWidth}px ${where}`,
  ).toBeLessThanOrEqual(clientWidth)
  if (column !== null) {
    expect(
      column.scrollWidth,
      `the editor column's scrollWidth ${column.scrollWidth}px exceeds its clientWidth ` +
        `${column.clientWidth}px ${where} — a panel is wider than the column (#534)`,
    ).toBeLessThanOrEqual(column.clientWidth + 1)
  }
}

/**
 * The page lays out within its viewport instead of scrolling *down* (#524's
 * guard, and the half of #347 that was missing).
 *
 * `expectNoHorizontalScroll` above existed and this did not, so every recent
 * UI PR asserted the app did not overflow sideways — because that is the
 * assertion that existed — and none asserted it fitted down the page. The
 * guide panel shipped `max-height: 100vh` under a header (#478) and CI was
 * green; the customer found it (#519) and measured the over-run themselves.
 * A shared assertion is what stops the next full-height surface depending on
 * a session remembering.
 *
 * Measured against `clientHeight` for the same reason as its horizontal
 * twin: it excludes a horizontal scrollbar, which is the height content
 * actually has to fit into.
 *
 * The 1px tolerance is sub-pixel layout, not slack: `scrollHeight` is an
 * integer and `100dvh` on an odd viewport height rounds, so an exact
 * comparison rejects a shell that fits. A real over-run is a control, a row
 * or a panel — tens of pixels, and the header-height 92px in #524's case.
 */
export async function expectNoVerticalPageScroll(page: Page, when = ''): Promise<void> {
  const { scrollHeight, clientHeight, innerHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    innerHeight: window.innerHeight,
  }))
  expect(
    scrollHeight,
    `page scrollHeight ${scrollHeight}px exceeds clientHeight ${clientHeight}px ` +
      `at a ${innerHeight}px viewport${when ? ` (${when})` : ''}`,
  ).toBeLessThanOrEqual(clientHeight + 1)
}

/**
 * The element's bottom edge is at or above the bottom of the window (#524).
 *
 * Distinct from `expectWithin` because the container is the viewport rather
 * than another box, and from `toBeInViewport`, which passes on any
 * intersection at all — a panel hanging a header's height below the fold
 * intersects the viewport perfectly well, and that is exactly the defect
 * this names.
 */
export async function expectBottomWithinViewport(
  locator: Locator,
  page: Page,
  what = 'element',
): Promise<void> {
  const box = await boxOf(locator, what)
  const innerHeight = await page.evaluate(() => window.innerHeight)
  const bottom = box.y + box.height
  expect(
    bottom,
    `${what} ends ${Math.round(bottom)}px down a ${innerHeight}px window ` +
      `(top ${Math.round(box.y)}px, height ${Math.round(box.height)}px)`,
  ).toBeLessThanOrEqual(innerHeight + 1)
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

/**
 * Every element of a locator lays its text on one line (no mid-word wrap),
 * and there is at least one element to check. Moved here from
 * `user-guide.spec.ts` when the Trim window's buttons needed it too (#707).
 *
 * Counted as the lines its **text** occupies: each text node's client rects,
 * in order of their tops. A rect starts a new line when its top is more than
 * half a glyph box (the larger of its own height and the line's first
 * rect's) below the current line's top. So one line holding text of two
 * sizes, or a fallback glyph whose box sits a few px higher, is still one
 * line, while a wrapped line's top lies about a line advance lower.
 *
 * The rule is on tops, not on the previous line's bottom (#884). At
 * `line-height: 1` a glyph box is taller than the line advance: the library
 * header's 13.3px buttons draw 15px boxes, so a wrapped label's second line
 * starts 1.7px *above* the first line's bottom. Grouping by vertical
 * overlap, as this helper first did, counted that as one line, and every
 * caller measuring a `line-height: 1` control could not fail.
 *
 * Neither earlier measure could see a wrap everywhere (#603):
 * - `scrollWidth <= clientWidth` compares boxes, and wrapped text fits its
 *   box. On the inline Contents links it also read `0 <= 0` in Chromium,
 *   which defines neither for an inline box (#586).
 * - `getClientRects().length` counts an element's own boxes. An inline link
 *   gets one per line, but a block-level element gets one however many lines
 *   its text takes, and the shortcut table's `<kbd>`s are flex items, which
 *   are blockified. Made to wrap onto three lines, every combo still read 1.
 *
 * The first element is awaited before the list is read: `all()` does not
 * wait, and straight after the guide opens the Contents can hold 0 links, a
 * loop over which asserts nothing.
 */
export async function expectNoWrap(items: Locator, what: string) {
  await expect(items.first(), `no ${what} to check`).toBeVisible()
  for (const item of await items.all()) {
    const layout = await item.evaluate((node) => {
      const rects: DOMRect[] = []
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        range.selectNodeContents(text)
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push(rect)
      }
      rects.sort((a, b) => a.top - b.top)
      let lines = 0
      let lineTop = -Infinity
      let lineHeight = 0
      for (const rect of rects) {
        // A rect more than half a glyph box below the current line's top
        // starts a new line (#884): see the doc comment.
        if (rect.top > lineTop + Math.max(rect.height, lineHeight) / 2) {
          lines++
          lineTop = rect.top
          lineHeight = rect.height
        }
      }
      return { lines, text: node.textContent }
    })
    expect(layout.lines, `${what} "${layout.text}" wraps onto more than one line`).toBe(1)
  }
}

/**
 * Adjacent controls share one height, with their tops and bottoms aligned
 * (#792, from the customer's #787). `controls` matches the cluster's
 * buttons — for a `Menu`, its `.menu-trigger`, not the wrapper. Returns the
 * shared height, so a caller can check that something which should not
 * change it (a taller glyph font) did not.
 *
 * A button with no height of its own is as tall as the line box of the
 * font that draws its glyph, and glyphs such as ▶ ⋯ ✕ come from fallback
 * symbol or emoji fonts that differ by platform (#470/#472) — so a
 * cluster that lines up on CI's fonts need not on the customer's. Callers
 * also measure under an injected style that enlarges the glyphs, which is
 * what a taller platform font does to the line box.
 *
 * All the boxes come from one page read, so they describe one layout.
 * The 1px tolerance is for sub-pixel rem heights rounding differently at
 * different offsets; a misalignment the eye catches is several pixels.
 */
export async function expectAlignedRow(controls: Locator, what: string): Promise<number> {
  await expect(controls.first(), `no ${what} to check`).toBeVisible()
  const boxes = await controls.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { label: node.getAttribute('aria-label') ?? node.textContent, top: rect.top, bottom: rect.bottom, height: rect.height }
    }),
  )
  expect(boxes.length, `${what}: fewer than two controls to align`).toBeGreaterThan(1)
  const [first, ...rest] = boxes
  for (const box of rest) {
    const where = `${what}: ${JSON.stringify(box)} against ${JSON.stringify(first)}`
    expect(Math.abs(box.height - first.height), `${where}: heights differ`).toBeLessThanOrEqual(1)
    expect(Math.abs(box.top - first.top), `${where}: tops differ`).toBeLessThanOrEqual(1)
    expect(Math.abs(box.bottom - first.bottom), `${where}: bottoms differ`).toBeLessThanOrEqual(1)
  }
  return first.height
}

/**
 * `expectAlignedRow` for a cluster that wraps (#793): the controls are
 * grouped into the lines they actually occupy, and each line of two or
 * more is held to the same rule — one height, tops and bottoms within a
 * pixel. Across lines, every control shares that one height too, since a
 * cluster's height belongs to its rule rather than to whichever line a
 * control wrapped onto. Returns the shared height.
 *
 * Two controls are on one line when their boxes overlap vertically. A
 * misaligned pair still overlaps (that is what makes it look wrong), so
 * misalignment cannot hide by splitting a line; wrapped lines are
 * separated by the row's gap and do not overlap.
 *
 * Controls inside an open menu panel, and controls with no box (hidden),
 * are not part of the cluster. All the boxes come from one page read.
 */
export async function expectAlignedLines(controls: Locator, what: string): Promise<number> {
  await expect(controls.first(), `no ${what} to check`).toBeVisible()
  const boxes = await controls.evaluateAll((nodes) =>
    nodes
      .filter((node) => node.closest('[role="menu"]') === null)
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          label: node.getAttribute('aria-label') ?? node.textContent,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          width: rect.width,
        }
      })
      .filter((box) => box.width > 0 && box.height > 0),
  )
  expect(boxes.length, `${what}: fewer than two controls to align`).toBeGreaterThan(1)
  const lines: { top: number; bottom: number; boxes: typeof boxes }[] = []
  for (const box of [...boxes].sort((a, b) => a.top - b.top)) {
    const line = lines.find((l) => box.top < l.bottom && box.bottom > l.top)
    if (line === undefined) {
      lines.push({ top: box.top, bottom: box.bottom, boxes: [box] })
    } else {
      line.boxes.push(box)
      line.top = Math.min(line.top, box.top)
      line.bottom = Math.max(line.bottom, box.bottom)
    }
  }
  const [first] = boxes
  for (const [index, line] of lines.entries()) {
    const [lead, ...rest] = line.boxes
    for (const box of rest) {
      const where = `${what}, line ${index + 1}: ${JSON.stringify(box)} against ${JSON.stringify(lead)}`
      expect(Math.abs(box.top - lead.top), `${where}: tops differ`).toBeLessThanOrEqual(1)
      expect(Math.abs(box.bottom - lead.bottom), `${where}: bottoms differ`).toBeLessThanOrEqual(1)
    }
    for (const box of line.boxes) {
      const where = `${what}, line ${index + 1}: ${JSON.stringify(box)} against ${JSON.stringify(first)}`
      expect(Math.abs(box.height - first.height), `${where}: heights differ`).toBeLessThanOrEqual(1)
    }
  }
  return first.height
}
