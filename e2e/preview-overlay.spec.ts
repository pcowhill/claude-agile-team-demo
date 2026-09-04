import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Overlay layers in the preview (#145): a real browser positions the
 * overlay's <video> at its fractional rectangle within the frame and shows
 * it exactly for its sequence-time window — the geometry jsdom cannot
 * verify (component tests pin the style values and the sync decisions).
 * Since #176 the rectangle resolves against the frame — the region shaped
 * exactly like the export canvas — not the stage layout box, so what the
 * preview shows is where the export composites.
 */

/** Records a short real WebM so the overlay has a decodable source. The
 * frame size is parameterized so the #176 test can prove the preview frame
 * follows the sources' own shape rather than the 16:9 fallback. */
async function recordWebm(page: Page, width = 320, height = 180): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
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
  }, { width, height })
  return Buffer.from(webmBase64, 'base64')
}

test('an overlay renders at its rectangle within the frame, only during its window', async ({
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
  await expect(page.getByRole('list', { name: 'Overlay layers' })).toBeVisible()

  // Inside its window (default: whole clip from sequence start) the element
  // sits at the default rectangle — 35% of the frame, inset bottom-right.
  const overlay = page.getByTestId('preview-overlay-0')
  await expect(overlay).toBeVisible()
  const frame = await page.getByTestId('preview-frame').boundingBox()
  const box = await overlay.boundingBox()
  expect(frame).not.toBeNull()
  expect(box).not.toBeNull()
  expect(box!.x).toBeCloseTo(frame!.x + 0.62 * frame!.width, 0)
  expect(box!.y).toBeCloseTo(frame!.y + 0.62 * frame!.height, 0)
  expect(box!.width).toBeCloseTo(0.35 * frame!.width, 0)
  expect(box!.height).toBeCloseTo(0.35 * frame!.height, 0)

  // The frame itself has the export frame's shape (#176): an all-slate base
  // means the fallback 640×360 frame, so 16:9 — regardless of the stage's
  // own layout-determined shape. Overlay clip dimensions play no part.
  expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1)

  // Past its window (the ~1.5s clip on the 5s slate) the element hides.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('4')
  await expect(overlay).toBeHidden()
})

test('the frame takes the export aspect from the base sources, pinning overlays to it (#176)', async ({
  page,
}) => {
  await page.goto('./')

  // The customer's report (#171): with a base video and a default-placed
  // overlay, the preview drew the overlay far right of where the export
  // composites it, because the overlay's fractions resolved against the
  // stage — whose shape is a layout accident — instead of the output frame.
  // A square base makes the mismatch stark: the desktop stage is much wider
  // than 1:1, so the old stage-relative placement would land the overlay in
  // the letterbox gutter, outside the picture.
  const webm = await recordWebm(page, 320, 320)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'base.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add base.webm as overlay' }).click()

  // The frame settles on the base video's own aspect (the export rule:
  // largest source dimensions — here the single 320×320 source), visibly
  // departing from the 16:9 fallback.
  const frameBox = page.getByTestId('preview-frame')
  await expect
    .poll(async () => {
      const box = (await frameBox.boundingBox())!
      return box.width / box.height
    })
    .toBeCloseTo(1, 1)

  // And the overlay's rectangle resolves against that frame: fully inside
  // it, at the default bottom-right placement.
  const frame = (await frameBox.boundingBox())!
  const box = (await page.getByTestId('preview-overlay-0').boundingBox())!
  expect(box.x).toBeCloseTo(frame.x + 0.62 * frame.width, 0)
  expect(box.y).toBeCloseTo(frame.y + 0.62 * frame.height, 0)
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1)
})
