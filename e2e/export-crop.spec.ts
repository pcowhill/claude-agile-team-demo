import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of per-clip crop (#256): the exported file must show only the kept
 * region the preview renders (#255) — the shared crop rule consumed in the
 * canvas draw path. The fixture's left half is green and its right half
 * blue (the preview-crop.spec idiom: every frame identical, so any decoded
 * frame samples exactly), making a left-half crop unmistakable in decoded
 * pixels: the frame reshapes to the kept region and the green band is
 * absent from the whole picture. Sampling anchors to the end of the file,
 * as the existing export specs do, because export overhead pads the front.
 */

/** Records a WebM whose left half is green and right half blue. */
async function recordBandedWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
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


/** Imports the banded clip, places it, and trims it to 1.5 s. */
async function placeBandedClip(page: Page) {
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of banded.webm at position 1 in seconds',
  })
  await outField.fill('1.5')
  await outField.blur()
}

// The fitted picture fills the whole frame (sole source), so the frame's
// left/right quarters are the source's own bands.
const LEFT_QUARTER: SampleRect = { x: 0, y: 0.25, width: 0.25, height: 0.5 }
const WHOLE_FRAME: SampleRect = { x: 0, y: 0, width: 1, height: 1 }

test('cropping the left half exports only the kept region at the reshaped frame (#256)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await placeBandedClip(page)

  // The uncropped control export: the full 320×180 picture, green on the
  // left — proving the band the crop must remove is really in the file.
  const plain = await sampleExportedFrame(
    page,
    await (async () => {
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export Project…' }).click()
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      return await readFile(await (await downloadPromise).path())
    })(),
    0.75,
    LEFT_QUARTER,
  )
  expect(plain.duration).toBeGreaterThan(1.5 * 0.6)
  expect(plain.duration).toBeLessThan(1.5 + 1)
  expect(plain.width).toBe(320)
  expect(plain.height).toBe(180)
  expect(plain.g).toBeGreaterThan(plain.b + 60)

  // Crop the green half away (#255) and export again.
  const cropField = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 1 (percent)',
  })
  await cropField.fill('50')
  await cropField.blur()

  // The export modal's automatic size shows the cropped frame (#179/#256):
  // the sole 320×180 source presents its kept 160×180 region, matching what
  // will export.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue(
    '160',
  )
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '180',
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  // The decoded file is the kept region's shape — the cropped dimensions
  // drove the export's own frame rule — and the whole frame decodes blue:
  // the cropped-away green band is absent from the file's pixels.
  const whole = await sampleExportedFrame(page, exported, 0.75, WHOLE_FRAME)
  expect(whole.width).toBe(160)
  expect(whole.height).toBe(180)
  expect(whole.b).toBeGreaterThan(whole.g + 60)
  expect(whole.g).toBeLessThan(80)
})
