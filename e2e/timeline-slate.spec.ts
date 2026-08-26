import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Solid-color slates on the timeline (#143): placement with an editable
 * color and duration, preview rendering (including the customer's red-opener
 * crossfade), and export.
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
        // Blue frames, so the slate's red is unmistakably the slate's.
        ctx.fillStyle = '#0033cc'
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

/** Decodes an exported file and samples its centre pixel near `atSeconds`. */
async function probeExport(
  page: import('@playwright/test').Page,
  exported: Buffer,
  atSeconds: number,
) {
  return page.evaluate(
    async ({ base64, at }) => {
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
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = Math.min(at, Math.max(0, duration - 0.05))
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
      return {
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        centre: [centre[0], centre[1], centre[2]],
      }
    },
    { base64: exported.toString('base64'), at: atSeconds },
  )
}

test('a slate joins the timeline red and 5s, with editable color and duration', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toContainText('Color slate')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  const color = page.getByLabel('Color of Color slate at position 1')
  await expect(color).toHaveValue('#ff0000')
  // Any 24-bit color: set an arbitrary one through the picker's input.
  await color.fill('#123abc')
  await expect(color).toHaveValue('#123abc')

  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await expect(duration).toHaveValue('5')
  await duration.fill('2')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')
  // A slate is a still: no trim, no volume.
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of Color slate at position 1 in seconds' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('spinbutton', { name: 'Volume of Color slate at position 1 (0 to 1)' }),
  ).toHaveCount(0)
})

test('the customer example previews: a red slate crossfading into a clip', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: webm,
  })
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()

  // Inside the slate's solo window the color layer fronts alone.
  const slider = page.getByRole('slider', { name: 'Seek within sequence' })
  await slider.fill('2')
  await expect(page.getByTestId('preview-slate')).toBeVisible()
  await expect(page.getByTestId('preview-slate')).toHaveCSS(
    'background-color',
    'rgb(255, 0, 0)',
  )
  await expect(page.getByTestId('preview-now-playing')).toContainText('Color slate')

  // Mid-crossfade both layers render: the red slate under the incoming clip.
  await slider.fill('4.5')
  await expect(page.getByTestId('preview-slate')).toBeVisible()
  await expect(page.getByTestId('preview-video-incoming')).toBeVisible()
  await expect(page.getByTestId('preview-now-playing')).toContainText(
    'Color slate → clip.webm (crossfade)',
  )
})

test('the preview plays through a slate into the video on the wall clock', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: webm,
  })
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // Keep it quick: slate 1s, video trimmed to 1s.
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('1')
  await duration.blur()
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 2 in seconds',
  })
  await out.fill('1')
  await out.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByTestId('preview-slate')).toBeVisible()
  await expect(page.getByTestId('preview-now-playing')).toContainText('clip.webm', {
    timeout: 5000,
  })
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('preview-position')).toHaveText('0:02 / 0:02')
})

test('export renders the red slate, crossfading into the clip (#143)', async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer: webm,
  })
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // Slate 1.5s + video 1s with a 0.5s crossfade → 2s total; the slate is
  // alone on screen for the first second.
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('1.5')
  await duration.blur()
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 2 in seconds',
  })
  await out.fill('1')
  await out.blur()
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

  // A frame from the slate's solo window ([0, 1] of the sequence) must be
  // the slate's solid red — not black (a slate that never drew) and not the
  // clip's blue.
  const probed = await probeExport(page, exported, 0.5)
  expect(probed.duration).toBeGreaterThan(1.6)
  expect(probed.duration).toBeLessThan(3.5)
  const [red, green, blue] = probed.centre
  expect(red).toBeGreaterThan(150)
  expect(green).toBeLessThan(100)
  expect(blue).toBeLessThan(100)
})

test('a slate-only timeline exports at the fallback frame size', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('1.5')
  await duration.blur()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  const download = await downloadPromise
  const exported = await readFile((await download.path())!)
  expect(exported.byteLength).toBeGreaterThan(500)

  const probed = await probeExport(page, exported, 0.75)
  // No media source names a size, so the export uses the fallback frame.
  expect(probed.width).toBe(640)
  expect(probed.height).toBe(360)
  expect(probed.duration).toBeGreaterThan(1.2)
  expect(probed.duration).toBeLessThan(3)
  const [red, green, blue] = probed.centre
  expect(red).toBeGreaterThan(150)
  expect(green).toBeLessThan(100)
  expect(blue).toBeLessThan(100)
})
