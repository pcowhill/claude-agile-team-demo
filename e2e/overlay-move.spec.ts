import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * Overlay Moves (#834) in the preview. The base is a 4 s red slate (#143);
 * the overlay a 16:9 still, so its picture fills its card, added at the
 * default placement (0.62, 0.62, 0.35 × 0.35) from 0 s. One Move glides it
 * from 1 s to 3 s to (0.05, 0.05, 0.5 × 0.5).
 *
 * `overlayRectAt` then places the card at its own placement before 1 s, at
 * exactly halfway, (0.335, 0.335, 0.425 × 0.425), at 2 s, and at the
 * destination from 3 s on. The card's box is measured against its parent,
 * the stage, in pixels.
 *
 * **Tolerance: 1 px on each edge.** The card is placed by CSS percentages of
 * the stage, which the browser lays out to sub-pixel precision, so the
 * honest error is rounding: well under a pixel. One pixel is the export
 * test's tolerance for the same rectangle (`exportVideo.test.ts`).
 */

const POSITION = 'overlay halves.png at position 1'
const SLATE_SECONDS = 4

const OWN = { x: 0.62, y: 0.62, width: 0.35, height: 0.35 }
const MID = { x: 0.335, y: 0.335, width: 0.425, height: 0.425 }
const DEST = { x: 0.05, y: 0.05, width: 0.5, height: 0.5 }
const TOLERANCE_PX = 1

/** A 320×180 PNG: left half green, right half blue. */
async function makeHalvesPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(0, 205, 0)'
    ctx.fillRect(0, 0, 160, 180)
    ctx.fillStyle = 'rgb(0, 0, 230)'
    ctx.fillRect(160, 0, 160, 180)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

async function setField(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** A populated project: the slate, the still overlay, and one Move on it. */
async function populate(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', String(SLATE_SECONDS))
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await chooseEffect(page, POSITION, 'Move')
  await setField(page, `Move 1 start of ${POSITION} in seconds`, '1')
  await setField(page, `Move 1 glide of ${POSITION} in seconds`, '2')
  await setField(page, `Move 1 width of ${POSITION} (percent of frame width)`, String(DEST.width * 100))
  await setField(page, `Move 1 height of ${POSITION} (percent of frame height)`, String(DEST.height * 100))
  await setField(page, `Move 1 left edge of ${POSITION} (percent of frame width)`, String(DEST.x * 100))
  await setField(page, `Move 1 top edge of ${POSITION} (percent of frame height)`, String(DEST.y * 100))
}

/** The card's box and the stage's, in one page read, so both come from one render. */
async function cardAgainstStage(page: Page) {
  return page.getByTestId('preview-overlay-card-0').evaluate((card) => {
    const stage = card.parentElement!.getBoundingClientRect()
    const own = card.getBoundingClientRect()
    return {
      stageWidth: stage.width,
      stageHeight: stage.height,
      left: own.left - stage.left,
      top: own.top - stage.top,
      width: own.width,
      height: own.height,
    }
  })
}

/** The largest edge error, in pixels, between the card and `rect` scaled to the stage. */
async function cardErrorPx(page: Page, rect: typeof OWN): Promise<number> {
  const box = await cardAgainstStage(page)
  return Math.max(
    Math.abs(box.left - rect.x * box.stageWidth),
    Math.abs(box.top - rect.y * box.stageHeight),
    Math.abs(box.width - rect.width * box.stageWidth),
    Math.abs(box.height - rect.height * box.stageHeight),
  )
}

test('a Move glides the overlay\'s card: its own placement before, halfway at the midpoint, the destination after (#834)', async ({
  page,
}, testInfo) => {
  await populate(page)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  for (const [time, rect, what] of [
    ['0.5', OWN, 'before the glide'],
    ['2', MID, 'at the glide\'s midpoint'],
    ['3.5', DEST, 'after the glide'],
  ] as const) {
    await seek.fill(time)
    // Polled: the seek commits a render after the input event (quality-and-ci.md).
    await expect
      .poll(() => cardErrorPx(page, rect), { message: `the card ${what} (${time} s), in px` })
      .toBeLessThanOrEqual(TOLERANCE_PX)
    if (time === '2') {
      await page.getByTestId('preview-frame').screenshot({ path: testInfo.outputPath('move-midpoint.png') })
    }
  }
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  test(`at ${viewport.width}px, an overlay's Move fields lie inside its row and the page does not scroll sideways (#834)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populate(page)
    const what = `at ${viewport.width}px`
    const row = page.getByRole('list', { name: 'Overlay layers' }).getByRole('listitem').first()
    const column = page.getByRole('main')
    const controls = [
      page.getByRole('spinbutton', { name: `Move 1 start of ${POSITION} in seconds` }),
      page.getByRole('spinbutton', { name: `Move 1 glide of ${POSITION} in seconds` }),
      page.getByRole('spinbutton', { name: `Move 1 left edge of ${POSITION} (percent of frame width)` }),
      page.getByRole('spinbutton', { name: `Move 1 top edge of ${POSITION} (percent of frame height)` }),
      page.getByRole('spinbutton', { name: `Move 1 width of ${POSITION} (percent of frame width)` }),
      page.getByRole('spinbutton', { name: `Move 1 height of ${POSITION} (percent of frame height)` }),
      page.getByRole('button', { name: `Remove move 1 from ${POSITION}` }),
    ]
    for (const [index, control] of controls.entries()) {
      await expectWithin(control, row, { axis: 'x', what: `Move control ${index + 1} in its row ${what}` })
      await expectWithin(control, column, { axis: 'x', what: `Move control ${index + 1} in the column ${what}` })
    }
    await expectNoHorizontalScroll(page, `with a Move on the overlay row ${what}`)
    await row.screenshot({ path: testInfo.outputPath(`move-row-${viewport.width}.png`) })
  })
}
