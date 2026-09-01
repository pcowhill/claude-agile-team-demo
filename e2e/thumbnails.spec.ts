import { expect, test } from '@playwright/test'

/**
 * Clip thumbnails in the timeline (#193): a video entry gains a captured
 * still of its trimmed range's first frame through the real chain (object
 * URL → video decode → canvas → data URL), re-captures when the in-point
 * changes, an image entry shows the image itself, and a slate shows its
 * color swatch.
 */

/** Records a real WebM whose frames change color over time, so different
 * trim in-points yield visibly different captures. */
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
        // Sweep the hue fast so 0s and 1s frames are far apart in color.
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
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

/** A real PNG generated in the browser, decodable by the actual probe. */
async function makePng(page: import('@playwright/test').Page): Promise<Buffer> {
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0c6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(pngBase64, 'base64')
}

test('a video entry gains a captured thumbnail that re-captures on a new in-point', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: await recordWebm(page),
  })
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // The real capture chain lands a fixed-size JPEG data URL in the row.
  const thumbnail = page.getByTestId('timeline-entry-thumbnail-0')
  await expect(thumbnail).toBeVisible()
  const initialSrc = await thumbnail.getAttribute('src')
  expect(initialSrc).toMatch(/^data:image\/jpeg/)

  // Re-trimming the in-point re-captures: the recording sweeps its color,
  // so the 1s frame encodes to a different image than the 0s frame.
  const inPoint = page.getByRole('spinbutton', {
    name: 'Trim in point of clip.webm at position 1 in seconds',
  })
  await inPoint.fill('1')
  await inPoint.blur()
  await expect(thumbnail).toBeVisible()
  await expect(async () => {
    const retrimmedSrc = await thumbnail.getAttribute('src')
    expect(retrimmedSrc).toMatch(/^data:image\/jpeg/)
    expect(retrimmedSrc).not.toBe(initialSrc)
  }).toPass()
})

test('image entries show the image itself; slates show their color swatch', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await makePng(page),
  })
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  // The image thumbnail is the imported image, scaled — no capture step.
  const imageThumb = page.getByTestId('timeline-entry-thumbnail-0')
  await expect(imageThumb).toBeVisible()
  expect(await imageThumb.getAttribute('src')).toMatch(/^blob:/)

  // The slate's swatch carries the slate's color (default red).
  const swatch = page.getByTestId('timeline-entry-thumbnail-1')
  await expect(swatch).toHaveCSS('background-color', 'rgb(255, 0, 0)')
})

test('an overlay row gains a captured thumbnail too', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: await recordWebm(page),
  })
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm as overlay' }).click()

  const thumbnail = page.getByTestId('video-overlay-thumbnail-0')
  await expect(thumbnail).toBeVisible()
  expect(await thumbnail.getAttribute('src')).toMatch(/^data:image\/jpeg/)
})
