import { expect, test } from '@playwright/test'

/**
 * Per-clip color adjustments (#192): the preview element carries the
 * canonical filter string (colorAdjustments.ts) for exactly the adjusted
 * clip — the e2e criterion of #192. Records a real WebM (as in
 * preview.spec.ts) so the elements are genuinely playable video.
 */
async function recordWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1200) resolve()
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

test('adjusting a clip sets the preview element filter; reset clears it', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'base.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'cam.webm', mimeType: 'video/webm', buffer: webm },
  ])
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()

  // Unadjusted: no filter on the preview element.
  const previewVideo = page.getByTestId('preview-video')
  await expect(previewVideo).toBeVisible()
  expect(await previewVideo.evaluate((el) => el.style.filter)).toBe('')

  // Brightness + a look → the canonical shared filter string, live.
  const brightness = page.getByRole('spinbutton', {
    name: 'Brightness of base.webm at position 1 (percent)',
  })
  await brightness.fill('150')
  await brightness.blur()
  await page
    .getByRole('combobox', { name: 'Look of base.webm at position 1' })
    .selectOption('sepia')
  expect(await previewVideo.evaluate((el) => el.style.filter)).toBe(
    'brightness(150%) sepia(100%)',
  )
  // The browser accepted the string: the computed style resolves it rather
  // than discarding it as invalid.
  expect(await previewVideo.evaluate((el) => getComputedStyle(el).filter)).toBe(
    'brightness(1.5) sepia(1)',
  )

  // A video overlay filters its own element, independent of the base.
  await page.getByRole('button', { name: 'Add cam.webm as overlay' }).click()
  const saturation = page.getByRole('spinbutton', {
    name: 'Saturation of overlay cam.webm at position 1 (percent)',
  })
  await saturation.fill('0')
  await saturation.blur()
  const overlayVideo = page.getByTestId('preview-overlay-0')
  expect(await overlayVideo.evaluate((el) => el.style.filter)).toBe('saturate(0%)')
  expect(await previewVideo.evaluate((el) => el.style.filter)).toBe(
    'brightness(150%) sepia(100%)',
  )

  // Reset returns the entry to identity — the filter is simply gone.
  await page.getByRole('button', { name: 'Reset color of base.webm at position 1' }).click()
  expect(await previewVideo.evaluate((el) => el.style.filter)).toBe('')
})
