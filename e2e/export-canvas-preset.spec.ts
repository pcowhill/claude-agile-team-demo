import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of the canvas preset (#274): the exported file must be the preset's
 * frame exactly as the preview shows it (#273) — the shared `canvasFrameSize`
 * rule consumed by the export's own sizing pass. A solid-blue landscape clip
 * makes the reshape unmistakable in decoded pixels: with a 9:16 preset the
 * decoded frame is portrait at the preset's exact ratio, the middle of the
 * picture is the clip's blue, and the top and bottom are the letterbox bars —
 * while the Auto control export stays at the source's own dimensions with the
 * clip filling the whole frame, proving the bar check measures the preset
 * rather than something always true.
 *
 * The modal's automatic size is asserted in the same run (the
 * export-crop.spec idiom): the pre-filled values are the preset frame the
 * export then actually produces. 320×180 at 9:16 → 324×576, the smallest
 * 9:16 frame in whole pixels containing the source (#273's rule), pinned as
 * exact numbers so a drifting derivation cannot hide behind a tolerance.
 */

/** Records a solid-blue WebM so the source decodes for real. */
async function recordBlueWebm(page: Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
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
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 2000) resolve()
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
  })
  return Buffer.from(webmBase64, 'base64')
}

/** Exports with the modal's current settings and returns the file's bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

const WHOLE_FRAME: SampleRect = { x: 0, y: 0, width: 1, height: 1 }
// The 320×180 picture letterboxed into 324×576 occupies y ≈ 0.34–0.66 of the
// frame, so these bands sit safely inside the picture and inside each bar.
const MIDDLE_BAND: SampleRect = { x: 0.3, y: 0.45, width: 0.4, height: 0.1 }
const TOP_BAR: SampleRect = { x: 0.3, y: 0.05, width: 0.4, height: 0.2 }
const BOTTOM_BAR: SampleRect = { x: 0.3, y: 0.75, width: 0.4, height: 0.2 }

test('a 9:16 canvas preset exports portrait frames with the clip letterboxed (#274)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')

  const blue = await recordBlueWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'wide.webm', mimeType: 'video/webm', buffer: blue }])
  await page.getByRole('button', { name: 'Add wide.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of wide.webm at position 1 in seconds',
  })
  await outField.fill('1.5')
  await outField.blur()

  // The Auto control export: today's source-derived frame, the clip filling
  // it — the shape a preset must visibly change.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue('320')
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '180',
  )
  const auto = await sampleExportedFrame(page, await exportOnce(page), 0.75, WHOLE_FRAME)
  expect(auto.width).toBe(320)
  expect(auto.height).toBe(180)
  expect(auto.b).toBeGreaterThan(auto.r + 60)
  expect(auto.b).toBeGreaterThan(auto.g + 60)

  // Fix the canvas to 9:16 (#273) and export again. The modal's automatic
  // size pre-fills the preset frame — the exact numbers the file then has.
  await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption('9:16')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue('324')
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '576',
  )
  const exported = await exportOnce(page)

  const middle = await sampleExportedFrame(page, exported, 0.75, MIDDLE_BAND)
  expect(middle.width).toBe(324)
  expect(middle.height).toBe(576)
  expect(middle.b).toBeGreaterThan(middle.r + 60)
  expect(middle.b).toBeGreaterThan(middle.g + 60)

  // The bars above and below the letterboxed clip: the frame's own ground,
  // not the clip — the shape background fill (#259) exists to treat.
  const top = await sampleExportedFrame(page, exported, 0.75, TOP_BAR)
  expect(Math.max(top.r, top.g, top.b)).toBeLessThan(40)
  const bottom = await sampleExportedFrame(page, exported, 0.75, BOTTOM_BAR)
  expect(Math.max(bottom.r, bottom.g, bottom.b)).toBeLessThan(40)
})
