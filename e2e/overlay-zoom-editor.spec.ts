import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The zoom editor on an overlay's zoom (#734), in a real browser. The base is
 * the default red slate (#143); the overlay a still whose left half is green
 * and right half blue, 16:9 like its default card (0.62, 0.62)–(0.97, 0.97),
 * so it fills the card exactly — `overlay-zoom.spec.ts`'s picture.
 *
 * - The editor's still is the overlay's own picture: green on its left, blue
 *   on its right, and no red anywhere, although the frame it is cut from is
 *   mostly red slate.
 * - Dragging the region to the picture's right half commits a centre x above
 *   0.5, in one undo step.
 * - At 360px on that populated project, the editor and its still sit inside
 *   the editor column, and the page does not scroll sideways.
 */

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

/** The red slate, and the halves image as an overlay on it with one zoom. */
async function overlayWithZoom(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await chooseEffect(page, POSITION, 'Zoom')
  await expect(page.getByRole('spinbutton', { name: `Zoom 1 centre X of ${POSITION} (0 to 1)` })).toHaveValue(
    '0.5',
  )
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: `Adjust Zoom 1 of ${POSITION} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust Zoom 1 of ${POSITION}` })
  await expect(editor).toBeVisible()
  // The still has landed and is laid out, not the pending placeholder.
  await expect
    .poll(() =>
      editor.getByTestId('frame-editor-image').evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(editor.getByTestId('frame-editor-updating')).toHaveCount(0)
  return editor
}

type Rgb = { r: number; g: number; b: number }
// Colour by the dominant channel, with `overlay-zoom.spec.ts`'s 60/255
// margin: the three colours differ by ~200 in their own channel.
const isGreen = (c: Rgb) => c.g > c.r + 60 && c.g > c.b + 60
const isBlue = (c: Rgb) => c.b > c.r + 60 && c.b > c.g + 60
const isRed = (c: Rgb) => c.r > c.g + 60 && c.r > c.b + 60

/** The average colour of a part of an element's box, as fractions of the box, from a screenshot. */
async function sampleBox(page: Page, target: Locator, part: { x: number; y: number; width: number; height: number }) {
  const box = (await target.boundingBox())!
  const png = await page.screenshot({
    clip: {
      x: box.x + box.width * part.x,
      y: box.y + box.height * part.y,
      width: Math.max(1, box.width * part.width),
      height: Math.max(1, box.height * part.height),
    },
  })
  return page.evaluate(async (base64): Promise<Rgb> => {
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
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
    }
    const pixels = data.length / 4
    return { r: r / pixels, g: g / pixels, b: b / pixels }
  }, png.toString('base64'))
}

test('an overlay zoom’s editor shows the overlay’s own picture, and dragging the region right commits a centre x above 0.5 in one undo step (#734)', async ({
  page,
}) => {
  await overlayWithZoom(page)
  const editor = await openEditor(page)
  const frame = editor.getByTestId('frame-editor-frame')
  // On screen, so the screenshots below sample it and the drag lands on it.
  await frame.scrollIntoViewIfNeeded()

  // The still's box has the overlay's aspect (16:9, a 0.35 × 0.35 card on a
  // 16:9 frame), not some other part of the frame's.
  const frameBox = (await frame.boundingBox())!
  expect(frameBox.width / frameBox.height).toBeCloseTo(16 / 9, 1)

  // The overlay's picture: green on the left, blue on the right. The
  // samples sit outside the zoom's region (the middle half), where the
  // shade dims the picture but keeps its hue, and away from the card's
  // edges and the seam.
  const left = await sampleBox(page, frame, { x: 0.05, y: 0.4, width: 0.12, height: 0.2 })
  const right = await sampleBox(page, frame, { x: 0.83, y: 0.4, width: 0.12, height: 0.2 })
  expect(isGreen(left), `left of the editor's still: ${JSON.stringify(left)}`).toBe(true)
  expect(isBlue(right), `right of the editor's still: ${JSON.stringify(right)}`).toBe(true)
  // No red slate anywhere along its middle row: the still is the card alone.
  for (const x of [0.02, 0.3, 0.6, 0.9]) {
    const sample = await sampleBox(page, frame, { x, y: 0.45, width: 0.06, height: 0.1 })
    expect(isRed(sample), `the editor's still at x ${x}: ${JSON.stringify(sample)}`).toBe(false)
  }

  // Drag the region (scale 2, the middle half) rightwards by a fifth of the
  // picture: the centre goes from 0.5 to the right half.
  const region = editor.getByTestId('frame-editor-rect')
  const regionBox = (await region.boundingBox())!
  const from = { x: regionBox.x + regionBox.width / 2, y: regionBox.y + regionBox.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + frameBox.width * 0.2, from.y, { steps: 8 })
  await page.mouse.up()

  const centreX = page.getByRole('spinbutton', { name: `Zoom 1 centre X of ${POSITION} (0 to 1)` })
  const centreY = page.getByRole('spinbutton', { name: `Zoom 1 centre Y of ${POSITION} (0 to 1)` })
  await expect.poll(async () => Number(await centreX.inputValue())).toBeGreaterThan(0.5)
  await expect(centreY).toHaveValue('0.5')

  // One gesture, one undo step.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(centreX).toHaveValue('0.5')
})

test('an overlay zoom’s editor fits the editor column at 360px on a populated project (#734)', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await overlayWithZoom(page)
  const editor = await openEditor(page)
  await editor.scrollIntoViewIfNeeded()
  // Against the editor column, not the row: a row that widened with its
  // contents would contain them and still push the page sideways.
  const column = page.getByRole('main')
  await expectWithin(editor, column, { axis: 'x', what: 'the overlay zoom editor at 360px' })
  await expectWithin(editor.getByTestId('frame-editor-frame'), editor, {
    axis: 'x',
    what: "the overlay zoom editor's still at 360px",
  })
  await expectWithin(editor.getByRole('checkbox', { name: 'Show result' }), editor, {
    axis: 'x',
    what: "the overlay zoom editor's Show result at 360px",
  })
  await expectNoHorizontalScroll(page, 'with an overlay zoom editor open at 360px')
  await editor.screenshot({ path: testInfo.outputPath('overlay-zoom-editor-360.png') })
})
