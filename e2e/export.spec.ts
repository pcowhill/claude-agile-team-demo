import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Records a real WebM in-browser (as in the other specs) so the export
 * pipeline has genuinely decodable video to replay and re-encode.
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

test('exporting a trimmed 2-entry sequence downloads a playable WebM of the right length', async ({
  page,
}) => {
  await page.goto('./')

  // No export before any timeline entries exist.
  await expect(page.getByRole('button', { name: 'Export video' })).toBeDisabled()

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

  // Trim both entries so the export exercises in- AND out-points:
  // entry 1 plays [0, 1.0), entry 2 plays [0.5, 1.2) → total 1.7 s.
  const out1 = page.getByRole('spinbutton', {
    name: 'Trim out point of first.webm at position 1 in seconds',
  })
  await out1.fill('1')
  await out1.blur()
  const in2 = page.getByRole('spinbutton', {
    name: 'Trim in point of second.webm at position 2 in seconds',
  })
  await in2.fill('0.5')
  await in2.blur()
  const out2 = page.getByRole('spinbutton', {
    name: 'Trim out point of second.webm at position 2 in seconds',
  })
  await out2.fill('1.2')
  await out2.blur()

  // The preview's seek slider max is the trimmed sequence total — the same
  // number the exported file's duration must come close to.
  const expectedTotal = Number(
    await page.getByRole('slider', { name: 'Seek within sequence' }).getAttribute('max'),
  )
  expect(expectedTotal).toBeCloseTo(1.7, 1)

  // Export: progress appears, and the download lands without another click.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  await expect(page.getByRole('progressbar', { name: 'Export progress' })).toBeVisible()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.webm')

  const path = await download.path()
  const exported = await readFile(path)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Decode the exported file back in the browser: it must be a playable
  // video whose duration reflects the trimmed sequence. Recording happens in
  // real time, so allow slack for clip-switch overhead (longer) and for the
  // out-point epsilon (marginally shorter) — but a file that ignored the
  // trims would be ~3 s and fail the upper bound.
  const probed = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    return await new Promise<{ duration: number; width: number; height: number }>(
      (resolve, reject) => {
        const settleIfKnown = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            resolve({
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
            })
            return true
          }
          return false
        }
        video.onerror = () => reject(new Error('exported file failed to decode'))
        video.onloadedmetadata = () => {
          if (settleIfKnown()) return
          // MediaRecorder WebMs may report Infinity until forced to scan.
          video.ondurationchange = () => settleIfKnown()
          video.currentTime = Number.MAX_SAFE_INTEGER
        }
        video.src = url
      },
    )
  }, exported.toString('base64'))

  expect(probed.width).toBe(320)
  expect(probed.height).toBe(180)
  expect(probed.duration).toBeGreaterThan(expectedTotal * 0.6)
  expect(probed.duration).toBeLessThan(expectedTotal + 1)

  // The finished export offers a re-download link with the file size.
  await expect(page.getByTestId('export-download')).toContainText('sequence-export.webm')
})

test('canceling an export returns to idle without an error or download', async ({ page }) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()

  await page.getByRole('button', { name: 'Export video' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('button', { name: 'Export video' })).toBeEnabled()
  await expect(page.getByRole('alert')).not.toBeVisible()
  await expect(page.getByTestId('export-download')).not.toBeVisible()
})
