import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page

/**
 * Spotlight regions (#532, from the customer-approved suggestion #531) in
 * real Chromium: what the preview dims, the file must dim.
 *
 * The fixture is the banded clip the crop, preview and redaction specs use
 * — a green left half and a blue right half, every frame identical — so any
 * decoded frame samples exactly and a dim is a pure multiplication of a
 * channel that is otherwise flat. A patch that reads 205 green unlit must
 * read about 82 under a 60% dim, and no compression noise closes that gap.
 *
 * The oval is the case the customer asked for and the one a duration or
 * brightness check alone cannot tell from a rectangle, so it is tested
 * where the two shapes actually differ: a corner of the bounding box, which
 * lies inside the rectangle and outside the inscribed ellipse.
 */

/** Records a WebM whose left half is green and right half blue. */
async function recordBandedWebm(page: Page, seconds = 6): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async (seconds) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
        if (performance.now() - start > seconds * 1000) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, seconds)
  return Buffer.from(webmBase64, 'base64')
}

const POSITION = 'banded.webm at position 1'
/** The source's own green channel, before anything dims it. */
const SOURCE_GREEN = 205

/** Imports the banded clip, places it, and trims it to `outPoint`. */
async function placeBandedClip(page: Page, outPoint: number) {
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: `Add banded.webm to timeline` }).click()
  const outField = page.getByRole('spinbutton', {
    name: `Trim out point of ${POSITION} in seconds`,
  })
  await outField.fill(String(outPoint))
  await outField.blur()
}

const escapeName = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Adds one spotlight region and returns the index it was given (1-based). */
async function addSpotlight(page: Page, position: string): Promise<number> {
  const existing = await page
    .getByRole('button', {
      name: new RegExp(`^Remove spotlight region \\d+ of ${escapeName(position)}$`),
    })
    .count()
  await page.getByRole('button', { name: `Add a spotlight region on ${position}` }).click()
  const index = existing + 1
  await expect(
    page.getByRole('combobox', { name: `Spotlight region ${index} shape of ${position}` }),
  ).toBeVisible()
  return index
}

/** Sets one spotlight region's fields. Percent values, seconds for the window. */
async function setSpotlight(
  page: Page,
  position: string,
  index: number,
  fields: {
    left?: number
    top?: number
    width?: number
    height?: number
    start?: number
    end?: number
    shape?: 'Rectangle' | 'Oval'
    dim?: number
  },
) {
  const which = `Spotlight region ${index}`
  const number = async (label: string, value: number) => {
    const field = page.getByRole('spinbutton', { name: label, exact: true })
    await field.fill(String(value))
    await field.blur()
  }
  if (fields.shape !== undefined) {
    await page
      .getByRole('combobox', { name: `${which} shape of ${position}` })
      .selectOption(fields.shape)
  }
  if (fields.left !== undefined) await number(`${which} left of ${position} (percent)`, fields.left)
  if (fields.top !== undefined) await number(`${which} top of ${position} (percent)`, fields.top)
  if (fields.width !== undefined)
    await number(`${which} width of ${position} (percent)`, fields.width)
  if (fields.height !== undefined)
    await number(`${which} height of ${position} (percent)`, fields.height)
  if (fields.start !== undefined)
    await number(`${which} start of ${position} in seconds`, fields.start)
  if (fields.end !== undefined) await number(`${which} end of ${position} in seconds`, fields.end)
  if (fields.dim !== undefined) await number(`${which} dim of ${position} (percent)`, fields.dim)
}

async function exportProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

// The region both shapes are drawn in: the middle 40% of each axis, so the
// bounding box straddles the source's colour edge and its corners sit well
// outside the inscribed ellipse — at the corner patch below, the ellipse
// equation reads 1.44, comfortably past 1 even after the picture is scaled.
const BOX = { left: 30, top: 30, width: 40, height: 40 }
/** Inside both shapes: on the green side, near the box's own centre line. */
const LIT: SampleRect = { x: 0.34, y: 0.45, width: 0.1, height: 0.1 }
/** Outside the box entirely, on the green side. */
const OUTSIDE: SampleRect = { x: 0.04, y: 0.45, width: 0.1, height: 0.1 }
/** Inside the box, outside the inscribed oval: the box's top-left corner. */
const CORNER: SampleRect = { x: 0.31, y: 0.31, width: 0.04, height: 0.04 }

test('the export dims outside a region, and an oval differs from a rectangle at the box corner (#532)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  // 6 s of source trimmed to 4 s: two windows and an unspotlit tail, all
  // sampled from one export rather than three.
  await placeBandedClip(page, 4)
  await openPicture(page, POSITION)

  // The same box twice, at different times, so one export tells the two
  // shapes apart with everything else held equal.
  const rectangle = await addSpotlight(page, POSITION)
  await setSpotlight(page, POSITION, rectangle, {
    ...BOX,
    shape: 'Rectangle',
    start: 0.2,
    end: 1.5,
    dim: 60,
  })
  const oval = await addSpotlight(page, POSITION)
  await setSpotlight(page, POSITION, oval, {
    ...BOX,
    shape: 'Oval',
    start: 2,
    end: 3.5,
    dim: 60,
  })

  const exported = await exportProject(page)

  // ---- Inside the rectangle's window (1 s in, i.e. 3 s from the end) ----
  const litUnderRectangle = await sampleExportedFrame(page, exported, 3, LIT)
  expect(litUnderRectangle.width).toBe(320)
  expect(litUnderRectangle.height).toBe(180)
  // Untouched: the source's own green, not a dimmed one.
  expect(litUnderRectangle.g, 'inside the rectangle is left alone').toBeGreaterThan(160)

  const dimmedUnderRectangle = await sampleExportedFrame(page, exported, 3, OUTSIDE)
  // 60% of the way to black: 205 × 0.4 ≈ 82. The bounds are wide enough for
  // VP9 and nowhere near either the lit value or black.
  expect(dimmedUnderRectangle.g, 'outside the rectangle is dimmed').toBeLessThan(120)
  expect(dimmedUnderRectangle.g, 'dimmed, not blacked out').toBeGreaterThan(40)
  expect(dimmedUnderRectangle.g / SOURCE_GREEN).toBeCloseTo(0.4, 1)

  // The box's corner is INSIDE a rectangle, so it is lit.
  const cornerUnderRectangle = await sampleExportedFrame(page, exported, 3, CORNER)
  expect(cornerUnderRectangle.g, 'the box corner is lit under a rectangle').toBeGreaterThan(160)

  // ---- Inside the oval's window (2.5 s in, 1.5 s from the end) ----
  const litUnderOval = await sampleExportedFrame(page, exported, 1.5, LIT)
  expect(litUnderOval.g, 'the oval lights its own middle').toBeGreaterThan(160)
  const cornerUnderOval = await sampleExportedFrame(page, exported, 1.5, CORNER)
  // The one assertion that tells the shapes apart: the same patch, the same
  // box, the same dim — dark because the oval does not reach the corner.
  expect(cornerUnderOval.g, 'the box corner is dimmed under an oval').toBeLessThan(120)
  expect(cornerUnderOval.g).toBeLessThan(cornerUnderRectangle.g - 50)

  // ---- Outside both windows (3.8 s in, 0.2 s from the end) ----
  const afterOutside = await sampleExportedFrame(page, exported, 0.2, OUTSIDE)
  const afterCorner = await sampleExportedFrame(page, exported, 0.2, CORNER)
  expect(afterOutside.g, 'nothing is dimmed once the windows have passed').toBeGreaterThan(160)
  expect(afterCorner.g, 'including the corner the oval had dimmed').toBeGreaterThan(160)
})

test('a redaction stays intact over a spotlight and in the dimmed area around it (#532)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  await placeBandedClip(page, 4)
  await openPicture(page, POSITION)

  const spot = await addSpotlight(page, POSITION)
  await setSpotlight(page, POSITION, spot, { ...BOX, shape: 'Rectangle', start: 0, end: 4, dim: 70 })

  // Two solid-red redactions: one inside the lit box, one out in the dim.
  // The second is the one that discriminates — the dim is painted before
  // the mask, so a mask outside the box reads FULL red. Were the order
  // reversed it would read 70% of the way to black, about 77.
  for (const rect of [
    { left: 40, top: 40, width: 12, height: 12 },
    { left: 5, top: 40, width: 12, height: 12 },
  ]) {
    await page.getByRole('button', { name: `Add a redaction region on ${POSITION}` }).click()
    const index = await page
      .getByRole('button', {
        name: new RegExp(`^Remove redaction region \\d+ of ${escapeName(POSITION)}$`),
      })
      .count()
    const which = `Redaction region ${index}`
    await page
      .getByRole('combobox', { name: `${which} style of ${POSITION}` })
      .selectOption('Solid')
    for (const [label, value] of [
      [`${which} left of ${POSITION} (percent)`, rect.left],
      [`${which} top of ${POSITION} (percent)`, rect.top],
      [`${which} width of ${POSITION} (percent)`, rect.width],
      [`${which} height of ${POSITION} (percent)`, rect.height],
      [`${which} start of ${POSITION} in seconds`, 0],
      [`${which} end of ${POSITION} in seconds`, 4],
    ] as const) {
      const field = page.getByRole('spinbutton', { name: label, exact: true })
      await field.fill(String(value))
      await field.blur()
    }
    await page.getByLabel(`${which} colour of ${POSITION}`).fill('#ff0000')
  }

  const exported = await exportProject(page)
  const inside = await sampleExportedFrame(page, exported, 2, {
    x: 0.42,
    y: 0.42,
    width: 0.08,
    height: 0.08,
  })
  const outside = await sampleExportedFrame(page, exported, 2, {
    x: 0.07,
    y: 0.42,
    width: 0.08,
    height: 0.08,
  })
  for (const [what, sample] of [
    ['over the spotlight', inside],
    ['in the dimmed area', outside],
  ] as const) {
    expect(sample.r, `the redaction ${what} is its own red`).toBeGreaterThan(150)
    expect(sample.g, `the redaction ${what} is not tinted`).toBeLessThan(90)
  }
})

test('the preview dims the same area the export does, and the rows lay out inside the timeline (#532)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  await placeBandedClip(page, 4)
  await openPicture(page, POSITION)
  const index = await addSpotlight(page, POSITION)
  await setSpotlight(page, POSITION, index, {
    ...BOX,
    shape: 'Rectangle',
    start: 0,
    end: 4,
    dim: 60,
  })

  // The preview paints the dim into an overlay canvas in front of the video
  // (`RegionOverlay`), so what it contributes is read straight off that
  // canvas: alpha where it dims, nothing where it does not.
  const canvas = page.getByTestId('preview-redactions')
  await expect(canvas).toBeVisible()
  const card = page.getByTestId('preview-video-card')
  const cardBox = (await card.boundingBox())!
  const canvasBox = (await canvas.boundingBox())!
  expect(
    Math.abs(canvasBox.width - cardBox.width),
    'the region canvas spans its card, so the fractions land where the picture is',
  ).toBeLessThan(2)
  expect(Math.abs(canvasBox.height - cardBox.height)).toBeLessThan(2)

  /** The canvas's transparent hole and the alpha it dims with, or null while it is blank. */
  const readCanvas = async () =>
    await canvas.evaluate((element) => {
      const source = element as HTMLCanvasElement
      const context = source.getContext('2d')
      if (context === null) return null
      const { width, height } = source
      if (width === 0 || height === 0) return null
      const data = context.getImageData(0, 0, width, height).data
      let minX = width
      let maxX = -1
      let minY = height
      let maxY = -1
      let opaqueAlpha = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = data[(y * width + x) * 4 + 3]
          if (alpha < 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          } else if (alpha > opaqueAlpha) opaqueAlpha = alpha
        }
      }
      return { minX, maxX, minY, maxY, width, height, opaqueAlpha }
    })

  // The canvas paints on its own rAF loop once the video has a frame, so
  // the first read can land on a blank buffer: polled until it has drawn,
  // never read once straight after the edit (`quality-and-ci.md`).
  await expect
    .poll(async () => (await readCanvas())?.opaqueAlpha ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(100)
  const painted = (await readCanvas())!

  // The picture is letterboxed inside the card, so the hole is measured
  // against the picture's own box rather than the canvas's: both are 16:9
  // here, which the card/canvas check above already established.
  const holeLeft = painted.minX / painted.width
  const holeRight = (painted.maxX + 1) / painted.width
  const holeTop = painted.minY / painted.height
  const holeBottom = (painted.maxY + 1) / painted.height
  expect(holeLeft, 'the lit hole starts where the region does').toBeCloseTo(0.3, 1)
  expect(holeRight, 'and ends where it does').toBeCloseTo(0.7, 1)
  expect(holeTop).toBeCloseTo(0.3, 1)
  expect(holeBottom).toBeCloseTo(0.7, 1)
  // 60% dim is alpha 153 of 255 over the picture.
  expect(painted.opaqueAlpha).toBeGreaterThan(140)
  expect(painted.opaqueAlpha).toBeLessThan(165)

  // Preview and export agree at the same source time: the preview's own
  // contribution is that alpha over a source the picture is known to hold
  // flat, and the export is decoded at the same point.
  const exported = await exportProject(page)
  const dimmed = await sampleExportedFrame(page, exported, 2, OUTSIDE)
  const predicted = SOURCE_GREEN * (1 - painted.opaqueAlpha / 255)
  expect(
    Math.abs(dimmed.g - predicted),
    `the export's ${dimmed.g.toFixed(1)} green matches the preview's predicted ${predicted.toFixed(1)}`,
  ).toBeLessThan(25)

  // Geometry the jsdom tests cannot see: the region's rows lay out inside
  // the timeline, its labels do not wrap, and the page does not scroll
  // sideways because of them.
  const block = page.locator('.timeline-spotlight').first()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 })
    const where = `at ${width}px`
    await expectWithin(block, sequence, { axis: 'x', what: `the spotlight region block ${where}` })
    const shape = page.getByRole('combobox', {
      name: `Spotlight region 1 shape of ${POSITION}`,
    })
    await expectWithin(shape, block, { what: `the Shape control ${where}` })
    const noWrap = await block.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(noWrap, `the spotlight region block scrolls sideways ${where}`).toBeLessThanOrEqual(1)
    await expectNoHorizontalScroll(page, where)
  }
})
