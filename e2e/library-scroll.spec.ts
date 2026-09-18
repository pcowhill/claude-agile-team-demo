import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { chooseView } from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { sineWav } from './sineWav'

/**
 * A bounded media library (#308): past a cap the clip list scrolls on its own
 * instead of pushing the timeline down the page, and the controls above the
 * list stay in place while it scrolls. With few clips nothing scrolls.
 */

const wavs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `clip-${String(from + i).padStart(2, '0')}.wav`,
    mimeType: 'audio/wav',
    buffer: sineWav(0.2),
  }))

/**
 * The gap between the items and the list's content edge (#460): the list's
 * `clientWidth` excludes its scrollbar, so this is exactly the space the
 * items leave beside it — the padding while the list scrolls, and nothing at
 * all when it does not. Measured from the rightmost item edge, because in
 * the card grid only the last column reaches the content edge; in the list
 * view every row does, and their right edges are asserted equal as well.
 */
async function gapBesideScrollbar(list: Locator): Promise<{ gap: number; spread: number }> {
  return list.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const contentRight = box.left + element.clientLeft + element.clientWidth
    const rights = Array.from(element.querySelectorAll(':scope > li')).map(
      (item) => item.getBoundingClientRect().right,
    )
    const grid = getComputedStyle(element).display === 'grid'
    return {
      gap: contentRight - Math.max(...rights),
      // Rows all end together; cards end where their column does.
      spread: grid ? 0 : Math.max(...rights) - Math.min(...rights),
    }
  })
}

/** The items stop a small distance short of the scrollbar (#460). */
async function expectGapBesideScrollbar(list: Locator, when: string) {
  const { gap, spread } = await gapBesideScrollbar(list)
  expect(gap, `gap ${gap}px beside the scrollbar ${when}`).toBeGreaterThanOrEqual(4)
  expect(gap, `gap ${gap}px beside the scrollbar ${when}`).toBeLessThanOrEqual(8)
  expect(spread, `rows end unevenly ${when}`).toBeLessThanOrEqual(1)
}

/** The items reach the list's content edge: no gap is reserved (#460). */
async function expectNoGapBesideScrollbar(list: Locator, when: string) {
  const { gap, spread } = await gapBesideScrollbar(list)
  expect(Math.abs(gap), `gap ${gap}px with no scrollbar ${when}`).toBeLessThanOrEqual(1)
  expect(spread, `rows end unevenly ${when}`).toBeLessThanOrEqual(1)
}

test('a large library scrolls internally and stops pushing the timeline down (#308)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')
  const list = page.getByRole('list', { name: 'Imported clips' })
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const importButton = page.getByRole('button', { name: 'Import clips' })
  const selectAll = page.getByRole('checkbox', { name: 'Select all' })

  await input.setInputFiles(wavs(1, 15))
  await expect(rows).toHaveCount(15)
  const timelineTopAt15 = (await timeline.boundingBox())!.y
  const importBoxAt15 = (await importButton.boundingBox())!
  const selectAllBoxAt15 = (await selectAll.boundingBox())!

  await input.setInputFiles(wavs(16, 15))
  await expect(rows).toHaveCount(30)

  // (a) The library stopped growing: the timeline did not move.
  expect((await timeline.boundingBox())!.y).toBe(timelineTopAt15)

  // (b) The list really scrolls.
  const metrics = () =>
    list.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
    }))
  const before = await metrics()
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)

  // (c) Scrolling the list to the bottom shows the last row and leaves the
  // controls above the list exactly where they were.
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(rows.last()).toBeInViewport()
  await expect(rows.first()).not.toBeInViewport()
  expect((await metrics()).scrollTop).toBeGreaterThan(0)
  expect(await importButton.boundingBox()).toEqual(importBoxAt15)
  expect(await selectAll.boundingBox()).toEqual(selectAllBoxAt15)
  await expect(importButton).toBeInViewport()
  await expect(selectAll).toBeInViewport()

  // (d) No horizontal page scroll with the scrollbar present (#208 guard).
  await expectNoHorizontalScroll(page, '30 clips, list scrolled to the bottom')

  // (e) A small, even gap between the rows and the scrollbar (#460, from
  // #457), in the list view and — the customer's screenshot — the card
  // grid, whose tracks recompute inside the narrower content box so the
  // cards stay equal in width.
  await expect(list).toHaveClass(/clip-list-scrolls/)
  await expectGapBesideScrollbar(list, 'in the list view')
  await chooseView(page, 'Thumbnails')
  await expect(list).toHaveClass(/clip-list-thumbnails/)
  const cards = list.getByRole('listitem')
  await expect(cards).toHaveCount(30)
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(true)
  await expectGapBesideScrollbar(list, 'in the thumbnail view')
  const widths = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  )
  for (const width of widths) {
    expect(Math.abs(width - widths[0]), 'cards in one grid differ in width').toBeLessThanOrEqual(1)
  }
  await expectNoHorizontalScroll(page, '30 cards with the scrollbar and its gap')
  await list.screenshot({ path: testInfo.outputPath('library-thumbnails-scrollbar-gap.png') })
  await chooseView(page, 'List')
})

/**
 * The list stays inside its panel (#546, from the customer's #545).
 *
 * #308's cap is `max-height: 50vh`, chosen when the shell's height was
 * indefinite and the panel always grew to fit its list. #524 gave the shell
 * a definite height: the top grid row is the height the window leaves, the
 * panel is exactly that tall, and a list capped against the *viewport* can
 * be taller than the room under the panel's header. The test above could
 * not see it — it asserts the timeline's `top` does not move, which stayed
 * true while the list painted over the timeline's heading. Measured on
 * `main` before the fix at 1280×720 with 14 rows: list bottom **552px**,
 * panel bottom **528px**. So this asserts containment in the panel's own
 * content box, at the window heights the cap alone did not fit, in both
 * views and both layouts — and that the list still scrolls there.
 */
test('the list stays inside its panel and scrolls there, at window heights the 50vh cap alone did not fit (#546)', async ({
  page,
}) => {
  const panel = page.getByRole('region', { name: 'Media library' })
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const importButton = page.getByRole('button', { name: 'Import clips' })
  const input = page.getByTestId('clip-file-input')

  /** The list ends inside the panel's content box — its padding is not room. */
  const expectInsidePanel = async (when: string) => {
    const edges = await panel.evaluate((node) => {
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      const listBox = node.querySelector('.clip-list')!.getBoundingClientRect()
      return {
        contentBottom:
          box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth),
        listBottom: listBox.bottom,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }
    })
    expect(
      edges.listBottom,
      `the list ends ${edges.listBottom - edges.contentBottom}px past the panel's content box ${when}`,
    ).toBeLessThanOrEqual(edges.contentBottom + 1)
    expect(edges.scrollHeight, `the panel overflows ${when}`).toBeLessThanOrEqual(
      edges.clientHeight + 1,
    )
    await expectWithin(list, panel, { axis: 'y', what: `the clip list ${when}` })
  }
  const scrolls = () => list.evaluate((node) => node.scrollHeight > node.clientHeight + 1)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await input.setInputFiles(wavs(1, 14))
  await expect(rows).toHaveCount(14)
  await expectInsidePanel('at 1280×720 with 14 rows')
  // Bounded by the panel means scrolling inside it — with #460's gap.
  expect(await scrolls(), 'the list scrolls at 1280×720 with 14 rows').toBe(true)
  await expect(list).toHaveClass(/clip-list-scrolls/)
  // The customer's screenshot: rows over the Timeline heading.
  const timelineBox = (await timeline.boundingBox())!
  const listBox = (await list.boundingBox())!
  expect(listBox.y + listBox.height, 'the list reaches the timeline').toBeLessThanOrEqual(
    timelineBox.y + 1,
  )
  // Scrolling the list leaves the header where it was and shows the last row.
  const importBox = await importButton.boundingBox()
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(rows.last()).toBeInViewport()
  expect(await importButton.boundingBox()).toEqual(importBox)

  await chooseView(page, 'Thumbnails')
  await expect(list).toHaveClass(/clip-list-thumbnails/)
  await expectInsidePanel('at 1280×720 with 14 cards')
  await chooseView(page, 'List')

  // The expanded-preview layout sizes its rows to their content, so here
  // the 50vh cap is still what bounds the list; it must fit either way.
  await page.getByRole('button', { name: 'Expand preview' }).click()
  await expectInsidePanel('at 1280×720 with the preview expanded')
  await page.getByRole('button', { name: 'Restore preview size' }).click()

  await page.setViewportSize({ width: 1440, height: 900 })
  await input.setInputFiles(wavs(15, 16))
  await expect(rows).toHaveCount(30)
  await expectInsidePanel('at 1440×900 with 30 rows')
  expect(await scrolls(), 'the list scrolls at 1440×900 with 30 rows').toBe(true)

  // Below 700px the panels stack in content-sized rows: the other layout.
  await page.setViewportSize({ width: 360, height: 640 })
  await expectInsidePanel('at 360×640 with 30 rows')
  expect(await scrolls(), 'the list scrolls at 360×640 with 30 rows').toBe(true)
})

test('a small library does not scroll and reserves no space (#308)', async ({ page }) => {
  await page.goto('./')
  const input = page.getByTestId('clip-file-input')
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')

  await input.setInputFiles(wavs(1, 3))
  await expect(rows).toHaveCount(3)

  const metrics = await list.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(metrics.scrollHeight).toBe(metrics.clientHeight)
  // The list is exactly its rows plus the gaps between them — no fixed height.
  const listBox = (await list.boundingBox())!
  const first = (await rows.first().boundingBox())!
  const last = (await rows.last().boundingBox())!
  expect(listBox.y).toBeCloseTo(first.y, 0)
  expect(listBox.y + listBox.height).toBeCloseTo(last.y + last.height, 0)
  // …and reserves no gap beside a scrollbar it does not have (#460): the
  // rows reach the list's edge as they always did.
  await expect(list).not.toHaveClass(/clip-list-scrolls/)
  await expectNoGapBesideScrollbar(list, 'with 3 rows')

  // The same three clips as cards are two grid rows, taller than the 50vh
  // cap at 720px: that grid scrolls, so it has the gap — and a taller
  // window takes the scrollbar away and the gap with it, with no reload,
  // which is the resize path the component listens for.
  const scrolls = () => list.evaluate((node) => node.scrollHeight > node.clientHeight + 1)
  await chooseView(page, 'Thumbnails')
  await expect(list).toHaveClass(/clip-list-thumbnails/)
  await expect(list).toHaveClass(/clip-list-scrolls/)
  expect(await scrolls(), 'three cards overflow the cap at 720px').toBe(true)
  await expectGapBesideScrollbar(list, 'with 3 cards at 720px')
  await page.setViewportSize({ width: 1280, height: 1400 })
  await expect(list).not.toHaveClass(/clip-list-scrolls/)
  expect(await scrolls(), 'three cards fit under the cap at 1400px').toBe(false)
  await expectNoGapBesideScrollbar(list, 'with 3 cards at 1400px')
  await page.setViewportSize({ width: 1280, height: 720 })
  await chooseView(page, 'List')

  // Crossing into scrolling — no reload — the gap appears with the scrollbar.
  await input.setInputFiles(wavs(4, 27))
  await expect(rows).toHaveCount(30)
  await expect(list).toHaveClass(/clip-list-scrolls/)
  await expectGapBesideScrollbar(list, 'once the library grew to 30 rows')
})
