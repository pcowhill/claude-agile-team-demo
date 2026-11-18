import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'
import { ADD_TEXT, chooseFromAddMenu, openSubtitleStyle } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page

/**
 * Every box in a row of several number boxes has its own visible label in
 * front of it (#664, from the customer's #657 and #655). Before this, a
 * crop row read `Crop [ ] right [ ] top [ ] bottom [ ] %`. The row's caption
 * stood where the first box's name belonged. An overlay's Rect and every
 * centre had pairs of boxes with no names at all.
 *
 * The measurement does not depend on the markup. For each box it reads the
 * text nearest to the box's left on the box's own line, from the rendered
 * layout. That text is the box's label, and it must be on one line. The
 * lines are counted from the label's client rects, as `user-guide.spec.ts`'s
 * `expectNoWrap` counts them (`development.md`). Taken on a populated
 * project at 1280×720 and at 360px, where these rows wrap.
 */

const IMAGE = 'red.png at position 1'
const OVERLAY = 'overlay cam.png at position 1'
const TEXT = 'text overlay at position 1'

/** Each box by its accessible name (unchanged by #664), and the label it should read. */
const BOXES: [name: string, label: string][] = [
  [`Crop left of ${IMAGE} (percent)`, 'left'],
  [`Crop right of ${IMAGE} (percent)`, 'right'],
  [`Crop top of ${IMAGE} (percent)`, 'top'],
  [`Crop bottom of ${IMAGE} (percent)`, 'bottom'],
  [`Brightness of ${IMAGE} (percent)`, 'brightness'],
  [`Contrast of ${IMAGE} (percent)`, 'contrast'],
  [`Saturation of ${IMAGE} (percent)`, 'saturation'],
  [`Redaction region 1 left of ${IMAGE} (percent)`, 'left'],
  [`Redaction region 1 top of ${IMAGE} (percent)`, 'top'],
  [`Redaction region 1 width of ${IMAGE} (percent)`, 'width'],
  [`Redaction region 1 height of ${IMAGE} (percent)`, 'height'],
  [`Spotlight region 1 left of ${IMAGE} (percent)`, 'left'],
  [`Spotlight region 1 top of ${IMAGE} (percent)`, 'top'],
  [`Spotlight region 1 width of ${IMAGE} (percent)`, 'width'],
  [`Spotlight region 1 height of ${IMAGE} (percent)`, 'height'],
  [`Zoom 1 scale of ${IMAGE}`, 'scale'],
  [`Zoom 1 centre X of ${IMAGE} (0 to 1)`, 'x'],
  [`Zoom 1 centre Y of ${IMAGE} (0 to 1)`, 'y'],
  [`Left edge of ${OVERLAY} (fraction of frame width)`, 'left'],
  [`Top edge of ${OVERLAY} (fraction of frame height)`, 'top'],
  [`Width of ${OVERLAY} (fraction of frame width)`, 'width'],
  [`Height of ${OVERLAY} (fraction of frame height)`, 'height'],
  [`Centre X of ${TEXT} (0 to 1)`, 'x'],
  [`Centre Y of ${TEXT} (0 to 1)`, 'y'],
  ['Default subtitle centre X (0 to 1)', 'x'],
  ['Default subtitle centre Y (0 to 1)', 'y'],
]

async function pngOf(page: Page, width: number, height: number, fill: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, fill }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, width, height)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { width, height, fill },
  )
  return Buffer.from(base64, 'base64')
}

/** An image entry with a crop row, colour row, a redaction, a spotlight and a zoom; an image overlay; a text overlay with the subtitle style open. */
async function populatedProject(page: Page) {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: await pngOf(page, 240, 160, 'rgb(220, 20, 20)') },
    { name: 'cam.png', mimeType: 'image/png', buffer: await pngOf(page, 240, 240, 'rgb(20, 20, 220)') },
  ])
  await page.getByRole('button', { name: 'Add red.png to timeline' }).click()
  await chooseClipAction(page, 'cam.png', 'Add as overlay')
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseEffect(page, IMAGE, 'Zoom')
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  await page.getByRole('button', { name: `Add a spotlight region on ${IMAGE}` }).click()
  await openSubtitleStyle(page)
  for (const [name] of BOXES) {
    await expect(page.getByRole('spinbutton', { name, exact: true }), name).toBeAttached()
  }
}

interface LabelReading {
  /** The nearest text left of the box on its line, trimmed to its last word. */
  label: string | null
  /** The pixels between that text's right edge and the box's left edge. */
  gap: number
  /** The lines that text's own node occupies. */
  lines: number
}

/**
 * The visible label of a box, read from the layout: of every text in the
 * box's row, the rect that ends nearest the box's left edge while sharing
 * the box's line (its vertical middle within the box's top and bottom).
 */
async function labelOf(page: Page, name: string): Promise<LabelReading> {
  const box = page.getByRole('spinbutton', { name, exact: true })
  await box.scrollIntoViewIfNeeded()
  return box.evaluate((input) => {
    const own = input.getBoundingClientRect()
    const row = input.closest('div')!
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let best: { node: Text; right: number } | null = null
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if ((node.textContent ?? '').trim() === '') continue
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue
        const middle = (rect.top + rect.bottom) / 2
        if (middle < own.top || middle > own.bottom) continue
        if (rect.right > own.left + 0.5) continue
        if (best === null || rect.right > best.right) best = { node, right: rect.right }
      }
    }
    if (best === null) return { label: null, gap: Infinity, lines: 0 }
    range.selectNodeContents(best.node)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    rects.sort((a, b) => a.top - b.top)
    let lines = 0
    let lineBottom = -Infinity
    for (const rect of rects) {
      if (rect.top >= lineBottom - 0.5) lines++
      lineBottom = Math.max(lineBottom, rect.bottom)
    }
    const words = (best.node.textContent ?? '').trim().split(/\s+/)
    return { label: words[words.length - 1], gap: own.left - best.right, lines }
  })
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 640 },
]) {
  test(`every box in a multi-box row has its own label before it, on one line, at ${viewport.width}px (#664)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populatedProject(page)
    // The editor column, not the Timeline panel: a row too wide for the
    // column widens the panel with it (measured: 994px at 360px under a
    // nowrap mutation), so "inside the panel" would hold trivially.
    const column = page.locator('main')

    const wrong: string[] = []
    for (const [name, expected] of BOXES) {
      const reading = await labelOf(page, name)
      // The gap is the row's own flex gap (0.4rem) or less; 12px means the
      // nearest text is the label beside the box, not a word further along.
      if (reading.label !== expected || reading.gap > 12 || reading.lines !== 1) {
        wrong.push(`${name}: read ${JSON.stringify(reading)}, want "${expected}"`)
      }
      // The row holding the box stays inside the editor column.
      await expectWithin(
        page.getByRole('spinbutton', { name, exact: true }).locator('xpath=ancestor::div[1]'),
        column,
        { axis: 'x', what: `the row of ${name}` },
      )
    }
    expect(wrong, 'boxes whose nearest left text, on their own line, is not their label').toEqual([])
    await expectNoHorizontalScroll(page, `at ${viewport.width}px`)

    await page.getByRole('spinbutton', { name: `Crop left of ${IMAGE} (percent)`, exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`field-labels-${viewport.width}.png`) })
  })
}
