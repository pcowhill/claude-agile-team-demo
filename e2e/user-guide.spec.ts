import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The in-app user guide (#478, approved design #477, customer feedback
 * #476) in real Chromium: the Help ▾ menu's place in the header, the docked
 * panel's geometry at both widths, the editor staying operable beside it,
 * deep links through the URL hash, search, and F1 — the rendered evidence
 * jsdom cannot give (`development.md`, "a new visible surface").
 */

const helpTrigger = (page: Page) => page.getByRole('button', { name: 'Help', exact: true })
const fileTrigger = (page: Page) => page.getByRole('button', { name: 'File', exact: true })
const helpMenu = (page: Page) => page.getByRole('menu', { name: 'Help menu' })
const guide = (page: Page) => page.getByRole('complementary', { name: 'User Guide' })
const searchField = (page: Page) => guide(page).getByRole('searchbox', { name: 'Search the user guide' })

async function openGuide(page: Page): Promise<Locator> {
  await helpTrigger(page).click()
  await helpMenu(page).getByRole('menuitem', { name: 'User Guide…' }).click()
  const panel = guide(page)
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Every element of a locator lays its text on one line (no mid-word wrap),
 * and there is at least one element to check.
 *
 * Counted as the lines its **text** occupies: each text node's client rects,
 * grouped by vertical overlap, so one line holding text of two sizes is
 * still one line. Neither earlier measure could see a wrap everywhere (#603):
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
async function expectNoWrap(items: Locator, what: string) {
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
      let lineBottom = -Infinity
      for (const rect of rects) {
        // A rect starting below the current line's bottom starts a new line.
        // Half a pixel, for subpixel rounding between two rects of one line.
        if (rect.top >= lineBottom - 0.5) lines++
        lineBottom = Math.max(lineBottom, rect.bottom)
      }
      return { lines, text: node.textContent }
    })
    expect(layout.lines, `${what} "${layout.text}" wraps onto more than one line`).toBe(1)
  }
}

test('Help ▾ sits beside File ▾ at its height, is keyboard-operable, and holds both help surfaces', async ({
  page,
}) => {
  await page.goto('./')
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const file = (await fileTrigger(page).boundingBox())!
    const help = (await helpTrigger(page).boundingBox())!
    const where = `at ${viewport.width}px: Help ${JSON.stringify(help)} against File ${JSON.stringify(file)}`
    expect(Math.abs(help.height - file.height), `${where}: heights differ`).toBeLessThanOrEqual(1)
    expect(Math.abs(help.y - file.y), `${where}: tops differ`).toBeLessThanOrEqual(1)
    expect(help.x, `${where}: Help is not to the right of File`).toBeGreaterThan(file.x + file.width - 1)
  }

  await page.setViewportSize({ width: 1280, height: 720 })
  await helpTrigger(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(helpMenu(page)).toBeVisible()
  const items = helpMenu(page).getByRole('menuitem')
  await expect(items).toHaveText(['User Guide…F1', 'Keyboard shortcuts…?'])
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Open the user guide')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // The menu-button contract (#412): Escape on the open menu refocuses the trigger.
  await helpTrigger(page).click()
  await expect(helpMenu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(helpMenu(page)).toHaveCount(0)
  await expect(helpTrigger(page)).toBeFocused()
})

test('the panel docks beside the editor at 1280px and covers the viewport at 800px', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  await expect(panel.getByRole('heading', { level: 2, name: 'Quick Start' })).toBeVisible()
  await expect(searchField(page)).toBeFocused()

  const view = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }))
  const box = (await panel.boundingBox())!
  expect(box.x, 'panel left').toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, 'panel right').toBeLessThanOrEqual(view.width)
  expect(box.y, 'panel top').toBeGreaterThanOrEqual(0)
  // Docked: it starts below the header, not over it.
  const header = (await page.locator('.app-header').boundingBox())!
  expect(box.y, 'panel overlaps the header').toBeGreaterThanOrEqual(header.y + header.height - 1)
  // And beside the editor: the timeline still has its own room to the left.
  const timeline = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!
  expect(timeline.x + timeline.width, 'timeline runs under the panel').toBeLessThanOrEqual(box.x + 1)
  await expectNoHorizontalScroll(page, 'guide open at 1280px')

  // Contents entries on one line each; the article inside the panel.
  const contents = panel.getByRole('navigation', { name: 'Contents' })
  await expectNoWrap(contents.getByRole('link'), 'contents entry')
  await expectWithin(panel.getByRole('article'), panel, { axis: 'x', what: 'article' })

  // The human check for the PR's rendered evidence, re-taken every run.
  await page.screenshot({ path: testInfo.outputPath('user-guide-open-1280.png') })
  await panel.screenshot({ path: testInfo.outputPath('user-guide-panel-1280.png') })

  // Narrow: the panel is the viewport's width.
  await page.setViewportSize({ width: 800, height: 1100 })
  const narrow = (await panel.boundingBox())!
  const narrowView = await page.evaluate(() => document.documentElement.clientWidth)
  expect(Math.abs(narrow.width - narrowView), 'panel spans the viewport at 800px').toBeLessThanOrEqual(1)
  expect(narrow.x, 'panel left at 800px').toBeLessThanOrEqual(1)
  await expectNoHorizontalScroll(page, 'guide open at 800px')
  await page.screenshot({ path: testInfo.outputPath('user-guide-open-800.png') })
})

test('the editor stays operable beside the open panel, and Escape closes it only from inside', async ({
  page,
}) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  await chooseFromAddMenu(page, ADD_SLATE)
  const panel = await openGuide(page)

  // A click on a timeline control and a transport key both still work.
  await page.getByRole('button', { name: 'Undo' }).focus()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse Color slate at position 1' }).click()
  await expect(page.getByRole('button', { name: 'Expand Color slate at position 1' })).toBeVisible()

  // Escape with focus inside: closed, focus back on Help ▾, hash gone.
  await searchField(page).focus()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(helpTrigger(page)).toBeFocused()
  expect(new URL(page.url()).hash).toBe('')
})

test('deep links: a #guide URL opens the panel on its heading, in-guide links stay in the panel, Back returns', async ({
  page,
}) => {
  await page.goto('./#guide/concepts/what-is-saved-where')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = guide(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { level: 2, name: 'Concepts' })).toBeVisible()
  const heading = panel.getByRole('heading', { level: 3, name: 'What is saved where' })
  await expect(heading).toBeVisible()
  // Scrolled to: the heading's top sits inside the panel's visible box, near its top.
  const panelBox = (await panel.boundingBox())!
  const headingBox = (await heading.boundingBox())!
  expect(headingBox.y, 'heading above the panel').toBeGreaterThanOrEqual(panelBox.y - 1)
  expect(headingBox.y, 'heading not scrolled into view').toBeLessThan(panelBox.y + panelBox.height / 2)

  // A link in the article: the panel navigates, the page stays.
  const before = new URL(page.url())
  await panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Quick Start' }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Quick Start' })).toBeVisible()
  const after = new URL(page.url())
  expect(after.pathname).toBe(before.pathname)
  expect(after.hash).toBe('#guide/quick-start')
  await panel.getByRole('article').getByRole('link', { name: 'Concepts' }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Concepts' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#guide/concepts')

  await page.goBack()
  await expect(panel.getByRole('heading', { level: 2, name: 'Quick Start' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#guide/quick-start')
})

test('search: results as you type, the typed prefix highlighted, Enter opens the first hit', async ({
  page,
}) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  await searchField(page).fill('proj')
  const results = panel.getByRole('list', { name: 'Search results' })
  await expect(results).toBeVisible()
  const marks = results.locator('mark')
  await expect(marks.first()).toBeVisible()
  for (const text of await marks.allInnerTexts()) expect(text.toLowerCase()).toBe('proj')
  await expect(panel.getByRole('status')).toContainText(/\d+ results? — Enter opens the first/)

  await page.keyboard.press('Enter')
  await expect(results).toHaveCount(0)
  await expect(searchField(page)).toHaveValue('')
  await expect(panel.getByRole('article')).toBeVisible()
  expect(new URL(page.url()).hash).toMatch(/^#guide\//)
})

test('search coverage (#479): one representative query per content section finds that section first', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })
  // The first hit's "Section › heading" line names the section a reader
  // lands in; each query is a word the customer would type for that page.
  // (`rename` was the Media library query until the Timeline page (#480)
  // gained its own "Rename…" heading, which outranks a body mention.)
  for (const [query, section] of [
    ['thumbnail', 'Media library'],
    ['webcam', 'Recording'],
    ['autosave', 'Projects'],
  ] as const) {
    await searchField(page).fill(query)
    await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(
      section,
    )
  }
  // Not yet written: the Audio page (#481). The phrase must not land in one
  // of this PR's sections, which would mean a passage claiming that feature.
  await searchField(page).fill('duck others')
  const status = panel.getByRole('status')
  await expect(status).toBeVisible()
  for (const where of await results.locator('.user-guide-hit-where').allInnerTexts()) {
    expect(where, `"duck others" hit ${where}`).not.toMatch(/^(Media library|Recording|Projects)/)
  }

  // The rendered evidence for the new pages: Recording, scrolled to the top.
  await searchField(page).fill('')
  await panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Recording' }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Recording' })).toBeVisible()
  await expectNoWrap(panel.getByRole('navigation', { name: 'Contents' }).getByRole('link'), 'contents entry')
  await expectWithin(panel.getByRole('article'), panel, { axis: 'x', what: 'article' })
  await expectNoHorizontalScroll(page, 'guide on Recording at 1280px')
  await panel.screenshot({ path: testInfo.outputPath('user-guide-recording-1280.png') })
})

test('search coverage (#480): one representative query per content section finds that section first', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })
  // The issue's own queries: the customer's example (Duplicate) first.
  for (const [query, section] of [
    ['duplicate', 'Timeline'],
    ['crossfade', 'Editing video'],
    ['snap', 'Visual editors'],
  ] as const) {
    await searchField(page).fill(query)
    await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(
      section,
    )
  }

  // The rendered evidence for the new pages: Timeline, scrolled to the top.
  await searchField(page).fill('')
  await panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await expectNoWrap(panel.getByRole('navigation', { name: 'Contents' }).getByRole('link'), 'contents entry')
  await expectWithin(panel.getByRole('article'), panel, { axis: 'x', what: 'article' })
  await expectNoHorizontalScroll(page, 'guide on Timeline at 1280px')
  await panel.screenshot({ path: testInfo.outputPath('user-guide-timeline-1280.png') })
})

test('search coverage (#481): one representative query per content section finds that section first', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })
  // The customer's own example first (#476): `duck others` is the Audio
  // page's heading of that name. The other three are section titles, which
  // the search ranks above every heading and body.
  for (const [query, where] of [
    ['duck others', 'Audio › Duck others'],
    ['subtitle', 'Text and subtitles'],
    ['playback', 'Preview and playback'],
    ['undo', 'Undo and redo'],
  ] as const) {
    await searchField(page).fill(query)
    await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(where)
  }

  // The rendered evidence for the new pages: Audio, scrolled to the top.
  await searchField(page).fill('')
  await panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Audio', exact: true }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Audio' })).toBeVisible()
  await expectNoWrap(panel.getByRole('navigation', { name: 'Contents' }).getByRole('link'), 'contents entry')
  await expectWithin(panel.getByRole('article'), panel, { axis: 'x', what: 'article' })
  await expectNoHorizontalScroll(page, 'guide on Audio at 1280px')
  await panel.screenshot({ path: testInfo.outputPath('user-guide-audio-1280.png') })
})

test('search coverage (#482): one representative query per content section finds that section first', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })
  // A word the customer would type for each page. Three of the issue's own
  // queries land first on another page's heading — `permission` on
  // Recording's "Permissions and failures", `ctrl+z` on the Undo page's
  // chords, `slate` on Settings' "New still or slate duration" — each a
  // correct answer, so those three are asserted below as hits on their
  // pages rather than as first hits, and a page-specific word stands in.
  for (const [query, where] of [
    ['mp3', 'Export › Audio only: WebM/Opus and MP3'],
    ['plugin', 'Plugins'],
    ['step size', 'Settings › Step sizes: playhead nudge and jump'],
    ['shortcut', 'Keyboard shortcuts'],
    ['browser support', 'Troubleshooting › Browser support and feature detection'],
    ['remap', 'Glossary › Remap, speed segment and pause'],
  ] as const) {
    await searchField(page).fill(query)
    await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(where)
  }
  for (const [query, section] of [
    ['ctrl+z', 'Keyboard shortcuts'],
    ['permission', 'Troubleshooting'],
    ['slate', 'Glossary'],
  ] as const) {
    await searchField(page).fill(query)
    await expect(results.locator('.user-guide-hit-where').filter({ hasText: section }).first()).toBeVisible()
  }

  // The generated table (#482): the guide's Keyboard shortcuts page shows
  // the cheat sheet's rows, with the step sizes in force.
  await searchField(page).fill('')
  await panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Keyboard shortcuts', exact: true }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Keyboard shortcuts' })).toBeVisible()
  const table = panel.getByTestId('user-guide-shortcuts')
  await expect(table).toContainText('Step the playhead 0.1 s back / forward')
  await expect(table).toContainText('Open the user guide')
  await expectNoWrap(panel.getByRole('navigation', { name: 'Contents' }).getByRole('link'), 'contents entry')
  await expectWithin(panel.getByRole('article'), panel, { axis: 'x', what: 'article' })
  await expectWithin(table, panel, { axis: 'x', what: 'shortcut table' })
  // A combo never breaks mid-combo, and the Redo row's two alternatives sit
  // on separate lines rather than running together (#287's rule, here too).
  await expectNoWrap(table.locator('kbd'), 'key combo')
  const redo = table.getByRole('row').filter({ hasText: 'Redo' }).locator('kbd')
  await expect(redo).toHaveCount(2)
  const [first, second] = await Promise.all([redo.nth(0).boundingBox(), redo.nth(1).boundingBox()])
  expect(first, 'first Redo combo has a box').not.toBeNull()
  expect(second, 'second Redo combo has a box').not.toBeNull()
  expect(second!.y, 'the Redo combos stack on separate lines').toBeGreaterThanOrEqual(first!.y + first!.height)
  await expectNoHorizontalScroll(page, 'guide on Keyboard shortcuts at 1280px')
  // The screenshot shows the table, not the Contents above it.
  await table.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: testInfo.outputPath('user-guide-shortcuts-1280.png') })
})

test('Quick Start screenshots (#483): every image loads and fits the panel', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  await expect(panel.getByRole('heading', { level: 2, name: 'Quick Start' })).toBeVisible()
  const images = panel.getByRole('article').locator('img')
  await expect(images).toHaveCount(4)
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toBeVisible()
    // Loaded, not a broken-image glyph: a decoded picture has a natural size.
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expectWithin(image, panel, { axis: 'x', what: 'Quick Start screenshot' })
    const alt = (await image.getAttribute('alt')) ?? ''
    expect(alt.length, 'alt text says what the reader should see').toBeGreaterThan(40)
  }
  await expectNoHorizontalScroll(page, 'guide on Quick Start with images at 1280px')
  // The rendered evidence: the first screenshot as the panel shows it.
  await images.first().scrollIntoViewIfNeeded()
  await panel.screenshot({ path: testInfo.outputPath('user-guide-quick-start-images-1280.png') })
})

test('Feature Index (#485): the customer’s own query lands, and every entry is a link', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })

  // The customer's own example (#476). The criterion allows either the
  // Feature Index entry or the Audio page; the Audio page's own heading
  // wins, which is the better answer — the index would only point there.
  await searchField(page).fill('duck others')
  await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(
    'Audio › Duck others',
  )
  // …and the index is reachable by the same search, for a label whose page
  // does not spell it out.
  await searchField(page).fill('feature index')
  await expect(
    results.locator('.user-guide-hit-where').filter({ hasText: 'Feature Index' }).first(),
  ).toBeVisible()

  await searchField(page).fill('')
  const contents = panel.getByRole('navigation', { name: 'Contents' })
  await contents.getByRole('link', { name: 'Feature Index', exact: true }).click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Feature Index' })).toBeVisible()

  const article = panel.getByRole('article')
  // Every entry carries at least one link, and they navigate inside the
  // panel: clicking one lands on the page it names without leaving the app.
  const entryLinks = article.getByRole('listitem').getByRole('link')
  expect(await entryLinks.count(), 'the index links its entries').toBeGreaterThan(150)
  await article.getByRole('link', { name: 'Audio › Duck others' }).first().click()
  await expect(panel.getByRole('heading', { level: 2, name: 'Audio' })).toBeVisible()
  await expect(panel.getByRole('heading', { level: 3, name: 'Duck others' })).toBeVisible()
  await page.goBack()
  await expect(panel.getByRole('heading', { level: 2, name: 'Feature Index' })).toBeVisible()

  await expectNoWrap(contents.getByRole('link'), 'contents entry')
  await expectWithin(article, panel, { axis: 'x', what: 'article' })
  // An entry is one line per control; a long one wraps within the panel
  // rather than pushing the panel sideways.
  await expectNoHorizontalScroll(page, 'guide on Feature Index at 1280px')
  // The screenshot shows the entries, not the Contents above them.
  const firstEntry = article.getByRole('listitem').first()
  await firstEntry.scrollIntoViewIfNeeded()
  await expect(firstEntry).toBeVisible()
  await panel.screenshot({ path: testInfo.outputPath('user-guide-feature-index-1280.png') })
})

test('a Contents link to the heading already showing scrolls back to it (#590)', async ({ page }) => {
  // #587: a Contents link scrolled to its heading once; scrolling back up
  // and clicking the same link again did nothing, because the place had not
  // changed. The panel is the scroll container, so "in view" is the
  // heading's top inside the panel's upper half — the same measure the
  // deep-link test uses.
  await page.goto('./#guide/editing-video')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = guide(page)
  await expect(panel.getByRole('heading', { level: 2, name: 'Editing video' })).toBeVisible()
  const link = panel.getByRole('navigation', { name: 'Contents' }).getByRole('link', { name: 'Zooms', exact: true })
  const heading = panel.getByRole('article').getByRole('heading', { name: 'Zooms', exact: true })
  const headingTopInPanel = async () => {
    const [panelBox, headingBox] = await Promise.all([panel.boundingBox(), heading.boundingBox()])
    return (headingBox!.y - panelBox!.y) / panelBox!.height
  }
  const inView = async () => {
    const top = await headingTopInPanel()
    return top >= -0.01 && top < 0.5
  }

  await link.click()
  await expect.poll(inView, { message: 'first click scrolls to the heading' }).toBe(true)
  expect(new URL(page.url()).hash).toBe('#guide/editing-video/zooms')

  // Back to the top of the panel, where the Contents list is: the heading
  // is now well below the panel's visible box.
  await panel.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(headingTopInPanel, { message: 'scrolled away from the heading' }).toBeGreaterThan(1)

  await link.click()
  await expect.poll(inView, { message: 'the same link scrolls to the heading again' }).toBe(true)
  expect(new URL(page.url()).hash).toBe('#guide/editing-video/zooms')
})

test('opening a search hit, by click or by Enter, shows its heading and keeps focus on the search field (#616)', async ({
  page,
}) => {
  // #616: in Firefox the panel stayed near the top after a hit opened. Its
  // focus on the search field scrolled lazily, after the arrival had scrolled
  // to the heading, and put the panel back. "In view" is the measure the
  // deep-link and #590 tests use: the heading's top inside the panel's upper
  // half, polled, since the scroll lands after the click resolves.
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  const panel = await openGuide(page)
  const results = panel.getByRole('list', { name: 'Search results' })
  const heading = panel.getByRole('article').getByRole('heading', { level: 3, name: 'What is saved where' })
  const headingTopInPanel = async () => {
    const [panelBox, headingBox] = await Promise.all([panel.boundingBox(), heading.boundingBox()])
    return (headingBox!.y - panelBox!.y) / panelBox!.height
  }
  const inView = async () => {
    const top = await headingTopInPanel()
    return top >= -0.01 && top < 0.5
  }

  // By click.
  await searchField(page).fill('saved where')
  const firstHit = results.getByRole('button').first()
  await expect(firstHit.locator('.user-guide-hit-where')).toContainText('What is saved where')
  await firstHit.click()
  await expect(results).toHaveCount(0)
  await expect.poll(inView, { message: 'a clicked hit scrolls to its heading' }).toBe(true)
  await expect(searchField(page)).toBeFocused()
  expect(new URL(page.url()).hash).toBe('#guide/concepts/what-is-saved-where')

  // By Enter, from the top of the panel, where the heading is out of view.
  await panel.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(headingTopInPanel, { message: 'scrolled away from the heading' }).toBeGreaterThan(1)
  await searchField(page).fill('saved where')
  await expect(firstHit.locator('.user-guide-hit-where')).toContainText('What is saved where')
  await page.keyboard.press('Enter')
  await expect(results).toHaveCount(0)
  await expect.poll(inView, { message: 'Enter on a hit scrolls to its heading' }).toBe(true)
  await expect(searchField(page)).toBeFocused()
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 800, height: 720 },
]) {
  test(`after a search hit opens, the search field stays in view, clear of the heading, and so do the next query's results; the title and ✕ stay with it (#666), at ${viewport.width}×${viewport.height} (#638)`, async ({
    page,
  }) => {
    // #638: opening a hit scrolls the panel to the hit's heading and puts
    // focus back on the search field. The field used to scroll away with the
    // article, so the next query was typed into a field nobody could see.
    // It is sticky now; the panel's scroll padding keeps the heading below
    // it. 800 wide is the narrow-window sheet, a separate layout.
    await page.goto('./')
    await page.setViewportSize(viewport)
    const panel = await openGuide(page)
    const field = searchField(page)
    const band = panel.getByRole('search')
    const heading = panel.getByRole('article').getByRole('heading', { level: 3, name: 'What is saved where' })
    const results = panel.getByRole('list', { name: 'Search results' })

    await field.fill('saved where')
    await expect(results.getByRole('button').first().locator('.user-guide-hit-where')).toContainText(
      'What is saved where',
    )
    await results.getByRole('button').first().click()
    await expect(results).toHaveCount(0)

    // Read together in one poll, so all three boxes come from one render.
    const geometry = async () => {
      const [panelBox, bandBox, fieldBox, headingBox] = await Promise.all([
        panel.boundingBox(),
        band.boundingBox(),
        field.boundingBox(),
        heading.boundingBox(),
      ])
      return {
        // The field lies inside the panel's visible box. 1px: the field's
        // border box against the panel's, both rounded by layout.
        fieldInView:
          fieldBox!.y >= panelBox!.y - 1 && fieldBox!.y + fieldBox!.height <= panelBox!.y + panelBox!.height + 1,
        // The heading starts at or below the sticky band — the lowest part
        // of the sticky header, under the title and ✕ since #666 — so
        // nothing covers it, and inside the panel's upper half, as #616's
        // test measures.
        headingClear: headingBox!.y >= bandBox!.y + bandBox!.height - 1,
        headingInUpperHalf: (headingBox!.y - panelBox!.y) / panelBox!.height < 0.5,
        // The panel really did scroll: the field would be in view anyway at
        // the top, which would prove nothing.
        scrolled: (await panel.evaluate((el) => el.scrollTop)) > 200,
      }
    }
    await expect
      .poll(geometry, { message: 'after the hit: field in view, heading clear of it and in the upper half' })
      .toEqual({ fieldInView: true, headingClear: true, headingInUpperHalf: true, scrolled: true })
    await expect(field).toBeFocused()

    // The next query, typed straight away: the field is still in view, and
    // so is the start of what it found.
    await page.keyboard.type('trim')
    await expect(field).toHaveValue('trim')
    await expect(results.getByRole('button').first()).toBeVisible()
    await expect
      .poll(
        async () => {
          const [panelBox, fieldBox, hitBox] = await Promise.all([
            panel.boundingBox(),
            field.boundingBox(),
            results.getByRole('button').first().boundingBox(),
          ])
          const bottom = panelBox!.y + panelBox!.height
          return {
            fieldInView: fieldBox!.y >= panelBox!.y - 1 && fieldBox!.y + fieldBox!.height <= bottom + 1,
            firstHitInView: hitBox!.y >= panelBox!.y - 1 && hitBox!.y < bottom,
          }
        },
        { message: 'typing the next query: field and first result in view' },
      )
      .toEqual({ fieldInView: true, firstHitInView: true })

    // #666: the title and ✕ stick with the field. An in-guide link's
    // arrival lands below all three, and at the very end of a long page the
    // title, ✕ and field are still in the panel's box, and ✕ — the element
    // actually under its own centre, not something scrolled over it —
    // closes the panel.
    await field.fill('')
    const title = panel.getByRole('heading', { level: 2, name: 'User Guide' })
    const close = panel.getByRole('button', { name: 'Close the user guide' })
    const inPanel = async (box: { y: number; height: number } | null) => {
      const panelBox = (await panel.boundingBox())!
      return box !== null && box.y >= panelBox.y - 1 && box.y + box.height <= panelBox.y + panelBox.height + 1
    }
    await panel.getByRole('article').getByRole('link', { name: 'colour slate' }).click()
    const arrival = panel.getByRole('article').getByRole('heading', { level: 3, name: 'The header' })
    await expect
      .poll(
        async () => {
          const [bandBox, arrivalBox] = await Promise.all([band.boundingBox(), arrival.boundingBox()])
          return {
            arrivalClear: arrivalBox!.y >= bandBox!.y + bandBox!.height - 1,
            arrivalInView: await inPanel(arrivalBox),
            scrolled: (await panel.evaluate((el) => el.scrollTop)) > 50,
          }
        },
        { message: 'an in-guide link lands its heading below the whole sticky header' },
      )
      .toEqual({ arrivalClear: true, arrivalInView: true, scrolled: true })

    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect
      .poll(
        async () => {
          const [titleBox, closeBox, fieldBox] = await Promise.all([
            title.boundingBox(),
            close.boundingBox(),
            field.boundingBox(),
          ])
          const atEnd = await panel.evaluate((el) => el.scrollTop > 200 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
          const closeOnTop = await close.evaluate((button) => {
            const box = button.getBoundingClientRect()
            return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button
          })
          return {
            atEnd,
            titleInView: await inPanel(titleBox),
            closeInView: await inPanel(closeBox),
            fieldInView: await inPanel(fieldBox),
            closeOnTop,
          }
        },
        { message: 'scrolled to the end: title, ✕ and field in view, ✕ on top' },
      )
      .toEqual({ atEnd: true, titleInView: true, closeInView: true, fieldInView: true, closeOnTop: true })
    await close.click()
    await expect(panel).toHaveCount(0)
  })
}

test('F1 opens the guide, and is inert while typing in a field (#478)', async ({ page }) => {
  await page.goto('./')
  await page.setViewportSize({ width: 1280, height: 720 })
  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.focus()
  await page.keyboard.press('F1')
  await expect(guide(page)).toHaveCount(0)

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('F1')
  await expect(guide(page)).toBeVisible()
  await expect(searchField(page)).toBeFocused()
})
