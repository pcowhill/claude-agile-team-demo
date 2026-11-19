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
 * An overlay's drop shadow (#698), from decoded pixels of a real export and
 * from the preview. The base is a white slate; the overlay a still whose
 * left half is green and right half blue, 16:9 like its default card
 * (0.62, 0.62)–(0.97, 0.97) on the 640×360 output frame, so it fills the
 * card exactly — #697's border spec's set-up. The shadow is black at 100 %,
 * offset 10 px right and 10 px down.
 *
 * Rectangle, blur 0: the strip the offset uncovers right of the card and
 * below it reads black, and so does the offset rectangle's corner past the
 * card's; the bands just left of and above the card read white; the
 * picture just inside its right edge keeps its blue — the shadow lies only
 * outside the overlay.
 * Blur 12 px: three samples crossing the shadow's right edge (x = 630.8)
 * read lighter and lighter.
 * Ellipse: right of the ellipse's rightmost point the offset ellipse's
 * shadow still reads black, but the offset rectangle's corner, outside the
 * offset ellipse, reads the white slate.
 */

const SLATE_SECONDS = 3
const POSITION = 'overlay halves.png at position 1'
const W = 640
const H = 360
// The card in output pixels: 396.8–620.8 across, 223.2–349.2 down.
const LEFT = 0.62 * W
const TOP = 0.62 * H
const RIGHT = 0.97 * W
const BOTTOM = 0.97 * H
const MID_Y = ((0.62 + 0.97) / 2) * H
const MID_X = ((0.62 + 0.97) / 2) * W
const OFFSET = 10
/** A rectangle in output pixels, as frame fractions. */
const px = (x: number, y: number, width: number, height: number): SampleRect => ({
  x: x / W,
  y: y / H,
  width: width / W,
  height: height / H,
})
const POINTS = {
  // 3–7 px right of the card, beside its middle (offset by 10 down, so
  // well inside the shadow's span): the uncovered strip on the right.
  rightStrip: px(RIGHT + 3, MID_Y, 4, 20),
  // 3–7 px below the card, beside its middle: the uncovered strip below.
  bottomStrip: px(MID_X - 20, BOTTOM + 3, 40, 4),
  // 3–7 px past the card's bottom-right corner on both axes: inside the
  // offset rectangle's corner, and outside an offset ellipse.
  offsetCorner: px(RIGHT + 3, BOTTOM + 3, 4, 4),
  // 3–7.5 px left of the card and above it: where the shadow does not fall.
  leftBand: px(LEFT - 7.5, MID_Y - 10, 4.5, 20),
  topBand: px(MID_X - 20, TOP - 7.5, 40, 4.5),
  // 3–8 px inside the card's right edge: the picture's blue half.
  insideRight: px(RIGHT - 8, MID_Y - 10, 5, 20),
  // Right of the ellipse's rightmost point, at its offset middle height:
  // inside the offset ellipse, outside the overlay's own.
  rightOfEllipse: px(RIGHT + 3, MID_Y + OFFSET - 5, 4, 10),
  // The base, well away from the card.
  base: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
}
/**
 * Three 2 px columns crossing the blurred shadow's right edge at x = 630.8:
 * 6.8 px inside it, on it, and 5.2 px outside it. A 12 px `shadowBlur` is a
 * Gaussian of σ = 6, so the shadow's coverage there is about 0.87, 0.5 and
 * 0.19 — darkness falling by over 75 levels a step, far beyond any codec or
 * scaling noise.
 */
const BLUR_COLUMNS = [623, 629.8, 635].map((x) => px(x, MID_Y, 2, 20))

// Black is every channel below 60, white every channel above 170, green
// and blue the dominant channel by 60 — #697's margins. VP9's chroma
// subsampling and the preview's scaling soften a flat colour by far less.
// The preview is held to the same tests, which is the tolerance it is
// compared to the export within, in both engines.
type Rgb = Pick<FrameSample, 'r' | 'g' | 'b'>
const isBlack = (c: Rgb) => c.r < 60 && c.g < 60 && c.b < 60
const isWhite = (c: Rgb) => c.r > 170 && c.g > 170 && c.b > 170
const isBlue = (c: Rgb) => c.b > c.r + 60 && c.b > c.g + 60
const lightness = (c: Rgb) => (c.r + c.g + c.b) / 3
/** Strictly lighter from one sample to the next, by at least `step` levels. */
const lightening = (samples: Rgb[], step = 30) =>
  samples.every((sample, index) => index === 0 || lightness(sample) > lightness(samples[index - 1]) + step)

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

async function setField(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** Turns the shadow on: black at 100 %, offset 10 px right and down, at `blur` px. */
async function setShadow(page: Page, blur: string) {
  await page.getByRole('checkbox', { name: `Shadow of ${POSITION}` }).check()
  await setField(page, `Shadow opacity of ${POSITION} in percent`, '100')
  await setField(page, `Shadow blur of ${POSITION} in pixels`, blur)
  await setField(page, `Shadow x offset of ${POSITION} in pixels`, String(OFFSET))
  await setField(page, `Shadow y offset of ${POSITION} in pixels`, String(OFFSET))
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
  await expect(page.getByTestId('preview-overlay-shadow-0')).toBeVisible()
}

test('a sharp black shadow offset 10 px fills the strips right of and below the card, not above or left, and not inside it (#698)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await setUp(page)
  await setShadow(page, '0')

  const exported = await exportOnce(page)
  const at = (rect: SampleRect) => sampleExportedFrame(page, exported, SLATE_SECONDS / 2, rect)
  const rightStrip = await at(POINTS.rightStrip)
  expect(rightStrip.width).toBe(W)
  expect(isBlack(rightStrip), `export right strip ${JSON.stringify(rightStrip)}`).toBe(true)
  const bottomStrip = await at(POINTS.bottomStrip)
  expect(isBlack(bottomStrip), `export bottom strip ${JSON.stringify(bottomStrip)}`).toBe(true)
  const offsetCorner = await at(POINTS.offsetCorner)
  expect(isBlack(offsetCorner), `export offset corner ${JSON.stringify(offsetCorner)}`).toBe(true)
  const leftBand = await at(POINTS.leftBand)
  expect(isWhite(leftBand), `export left of the card ${JSON.stringify(leftBand)}`).toBe(true)
  const topBand = await at(POINTS.topBand)
  expect(isWhite(topBand), `export above the card ${JSON.stringify(topBand)}`).toBe(true)
  const inside = await at(POINTS.insideRight)
  expect(isBlue(inside), `export just inside ${JSON.stringify(inside)}`).toBe(true)
  const base = await at(POINTS.base)
  expect(isWhite(base), `export base ${JSON.stringify(base)}`).toBe(true)

  await showPreview(page)
  await expect.poll(async () => isBlack(await samplePreview(page, POINTS.rightStrip))).toBe(true)
  expect(isBlack(await samplePreview(page, POINTS.bottomStrip))).toBe(true)
  expect(isBlack(await samplePreview(page, POINTS.offsetCorner))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.leftBand))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.topBand))).toBe(true)
  expect(isBlue(await samplePreview(page, POINTS.insideRight))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.base))).toBe(true)
})

test("a blurred shadow's edge is graded: three samples across it read lighter and lighter (#698)", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await setUp(page)
  await setShadow(page, '12')

  const exported = await exportOnce(page)
  const exportColumns: Rgb[] = []
  for (const column of BLUR_COLUMNS) {
    exportColumns.push(await sampleExportedFrame(page, exported, SLATE_SECONDS / 2, column))
  }
  expect(lightening(exportColumns), `export across the edge ${JSON.stringify(exportColumns)}`).toBe(true)

  await showPreview(page)
  await expect
    .poll(async () => {
      const columns: Rgb[] = []
      for (const column of BLUR_COLUMNS) columns.push(await samplePreview(page, column))
      return lightening(columns) ? 'graded' : JSON.stringify(columns)
    })
    .toBe('graded')
})

test('with the Ellipse mask the shadow is an offset ellipse: the offset rectangle corner reads the slate (#698)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await setUp(page)
  await page.getByRole('combobox', { name: `Shape mask of ${POSITION}` }).selectOption('ellipse')
  await setShadow(page, '0')

  const exported = await exportOnce(page)
  const at = (rect: SampleRect) => sampleExportedFrame(page, exported, SLATE_SECONDS / 2, rect)
  const rightOfEllipse = await at(POINTS.rightOfEllipse)
  expect(isBlack(rightOfEllipse), `export right of the ellipse ${JSON.stringify(rightOfEllipse)}`).toBe(true)
  const offsetCorner = await at(POINTS.offsetCorner)
  expect(isWhite(offsetCorner), `export offset corner ${JSON.stringify(offsetCorner)}`).toBe(true)

  await showPreview(page)
  await expect.poll(async () => isBlack(await samplePreview(page, POINTS.rightOfEllipse))).toBe(true)
  expect(isWhite(await samplePreview(page, POINTS.offsetCorner))).toBe(true)
})

test("an overlay's Shadow fields stay inside the editor column at 360px (#698)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')
  // Populated: a base entry under the overlay, as #534 asks of a layout check.
  await setUp(page)
  await setShadow(page, '12')

  // Against the editor column, not the row: a row that widened with its
  // contents would contain them and still push the page sideways.
  const column = page.getByRole('main')
  const controls = [
    page.getByRole('checkbox', { name: `Shadow of ${POSITION}` }),
    page.getByLabel(`Shadow colour of ${POSITION}`),
    page.getByRole('spinbutton', { name: `Shadow opacity of ${POSITION} in percent` }),
    page.getByRole('slider', { name: `Shadow opacity of ${POSITION} in percent slider` }),
    page.getByRole('spinbutton', { name: `Shadow blur of ${POSITION} in pixels` }),
    page.getByRole('slider', { name: `Shadow blur of ${POSITION} in pixels slider` }),
    page.getByRole('spinbutton', { name: `Shadow x offset of ${POSITION} in pixels` }),
    page.getByRole('spinbutton', { name: `Shadow y offset of ${POSITION} in pixels` }),
  ]
  for (const [index, control] of controls.entries()) {
    await expectWithin(control, column, { axis: 'x', what: `shadow control ${index + 1} at 360px` })
  }
  await expectNoHorizontalScroll(page, '360px with an overlay shadow')
})
