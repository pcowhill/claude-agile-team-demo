import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of per-clip crop (#256): the exported file must show only the kept
 * region the preview renders (#255) — the shared crop rule consumed in the
 * canvas draw path. The fixture's left half is green and its right half
 * blue (the preview-crop.spec idiom: every frame identical, so any decoded
 * frame samples exactly), making a left-half crop unmistakable in decoded
 * pixels: the frame reshapes to the kept region and the green band is
 * absent from the whole picture. Sampling anchors to the end of the file,
 * as the existing export specs do, because export overhead pads the front.
 */

/** Records a WebM whose left half is green and right half blue. */
async function recordBandedWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
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

interface FrameSample {
  r: number
  g: number
  b: number
  duration: number
  width: number
  height: number
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
 * export-orientation.spec approach — the decoded dimensions make the
 * cropped frame's reshaped size checkable).
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
        return {
          r: r / pixels,
          g: g / pixels,
          b: b / pixels,
          duration,
          width: video.videoWidth,
          height: video.videoHeight,
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, rect },
  )
}

/** Imports the banded clip, places it, and trims it to 1.5 s. */
async function placeBandedClip(page: Page) {
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of banded.webm at position 1 in seconds',
  })
  await outField.fill('1.5')
  await outField.blur()
}

// The fitted picture fills the whole frame (sole source), so the frame's
// left/right quarters are the source's own bands.
const LEFT_QUARTER: SampleRect = { x: 0, y: 0.25, width: 0.25, height: 0.5 }
const WHOLE_FRAME: SampleRect = { x: 0, y: 0, width: 1, height: 1 }

test('cropping the left half exports only the kept region at the reshaped frame (#256)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await placeBandedClip(page)

  // The uncropped control export: the full 320×180 picture, green on the
  // left — proving the band the crop must remove is really in the file.
  const plain = await sampleExportedFrame(
    page,
    await (async () => {
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export Project…' }).click()
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      return await readFile(await (await downloadPromise).path())
    })(),
    0.75,
    LEFT_QUARTER,
  )
  expect(plain.duration).toBeGreaterThan(1.5 * 0.6)
  expect(plain.duration).toBeLessThan(1.5 + 1)
  expect(plain.width).toBe(320)
  expect(plain.height).toBe(180)
  expect(plain.g).toBeGreaterThan(plain.b + 60)

  // Crop the green half away (#255) and export again.
  const cropField = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 1 (percent)',
  })
  await cropField.fill('50')
  await cropField.blur()

  // The export modal's automatic size shows the cropped frame (#179/#256):
  // the sole 320×180 source presents its kept 160×180 region, matching what
  // will export.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveValue(
    '160',
  )
  await expect(page.getByRole('spinbutton', { name: 'Export height in pixels' })).toHaveValue(
    '180',
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  // The decoded file is the kept region's shape — the cropped dimensions
  // drove the export's own frame rule — and the whole frame decodes blue:
  // the cropped-away green band is absent from the file's pixels.
  const whole = await sampleExportedFrame(page, exported, 0.75, WHOLE_FRAME)
  expect(whole.width).toBe(160)
  expect(whole.height).toBe(180)
  expect(whole.b).toBeGreaterThan(whole.g + 60)
  expect(whole.g).toBeLessThan(80)
})
