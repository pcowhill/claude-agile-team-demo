import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { FrameSample, SampleRect } from './decodedFrame'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * A zoom on an overlay's own picture (#699), from decoded pixels of a real
 * export and from the preview. The base is the default red slate (#143); the
 * overlay a still whose left half is green and right half blue, 16:9 like
 * its default card (0.62, 0.62)–(0.97, 0.97), so it fills the card exactly.
 *
 * The zoom is 2x on the right edge's centre (centre x 0.75, the furthest a
 * 2x region can sit), holding from 1.25 s to 2.25 s. During the hold the
 * card's left and right quarters both read blue; before and after it the
 * left reads green and the right blue; and the base outside the card reads
 * red throughout — the rectangle itself never grows.
 */

const SLATE_SECONDS = 3.5
const POSITION = 'overlay halves.png at position 1'

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

/** Exports with the current settings and returns the file's bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

/**
 * Card regions as fractions of the card, and their frame-fraction form for
 * the export: a quarter well inside each half, clear of the seam and of the
 * card's edges, which VP9 softens.
 */
const CARD = { x: 0.62, y: 0.62, size: 0.35 }
const LEFT = { fx: 0.08, fy: 0.4, fw: 0.15, fh: 0.2 }
const RIGHT = { fx: 0.77, fy: 0.4, fw: 0.15, fh: 0.2 }
const inFrame = (region: typeof LEFT): SampleRect => ({
  x: CARD.x + CARD.size * region.fx,
  y: CARD.y + CARD.size * region.fy,
  width: CARD.size * region.fw,
  height: CARD.size * region.fh,
})
const BASE: SampleRect = { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }

// Colour by the dominant channel, with a 60/255 margin: VP9's chroma
// subsampling and the preview's scaling both soften a flat colour by far
// less than that, and the three colours here differ by ~200 in their own
// channel. The preview is held to the same test, which is the tolerance it
// is compared to the export within.
type Rgb = Pick<FrameSample, 'r' | 'g' | 'b'>
const isGreen = (c: Rgb) => c.g > c.r + 60 && c.g > c.b + 60
const isBlue = (c: Rgb) => c.b > c.r + 60 && c.b > c.g + 60
const isRed = (c: Rgb) => c.r > c.g + 60 && c.r > c.b + 60

/** Per-channel average of a screenshot clip, decoded in-page. */
async function sampleScreenRect(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Rgb> {
  const png = await page.screenshot({ clip: rect })
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let r = 0
    let g = 0
    let b = 0
    const pixels = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels }
  }, png.toString('base64'))
}

async function setField(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

test('a 2x overlay zoom on the right half shows blue across the whole card during its hold (#699)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')

  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill(String(SLATE_SECONDS))
  await duration.blur()

  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')

  await chooseEffect(page, POSITION, 'Zoom')
  await setField(page, `Zoom 1 start of ${POSITION} in seconds`, '1')
  await setField(page, `Zoom 1 ramp-in of ${POSITION} in seconds`, '0.25')
  await setField(page, `Zoom 1 hold of ${POSITION} in seconds`, '1')
  await setField(page, `Zoom 1 ramp-out of ${POSITION} in seconds`, '0.25')
  await setField(page, `Zoom 1 scale of ${POSITION}`, '2')
  await setField(page, `Zoom 1 centre X of ${POSITION} (0 to 1)`, '0.75')
  await setField(page, `Zoom 1 centre Y of ${POSITION} (0 to 1)`, '0.5')

  // The export, at 0.5 s (before), 1.75 s (mid-hold) and 3 s (after).
  const exported = await exportOnce(page)
  const at = (time: number, rect: SampleRect) =>
    sampleExportedFrame(page, exported, SLATE_SECONDS - time, rect)
  for (const time of [0.5, 3]) {
    const left = await at(time, inFrame(LEFT))
    const right = await at(time, inFrame(RIGHT))
    expect(isGreen(left), `export left quarter at ${time}s ${JSON.stringify(left)}`).toBe(true)
    expect(isBlue(right), `export right quarter at ${time}s ${JSON.stringify(right)}`).toBe(true)
  }
  const heldLeft = await at(1.75, inFrame(LEFT))
  const heldRight = await at(1.75, inFrame(RIGHT))
  expect(heldLeft.width).toBe(640)
  expect(isBlue(heldLeft), `export left quarter in the hold ${JSON.stringify(heldLeft)}`).toBe(true)
  expect(isBlue(heldRight), `export right quarter in the hold ${JSON.stringify(heldRight)}`).toBe(true)
  for (const time of [0.5, 1.75, 3]) {
    const base = await at(time, BASE)
    expect(isRed(base), `export base outside the card at ${time}s ${JSON.stringify(base)}`).toBe(true)
  }

  // The preview, paused at the same instants: the same classification.
  const card = page.getByTestId('preview-overlay-card-0')
  const sampleCard = async (region: typeof LEFT) => {
    await card.scrollIntoViewIfNeeded()
    const box = (await card.boundingBox())!
    return sampleScreenRect(page, {
      x: box.x + box.width * region.fx,
      y: box.y + box.height * region.fy,
      width: box.width * region.fw,
      height: box.height * region.fh,
    })
  }
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('1.75')
  await expect.poll(async () => isBlue(await sampleCard(LEFT))).toBe(true)
  expect(isBlue(await sampleCard(RIGHT))).toBe(true)
  // The card itself does not grow: its box is still the placed rectangle.
  const stage = (await page.getByTestId('preview-overlay-card-0').evaluate((el) => {
    const parent = el.parentElement!.getBoundingClientRect()
    const own = el.getBoundingClientRect()
    return { left: (own.left - parent.left) / parent.width, width: own.width / parent.width }
  }))
  expect(stage.left).toBeCloseTo(0.62, 2)
  expect(stage.width).toBeCloseTo(0.35, 2)
  for (const time of ['0.5', '3']) {
    await seek.fill(time)
    await expect.poll(async () => isGreen(await sampleCard(LEFT))).toBe(true)
    expect(isBlue(await sampleCard(RIGHT))).toBe(true)
  }
})

test("an overlay's zoom fields and + Effect ▾ stay inside its row at 360px (#699)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')
  // Populated: a base entry under the overlay, as #534 asks of a layout check.
  await chooseFromAddMenu(page, ADD_SLATE)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await chooseEffect(page, POSITION, 'Zoom')

  // Against the editor column, not the row: a row that widened with its
  // contents would contain them and still push the page sideways.
  const column = page.getByRole('main')
  const controls = [
    page.getByRole('spinbutton', { name: `Zoom 1 start of ${POSITION} in seconds` }),
    page.getByRole('spinbutton', { name: `Zoom 1 ramp-out of ${POSITION} in seconds` }),
    page.getByRole('spinbutton', { name: `Zoom 1 scale of ${POSITION}` }),
    page.getByRole('spinbutton', { name: `Zoom 1 centre Y of ${POSITION} (0 to 1)` }),
    page.getByRole('button', { name: `Remove zoom 1 from ${POSITION}` }),
    page.getByRole('button', { name: `+ Effect on ${POSITION}`, exact: true }),
  ]
  for (const [index, control] of controls.entries()) {
    await expectWithin(control, column, { axis: 'x', what: `zoom control ${index + 1} at 360px` })
  }
  await expectNoHorizontalScroll(page, '360px with an overlay zoom')
})
