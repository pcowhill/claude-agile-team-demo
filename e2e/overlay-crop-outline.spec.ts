import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { FrameSample, SampleRect } from './decodedFrame'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { openPicture } from './pictureDisclosure'
import { choosePreviewLayout } from './previewView'

type Page = import('@playwright/test').Page

/**
 * A cropped overlay's border, shape mask and shadow follow the picture the
 * crop kept, not the overlay's placed card (#791, from the customer's
 * #785), read from decoded pixels of a real export and from the preview.
 *
 * The base is a white slate; the overlay a 320×180 still whose left half is
 * green and right half blue, on the default card (0.62, 0.62)–(0.97, 0.97)
 * of the 640×360 output frame. Cropping 25% off each side keeps the middle
 * 160×180 (green then blue), which letterboxes in the 224×126 card as a
 * 112×126 picture with a 56 px transparent gutter either side.
 *
 * Every check pairs a sample at the picture's edge with one at the card's
 * edge, so each tells the two outlines apart: before #791 the band, the
 * ellipse and the shadow all sat on the card, in the opposite places.
 */

const SLATE_SECONDS = 3
const POSITION = 'overlay halves.png at position 1'
const W = 640
const H = 360
// The card in output pixels.
const LEFT = 0.62 * W
const TOP = 0.62 * H
const RIGHT = 0.97 * W
const MID_Y = ((0.62 + 0.97) / 2) * H
const MID_X = (LEFT + RIGHT) / 2
// The picture: 112 px wide, centred in the card, full height.
const PICTURE_LEFT = MID_X - 56
const PICTURE_RIGHT = MID_X + 56
const BAND = 10
const OFFSET = 10
/** A rectangle in output pixels, as frame fractions. */
const px = (x: number, y: number, width: number, height: number): SampleRect => ({
  x: x / W,
  y: y / H,
  width: width / W,
  height: height / H,
})
const POINTS = {
  // 3–7.5 px outside the picture's left edge, at its middle: in the gutter.
  pictureLeftBand: px(PICTURE_LEFT - 7.5, MID_Y - 10, 4.5, 20),
  // 3–7.5 px outside the card's left edge, where the band used to be.
  cardLeftBand: px(LEFT - 7.5, MID_Y - 10, 4.5, 20),
  // 3–7.5 px above the picture's top edge — the card's too, at full height.
  topBand: px(MID_X - 20, TOP - 7.5, 40, 4.5),
  // 3–8 px inside the picture's left edge: the kept region's green.
  insidePictureLeft: px(PICTURE_LEFT + 3, MID_Y - 10, 5, 20),
  // 3–8 px inside its right edge: the kept region's blue.
  insidePictureRight: px(PICTURE_RIGHT - 8, MID_Y - 10, 5, 20),
  // The middle of the left gutter: nothing of the overlay draws there.
  gutter: px(LEFT + 15, MID_Y - 10, 25, 20),
  // The picture's own top-left corner, 1–6 px in: outside an inscribed ellipse.
  pictureCorner: px(PICTURE_LEFT + 1, TOP + 1, 5, 4),
  // 3–8 px right of the picture, at its middle: where its shadow falls.
  pictureRightShadow: px(PICTURE_RIGHT + 3, MID_Y - 10, 5, 20),
  // 3–8 px right of the card: where the card's shadow used to fall.
  cardRightShadow: px(RIGHT + 3, MID_Y - 10, 5, 20),
}

// The overlay-border spec's colour tests (#697), margins and all.
type Rgb = Pick<FrameSample, 'r' | 'g' | 'b'>
const isGreen = (c: Rgb) => c.g > c.r + 60 && c.g > c.b + 60
const isBlue = (c: Rgb) => c.b > c.r + 60 && c.b > c.g + 60
const isRed = (c: Rgb) => c.r > c.g + 60 && c.r > c.b + 60
const isWhite = (c: Rgb) => c.r > 170 && c.g > 170 && c.b > 170
const isBlack = (c: Rgb) => c.r < 60 && c.g < 60 && c.b < 60

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

async function setField(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** A white slate with the halves still over it, cropped 25% each side. */
async function setUp(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', String(SLATE_SECONDS))
  await page.getByLabel('Color of Color slate at position 1').fill('#ffffff')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await openPicture(page, POSITION)
  await setField(page, `Crop left of ${POSITION} (percent)`, '25')
  await setField(page, `Crop right of ${POSITION} (percent)`, '25')
}

async function setBorder(page: Page) {
  await page.getByLabel(`Border colour of ${POSITION}`).fill('#ff0000')
  await setField(page, `Border thickness of ${POSITION} in pixels`, String(BAND))
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

/** The preview at Fit to width (~1.2× the 640 px frame), at the slate's middle. */
async function showPreview(page: Page) {
  await choosePreviewLayout(page, 'Fit to width')
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(SLATE_SECONDS / 2))
}

/**
 * Each named point's colour test, read in the export and then in the
 * preview, the preview polled on its first point until its layers paint.
 */
async function expectBoth(
  page: Page,
  exported: Buffer,
  checks: Array<[keyof typeof POINTS, (c: Rgb) => boolean, string]>,
) {
  for (const [point, test, what] of checks) {
    const sample = await sampleExportedFrame(page, exported, SLATE_SECONDS / 2, POINTS[point])
    expect(sample.width).toBe(W)
    expect(test(sample), `export ${point} should be ${what}: ${JSON.stringify(sample)}`).toBe(true)
  }
  await showPreview(page)
  const [[first, firstTest]] = checks
  await expect.poll(async () => firstTest(await samplePreview(page, POINTS[first]))).toBe(true)
  for (const [point, test, what] of checks) {
    const sample = await samplePreview(page, POINTS[point])
    expect(test(sample), `preview ${point} should be ${what}: ${JSON.stringify(sample)}`).toBe(true)
  }
}

test('a cropped overlay\'s border outlines the picture the crop kept, not the card (#791)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await setUp(page)
  await setBorder(page)
  const exported = await exportOnce(page)
  await expectBoth(page, exported, [
    ['pictureLeftBand', isRed, 'red: the band beside the picture'],
    ['topBand', isRed, 'red: the band above the picture'],
    ['cardLeftBand', isWhite, "white: the card's edge has no band"],
    ['gutter', isWhite, 'white: the gutter stays empty'],
    ['insidePictureLeft', isGreen, "green: the picture keeps its edge"],
  ])
})

test('a cropped overlay\'s ellipse is inscribed in the picture, its border with it (#791)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await setUp(page)
  await page.getByRole('combobox', { name: `Shape mask of ${POSITION}` }).selectOption('ellipse')
  await setBorder(page)
  const exported = await exportOnce(page)
  await expectBoth(page, exported, [
    // The ellipse's leftmost point is the picture's left edge, not the card's.
    ['pictureLeftBand', isRed, "red: the band beside the ellipse's left"],
    ['topBand', isRed, "red: the band above the ellipse's top"],
    ['cardLeftBand', isWhite, 'white: no band at the card'],
    ['pictureCorner', isWhite, "white: the picture's corner is outside the ellipse"],
    ['insidePictureLeft', isGreen, "green: inside the ellipse's left"],
  ])
})

test('a cropped overlay casts its shadow from the picture: into the gutter, not past the card (#791)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await setUp(page)
  await page.getByRole('checkbox', { name: `Shadow of ${POSITION}` }).check()
  await setField(page, `Shadow opacity of ${POSITION} in percent`, '100')
  await setField(page, `Shadow blur of ${POSITION} in pixels`, '0')
  await setField(page, `Shadow x offset of ${POSITION} in pixels`, String(OFFSET))
  await setField(page, `Shadow y offset of ${POSITION} in pixels`, String(OFFSET))
  const exported = await exportOnce(page)
  await expectBoth(page, exported, [
    ['pictureRightShadow', isBlack, 'black: the shadow right of the picture, in the gutter'],
    ['cardRightShadow', isWhite, "white: nothing right of the card"],
    ['insidePictureRight', isBlue, 'blue: the picture is not darkened'],
    ['gutter', isWhite, 'white: the left gutter stays empty'],
  ])
})
