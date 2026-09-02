import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Export format picker (#114): the panel offers the container formats the
 * running browser can record, the chosen format drives the encoder candidate
 * list, and the downloaded file's container, MIME type, and extension follow
 * the choice. Chromium reports `video/mp4` recordable (as VP9/Opus in builds
 * without proprietary codecs), so the MP4 path runs for real in CI.
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

async function importOneClip(page: import('@playwright/test').Page) {
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
}

test('selecting MP4 exports a file that demuxes as MP4 (#114)', async ({ page }) => {
  await page.goto('./')
  await importOneClip(page)

  // Chromium records MP4, so the modal must offer the choice — a missing
  // option here means the feature detection or the candidate lists regressed.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const mp4 = page.getByRole('radio', { name: 'MP4' })
  await expect(mp4).toBeVisible()
  await mp4.check()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.mp4')
  const exported = await readFile(await download.path())
  expect(exported.byteLength).toBeGreaterThan(1000)

  // An MP4 opens with an ftyp box: box size (4 bytes) then the type 'ftyp'.
  expect(exported.subarray(4, 8).toString('latin1')).toBe('ftyp')

  // The saved Blob's type is the recorder's actual MIME — an MP4 one.
  const blobType = await page.evaluate(async () => {
    const href = document.querySelector('[data-testid="export-download"]')!.getAttribute('href')!
    return (await (await fetch(href)).blob()).type
  })
  expect(blobType.startsWith('video/mp4')).toBe(true)

  // And the file is genuinely playable video, not just well-magic-numbered.
  const probed = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    const video = document.createElement('video')
    return await new Promise<{ duration: number; width: number; height: number }>(
      (resolve, reject) => {
        video.onerror = () => reject(new Error('exported MP4 failed to decode'))
        video.onloadedmetadata = () =>
          resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
        video.src = url
      },
    )
  }, exported.toString('base64'))
  expect(probed.width).toBe(320)
  expect(probed.height).toBe(180)
  expect(probed.duration).toBeGreaterThan(0.5)
})

test('without MP4 support the picker drops MP4 and WebM exports as today (#114)', async ({
  page,
}) => {
  // Simulate a browser without MP4 recording (Firefox) by narrowing the
  // real feature detection before the app loads. WebM stays the checked
  // default; the audio-only format (#245) rides the same WebM support, so
  // only MP4 vanishes.
  await page.addInitScript(() => {
    const original = MediaRecorder.isTypeSupported.bind(MediaRecorder)
    MediaRecorder.isTypeSupported = (type: string) =>
      type.startsWith('video/mp4') ? false : original(type)
  })
  await page.goto('./')
  await importOneClip(page)

  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('radio', { name: 'WebM', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'MP4' })).toHaveCount(0)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.webm')
  const exported = await readFile(await download.path())
  // A WebM opens with the EBML magic number.
  expect(exported.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
})
