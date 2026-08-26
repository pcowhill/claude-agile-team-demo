import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Overlay video layers in the preview (#145): a real browser positions the
 * overlay's <video> at its fractional rectangle within the stage and shows
 * it exactly for its sequence-time window — the geometry jsdom cannot
 * verify (component tests pin the style values and the sync decisions).
 */

/** Records a short real WebM so the overlay has a decodable source. */
async function recordWebm(page: Page): Promise<Buffer> {
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

test('an overlay renders at its rectangle within the stage, only during its window', async ({
  page,
}) => {
  await page.goto('./')

  // A slate keeps the base media-free (#143); the overlay is a real clip.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'cam.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add cam.webm as overlay' }).click()

  // The Overlays lane lists it with the default placement.
  await expect(page.getByRole('list', { name: 'Overlay video layers' })).toBeVisible()

  // Inside its window (default: whole clip from sequence start) the element
  // sits at the default rectangle — 35% of the stage, inset bottom-right.
  const overlay = page.getByTestId('preview-overlay-0')
  await expect(overlay).toBeVisible()
  const stage = await page.locator('.preview-stage').boundingBox()
  const box = await overlay.boundingBox()
  expect(stage).not.toBeNull()
  expect(box).not.toBeNull()
  expect(box!.x).toBeCloseTo(stage!.x + 0.62 * stage!.width, 0)
  expect(box!.y).toBeCloseTo(stage!.y + 0.62 * stage!.height, 0)
  expect(box!.width).toBeCloseTo(0.35 * stage!.width, 0)
  expect(box!.height).toBeCloseTo(0.35 * stage!.height, 0)

  // Past its window (the ~1.5s clip on the 5s slate) the element hides.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('4')
  await expect(overlay).toBeHidden()
})
