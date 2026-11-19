import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { FrameSample, SampleRect } from './decodedFrame'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { openPicture } from './pictureDisclosure'
import { choosePreviewLayout } from './previewView'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * An overlay's border (#697), from decoded pixels of a real export and from
 * the preview. The base is a white slate; the overlay a still whose left
 * half is green and right half blue, 16:9 like its default card
 * (0.62, 0.62)–(0.97, 0.97) on the 640×360 output frame, so it fills the
 * card exactly. The border is 10 px of red at that frame.
 *
 * Rectangle: a band 3–7.5 px outside the card's left and top edges reads
 * red, and a strip 3–8 px inside its left edge reads the picture's green —
 * the border is outside, so the picture keeps its edge pixels.
 * The rectangle's band is sharp-cornered: just outside the card's corner,
 * diagonally, reads red too.
 * Ellipse: the band beside the ellipse's leftmost and topmost points still
 * reads red, but the card's own top-left corner, inside it and just outside
 * it — outside the ellipse by far more than 10 px — reads the white base,
 * not red. The outside sample is what tells an ellipse's band from a
 * rectangle's.
 */

const SLATE_SECONDS = 3
const POSITION = 'overlay halves.png at position 1'
const W = 640
const H = 360
// The card in output pixels.
const LEFT = 0.62 * W
const TOP = 0.62 * H
const RIGHT = 0.97 * W
const MID_Y = (0.62 + 0.97) / 2 * H
const MID_X = (LEFT + RIGHT) / 2
/** A rectangle in output pixels, as frame fractions. */
const px = (x: number, y: number, width: number, height: number): SampleRect => ({
  x: x / W,
  y: y / H,
  width: width / W,
  height: height / H,
})
const POINTS = {
  // 3–7.5 px outside the left edge, beside the card's (and ellipse's) middle.
  leftBand: px(LEFT - 7.5, MID_Y - 10, 4.5, 20),
  // 3–7.5 px above the top edge, beside the card's (and ellipse's) middle.
  topBand: px(MID_X - 20, TOP - 7.5, 40, 4.5),
  // 3–8 px inside the left edge: the picture's green half.
  insideLeft: px(LEFT + 3, MID_Y - 10, 5, 20),
  // The card's top-left corner, 1–6 px in: outside an inscribed ellipse.
  corner: px(LEFT + 1, TOP + 1, 5, 4),
  // 3–7 px outside the card's top-left corner, diagonally: inside a
  // rectangle's band (its corner is sharp, as a CSS border's is), and far
  // outside an ellipse's.
  outsideCorner: px(LEFT - 7, TOP - 7, 4, 4),
  // The base, well away from the card.
  base: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
}

// Colour by the dominant channel, with a 60/255 margin, as the overlay-zoom
// spec does (#699); white is every channel above 170. VP9's chroma
// subsampling and the preview's scaling soften a flat colour by far less
// than either margin. The preview is held to the same tests, which is the
// tolerance it is compared to the export within.
type Rgb = Pick<FrameSample, 'r' | 'g' | 'b'>
const isGreen = (c: Rgb) => c.g > c.r + 60 && c.g > c.b + 60
const isRed = (c: Rgb) => c.r > c.g + 60 && c.r > c.b + 60
const isWhite = (c: Rgb) => c.r > 170 && c.g > 170 && c.b > 170

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

/** A white slate with the halves still over it, its Picture ▸ open. */
async function setUp(page: Page) {
  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill(String(SLATE_SECONDS))
  await duration.blur()
  await page.getByLabel('Color of Color slate at position 1').fill('#ffffff')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await openPicture(page, POSITION)
}

async function setBorder(page: Page, thickness: string, colour: string) {
  await page.getByLabel(`Border colour of ${POSITION}`).fill(colour)
  const field = page.getByRole('spinbutton', { name: `Border thickness of ${POSITION} in pixels` })
  await field.fill(thickness)
  await field.blur()
  await expect(field).toHaveValue(thickness)
}

/** The preview stage's on-screen box: the card's parent, the frame proxy. */
async function stageBox(page: Page) {
  const card = page.getByTestId('preview-overlay-card-0')
  await card.scrollIntoViewIfNeeded()
  return await card.evaluate((el) => {
    const box = el.parentElement!.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
}

async function samplePreview(page: Page, rect: SampleRect): Promise<Rgb> {
  const stage = await stageBox(page)
  return sampleScreenRect(page, {
    x: stage.x + stage.width * rect.x,
    y: stage.y + stage.height * rect.y,
    width: Math.max(1, stage.width * rect.width),
    height: Math.max(1, stage.height * rect.height),
  })
}

test('a 10 px red border reads red just outside the card and the picture just inside, in the export and the preview (#697)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await setUp(page)
  await setBorder(page, '10', '#ff0000')

  const exported = await exportOnce(page)
  const at = (rect: SampleRect) => sampleExportedFrame(page, exported, SLATE_SECONDS / 2, rect)
  const leftBand = await at(POINTS.leftBand)
  expect(leftBand.width).toBe(W)
  expect(isRed(leftBand), `export left band ${JSON.stringify(leftBand)}`).toBe(true)
  const topBand = await at(POINTS.topBand)
  expect(isRed(topBand), `export top band ${JSON.stringify(topBand)}`).toBe(true)
  const outsideCorner = await at(POINTS.outsideCorner)
  expect(isRed(outsideCorner), `export outside the corner ${JSON.stringify(outsideCorner)}`).toBe(true)
  const inside = await at(POINTS.insideLeft)
  expect(isGreen(inside), `export just inside ${JSON.stringify(inside)}`).toBe(true)
  const base = await at(POINTS.base)
  expect(isWhite(base), `export base ${JSON.stringify(base)}`).toBe(true)

  // The preview, at a size where the band is wider than its sample: Fit to
  // width scales the 640 px frame to ~1.2×.
  await choosePreviewLayout(page, 'Fit to width')
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(SLATE_SECONDS / 2))
  await expect.poll(async () => isRed(await samplePreview(page, POINTS.leftBand))).toBe(true)
  expect(isRed(await samplePreview(page, POINTS.topBand))).toBe(true)
  expect(isRed(await samplePreview(page, POINTS.outsideCorner))).toBe(true)
  expect(isGreen(await samplePreview(page, POINTS.insideLeft))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.base))).toBe(true)
})

test('with the Ellipse mask the border follows the ellipse: the card corner reads the base, not red (#697)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await setUp(page)
  await page.getByRole('combobox', { name: `Shape mask of ${POSITION}` }).selectOption('ellipse')
  await setBorder(page, '10', '#ff0000')

  const exported = await exportOnce(page)
  const at = (rect: SampleRect) => sampleExportedFrame(page, exported, SLATE_SECONDS / 2, rect)
  const leftBand = await at(POINTS.leftBand)
  expect(isRed(leftBand), `export band beside the ellipse's left ${JSON.stringify(leftBand)}`).toBe(true)
  const topBand = await at(POINTS.topBand)
  expect(isRed(topBand), `export band above the ellipse's top ${JSON.stringify(topBand)}`).toBe(true)
  const corner = await at(POINTS.corner)
  expect(isWhite(corner), `export card corner ${JSON.stringify(corner)}`).toBe(true)
  const outsideCorner = await at(POINTS.outsideCorner)
  expect(isWhite(outsideCorner), `export outside the corner ${JSON.stringify(outsideCorner)}`).toBe(true)

  await choosePreviewLayout(page, 'Fit to width')
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(SLATE_SECONDS / 2))
  await expect.poll(async () => isRed(await samplePreview(page, POINTS.leftBand))).toBe(true)
  expect(isRed(await samplePreview(page, POINTS.topBand))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.corner))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.outsideCorner))).toBe(true)
})

test("an overlay's Border fields stay inside the editor column at 360px (#697)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')
  // Populated: a base entry under the overlay, as #534 asks of a layout check.
  await setUp(page)
  await setBorder(page, '10', '#ff0000')

  // Against the editor column, not the row: a row that widened with its
  // contents would contain them and still push the page sideways.
  const column = page.getByRole('main')
  const controls = [
    page.getByLabel(`Border colour of ${POSITION}`),
    page.getByRole('spinbutton', { name: `Border thickness of ${POSITION} in pixels` }),
    page.getByRole('slider', { name: `Border thickness of ${POSITION} in pixels slider` }),
  ]
  for (const [index, control] of controls.entries()) {
    await expectWithin(control, column, { axis: 'x', what: `border control ${index + 1} at 360px` })
  }
  await expectNoHorizontalScroll(page, '360px with an overlay border')
})
