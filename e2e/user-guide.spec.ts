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
const guide = (page: Page) => page.getByRole('complementary', { name: 'User guide' })
const searchField = (page: Page) => guide(page).getByRole('searchbox', { name: 'Search the user guide' })

async function openGuide(page: Page): Promise<Locator> {
  await helpTrigger(page).click()
  await helpMenu(page).getByRole('menuitem', { name: 'User guide…' }).click()
  const panel = guide(page)
  await expect(panel).toBeVisible()
  return panel
}

/** Every element of a locator lays its text on one line (no mid-word wrap). */
async function expectNoWrap(items: Locator, what: string) {
  for (const item of await items.all()) {
    const overflow = await item.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      text: node.textContent,
    }))
    expect(overflow.scrollWidth, `${what} "${overflow.text}" overflows its box`).toBeLessThanOrEqual(
      overflow.clientWidth,
    )
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
  await expect(items).toHaveText(['User guide…F1', 'Keyboard shortcuts…?'])
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
