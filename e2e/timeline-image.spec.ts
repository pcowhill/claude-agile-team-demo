import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Still images on the timeline (#140): placement with an adjustable
 * duration, preview rendering (including through a transition), and export.
 */

/** Records a real WebM in-browser so the pipeline has decodable video. */
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

test('an image joins the timeline as a 5s still with an editable duration', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await makePng(page),
  })
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()

  const sequence = page.getByRole('list', { name: 'Sequence' })
  const entry = sequence.getByRole('listitem')
  await expect(entry).toContainText('logo.png')
  // Default 5 seconds; no trim or volume controls — a still has neither.
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of logo.png at position 1 in seconds',
  })
  await expect(duration).toHaveValue('5')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of logo.png at position 1 in seconds' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('spinbutton', { name: 'Volume of logo.png at position 1 (0 to 1)' }),
  ).toHaveCount(0)

  // Any positive duration is accepted.
  await duration.fill('2')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')
})

test('the preview shows the still for its window and plays through it', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) },
  ])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // Shorten both so the play-through is quick: still 1s + video trimmed to 1s.
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of logo.png at position 1 in seconds',
  })
  await duration.fill('1')
  await duration.blur()
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 2 in seconds',
  })
  await out.fill('1')
  await out.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  // Seeking into the still's window renders it as an image layer.
  const slider = page.getByRole('slider', { name: 'Seek within sequence' })
  await slider.fill('0.5')
  await expect(page.getByTestId('preview-image')).toBeVisible()
  await expect(page.getByTestId('preview-now-playing')).toContainText('logo.png')

  // Playing runs the still on the wall clock, hands over to the video at the
  // cut, and finishes the sequence.
  await slider.fill('0')
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByTestId('preview-image')).toBeVisible()
  await expect(page.getByTestId('preview-now-playing')).toContainText('clip.webm', {
    timeout: 5000,
  })
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('preview-position')).toHaveText('0:02 / 0:02')
})

test('a transition into a still previews with the incoming image layer', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) },
  ])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()

  // clip.webm runs ~1.5s; the 1s crossfade overlap starts ~0.5s in. Seek
  // into the overlap: both layers render, the incoming one the image.
  const max = Number(
    await page.getByRole('slider', { name: 'Seek within sequence' }).getAttribute('max'),
  )
  const overlapMidpoint = max - 5 + 0.5 // still contributes its last 4s alone
  // The range input's step is 0.01: snap the value to it or fill() refuses.
  await page
    .getByRole('slider', { name: 'Seek within sequence' })
    .fill((Math.round(overlapMidpoint * 100) / 100).toFixed(2))
  await expect(page.getByTestId('preview-image-incoming')).toBeVisible()
  await expect(page.getByTestId('preview-now-playing')).toContainText(
    'clip.webm → logo.png (crossfade)',
  )
})

test('export renders the still into the file (video + still, with a transition)', async ({
  page,
}) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) },
  ])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()

  // Keep the realtime export quick: video trimmed to 1s, still 1.5s, and a
  // 0.5s crossfade between them → total 2s.
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await out.fill('1')
  await out.blur()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of logo.png at position 2 in seconds',
  })
  await duration.fill('1.5')
  await duration.blur()
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const transitionDuration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await transitionDuration.fill('0.5')
  await transitionDuration.blur()

  const expectedTotal = Number(
    await page.getByRole('slider', { name: 'Seek within sequence' }).getAttribute('max'),
  )
  expect(expectedTotal).toBeCloseTo(2, 1)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  const download = await downloadPromise
  const exported = await readFile((await download.path())!)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // The exported file must decode and cover the whole sequence — a pipeline
  // that stalled on the still (which has no media element to play) would
  // never reach this length. The still's frames dominate the tail, so decode
  // a frame from inside its window and check it carries the PNG's color.
  const probed = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    video.muted = true
    await new Promise<void>((resolve, reject) => {
      video.onerror = () => reject(new Error('exported file failed to decode'))
      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) resolve()
        else {
          video.ondurationchange = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) resolve()
          }
          video.currentTime = Number.MAX_SAFE_INTEGER
        }
      }
      video.src = url
    })
    const duration = video.duration
    // Seek into the still's solo window (the last second of the export).
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = Math.max(0, duration - 0.4)
    })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const centre = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data
    return { duration, centre: [centre[0], centre[1], centre[2]] }
  }, exported.toString('base64'))

  // Real-time recording: allow overhead above and epsilon below.
  expect(probed.duration).toBeGreaterThan(1.6)
  expect(probed.duration).toBeLessThan(3.5)
  // The sampled frame sits in the still's solo window ([1.0, 2.0] of the
  // sequence), so it must carry the PNG's solid #0c6 — green dominant, red
  // low — not black (a still that never drew) or the video's frames.
  const [red, green] = probed.centre
  expect(green).toBeGreaterThan(150)
  expect(red).toBeLessThan(100)
})
