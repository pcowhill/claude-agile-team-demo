import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Whether an open menu panel is usable *where it is drawn* — the property
 * jsdom cannot see and containment against the viewport does not catch.
 *
 * Extracted from `library-menus.spec.ts` by #419 so the timeline's row ⋯ and
 * + Effect ▾ are held to the same bar as the library's; the checks and the
 * measurements below are #416's, moved verbatim.
 */

/** A box's scroll state, for reading before and after a menu opens. */
export const scrollBox = (list: Locator) =>
  list.evaluate((node) => ({ scrollHeight: node.scrollHeight, scrollTop: node.scrollTop }))

/**
 * The open panel is usable where it is drawn: anchored to its trigger;
 * inside the viewport; every item hit-testable at its own centre
 * (`elementFromPoint` resolves to the item, not to what a clipped panel
 * would leave showing through), with its label on one line; and the list's
 * scroll box exactly as it was before the menu opened — no scrollbar grown
 * to hold the panel, no jump to reveal it. Measured on the first cut of this
 * PR with two clips at 1280×720: the panel ran 17px past the list's box, the
 * list's `scrollHeight` went 77 → 94, and the centre of Remove hit the
 * section behind the menu.
 *
 * "Anchored" is not decoration: the panel is lifted out of the list with
 * `position: fixed` and placed by measurement, and a mis-measured panel
 * lands at the viewport's corner — inside the viewport, every item hittable,
 * nowhere near the row that opened it. It caught exactly that once.
 */
export async function expectMenuUsable(
  page: Page,
  list: Locator,
  trigger: Locator,
  menu: Locator,
  before: { scrollHeight: number; scrollTop: number },
  label: string,
): Promise<void> {
  expect(await scrollBox(list), `opening ⋯ changed the list's scroll box (${label})`).toEqual(
    before,
  )
  const view = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }))
  const box = (await menu.boundingBox())!
  expect(box.x, `panel left (${label})`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `panel right (${label})`).toBeLessThanOrEqual(view.width)
  expect(box.y, `panel top (${label})`).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, `panel bottom (${label})`).toBeLessThanOrEqual(view.height)
  // Anchored: the panel opens directly below its trigger, or directly above
  // it when flipped, and shares the trigger's left edge, or its right edge
  // when flipped. The panel's own 0.25rem gap plus a pixel of rounding is
  // the tolerance, so 8px.
  const anchor = (await trigger.boundingBox())!
  const belowGap = box.y - (anchor.y + anchor.height)
  const aboveGap = anchor.y - (box.y + box.height)
  expect(
    Math.min(Math.abs(belowGap), Math.abs(aboveGap)),
    `panel is not against its trigger: panel y ${box.y}–${box.y + box.height}, ` +
      `trigger y ${anchor.y}–${anchor.y + anchor.height} (${label})`,
  ).toBeLessThanOrEqual(8)
  expect(
    Math.min(Math.abs(box.x - anchor.x), Math.abs(box.x + box.width - (anchor.x + anchor.width))),
    `panel shares neither edge with its trigger: panel x ${box.x}–${box.x + box.width}, ` +
      `trigger x ${anchor.x}–${anchor.x + anchor.width} (${label})`,
  ).toBeLessThanOrEqual(1)
  for (const item of await menu.getByRole('menuitem').all()) {
    const text = await item.textContent()
    const hit = await item.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        ok: at !== null && node.contains(at),
        found: at === null ? 'nothing' : `${at.tagName.toLowerCase()}.${at.className}`,
        oneLine: node.scrollWidth <= node.clientWidth,
      }
    })
    expect(hit.ok, `"${text}" is not hittable at its centre — found ${hit.found} (${label})`).toBe(
      true,
    )
    expect(hit.oneLine, `"${text}" overflows its item (${label})`).toBe(true)
  }
}
