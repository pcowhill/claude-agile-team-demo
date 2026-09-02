import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of per-clip orientation (#233): the exported file must show the
 * same rotation/flips the preview renders (#232) — the shared transform
 * rule applied in the canvas draw path. The fixture's left half is green
 * and its right half blue (the preview-orientation.spec idiom: every frame
 * identical, so any decoded frame samples exactly), making a flip's band
 * swap and a quarter turn's band-to-top unmistakable in decoded pixels.
 * Sampling anchors to the end of the file, as the existing export specs
 * do, because export overhead pads the front.
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

/** Opens the export modal and runs an export, returning the saved bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
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

// The fitted picture fills the whole 320×180 frame (sole source), so the
// frame's left/right quarters are the source's own bands.
const LEFT_QUARTER: SampleRect = { x: 0, y: 0.25, width: 0.25, height: 0.5 }
const RIGHT_QUARTER: SampleRect = { x: 0.75, y: 0.25, width: 0.25, height: 0.5 }

test('flipping a clip flips the exported picture; unoriented exports unswapped (#233)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await placeBandedClip(page)

  // The unoriented control export: bands land where they were shot.
  const plain = await sampleExportedFrame(page, await exportOnce(page), 0.75, LEFT_QUARTER)
  expect(plain.duration).toBeGreaterThan(1.5 * 0.6)
  expect(plain.duration).toBeLessThan(1.5 + 1)
  expect(plain.g).toBeGreaterThan(plain.b + 60)

  // Flip H (#232) and export again: the same region now decodes blue, and
  // the opposite region green — the mirror, in the file's own pixels.
  await page
    .getByRole('checkbox', { name: 'Flip banded.webm at position 1 horizontally' })
    .check()
  const flipped = await exportOnce(page)
  const left = await sampleExportedFrame(page, flipped, 0.75, LEFT_QUARTER)
  const right = await sampleExportedFrame(page, flipped, 0.75, RIGHT_QUARTER)
  expect(left.b).toBeGreaterThan(left.g + 60)
  expect(right.g).toBeGreaterThan(right.b + 60)
})

test('a quarter turn exports portrait with the left band carried to the top (#233)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')
  await placeBandedClip(page)

  await page
    .getByRole('button', {
      name: 'Rotate banded.webm at position 1 90 degrees clockwise (currently 0 degrees)',
    })
    .click()

  // The export modal's automatic size shows the oriented frame (#179/#233):
  // the sole 320×180 source presents 180×320, matching what will export.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue(
    '180',
  )
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '320',
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  // The decoded file is portrait — the oriented dimensions drove the
  // export's own frame rule — and a 90° clockwise turn carries the source's
  // left (green) band to the top, right (blue) to the bottom.
  const top = await sampleExportedFrame(page, exported, 0.75, {
    x: 0.25,
    y: 0,
    width: 0.5,
    height: 0.25,
  })
  const bottom = await sampleExportedFrame(page, exported, 0.75, {
    x: 0.25,
    y: 0.75,
    width: 0.5,
    height: 0.25,
  })
  expect(top.width).toBe(180)
  expect(top.height).toBe(320)
  expect(top.g).toBeGreaterThan(top.b + 60)
  expect(bottom.b).toBeGreaterThan(bottom.g + 60)
})
