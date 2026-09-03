import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of overlay shape masks (#267): the exported file must show the same
 * cut silhouette the preview clips (#266). The fixture is the
 * preview-overlay-mask.spec arrangement, decoded from a real export instead
 * of screenshotted: a red slate base with a solid-green clip as an overlay,
 * whose 16:9 shape fills its default 16:9 card exactly — so under the hard
 * rectangle every card pixel is green. The unmasked control export first
 * proves the card's corner is green in decoded pixels (the pixels the mask
 * must cut really are in the file); with the ellipse mask the same corner
 * region — outside the inscribed ellipse — decodes as the red base showing
 * through the cut, while the card's centre stays green.
 *
 * Regions are fractions of the output frame. The slate-only sequence
 * composes at the 640×360 fallback frame (overlay dimensions play no part in
 * frame size), and the default overlay card is (0.62, 0.62)–(0.97, 0.97);
 * the corner square sits just inside the card's top-left, far outside the
 * inscribed ellipse, and the centre square on the card's midpoint.
 */

/** Records a short solid-green WebM so the overlay has a decodable source. */
async function recordGreenWebm(page: Page): Promise<Buffer> {
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
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1500) resolve()
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

/** Exports with the current settings and returns the file's bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

// The card spans (0.62, 0.62)–(0.97, 0.97) of the frame. In card fractions
// the corner square is ~(0.01–0.13, 0.01–0.14) — outside the inscribed
// ellipse, whose boundary that near the corner needs (dx² + dy²) ≤ 1 over
// half-card units — and the centre square straddles the card's midpoint.
const CARD_CORNER: SampleRect = { x: 0.625, y: 0.625, width: 0.04, height: 0.045 }
const CARD_CENTER: SampleRect = { x: 0.775, y: 0.775, width: 0.04, height: 0.045 }

test('an ellipse mask cuts the exported overlay corners to the base (#267)', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('./')

  // The base: the default red slate (#143), trimmed short for export speed.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('1.5')
  await duration.blur()

  const webm = await recordGreenWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'cam.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add cam.webm as overlay' }).click()

  // The unmasked control: the card corner decodes as the overlay's own
  // green — the pixels the mask must cut away really are in the file.
  const control = await sampleExportedFrame(page, await exportOnce(page), 0.6, CARD_CORNER)
  expect(control.width).toBe(640)
  expect(control.height).toBe(360)
  expect(control.g, `unmasked corner ${JSON.stringify(control)}`).toBeGreaterThan(control.r + 60)

  // Ellipse mask (#266) and export again: the corner region lies outside the
  // inscribed ellipse, so the red base decodes through the cut, while the
  // card's centre stays the overlay's green.
  await page
    .getByRole('combobox', { name: 'Shape mask of overlay cam.webm at position 1' })
    .selectOption('ellipse')
  const exported = await exportOnce(page)

  const corner = await sampleExportedFrame(page, exported, 0.6, CARD_CORNER)
  expect(corner.r, `masked corner ${JSON.stringify(corner)}`).toBeGreaterThan(corner.g + 60)
  const center = await sampleExportedFrame(page, exported, 0.6, CARD_CENTER)
  expect(center.g, `masked centre ${JSON.stringify(center)}`).toBeGreaterThan(center.r + 60)
})
