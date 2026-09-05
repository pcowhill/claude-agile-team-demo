import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Export output settings (#179): the modal pre-fills the automatic frame,
 * presets and custom edits export at the chosen dimensions, and fractional
 * placements (text) resolve against the chosen frame.
 */

/** Records a short real WebM in-browser as decodable source material. */
async function recordSourceWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
        ctx.fillStyle = '#0033cc'
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

/** Exports via the modal and returns the downloaded bytes. */
async function exportDownload(page: import('@playwright/test').Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return readFile(await download.path())
}

/** Decodes an exported WebM's metadata in the browser. */
async function probeExport(
  page: import('@playwright/test').Page,
  exported: Buffer,
): Promise<{ duration: number; width: number; height: number }> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    return await new Promise((resolve, reject) => {
      video.onerror = () => reject(new Error('exported file failed to decode'))
      video.onloadedmetadata = () =>
        resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
      video.src = url
    })
  }, exported.toString('base64'))
}

/**
 * Counts near-white pixels at a decoded instant — the text-overlay signal.
 * The seek waits for the sought frame to be PRESENTED (#276's discipline,
 * mirrored from the shared decoder): drawing straight after `onseeked`
 * intermittently rasterizes a not-yet-presented frame as all black under
 * parallel load — a stress run recorded exactly that here (a whitish count
 * of zero on a frame that provably carries the text; #374).
 */
async function countWhitishPixels(
  page: import('@playwright/test').Page,
  exported: Buffer,
  atSeconds: number,
): Promise<number> {
  return page.evaluate(
    async ({ base64, at }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      await new Promise<void>((resolve, reject) => {
        video.onerror = () => reject(new Error('exported file failed to decode'))
        video.onloadedmetadata = () => resolve()
        video.src = url
      })
      await new Promise<void>((resolve, reject) => {
        const started = performance.now()
        let presented = false
        const onFrame = (_now: number, metadata: { mediaTime: number }) => {
          if (Math.abs(metadata.mediaTime - at) < 0.25) presented = true
          else video.requestVideoFrameCallback(onFrame)
        }
        video.requestVideoFrameCallback(onFrame)
        video.currentTime = at
        let settledAt: number | null = null
        const check = () => {
          if (!video.seeking && Math.abs(video.currentTime - at) < 0.25 && video.readyState >= 2) {
            settledAt ??= performance.now()
            if (presented || performance.now() - settledAt > 1500) {
              resolve()
              return
            }
          }
          if (performance.now() - started > 10_000) {
            reject(new Error('seeking the exported file timed out'))
          } else {
            requestAnimationFrame(check)
          }
        }
        check()
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let whitish = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 180 && pixels[index + 1] > 180 && pixels[index + 2] > 180) whitish++
      }
      return whitish
    },
    { base64: exported.toString('base64'), at: atSeconds },
  )
}

test('a preset exports at its dimensions with text resolved against the chosen frame', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')

  // A red slate with a white text overlay — both media-free.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('2')
  await slateDuration.blur()
  await page.getByRole('button', { name: 'Add text overlay to timeline' }).click()
  const size = page.getByRole('spinbutton', {
    name: 'Size of text overlay at position 1 (fraction of frame height)',
  })
  await size.fill('0.25')
  await size.blur()

  await page.getByRole('button', { name: 'Export Project…' }).click()

  // Slates carry no dimensions, so Auto pre-fills the fallback frame.
  await expect(page.getByRole('combobox', { name: 'Export size preset' })).toHaveValue('auto')
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue('640')
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '360',
  )
  await expect(
    page.getByRole('spinbutton', { name: 'Export frame rate in frames per second' }),
  ).toHaveValue('30')

  // Pick the Web preset: the fields repopulate and the export follows them.
  await page.getByRole('combobox', { name: 'Export size preset' }).selectOption('web')
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue('854')

  const exported = await exportDownload(page)
  expect(exported.byteLength).toBeGreaterThan(1000)
  const probed = await probeExport(page, exported)
  expect(probed.width).toBe(854)
  expect(probed.height).toBe(480)
  expect(probed.duration).toBeGreaterThan(1)

  // The white text overlay drew inside the chosen (larger) frame: its size
  // is a fraction of the frame height, so whitish pixels must be plentiful.
  const whitish = await countWhitishPixels(page, exported, 1)
  expect(whitish).toBeGreaterThan(854 * 480 * 0.005)
})

test('custom dimensions and frame rate: the modal pre-fills the source frame, the export honors the edits', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')

  const webm = await recordSourceWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await outField.fill('1')
  await outField.blur()

  await page.getByRole('button', { name: 'Export Project…' }).click()

  // Auto pre-fills the source-derived frame — the 320×180 recording.
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue('320')
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '180',
  )

  // Manual edits switch the selector to Custom and drive the export.
  await page.getByRole('spinbutton', { name: 'Export width in pixels' }).fill('160')
  await expect(page.getByRole('combobox', { name: 'Export size preset' })).toHaveValue('custom')
  await page.getByRole('spinbutton', { name: 'Export height in pixels' }).fill('90')
  await page.getByRole('spinbutton', { name: 'Export frame rate in frames per second' }).fill('15')

  const exported = await exportDownload(page)
  expect(exported.byteLength).toBeGreaterThan(500)
  const probed = await probeExport(page, exported)
  expect(probed.width).toBe(160)
  expect(probed.height).toBe(90)
  expect(probed.duration).toBeGreaterThan(0.5)
})

test('invalid settings disable Export until corrected', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Export Project…' }).click()

  const width = page.getByRole('spinbutton', { name: 'Export width in pixels' })
  await width.fill('0')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('whole numbers')

  await width.fill('640')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
})
