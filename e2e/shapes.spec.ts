import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SHAPES, ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * Shape groups (#683, the approved design #681): rectangles and ellipses
 * drawn on the output frame. The unit tests pin the drawing routine's calls;
 * these read pixels, because only a real canvas shows that the export, the
 * preview, Save frame and the GIF plugin all draw the same thing.
 *
 * The fixture is a blue colour slate, so the project composes at the 640×360
 * fallback frame and every sample point is a known pixel. Exported frames
 * are sampled from the end of the file, as the other export specs do,
 * because export overhead only ever pads the front.
 */

interface Rgb {
  r: number
  g: number
  b: number
}

const SLATE = { r: 0, g: 0, b: 204 }
const BORDER = { r: 0xe5, g: 0x39, b: 0x35 }
const GREEN = { r: 0, g: 255, b: 0 }

const group = (index = 1) => `shape group at position ${index}`
const shape = (kind: string, index: number, groupIndex = 1) =>
  `${kind} ${index} of ${group(groupIndex)}`

async function setField(page: Page, name: string, value: string): Promise<void> {
  const field = page.getByRole('spinbutton', { name, exact: true })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

async function addShape(page: Page, groupIndex: number, kind: 'Rectangle' | 'Ellipse') {
  await page.getByRole('button', { name: `Add a shape to ${group(groupIndex)}` }).click()
  await page.getByRole('menuitem', { name: kind, exact: true }).click()
}

/** A 3 s blue slate: the frame everything below is drawn on. */
async function blueSlate(page: Page): Promise<void> {
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', '3')
  await page.getByLabel('Color of Color slate at position 1').fill('#0000cc')
}

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * The parity fixture: one group, shown from 1.5 s to the end of the 3 s
 * slate, holding a red-bordered ellipse with a transparent centre and a
 * half-opaque green rectangle with no border.
 *
 * Geometry at 640×360: the ellipse's box is x 0.3–0.7, y 0.3–0.7, so its
 * top border is centred on (320, 108) and, at 20 px, spans y 98–118. The
 * rectangle covers x 0.05–0.25, y 0.05–0.25.
 */
async function parityFixture(page: Page): Promise<void> {
  await blueSlate(page)
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group()} in seconds`, '1.5')
  await setField(page, `Duration of ${group()} in seconds`, '10')
  const ellipse = shape('Ellipse', 1)
  await setField(page, `Left edge of ${ellipse} (0 to 1)`, '0.3')
  await setField(page, `Top edge of ${ellipse} (0 to 1)`, '0.3')
  await setField(page, `Width of ${ellipse} (fraction of frame width)`, '0.4')
  await setField(page, `Height of ${ellipse} (fraction of frame height)`, '0.4')
  await setField(page, `Border thickness of ${ellipse} in pixels`, '20')
  await addShape(page, 1, 'Rectangle')
  const rectangle = shape('Rectangle', 2)
  await setField(page, `Left edge of ${rectangle} (0 to 1)`, '0.05')
  await setField(page, `Top edge of ${rectangle} (0 to 1)`, '0.05')
  await setField(page, `Width of ${rectangle} (fraction of frame width)`, '0.2')
  await setField(page, `Height of ${rectangle} (fraction of frame height)`, '0.2')
  await setField(page, `Border thickness of ${rectangle} in pixels`, '0')
  await page.getByLabel(`Fill colour of ${rectangle}`).fill('#00ff00')
  await setField(page, `Fill opacity of ${rectangle} (percent)`, '50')
}

/** The sample points, as fractions of the frame. */
const POINTS: Record<'border' | 'inside' | 'filled', SampleRect> = {
  // Centred on the ellipse's top border, well inside its 20 px.
  border: { x: 0.49, y: 104 / 360, width: 0.02, height: 8 / 360 },
  // The ellipse's centre: its transparent middle.
  inside: { x: 0.47, y: 0.47, width: 0.06, height: 0.06 },
  // The middle of the half-opaque rectangle.
  filled: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
}

/** What a point over the slate reads once a shape colour lands at `alpha`. */
const over = (color: { r: number; g: number; b: number }, alpha: number) => ({
  r: color.r * alpha + SLATE.r * (1 - alpha),
  g: color.g * alpha + SLATE.g * (1 - alpha),
  b: color.b * alpha + SLATE.b * (1 - alpha),
})

/** Within `tolerance` per channel: lossy video moves a colour a little. */
function expectColor(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
  tolerance: number,
  what: string,
): void {
  const where = `${what}: read ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} ±${tolerance}`
  expect(Math.abs(actual.r - expected.r), where).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.g - expected.g), where).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.b - expected.b), where).toBeLessThanOrEqual(tolerance)
}

/** Averages a region of the preview's shape canvas, composited over the slate. */
async function samplePreviewShapes(page: Page, rect: SampleRect): Promise<Rgb> {
  return await page.getByTestId('preview-shapes').evaluate(
    (canvas, { rect, slate }) => {
      const element = canvas as HTMLCanvasElement
      const context = element.getContext('2d')!
      const x = Math.floor(rect.x * element.width)
      const y = Math.floor(rect.y * element.height)
      const w = Math.max(1, Math.floor(rect.width * element.width))
      const h = Math.max(1, Math.floor(rect.height * element.height))
      const data = context.getImageData(x, y, w, h).data
      let r = 0
      let g = 0
      let b = 0
      const pixels = data.length / 4
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] / 255
        r += data[index] * alpha + slate.r * (1 - alpha)
        g += data[index + 1] * alpha + slate.g * (1 - alpha)
        b += data[index + 2] * alpha + slate.b * (1 - alpha)
      }
      return { r: r / pixels, g: g / pixels, b: b / pixels }
    },
    { rect, slate: SLATE },
  )
}

/** Decodes an image (a PNG, or a GIF's first frame) and averages a region. */
async function sampleImage(
  page: Page,
  bytes: Buffer,
  mime: string,
  rect: SampleRect,
): Promise<Rgb> {
  return await page.evaluate(
    async ({ base64, mime, rect }) => {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('the image failed to decode'))
        image.src = `data:${mime};base64,${base64}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const x = Math.floor(rect.x * canvas.width)
      const y = Math.floor(rect.y * canvas.height)
      const w = Math.max(1, Math.floor(rect.width * canvas.width))
      const h = Math.max(1, Math.floor(rect.height * canvas.height))
      const data = context.getImageData(x, y, w, h).data
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
    },
    { base64: bytes.toString('base64'), mime, rect },
  )
}

test('the export draws each shape where the preview and Save frame draw it, inside the group window only (#683)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await parityFixture(page)

  const exported = await exportOnce(page)
  // Inside the window: 0.5 s from the end of a 3 s sequence, past 1.5 s.
  const border = await sampleExportedFrame(page, exported, 0.5, POINTS.border)
  const inside = await sampleExportedFrame(page, exported, 0.5, POINTS.inside)
  const filled = await sampleExportedFrame(page, exported, 0.5, POINTS.filled)
  expectColor(border, BORDER, 45, 'export, on the ellipse border')
  expectColor(inside, SLATE, 30, 'export, inside the ellipse (transparent centre)')
  expectColor(filled, over(GREEN, 0.5), 40, 'export, inside the half-opaque rectangle')
  // Outside the window: near the start, where only the slate (or leading
  // padding) can be, the border point carries no red.
  const before = await sampleExportedFrame(page, exported, border.duration - 0.5, POINTS.border)
  expect(before.r, `before the window the border point reads ${JSON.stringify(before)}`).toBeLessThan(60)

  // The preview, at an instant inside the window, draws the same shapes at
  // the same points (its canvas holds the shapes alone; composited over the
  // slate here, which is what the picture beneath it shows).
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('2.5')
  await expect(page.getByTestId('preview-shapes')).toBeVisible()
  await expect
    .poll(async () => (await samplePreviewShapes(page, POINTS.border)).r, {
      message: 'the preview draws the border',
    })
    .toBeGreaterThan(180)
  const previewBorder = await samplePreviewShapes(page, POINTS.border)
  const previewInside = await samplePreviewShapes(page, POINTS.inside)
  const previewFilled = await samplePreviewShapes(page, POINTS.filled)
  expectColor(previewBorder, border, 45, 'preview vs export, on the border')
  expectColor(previewInside, inside, 30, 'preview vs export, inside the ellipse')
  expectColor(previewFilled, filled, 40, 'preview vs export, inside the rectangle')
  // Before the window the preview draws no shapes at all.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
  await expect(page.getByTestId('preview-shapes')).toHaveCount(0)

  // Save frame at 2.5 s: the PNG is composed by the export's own routine,
  // and lossless, so it reads the same points against the export.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('2.5')
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const png = await readFile(await (await downloadPromise).path())
  expectColor(await sampleImage(page, png, 'image/png', POINTS.border), BORDER, 20, 'PNG, on the border')
  expectColor(await sampleImage(page, png, 'image/png', POINTS.inside), SLATE, 10, 'PNG, inside')
  expectColor(
    await sampleImage(page, png, 'image/png', POINTS.filled),
    over(GREEN, 0.5),
    10,
    'PNG, inside the rectangle',
  )
})

test('shapes draw below text, and the later-starting of two overlapping groups is on top (#683)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await blueSlate(page)

  // Group 1, added first but starting at 1 s: a red box. Group 2, added
  // second but starting at 0 s: a green box under the red one, and a black
  // box on the right. List order and start order disagree, so the sample
  // below tells the stacking rule (later start on top, #681 §4) from add
  // order.
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group(1)} in seconds`, '1')
  await setField(page, `Duration of ${group(1)} in seconds`, '10')
  await addShape(page, 1, 'Rectangle')
  await page.getByRole('button', { name: `Remove ${shape('Ellipse', 1, 1)}` }).click()
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group(2)} in seconds`, '0')
  await setField(page, `Duration of ${group(2)} in seconds`, '10')
  await addShape(page, 2, 'Rectangle')
  await addShape(page, 2, 'Rectangle')
  await page.getByRole('button', { name: `Remove ${shape('Ellipse', 1, 2)}` }).click()
  for (const [name, x, y, w, h, fill] of [
    [shape('Rectangle', 1, 1), '0.05', '0.3', '0.35', '0.4', '#ff0000'],
    [shape('Rectangle', 1, 2), '0.05', '0.3', '0.35', '0.4', '#00ff00'],
    [shape('Rectangle', 2, 2), '0.55', '0.2', '0.4', '0.6', '#000000'],
  ] as const) {
    await setField(page, `Left edge of ${name} (0 to 1)`, x)
    await setField(page, `Top edge of ${name} (0 to 1)`, y)
    await setField(page, `Width of ${name} (fraction of frame width)`, w)
    await setField(page, `Height of ${name} (fraction of frame height)`, h)
    await setField(page, `Border thickness of ${name} in pixels`, '0')
    await page.getByLabel(`Fill colour of ${name}`).fill(fill)
    await setField(page, `Fill opacity of ${name} (percent)`, '100')
  }

  // White text centred on the black box, a quarter of the frame tall.
  await chooseFromAddMenu(page, ADD_TEXT)
  await setField(page, 'Duration of text overlay at position 1 in seconds', '10')
  await setField(page, 'Centre X of text overlay at position 1 (0 to 1)', '0.75')
  await setField(page, 'Size of text overlay at position 1 (fraction of frame height)', '0.25')

  const exported = await exportOnce(page)
  const boxCentre = { x: 0.15, y: 0.45, width: 0.15, height: 0.1 }
  expectColor(
    await sampleExportedFrame(page, exported, 0.5, boxCentre),
    { r: 255, g: 0, b: 0 },
    50,
    'the later-starting red box is on top of the green one',
  )

  // The text is drawn over the black box: whitish pixels inside the box.
  // Were the shapes drawn above the text, the box would read solid black.
  const textRegion = { x: 0.6, y: 0.4, width: 0.3, height: 0.2 }
  const sample = await sampleExportedFrame(page, exported, 0.5, textRegion)
  // A solid black box averages near 0; white glyphs over part of it lift
  // every channel together.
  expect(
    Math.min(sample.r, sample.g, sample.b),
    `the text region over the black box reads ${JSON.stringify(sample)}`,
  ).toBeGreaterThan(25)
})

test('the GIF plugin draws shape groups too (#683)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  await blueSlate(page)
  await setField(page, 'Duration of Color slate at position 1 in seconds', '1')
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Duration of ${group()} in seconds`, '10')
  const ellipse = shape('Ellipse', 1)
  // A large solid-red ellipse in the middle: the first GIF frame carries it.
  await setField(page, `Left edge of ${ellipse} (0 to 1)`, '0.25')
  await setField(page, `Top edge of ${ellipse} (0 to 1)`, '0.25')
  await setField(page, `Width of ${ellipse} (fraction of frame width)`, '0.5')
  await setField(page, `Height of ${ellipse} (fraction of frame height)`, '0.5')
  await page.getByLabel(`Fill colour of ${ellipse}`).fill('#ff0000')
  await setField(page, `Fill opacity of ${ellipse} (percent)`, '100')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated GIF' }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const gif = await readFile(await (await downloadPromise).path())
  // An Image decodes a GIF's first frame; the group covers it from 0 s.
  const middle = await sampleImage(page, gif, 'image/gif', { x: 0.45, y: 0.45, width: 0.1, height: 0.1 })
  const corner = await sampleImage(page, gif, 'image/gif', { x: 0.02, y: 0.02, width: 0.08, height: 0.08 })
  expectColor(middle, { r: 255, g: 0, b: 0 }, 50, 'GIF, inside the red ellipse')
  expectColor(corner, SLATE, 50, 'GIF, outside the ellipse')
})

for (const width of [1280, 360]) {
  test(`an expanded shape group stays inside the timeline at ${width}px (#683)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    // Populated (development.md): a slate, a text row and a two-shape group
    // with both kinds' fields showing — the widest the row gets today.
    await blueSlate(page)
    await chooseFromAddMenu(page, ADD_TEXT)
    await chooseFromAddMenu(page, ADD_SHAPES)
    await addShape(page, 1, 'Rectangle')
    const row = page.getByRole('list', { name: 'Shape groups' }).locator('> li').first()
    const timeline = page.getByRole('region', { name: 'Timeline' })
    await expectWithin(row, timeline, { axis: 'x', what: 'the shape group row' })
    for (const name of [shape('Ellipse', 1), shape('Rectangle', 2)]) {
      await expectWithin(page.getByRole('listitem', { name }), row, { axis: 'x', what: name })
    }
    await expectNoHorizontalScroll(page, 'with an expanded shape group')
    if (width === 1280) {
      await row.screenshot({ path: testInfo.outputPath(`shape-group-row-${width}.png`) })
    }
  })
}
