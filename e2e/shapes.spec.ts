import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame, sampleExportedGrid } from './decodedFrame'
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

async function addShape(page: Page, groupIndex: number, kind: 'Rectangle' | 'Ellipse' | 'Arrow') {
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

/**
 * The arrow fixture (#684): one group from 1.5 s on the 3 s blue slate,
 * holding only a red arrow from (0.2, 0.5) to (0.8, 0.5), 20 px thick, head
 * at the tip at the medium size.
 *
 * Geometry at 640×360: the shaft runs along y = 180 from x = 128, 20 px
 * thick (y 170–190). The head is 4.5 × 20 = 90 px long, from its base at
 * x = 422 to the tip at x = 512, and 90 px wide at its base, so at x = 470
 * it spans y 159–201: wider than the shaft.
 */
async function arrowFixture(page: Page): Promise<void> {
  await blueSlate(page)
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group()} in seconds`, '1.5')
  await setField(page, `Duration of ${group()} in seconds`, '10')
  await addShape(page, 1, 'Arrow')
  await page.getByRole('button', { name: `Remove ${shape('Ellipse', 1)}` }).click()
  const arrow = shape('Arrow', 1)
  await setField(page, `Tail x of ${arrow} (0 to 1)`, '0.2')
  await setField(page, `Tail y of ${arrow} (0 to 1)`, '0.5')
  await setField(page, `Tip x of ${arrow} (0 to 1)`, '0.8')
  await setField(page, `Tip y of ${arrow} (0 to 1)`, '0.5')
  await setField(page, `Border thickness of ${arrow} in pixels`, '20')
  await expect(page.getByRole('combobox', { name: `Arrow heads of ${arrow}` })).toHaveValue('tip')
}

const ARROW_POINTS: Record<'shaft' | 'head' | 'beyond', SampleRect> = {
  // On the shaft, well inside its 20 px.
  shaft: { x: 248 / 640, y: 176 / 360, width: 16 / 640, height: 8 / 360 },
  // Inside the head, 12–18 px off the axis: outside the shaft's 10 px
  // half-width, so only the head's triangle can colour it.
  head: { x: 466 / 640, y: 162 / 360, width: 8 / 640, height: 6 / 360 },
  // Just beyond the tip, on the axis: the arrow ends at x = 512.
  beyond: { x: 522 / 640, y: 176 / 360, width: 10 / 640, height: 8 / 360 },
}

test('an arrow draws its shaft and head in the border colour and stops at the tip, in the export, preview and Save frame (#684)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await arrowFixture(page)

  const exported = await exportOnce(page)
  const shaft = await sampleExportedFrame(page, exported, 0.5, ARROW_POINTS.shaft)
  const head = await sampleExportedFrame(page, exported, 0.5, ARROW_POINTS.head)
  const beyond = await sampleExportedFrame(page, exported, 0.5, ARROW_POINTS.beyond)
  expectColor(shaft, BORDER, 45, 'export, on the shaft')
  expectColor(head, BORDER, 45, "export, inside the head's triangle")
  expectColor(beyond, SLATE, 30, 'export, just beyond the tip')

  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('2.5')
  await expect(page.getByTestId('preview-shapes')).toBeVisible()
  await expect
    .poll(async () => (await samplePreviewShapes(page, ARROW_POINTS.shaft)).r, {
      message: 'the preview draws the shaft',
    })
    .toBeGreaterThan(180)
  expectColor(await samplePreviewShapes(page, ARROW_POINTS.shaft), shaft, 45, 'preview vs export, shaft')
  expectColor(await samplePreviewShapes(page, ARROW_POINTS.head), head, 45, 'preview vs export, head')
  expectColor(await samplePreviewShapes(page, ARROW_POINTS.beyond), beyond, 30, 'preview vs export, beyond the tip')

  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const png = await readFile(await (await downloadPromise).path())
  expectColor(await sampleImage(page, png, 'image/png', ARROW_POINTS.shaft), BORDER, 20, 'PNG, on the shaft')
  expectColor(await sampleImage(page, png, 'image/png', ARROW_POINTS.head), BORDER, 20, 'PNG, inside the head')
  expectColor(await sampleImage(page, png, 'image/png', ARROW_POINTS.beyond), SLATE, 10, 'PNG, beyond the tip')

  // A line (no head): the same off-axis point is no longer coloured.
  await page.getByRole('combobox', { name: `Arrow heads of ${shape('Arrow', 1)}` }).selectOption('none')
  await expect
    .poll(async () => (await samplePreviewShapes(page, ARROW_POINTS.head)).r, {
      message: "a line has no head's triangle to colour the off-axis point",
    })
    .toBeLessThan(30)
  expectColor(await samplePreviewShapes(page, ARROW_POINTS.shaft), BORDER, 45, 'a line still draws its shaft')
})

/**
 * The line-style fixture (#688), all 16 px thick at 640×360:
 * - a dashed rectangle, x 0.1–0.9 (64–576 px), y 0.1–0.3: its top border is
 *   centred on y = 36;
 * - a dotted rectangle with the same box at y 0.7–0.9: top border on y = 252;
 * - a dashed arrow along y = 0.5 (180 px) from x 64 to its tip at 576. Its
 *   medium head is 4.5 × 16 = 72 px long, so the shaft ends at x = 504.
 */
async function lineStyleFixture(page: Page): Promise<void> {
  await blueSlate(page)
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group()} in seconds`, '1.5')
  await setField(page, `Duration of ${group()} in seconds`, '10')
  await addShape(page, 1, 'Rectangle')
  await addShape(page, 1, 'Rectangle')
  await addShape(page, 1, 'Arrow')
  await page.getByRole('button', { name: `Remove ${shape('Ellipse', 1)}` }).click()
  const boxes: [string, string, string][] = [
    [shape('Rectangle', 1), '0.1', 'dashed'],
    [shape('Rectangle', 2), '0.7', 'dotted'],
  ]
  for (const [name, top, lineStyle] of boxes) {
    await setField(page, `Left edge of ${name} (0 to 1)`, '0.1')
    await setField(page, `Top edge of ${name} (0 to 1)`, top)
    await setField(page, `Width of ${name} (fraction of frame width)`, '0.8')
    await setField(page, `Height of ${name} (fraction of frame height)`, '0.2')
    await setField(page, `Border thickness of ${name} in pixels`, '16')
    await page.getByRole('combobox', { name: `Line style of ${name}` }).selectOption(lineStyle)
  }
  const arrow = shape('Arrow', 3)
  await setField(page, `Tail x of ${arrow} (0 to 1)`, '0.1')
  await setField(page, `Tail y of ${arrow} (0 to 1)`, '0.5')
  await setField(page, `Tip x of ${arrow} (0 to 1)`, '0.9')
  await setField(page, `Tip y of ${arrow} (0 to 1)`, '0.5')
  await setField(page, `Border thickness of ${arrow} in pixels`, '16')
  await page.getByRole('combobox', { name: `Line style of ${arrow}` }).selectOption('dashed')
}

/** A run of one class along a sampled row: border (`true`) or slate. */
interface Run {
  border: boolean
  start: number
  length: number
}

/** A row of 1 px cells classified by red, which the border has and the slate lacks. */
function runsOf(cells: { r: number }[]): Run[] {
  const runs: Run[] = []
  cells.forEach((cell, x) => {
    const border = cell.r > 0xe5 / 2
    const last = runs[runs.length - 1]
    if (last !== undefined && last.border === border) last.length += 1
    else runs.push({ border, start: x, length: 1 })
  })
  return runs
}

test('a dashed or dotted border alternates border and slate along its edge, and a dashed arrow keeps a solid head (#688)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await lineStyleFixture(page)
  const exported = await exportOnce(page)
  const THICKNESS = 16
  /** One row of 640 one-pixel cells, 4 px tall, centred on `y` px. */
  const row = async (y: number) =>
    runsOf(
      (await sampleExportedGrid(page, exported, 0.5, { x: 0, y: (y - 2) / 360, width: 1, height: 4 / 360 }, 640, 1))
        .cells[0],
    )
  // The runs between the corners: the first and last border runs meet the
  // side borders, so only those between them have a known length.
  const interior = (runs: Run[]) => {
    const border = runs.filter((run) => run.border)
    const first = runs.indexOf(border[0])
    const last = runs.indexOf(border[border.length - 1])
    return runs.slice(first + 1, last)
  }
  // Lossy video softens each edge of a run by a pixel or two, and the
  // classification splits a softened edge at half the border's red, so a
  // run may read up to ±5 px (0.3 of the thickness) from its drawn length.
  const TOLERANCE = 5
  const expectRuns = (runs: Run[], dash: number, gap: number, what: string) => {
    const where = `${what}: ${JSON.stringify(runs.map((run) => `${run.border ? 'B' : '-'}${run.length}`))}`
    expect(runs.filter((run) => run.border).length, where).toBeGreaterThanOrEqual(3)
    expect(runs.filter((run) => !run.border).length, where).toBeGreaterThanOrEqual(3)
    for (const run of runs) {
      expect(Math.abs(run.length - (run.border ? dash : gap) * THICKNESS), where).toBeLessThanOrEqual(TOLERANCE)
    }
  }
  const dashed = interior(await row(36))
  const dotted = interior(await row(252))
  // Dashes 3 thicknesses on 2 off (48/32 px); dots 1 on 1 (16/16 px).
  expectRuns(dashed, 3, 2, 'the dashed top edge')
  expectRuns(dotted, 1, 1, 'the dotted top edge')

  // The arrow's axis: a dashed shaft from x 64, then the head, solid from
  // its base at 504 to the tip at 576 — longer than any dash could be.
  const axis = (await row(180)).filter((run) => run.start >= 60 && run.start < 600)
  const where = JSON.stringify(axis.map((run) => `${run.border ? 'B' : '-'}${run.start}+${run.length}`))
  const head = axis.filter((run) => run.border).pop()!
  expect(Math.abs(head.start + head.length - 576), `the head ends at the tip: ${where}`).toBeLessThanOrEqual(TOLERANCE)
  expect(head.length, `the head is solid for its 72 px: ${where}`).toBeGreaterThanOrEqual(72 - TOLERANCE)
  const shaft = axis.filter((run) => run.start + run.length <= head.start)
  expect(shaft.filter((run) => !run.border).length, `the shaft has gaps: ${where}`).toBeGreaterThanOrEqual(4)
  expectRuns(shaft.slice(1, -1), 3, 2, 'the dashed shaft')
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
  test(`an expanded shape group stays inside the timeline at ${width}px (#683, #684)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    // Populated (development.md): a slate, a text row and a three-shape
    // group with every kind's fields showing — the widest the row gets today.
    await blueSlate(page)
    await chooseFromAddMenu(page, ADD_TEXT)
    await chooseFromAddMenu(page, ADD_SHAPES)
    await addShape(page, 1, 'Rectangle')
    await addShape(page, 1, 'Arrow')
    const row = page.getByRole('list', { name: 'Shape groups' }).locator('> li').first()
    const timeline = page.getByRole('region', { name: 'Timeline' })
    await expectWithin(row, timeline, { axis: 'x', what: 'the shape group row' })
    for (const name of [shape('Ellipse', 1), shape('Rectangle', 2), shape('Arrow', 3)]) {
      await expectWithin(page.getByRole('listitem', { name }), row, { axis: 'x', what: name })
      // Each field on its own (#688 added Line): an item that overflows a
      // wrapping row keeps its own box, so the row's box alone cannot see it.
      await expectWithin(page.getByRole('combobox', { name: `Line style of ${name}` }), row, {
        axis: 'x',
        what: `the Line field of ${name}`,
      })
    }
    // An arrow's end point (#684) is one item: its "Tail" label, x box and y
    // box share a line, so a narrow row never strands a y box away from its x.
    const arrow = page.getByRole('listitem', { name: shape('Arrow', 3) })
    for (const end of ['Tail', 'Tip']) {
      const tops = await Promise.all(
        ['x', 'y'].map(async (axis) => {
          const box = await arrow
            .getByRole('spinbutton', { name: `${end} ${axis} of ${shape('Arrow', 3)} (0 to 1)` })
            .boundingBox()
          return box!.y
        }),
      )
      expect(Math.abs(tops[0] - tops[1]), `${end} x and y on one line at ${width}px`).toBeLessThanOrEqual(2)
    }
    await expectNoHorizontalScroll(page, 'with an expanded shape group')
    if (width === 1280) {
      await row.screenshot({ path: testInfo.outputPath(`shape-group-row-${width}.png`) })
    }

    // A name of the user's own (#687) can be any length; the row's main line
    // ellipsizes it rather than pushing ⋯ and ✕ out of the row.
    await page.getByRole('button', { name: `More actions for ${group()}` }).click()
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    const input = page.getByRole('textbox', { name: `New name for ${group()}` })
    await input.fill('Arrows and boxes pointing at the export settings in the second half of the demo')
    await input.press('Enter')
    const name = row.locator('.shape-group-main .clip-name')
    await expect(name).toHaveText(/^Arrows and boxes/)
    await expectWithin(name, row, { axis: 'x', what: 'the renamed group name' })
    for (const control of [`More actions for ${group()}`, `Remove ${group()} from timeline`]) {
      await expectWithin(page.getByRole('button', { name: control }), row, { axis: 'x', what: control })
    }
    await expectNoHorizontalScroll(page, 'with a long shape group name')
  })
}
