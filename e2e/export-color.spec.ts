import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of per-clip color adjustments (#195): an exported file must show
 * the same adjustments the preview renders (#192) — the shared canonical
 * filter string applied in the canvas draw path. Fixtures are solid red so
 * a full grayscale is unmistakable in a decoded frame: unadjusted red reads
 * r≈205, g/b≈0; grayscaled it reads r≈g≈b≈44 (the red's luminance).
 * Sampling anchors to the end of the file, as the existing export specs do,
 * because export overhead pads the front.
 */

/** Records a solid red WebM (every frame identical). */
async function recordRedWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = 'rgb(205, 0, 0)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 2000) resolve()
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

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

interface FrameSample {
  r: number
  g: number
  b: number
  duration: number
}

/** A sampling region as fractions of the decoded frame. */
interface SampleRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * averages the pixels of a fractional region of that frame (the
 * export-zoom.spec approach, with a free-form region so an overlay's
 * rectangle can be sampled apart from the base).
 */
async function sampleExportedFrame(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  rect: SampleRect,
): Promise<FrameSample> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, rect }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const settleIfKnown = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve()
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
        const duration = video.duration
        const target = Math.max(0, duration - fromEndSeconds)
        video.currentTime = target
        // Poll instead of listening for `seeked`: the duration scan above may
        // still have a seek in flight, and its events would race a listener.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now()
          const check = () => {
            if (
              !video.seeking &&
              Math.abs(video.currentTime - target) < 0.25 &&
              video.readyState >= 2
            ) {
              resolve()
            } else if (performance.now() - started > 10_000) {
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
        const x = Math.floor(rect.x * canvas.width)
        const y = Math.floor(rect.y * canvas.height)
        const w = Math.max(1, Math.floor(rect.width * canvas.width))
        const h = Math.max(1, Math.floor(rect.height * canvas.height))
        const data = ctx.getImageData(x, y, w, h).data
        let r = 0
        let g = 0
        let b = 0
        const pixels = data.length / 4
        for (let index = 0; index < data.length; index += 4) {
          r += data[index]
          g += data[index + 1]
          b += data[index + 2]
        }
        return { r: r / pixels, g: g / pixels, b: b / pixels, duration }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, rect },
  )
}

const FULL: SampleRect = { x: 0, y: 0, width: 1, height: 1 }

test('an export renders a grayscale look: the red clip decodes gray (#195)', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordRedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'red.webm', mimeType: 'video/webm', buffer: red }])
  await page.getByRole('button', { name: 'Add red.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of red.webm at position 1 in seconds',
  })
  await outField.fill('1.5')
  await outField.blur()

  await page
    .getByRole('combobox', { name: 'Look of red.webm at position 1' })
    .selectOption('grayscale')

  const exported = await exportOnce(page)
  const frame = await sampleExportedFrame(page, exported, 0.75, FULL)
  expect(frame.duration).toBeGreaterThan(1.5 * 0.6)
  expect(frame.duration).toBeLessThan(1.5 + 1)

  // Unadjusted, the frame would read r≈205, g/b<25. Grayscaled, all three
  // channels sit at the red's luminance (≈44): red no longer dominates and
  // green rises above anything codec noise could produce from pure red.
  expect(frame.r).toBeLessThan(100)
  expect(frame.g).toBeGreaterThan(30)
  expect(Math.abs(frame.r - frame.g)).toBeLessThan(20)
  expect(Math.abs(frame.g - frame.b)).toBeLessThan(20)
})

test('an adjusted overlay exports adjusted while the base stays untouched (#195)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordRedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'red.webm', mimeType: 'video/webm', buffer: red }])

  // A green slate base (slates take no adjustments — their color is set
  // directly, #143) under a grayscaled red overlay in the default
  // bottom-right rectangle (0.62, 0.62, 0.35 × 0.35).
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('2')
  await duration.blur()
  await page.getByLabel('Color of Color slate at position 1').fill('#00cd00')

  await page.getByRole('button', { name: 'Add red.webm as overlay' }).click()
  await page
    .getByRole('combobox', { name: 'Look of overlay red.webm at position 1' })
    .selectOption('grayscale')

  const exported = await exportOnce(page)
  // Inside the overlay's rectangle: gray (the grayscaled red), not red.
  const overlayRegion = await sampleExportedFrame(page, exported, 1, {
    x: 0.66,
    y: 0.66,
    width: 0.27,
    height: 0.27,
  })
  // The top-left, owned by the slate: still saturated green — the overlay's
  // adjustment filtered exactly its own layer, nothing else.
  const base = await sampleExportedFrame(page, exported, 1, {
    x: 0.05,
    y: 0.05,
    width: 0.25,
    height: 0.25,
  })
  expect(overlayRegion.duration).toBeGreaterThan(2 * 0.6)

  expect(overlayRegion.r).toBeLessThan(100)
  expect(overlayRegion.g).toBeGreaterThan(30)
  expect(Math.abs(overlayRegion.r - overlayRegion.g)).toBeLessThan(20)
  expect(Math.abs(overlayRegion.g - overlayRegion.b)).toBeLessThan(20)

  expect(base.g).toBeGreaterThan(80)
  expect(base.r).toBeLessThan(30)
  expect(base.b).toBeLessThan(30)
})
