import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame, sampleExportedGrid } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page

/**
 * Export of redaction regions (#492): what the preview hides, the file must
 * hide. The fixture is the banded clip the crop and preview specs use — a
 * green left half and a blue right half, every frame identical, so any
 * decoded frame samples exactly and the vertical edge at the centre gives
 * each style something unmistakable to do:
 *
 * - **solid** paints its own colour, so its patch reads that colour and
 *   nothing else;
 * - **pixelate** averages each block, so a block straddling the edge reads
 *   FLAT — its cells all agree — where the source underneath changes
 *   colour completely;
 * - **blur** mixes across the edge, so a patch on the green side of it
 *   carries blue it could not otherwise have.
 *
 * Tolerances are wide enough for VP9: the export is a real-time recording
 * of a canvas, so "equal" means equal within compression noise, never
 * byte-equal.
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

/** Adds one region and returns the index it was given (1-based). */
async function addRegion(page: Page, position: string): Promise<number> {
  const existing = await page
    .getByRole('button', { name: new RegExp(`^Remove redaction region \\d+ of ${escapeName(position)}$`) })
    .count()
  await page.getByRole('button', { name: `Add a redaction region on ${position}` }).click()
  const index = existing + 1
  await expect(
    page.getByRole('combobox', { name: `Redaction region ${index} style of ${position}` }),
  ).toBeVisible()
  return index
}

const escapeName = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Sets one region's fields. Percent values, seconds for the window. */
async function setRegion(
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
    style?: 'Blur' | 'Pixelate' | 'Solid'
    blockSize?: number
    strength?: number
    colour?: string
  },
) {
  const which = `Redaction region ${index}`
  const number = async (label: string, value: number) => {
    const field = page.getByRole('spinbutton', { name: label, exact: true })
    await field.fill(String(value))
    await field.blur()
  }
  if (fields.style !== undefined) {
    await page
      .getByRole('combobox', { name: `${which} style of ${position}` })
      .selectOption(fields.style)
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
  if (fields.blockSize !== undefined)
    await number(`${which} block size of ${position} in pixels`, fields.blockSize)
  if (fields.strength !== undefined)
    await number(`${which} blur strength of ${position} in pixels`, fields.strength)
  if (fields.colour !== undefined) {
    await page
      .getByLabel(`${which} colour of ${position}`)
      .fill(fields.colour)
  }
}

async function exportProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

/** The greatest per-channel spread across a grid's cells. */
function spread(cells: { r: number; g: number; b: number }[][]): number {
  const flat = cells.flat()
  const range = (pick: (cell: { r: number; g: number; b: number }) => number) =>
    Math.max(...flat.map(pick)) - Math.min(...flat.map(pick))
  return Math.max(range((cell) => cell.r), range((cell) => cell.g), range((cell) => cell.b))
}

test('each style hides its region inside its window, and nothing outside it (#492)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  // 6 s of source, trimmed to 4 s, so the window 1–3 s leaves an
  // unredacted tail the same export can be sampled in.
  await placeBandedClip(page, 4)
  await openPicture(page, POSITION)

  // A solid region over the green half's upper band.
  const solid = await addRegion(page, POSITION)
  await setRegion(page, POSITION, solid, {
    style: 'Solid',
    left: 5,
    top: 5,
    width: 30,
    height: 20,
    start: 1,
    end: 3,
    colour: '#ff0000',
  })
  // A pixelate region straddling the centre edge, with a block wide enough
  // that one block spans both colours: 64 source px across a 320 px frame.
  const pixelated = await addRegion(page, POSITION)
  await setRegion(page, POSITION, pixelated, {
    style: 'Pixelate',
    left: 40,
    top: 40,
    width: 20,
    height: 20,
    start: 1,
    end: 3,
    blockSize: 64,
  })
  // A blur region straddling the same edge, lower down.
  const blurred = await addRegion(page, POSITION)
  await setRegion(page, POSITION, blurred, {
    style: 'Blur',
    left: 40,
    top: 70,
    width: 20,
    height: 20,
    start: 1,
    end: 3,
    strength: 30,
  })

  const exported = await exportProject(page)

  // ---- Inside the window (sampled 2 s from the end of a 4 s export) ----
  const inside = 2
  const solidPatch: SampleRect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }
  const solidSample = await sampleExportedFrame(page, exported, inside, solidPatch)
  expect(solidSample.width).toBe(320)
  expect(solidSample.height).toBe(180)
  // Red where the source is green: the region is painted, not tinted.
  expect(solidSample.r).toBeGreaterThan(150)
  expect(solidSample.g).toBeLessThan(90)
  expect(solidSample.b).toBeLessThan(90)

  // A pixelate block straddling the edge reads FLAT: 64 source px is 20% of
  // the 320 px frame, so this patch lies inside one block, and its cells
  // must agree even though the source under it changes colour completely.
  const oneBlock: SampleRect = { x: 0.44, y: 0.44, width: 0.12, height: 0.12 }
  const blockGrid = await sampleExportedGrid(page, exported, inside, oneBlock, 4, 4)
  expect(spread(blockGrid.cells)).toBeLessThan(28)
  // …and it is the average of the two, not either one: green and blue both
  // present, neither dominant the way the unredacted source is.
  const blockCell = blockGrid.cells[0][0]
  expect(blockCell.g).toBeGreaterThan(30)
  expect(blockCell.b).toBeGreaterThan(30)

  // The blur region carries the other side's colour across the edge: a
  // patch wholly on the green side reads blue it could not otherwise have.
  const blurGreenSide: SampleRect = { x: 0.42, y: 0.75, width: 0.05, height: 0.1 }
  const blurred1 = await sampleExportedFrame(page, exported, inside, blurGreenSide)
  expect(blurred1.b).toBeGreaterThan(25)

  // ---- Outside the window, in the same file ----
  // The tail (3–4 s) carries no region at all, so every patch is the source.
  const outside = 0.4
  const solidOutside = await sampleExportedFrame(page, exported, outside, solidPatch)
  expect(solidOutside.g).toBeGreaterThan(solidOutside.r + 60)
  const blockOutside = await sampleExportedGrid(page, exported, outside, oneBlock, 4, 4)
  // The source's own edge runs through this patch, so it is the opposite of
  // flat — which is exactly what the pixelated sample above was not.
  expect(spread(blockOutside.cells)).toBeGreaterThan(60)
  const blurOutside = await sampleExportedFrame(page, exported, outside, blurGreenSide)
  expect(blurOutside.b).toBeLessThan(25)
})

test('a region lands on the same source pixels through a rotation and a crop (#492)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  await placeBandedClip(page, 3)
  await openPicture(page, POSITION)

  // A solid region over the source's own top-left corner — the green half.
  const region = await addRegion(page, POSITION)
  await setRegion(page, POSITION, region, {
    style: 'Solid',
    left: 5,
    top: 10,
    width: 25,
    height: 30,
    start: 0,
    end: 3,
    colour: '#ff0000',
  })

  // First a crop alone: trim the left 20 % of the source away. The region
  // sat at source x 5–30 %, so its left third is now off-picture and what
  // remains is the first eighth of the kept width — the mask is trimmed to
  // the part still shown rather than sliding along with the crop.
  await page
    .getByRole('spinbutton', { name: `Crop left of ${POSITION} (percent)` })
    .fill('20')
  await page.getByRole('spinbutton', { name: `Crop left of ${POSITION} (percent)` }).blur()
  const cropped = await exportProject(page)
  expect(
    (await sampleExportedFrame(page, cropped, 1, { x: 0, y: 0, width: 1, height: 1 })).width,
  ).toBe(256)
  const keptEdge = await sampleExportedFrame(page, cropped, 1, {
    x: 0.02,
    y: 0.15,
    width: 0.08,
    height: 0.2,
  })
  expect(keptEdge.r).toBeGreaterThan(150)
  expect(keptEdge.g).toBeLessThan(90)
  // Just past the region's kept eighth, the picture is its own green again.
  const pastRegion = await sampleExportedFrame(page, cropped, 1, {
    x: 0.18,
    y: 0.15,
    width: 0.08,
    height: 0.2,
  })
  expect(pastRegion.g).toBeGreaterThan(pastRegion.r + 60)

  // Quarter-turn the clip. The stored rectangle does not move — it names
  // source pixels — so the mask turns with the picture and the frame
  // transposes to the cropped source's transpose.
  await page
    .getByRole('button', {
      name: `Rotate ${POSITION} 90 degrees clockwise (currently 0 degrees)`,
    })
    .click()

  const exported = await exportProject(page)
  // The cropped 256×180 picture, quarter-turned, is a 180×256 frame.
  expect((await sampleExportedFrame(page, exported, 1, { x: 0, y: 0, width: 1, height: 1 })).width)
    .toBe(180)

  // Composed: crop puts the visible part of the region at kept-space
  // u 0–0.125, v 0.1–0.4, and a 90° clockwise turn maps (u, v) to
  // (1 − v, u) — so it lands at frame x 60–90 %, y 0–12.5 %.
  const turned = await sampleExportedFrame(page, exported, 1, {
    x: 0.66,
    y: 0.02,
    width: 0.16,
    height: 0.08,
  })
  expect(turned.r).toBeGreaterThan(150)
  expect(turned.g).toBeLessThan(90)
  // And where the region is NOT, the turned picture is its own colour.
  const elsewhere = await sampleExportedFrame(page, exported, 1, {
    x: 0.2,
    y: 0.6,
    width: 0.15,
    height: 0.15,
  })
  expect(elsewhere.r).toBeLessThan(90)
})

test('a blurred region refuses to export where canvas filters are unavailable (#492)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  // The colour-adjustment refusal's own mechanism (#195): make the canvas
  // context report no filter support before the app loads.
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      CanvasRenderingContext2D.prototype,
      'filter',
    )
    if (descriptor === undefined) return
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'filter', {
      configurable: true,
      get() {
        return 'none'
      },
      set() {
        /* every assignment is dropped, so the probe reads back "none" */
      },
    })
  })
  await page.goto('./')
  await placeBandedClip(page, 2)
  await openPicture(page, POSITION)
  const region = await addRegion(page, POSITION)
  await setRegion(page, POSITION, region, {
    style: 'Blur',
    start: 0,
    end: 2,
    strength: 20,
  })

  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  // Named, so the user knows which setting to change — and refused rather
  // than quietly writing out the thing they marked to hide.
  await expect(page.getByRole('dialog')).toContainText(/redaction/i)
  await expect(page.getByRole('dialog')).toContainText(/Pixelate or Solid/i)

  // The same timeline with the region switched to Pixelate exports.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await setRegion(page, POSITION, region, { style: 'Pixelate', blockSize: 32 })
  const exported = await exportProject(page)
  expect(exported.byteLength).toBeGreaterThan(0)
})
