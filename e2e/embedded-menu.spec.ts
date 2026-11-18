import { expect, test } from '@playwright/test'
import { embedBetweenHeaderAndFooter } from './embeddedHost'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { effectMenu, effectMenuTrigger } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Menus flip against the app's own box, not only the window (#653, from the
 * customer's #651). Embedded between a host page's header and footer (#652),
 * the window's bottom is the footer's bottom, so a menu opened near the
 * app's bottom edge passed the flip check against the window and opened
 * under the footer — the customer named a clip's **+ Effect ▾**.
 *
 * The trigger is placed, by scrolling the editor column, so that its panel
 * opened downward would end **between** the app's bottom and the window's:
 * the one band where the two rules disagree. Below it both flip; above it
 * neither needs to.
 */

const ROWS = 6
const slate = (n: number) => `Color slate at position ${n}`

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
  })

async function embeddedProject(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await embedBetweenHeaderAndFooter(page)
  for (let i = 0; i < ROWS; i += 1) await chooseFromAddMenu(page, ADD_SLATE)
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(ROWS)
}

/**
 * Scrolls the editor column so that `trigger`'s bottom edge lands at `y`,
 * and reports whether it could: the column only scrolls so far, so a row
 * near the top cannot be brought down past where it starts, nor the last
 * row up past where it ends.
 */
async function placeTriggerBottomAt(trigger: Locator, y: number): Promise<boolean> {
  return trigger.evaluate((target, y) => {
    const column = target.closest('main')!
    const want = column.scrollTop + (target.getBoundingClientRect().bottom - y)
    if (want < 0 || want > column.scrollHeight - column.clientHeight) return false
    column.scrollTop = want
    return Math.abs(target.getBoundingClientRect().bottom - y) <= 1
  }, y)
}

/** The natural (downward) panel's height and its gap under the trigger, measured where it fits. */
async function measurePanel(page: Page): Promise<{ height: number; gap: number }> {
  const position = slate(1)
  const trigger = effectMenuTrigger(page, position)
  expect(await placeTriggerBottomAt(trigger, 300), 'slate 1 placed with room below').toBe(true)
  await trigger.click()
  const menu = effectMenu(page, position)
  await expect(menu).toBeVisible()
  const panel = await boxOf(menu)
  const anchor = await boxOf(trigger)
  expect(panel.top, 'a trigger with room below opens downward').toBeGreaterThanOrEqual(anchor.bottom - 1)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return { height: panel.bottom - panel.top, gap: panel.top - anchor.bottom }
}

test('embedded, a + Effect menu that would end under the host’s footer opens upward, inside the app (#653)', async ({
  page,
}, testInfo) => {
  await embeddedProject(page)
  const app = await boxOf(page.locator('.app'))
  const windowHeight = await page.evaluate(() => window.innerHeight)
  expect(app.bottom, 'the app ends above the footer (#652)').toBeLessThan(windowHeight)

  const { height, gap } = await measurePanel(page)
  // Opened downward, the panel ends midway between the app's bottom and the
  // window's: past the app, inside the window.
  const naturalBottom = (app.bottom + windowHeight) / 2
  expect(naturalBottom - height, 'the band is reachable: the panel is shorter than the app').toBeGreaterThan(app.top)
  const triggerBottom = naturalBottom - height - gap

  // The last slate that the column can scroll to that spot.
  let position: string | undefined
  for (let n = ROWS; n >= 1 && position === undefined; n -= 1) {
    if (await placeTriggerBottomAt(effectMenuTrigger(page, slate(n)), triggerBottom)) {
      position = slate(n)
    }
  }
  expect(position, 'some slate’s + Effect can be scrolled to the band').toBeDefined()
  const trigger = effectMenuTrigger(page, position!)
  const anchor = await boxOf(trigger)

  await trigger.click()
  const menu = effectMenu(page, position!)
  await expect(menu).toBeVisible()
  // One read, after the layout effect has placed it (polled: the click
  // resolves on dispatch, not on React's commit — `quality-and-ci.md`).
  await expect
    .poll(async () => {
      const panel = await boxOf(menu)
      return {
        openedUpward: panel.top < anchor.top,
        insideAppVertically: panel.top >= app.top - 1 && panel.bottom <= app.bottom + 1,
        insideAppHorizontally: panel.left >= app.left - 1 && panel.right <= app.right + 1,
      }
    }, { message: `the + Effect menu of ${position} near the app's bottom edge` })
    .toEqual({ openedUpward: true, insideAppVertically: true, insideAppHorizontally: true })

  await page.screenshot({ path: testInfo.outputPath('embedded-effect-menu-flipped.png') })
})

test('embedded, a + Effect menu with room below inside the app still opens downward (#653)', async ({
  page,
}) => {
  await embeddedProject(page)
  // `measurePanel` opens slate 1's menu with its trigger at y = 300, far
  // above the footer, and asserts it opened downward.
  const { height } = await measurePanel(page)
  expect(height, 'the panel has a size').toBeGreaterThan(0)
})
