import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Export honors time remapping (#144): the exported file lasts the remapped
 * total — a speed segment stretches (or compresses) its portion, a pause
 * records as held frames. The per-frame schedule maths is unit-tested in
 * exportVideo.test.ts (advanceRemapReplay) and the mapping in remap.test.ts;
 * this proves the real recorded artifact carries the remapped timing, the
 * same way export.spec.ts proves trims.
 */

/** Records a real WebM in-browser so the export has decodable video. */
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

/** Import one recorded clip, add it to the timeline, and trim it to 1 s. */
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

/** Decodes an exported WebM and reports its duration. */
async function probeDuration(
  page: import('@playwright/test').Page,
  exported: Buffer,
): Promise<number> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    return await new Promise<number>((resolve, reject) => {
      const settleIfKnown = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          resolve(video.duration)
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
    })
  }, exported.toString('base64'))
}

async function exportSequence(page: import('@playwright/test').Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

test('a speed segment stretches the exported file to the remapped total', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await addTrimmedEntry(page)

  // The default segment fills the free space: [0, 1] at 0.5× on the 1 s
  // entry, so the 1 s of source must record as ~2 s of output — a file that
  // ignored the remap would be ~1 s and fail the lower bound.
  await page.getByRole('button', { name: 'Add speed segment to clip.webm at position 1' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  const exported = await exportSequence(page)
  expect(exported.byteLength).toBeGreaterThan(1000)
  const duration = await probeDuration(page, exported)
  expect(duration).toBeGreaterThan(2 * 0.7)
  expect(duration).toBeLessThan(2 + 1)
})

test('a pause records as held frames for the configured duration', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await addTrimmedEntry(page)

  // A pause at 0 holding 1 s (the default placement on a fresh entry): the
  // 1 s entry exports as ~2 s. Set the position mid-entry so the export
  // crosses into the hold mid-playback — the crossing path, not just the
  // entry-opening path.
  await page.getByRole('button', { name: 'Add pause to clip.webm at position 1' }).click()
  const at = page.getByRole('spinbutton', {
    name: 'Pause 1 position of clip.webm at position 1 in seconds',
  })
  await at.fill('0.5')
  await at.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  const exported = await exportSequence(page)
  expect(exported.byteLength).toBeGreaterThan(1000)
  const duration = await probeDuration(page, exported)
  // A file that skipped the hold would be ~1 s and fail the lower bound.
  expect(duration).toBeGreaterThan(2 * 0.7)
  expect(duration).toBeLessThan(2 + 1)
})
