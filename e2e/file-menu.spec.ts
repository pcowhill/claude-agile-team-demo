import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * The header's File ▾ (#415, from the approved redesign #401 / feedback #395
 * "So Many Buttons") in real Chromium: keyboard-only operation all the way
 * into Export ▸, and the rendered evidence jsdom cannot give — the reduced
 * header on one line at both widths, the open menu and its submenu inside
 * the viewport, and the canvas preset on the timeline header's own line.
 *
 * The submenu is also the first one this product ships, so it is the first
 * browser exercise of `Menu`'s flip rule (#430).
 */

/** A one-second silent WebM is enough for a timeline that can be exported. */
async function seedTimeline(page: Page) {
  await page.goto('./')
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2a6'
    ctx.fillRect(0, 0, 160, 90)
    const stream = canvas.captureStream(25)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    recorder.start()
    await new Promise((resolve) => setTimeout(resolve, 700))
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  })
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
}

const fileTrigger = (page: Page) => page.getByRole('button', { name: 'File', exact: true })
const fileMenu = (page: Page) => page.getByRole('menu', { name: 'File menu' })

test('File ▾ is keyboard-operable into Export ▸, which opens the modal on the chosen format (#415)', async ({
  page,
}) => {
  await seedTimeline(page)

  await fileTrigger(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(fileMenu(page)).toBeVisible()
  await expect(fileTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menuitem', { name: 'New Project' })).toBeFocused()

  // Down to Export ▸ — past Open Project…, Save and Save As… — then right
  // into the submenu, which takes focus on its first format.
  for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowDown')
  const exportItem = page.getByRole('menuitem', { name: 'Export', exact: true })
  await expect(exportItem).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByRole('menu', { name: 'Export' })
  await expect(submenu).toBeVisible()
  await expect(submenu.getByRole('menuitem').first()).toBeFocused()

  // Arrow to MP4 and start it. Which formats exist is the browser's answer,
  // so find MP4's position rather than assuming it.
  const labels = await submenu.getByRole('menuitem').allInnerTexts()
  const target = labels.indexOf('MP4')
  expect(target, `MP4 among ${labels.join(', ')}`).toBeGreaterThanOrEqual(0)
  for (let step = 0; step < target; step++) await page.keyboard.press('ArrowDown')
  await expect(submenu.getByRole('menuitem', { name: 'MP4', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')

  // The export modal is up, on that format, and the whole menu is gone.
  const dialog = page.getByRole('dialog', { name: /export/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'MP4' })).toBeChecked()
  await expect(fileMenu(page)).toHaveCount(0)
  await expect(submenu).toHaveCount(0)

  // Escape leaves the modal, and the trigger takes focus back when the menu
  // itself is dismissed — the menu-button contract (#412).
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await fileTrigger(page).click()
  await expect(fileMenu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(fileMenu(page)).toHaveCount(0)
  await expect(fileTrigger(page)).toBeFocused()
})

test('File ▾, Save and Export Project… share one height with their tops and bottoms aligned, whatever draws the 💾 (#472)', async ({
  page,
}, testInfo) => {
  // The customer's picture (#470) showed Save taller than its neighbours and
  // File ▾ sitting a hair high. A button with no height of its own is as
  // tall as the glyphs its font draws, and the 💾 comes from the platform's
  // colour-emoji font — taller than the text's on macOS and Windows, the
  // same as it in this Linux Chromium, where all three measured 21 px before
  // the fix. So the state that fails on the customer's machine has to be
  // made here: a test-only stylesheet raises the emoji's font-size by half,
  // which is what a taller emoji font does to the line box.
  await page.goto('./')
  const controls = () => [
    fileTrigger(page),
    page.locator('.project-save-button'),
    page.getByRole('button', { name: 'Export Project…' }),
  ]
  /** Every edge of Save's and Export's box within a pixel of File ▾'s; returns the shared height. */
  const expectAligned = async (when: string): Promise<number> => {
    const boxes = await Promise.all(controls().map(async (locator) => (await locator.boundingBox())!))
    const [file, ...others] = boxes
    for (const box of others) {
      const where = `${when}: ${JSON.stringify(box)} against File ▾ ${JSON.stringify(file)}`
      expect(Math.abs(box.height - file.height), `${where}: heights differ`).toBeLessThanOrEqual(1)
      expect(Math.abs(box.y - file.y), `${where}: tops differ`).toBeLessThanOrEqual(1)
      expect(
        Math.abs(box.y + box.height - (file.y + file.height)),
        `${where}: bottoms differ`,
      ).toBeLessThanOrEqual(1)
    }
    return file.height
  }
  const tallGlyph = () =>
    page.addStyleTag({ content: '.project-save-button > span { font-size: 150%; }' })

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const clean = await expectAligned(`clean project at ${viewport.width}px`)
    const style = await tallGlyph()
    const tall = await expectAligned(`taller emoji at ${viewport.width}px`)
    // The box is the rule's, not the glyph's: a taller glyph changes nothing.
    expect(Math.abs(tall - clean), `a taller emoji changed the height at ${viewport.width}px`).toBeLessThanOrEqual(1)
    if (viewport.width === 1280) {
      await page.locator('.app-header').screenshot({ path: testInfo.outputPath('header-buttons-tall-glyph.png') })
    }
    await style.evaluate((node) => (node as Element).remove())
  }

  // Dirty: the ● dot joins the glyph on Save's one line (#415), and the
  // height is still the rule's, with and without the taller emoji.
  await seedTimeline(page)
  await expect(page.locator('.project-dirty')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  const dirty = await expectAligned('dirty project at 1280px')
  await tallGlyph()
  const dirtyTall = await expectAligned('dirty project with a taller emoji at 1280px')
  expect(Math.abs(dirtyTall - dirty), 'the dot or the taller emoji changed the height').toBeLessThanOrEqual(1)
})

test('the reduced header and the open menu fit both widths, and Canvas sits on the timeline header (#415)', async ({
  page,
}, testInfo) => {
  await seedTimeline(page)

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const header = page.locator('.project-controls')
    // By class, not by name: the compact Save reads "Save (unsaved changes)"
    // once the seeded edit dirties the project, and a bare "Save" would also
    // match the preview's "📷 Save frame".
    const save = page.locator('.project-save-button')
    const exportButton = page.getByRole('button', { name: 'Export Project…' })

    // The three controls the redesign leaves visible share one line, with
    // the status text beside them — the reduction is the point of #415.
    const boxes = await Promise.all(
      [fileTrigger(page), save, exportButton].map(async (locator) => (await locator.boundingBox())!),
    )
    const centre = (box: { y: number; height: number }) => box.y + box.height / 2
    for (const box of boxes.slice(1)) {
      expect(
        Math.abs(centre(box) - centre(boxes[0])),
        `header controls share a line at ${viewport.width}px`,
      ).toBeLessThan(boxes[0].height / 2)
    }
    for (const locator of [fileTrigger(page), save, exportButton]) {
      await expectWithin(locator, header, { what: `header control at ${viewport.width}px` })
    }
    await expectNoHorizontalScroll(page, `header at ${viewport.width}px`)

    // The open panel, and then its submenu, lie inside the viewport. The
    // submenu is the first this product ships, so this is what #430's flip
    // rule finally gets measured by.
    await fileTrigger(page).click()
    const menu = fileMenu(page)
    await expect(menu).toBeVisible()
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    const insideViewport = async (locator: import('@playwright/test').Locator, what: string) => {
      const box = (await locator.boundingBox())!
      expect(box.x, `${what} left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, `${what} right at ${viewport.width}px`).toBeLessThanOrEqual(
        view.width,
      )
      expect(box.y, `${what} top at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height, `${what} bottom at ${viewport.width}px`).toBeLessThanOrEqual(
        view.height,
      )
    }
    await insideViewport(menu, 'File panel')
    // Every item on one line, nothing clipped.
    for (const item of await menu.getByRole('menuitem').all()) {
      const overflow = await item.evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    }

    await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
    const submenu = page.getByRole('menu', { name: 'Export' })
    await expect(submenu).toBeVisible()
    await insideViewport(submenu, 'Export submenu')
    await expectNoHorizontalScroll(page, `File menu open at ${viewport.width}px`)

    // The human check for the PR's rendered evidence, re-taken every run.
    await page.screenshot({
      path: testInfo.outputPath(`file-menu-open-${viewport.width}.png`),
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(520, viewport.height) },
    })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  // Canvas left the page header for the timeline's (#415 H1): it is inside
  // the timeline panel, on the same line as Total, and nowhere else.
  await page.setViewportSize({ width: 1280, height: 720 })
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const canvas = page.getByLabel('Canvas aspect')
  await expect(canvas).toHaveCount(1)
  await expectWithin(canvas, timeline, { what: 'canvas preset' })
  const canvasBox = (await canvas.boundingBox())!
  const totalBox = (await page.getByTestId('timeline-total').boundingBox())!
  expect(
    Math.abs(canvasBox.y + canvasBox.height / 2 - (totalBox.y + totalBox.height / 2)),
    'Canvas shares the Total line',
  ).toBeLessThan(canvasBox.height)
  await page
    .locator('.timeline-header')
    .screenshot({ path: testInfo.outputPath('timeline-header-canvas.png') })
})
