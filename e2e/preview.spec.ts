import { expect, test } from '@playwright/test'

/**
 * Records a real WebM in-browser (as in import.spec.ts / timeline.spec.ts)
 * so the preview player has genuinely decodable video to play.
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

test('a trimmed 3-entry sequence (with a duplicated source) plays, pauses, and resumes', async ({
  page,
}) => {
  await page.goto('./')

  // No player before any timeline entries exist.
  await expect(page.getByText('Add clips to the timeline to preview your edit.')).toBeVisible()

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(2)

  // Three entries from two clips: first.webm appears twice with different
  // trims (issue #8 acceptance criteria).
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(3)

  // Entry 1 plays only its first 1.0s; entry 2 (same source) skips its
  // first 0.5s. Entry 3 stays untrimmed.
  const out1 = page.getByRole('spinbutton', {
    name: 'Trim out point of first.webm at position 1 in seconds',
  })
  await out1.fill('1')
  await out1.blur()
  const in2 = page.getByRole('spinbutton', {
    name: 'Trim in point of first.webm at position 2 in seconds',
  })
  await in2.fill('0.5')
  await in2.blur()
  await expect(sequence.getByRole('listitem').first()).toContainText('plays 1s of')

  const video = page.getByTestId('preview-video')
  const position = page.getByTestId('preview-position')
  await expect(position).toContainText('0:00 /')

  // Play: the video element starts advancing and the button flips to Pause.
  await page.getByRole('button', { name: 'Play preview' }).click()
  const pauseButton = page.getByRole('button', { name: 'Pause preview' })
  await expect(pauseButton).toBeVisible()
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.1)
  await expect(page.getByTestId('preview-now-playing')).toContainText('Clip 1 of 3: first.webm')

  // Pause: playback stops and the position freezes.
  await pauseButton.click()
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()
  const paused = await video.evaluate((el: HTMLVideoElement) => el.paused)
  expect(paused).toBe(true)
  const frozenAt = await video.evaluate((el: HTMLVideoElement) => el.currentTime)
  await page.waitForTimeout(300)
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBe(frozenAt)

  // Resume: the rest of the ~2.5s trimmed sequence plays through all three
  // entries in order — proving trims are honored across boundaries and the
  // duplicated source is re-cued at its own in-point — then playback stops
  // with the position pinned to the total.
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByTestId('preview-now-playing')).toContainText('Clip 2 of 3: first.webm', {
    timeout: 10_000,
  })
  // Entry 2 starts at its 0.5s in-point, not at the start of the source.
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(0.5)
  await expect(page.getByTestId('preview-now-playing')).toContainText('Clip 3 of 3: second.webm', {
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
    timeout: 10_000,
  })
  const positionText = await position.textContent()
  const [current, total] = positionText!.split(' / ')
  expect(current).toBe(total)
})

test('seeking jumps to the correct clip within the sequence', async ({ page }) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()

  // Seek near the end of the sequence: the second clip must be cued.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const max = Number(await seek.getAttribute('max'))
  expect(max).toBeGreaterThan(1)
  // Range inputs only accept values on the step grid (step=0.01).
  await seek.fill((Math.round((max - 0.2) * 100) / 100).toFixed(2))
  await expect(page.getByTestId('preview-now-playing')).toContainText('second.webm')

  // The video element is cued into the second source at the right offset:
  // sequence max−0.2 falls 0.2s before the end of the second clip.
  const video = page.getByTestId('preview-video')
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(max / 2 - 0.4)

  // Seek back to the start: the first clip is cued again.
  await seek.fill('0')
  await expect(page.getByTestId('preview-now-playing')).toContainText('first.webm')
})
