import { expect, test } from '@playwright/test'

/**
 * Preview playback of time-remap effects (#141): a speed segment drives the
 * video element's playbackRate and stretches the sequence; a pause freezes
 * the element on one frame while the sequence clock advances through the
 * hold; seeks land inside remapped regions correctly. The mapping maths is
 * unit-tested in lib/remap.test.ts and lib/playback.test.ts — this exercises
 * the real element behavior those numbers drive.
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
        // Animated content so seeked frames differ and playback is visible.
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

/** Import one recorded clip, add it to the timeline, and trim it to 1s. */
async function addTrimmedEntry(page: import('@playwright/test').Page) {
  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await out.fill('1')
  await out.blur()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toContainText(
    'plays 1s of',
  )
}

test('a speed segment drives playbackRate and stretches the sequence', async ({ page }) => {
  await page.goto('./')
  await addTrimmedEntry(page)

  // The default segment fills the free space: [0, 1] at 0.5× on the 1s
  // entry, so 1s of source plays for 2s of sequence.
  await page.getByRole('button', { name: 'Add speed segment to clip.webm at position 1' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '2',
  )

  const video = page.getByTestId('preview-video')
  await page.getByRole('button', { name: 'Play preview' }).click()
  // Inside the segment the element plays at the configured factor.
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.playbackRate))
    .toBe(0.5)
  // The published sequence position passes the un-remapped 1s total: only
  // the stretched mapping can take it there.
  await expect(page.getByTestId('preview-position')).toContainText('0:01 /', { timeout: 10_000 })
  // The whole remapped sequence plays out and stops at the 2s total.
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId('preview-position')).toHaveText('0:02 / 0:02')
})

test('a pause freezes the frame while the sequence clock advances', async ({ page }) => {
  await page.goto('./')
  await addTrimmedEntry(page)

  // A pause at 0.5s holding 1s: the 1s entry plays for 2s of sequence.
  await page.getByRole('button', { name: 'Add pause to clip.webm at position 1' }).click()
  const at = page.getByRole('spinbutton', {
    name: 'Pause 1 position of clip.webm at position 1 in seconds',
  })
  await at.fill('0.5')
  await at.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  const video = page.getByTestId('preview-video')
  await page.getByRole('button', { name: 'Play preview' }).click()

  // Mid-hold: the element is paused on the frozen instant while playback is
  // still running (the pause button is showing) — the sequence clock, not
  // the element clock, is advancing.
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused), { timeout: 10_000 })
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  const frozenAt = await video.evaluate((el: HTMLVideoElement) => el.currentTime)
  expect(frozenAt).toBeGreaterThanOrEqual(0.4)
  expect(frozenAt).toBeLessThanOrEqual(0.6)

  // The hold ends: the element resumes and the sequence completes at the
  // remapped 2s total.
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused), { timeout: 10_000 })
    .toBe(false)
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByTestId('preview-position')).toHaveText('0:02 / 0:02')
})

test('seeking lands inside remapped regions on the right frame', async ({ page }) => {
  await page.goto('./')
  await addTrimmedEntry(page)

  await page.getByRole('button', { name: 'Add pause to clip.webm at position 1' }).click()
  const at = page.getByRole('spinbutton', {
    name: 'Pause 1 position of clip.webm at position 1 in seconds',
  })
  await at.fill('0.5')
  await at.blur()

  // Sequence 1.0 is inside the plateau [0.5, 1.5): the element must be cued
  // to the frozen instant and stay paused.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('1')
  const video = page.getByTestId('preview-video')
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(0.5, 1)
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)

  // Sequence 1.8 is past the plateau: 0.3s of source remain, so the element
  // cues to source 0.8.
  await seek.fill('1.8')
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(0.8, 1)
})
