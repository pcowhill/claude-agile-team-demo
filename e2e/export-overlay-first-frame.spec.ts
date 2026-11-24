import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { scanExportedFrames } from './decodedFrame'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

/**
 * Overlays that start at 0 s must be in the exported file's very first
 * frame (#898, from the customer's #896). The customer's arrangement: a
 * black colour slate as the whole sequence, two overlays side by side as a
 * split screen, both starting at 0 s, and a text overlay across the top.
 * Their export opened on the slate and the text, and the overlays appeared
 * a moment later.
 *
 * The spec rebuilds that arrangement with video overlays and again with
 * image overlays, exports a WebM, and walks the file from its first
 * presented frame (`scanExportedFrames`, #276's presentation discipline).
 * Each half's sample must show its overlay's colour, not the slate's
 * black, on the first frame and on every frame of the first half second.
 */

const SLATE = '#000000'
/** The two overlays' colours: one per half, far from black and from each other. */
const LEFT = { r: 220, g: 40, b: 40 }
const RIGHT = { r: 40, g: 200, b: 40 }

/** Records a real WebM of one flat colour, so the overlay sources decode for real. */
async function recordWebm(page: Page, color: string, ms: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ color, ms }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 360
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
          ctx.fillStyle = color
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > ms) resolve()
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
    },
    { color, ms },
  )
  return Buffer.from(base64, 'base64')
}

/** A flat-colour PNG, encoded by the browser. */
async function makePng(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  }, color)
  return Buffer.from(base64, 'base64')
}

const css = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r}, ${g}, ${b})`

/** Sets one overlay's Rect fields, in percent of the frame (#892). */
async function place(page: Page, name: string, left: number, width: number) {
  const fields: [string, number][] = [
    [`Left edge of overlay ${name} (percent of frame width)`, left],
    [`Top edge of overlay ${name} (percent of frame height)`, 0],
    [`Width of overlay ${name} (percent of frame width)`, width],
    [`Height of overlay ${name} (percent of frame height)`, 100],
  ]
  // Width before left would clamp against the default left edge, so the
  // left edge goes first, then the size.
  for (const [label, value] of fields) {
    const field = page.getByRole('spinbutton', { name: label })
    await field.fill(String(value))
    await field.blur()
  }
}

/** Builds the customer's #896 arrangement around two overlay files. */
async function buildSplitScreen(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await chooseFromAddMenu(page, ADD_SLATE)
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('2')
  await slateDuration.blur()
  await page.getByLabel('Color of Color slate at position 1').fill(SLATE)

  await page.getByTestId('clip-file-input').setInputFiles(files)
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(files.length)
  await chooseClipAction(page, files[0].name, 'Add as overlay')
  await chooseClipAction(page, files[1].name, 'Add as overlay')
  await place(page, `${files[0].name} at position 1`, 0, 50)
  await place(page, `${files[1].name} at position 2`, 50, 50)
  for (const position of [1, 2]) {
    await expect(
      page.getByRole('spinbutton', {
        name: `Start time of overlay ${files[position - 1].name} at position ${position} in seconds`,
      }),
    ).toHaveValue('0')
  }

  // The title across the top, from 0 s as well.
  await chooseFromAddMenu(page, ADD_TEXT)
  const centreY = page.getByRole('spinbutton', {
    name: 'Centre Y of text overlay at position 1 (0 to 1)',
  })
  await centreY.fill('0.1')
  await centreY.blur()
}

/**
 * Exports a WebM and returns the file: the whole sequence, or, given a
 * range, the export modal's Custom range (#400) between those times.
 */
async function exportWebm(page: Page, range?: { start: string; end: string }): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  if (range !== undefined) {
    await page.getByTestId('export-range-start').fill(range.start)
    await page.getByTestId('export-range-end').fill(range.end)
    await expect(page.getByTestId('export-scope-custom')).toBeChecked()
    await expect(page.getByTestId('export-range-error')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * Walks the export's first half second and asserts each half shows its
 * overlay. Sampled low in each half, clear of the title at the top and of
 * the seam in the middle, so encoder bleed at an edge cannot decide it.
 */
async function expectOverlaysFromTheFirstFrame(page: Page, exported: Buffer, label: string) {
  const scan = await scanExportedFrames(page, exported, {
    left: { x: 0.15, y: 0.55, width: 0.2, height: 0.3 },
    right: { x: 0.65, y: 0.55, width: 0.2, height: 0.3 },
  })
  const opening = scan.frames.filter((frame) => frame.time < 0.5)
  console.log(
    `[${label}] first ${opening.length} frames: ` +
      JSON.stringify(
        opening.map(({ time, bands }) => ({
          t: Number(time.toFixed(3)),
          left: [bands.left.r, bands.left.g, bands.left.b].map(Math.round),
          right: [bands.right.r, bands.right.g, bands.right.b].map(Math.round),
        })),
      ),
  )
  expect(opening.length).toBeGreaterThan(10)
  // Within 40 of each channel: the encoder's colour error on a flat field
  // is a few units, and the slate's black is ~200 away on the lit channel.
  const near = (sample: { r: number; g: number; b: number }, want: typeof LEFT) =>
    Math.abs(sample.r - want.r) <= 40 &&
    Math.abs(sample.g - want.g) <= 40 &&
    Math.abs(sample.b - want.b) <= 40
  const missing = opening.filter(({ bands }) => !near(bands.left, LEFT) || !near(bands.right, RIGHT))
  expect(
    missing.map((frame) => Number(frame.time.toFixed(3))),
    `${label}: frames in the first 0.5 s without both overlays`,
  ).toEqual([])
}

test.describe('overlays that start at 0 s are in the exported first frame (#898)', () => {
  test('two video overlays and a title over a black slate', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('./')
    const left = await recordWebm(page, css(LEFT), 2500)
    const right = await recordWebm(page, css(RIGHT), 2500)
    await buildSplitScreen(page, [
      { name: 'left.webm', mimeType: 'video/webm', buffer: left },
      { name: 'right.webm', mimeType: 'video/webm', buffer: right },
    ])
    await expectOverlaysFromTheFirstFrame(page, await exportWebm(page), 'video overlays')
  })

  test('two image overlays and a title over a black slate', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('./')
    const left = await makePng(page, css(LEFT))
    const right = await makePng(page, css(RIGHT))
    await buildSplitScreen(page, [
      { name: 'left.png', mimeType: 'image/png', buffer: left },
      { name: 'right.png', mimeType: 'image/png', buffer: right },
    ])
    await expectOverlaysFromTheFirstFrame(page, await exportWebm(page), 'image overlays')
  })

  test('a range that opens partway through two video overlays has them from its first frame (#901)', async ({
    page,
  }) => {
    // The same arrangement, exported as a Custom range from 1 s to 2 s: the
    // file opens 1 s into both overlays. Before #901 they were cued to their
    // in-points, so the first tick had to seek them, and the file's first
    // frames had only the slate and the title.
    test.setTimeout(120_000)
    await page.goto('./')
    const left = await recordWebm(page, css(LEFT), 2500)
    const right = await recordWebm(page, css(RIGHT), 2500)
    await buildSplitScreen(page, [
      { name: 'left.webm', mimeType: 'video/webm', buffer: left },
      { name: 'right.webm', mimeType: 'video/webm', buffer: right },
    ])
    await expectOverlaysFromTheFirstFrame(
      page,
      await exportWebm(page, { start: '1', end: '2' }),
      'range from 1 s',
    )
  })
})
