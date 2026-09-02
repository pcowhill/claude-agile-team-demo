import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of per-entry background fill (#260): the exported file must fill
 * the bars a non-frame-filling entry leaves exactly as the preview renders
 * them (#259) — the shared backdrop rule consumed in the export's canvas
 * draw path. The setup is the preview spec's (preview-background-fill):
 * the same banded WebM (left half green, right half blue) placed twice,
 * the second placement cropped to its blue right half — the uncropped
 * first entry keeps the frame at 320×180, so the cropped 160×180 entry
 * pillarboxes with a bar on each side. Decoded frames from inside the
 * second entry evidence the fill: the bars decode black bare, the chosen
 * color under `color`, and non-black blue (the entry's own blurred frame)
 * under `blur` — with the exported dimensions pinned unchanged throughout
 * (fill never shapes the frame). Sampling anchors to the end of the file,
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
 * export-crop.spec approach — the decoded dimensions make the frame's
 * unchanged size checkable).
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

/** Exports the timeline and returns the downloaded file's bytes. */
async function exportProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

// The cropped 160×180 entry contain-fits into the centre half of the
// 320×180 frame, leaving a quarter-frame bar each side — the sampled
// regions, inset from the frame edges and the fitted picture.
const LEFT_BAR: SampleRect = { x: 0.02, y: 0.2, width: 0.18, height: 0.6 }
const PICTURE_CENTER: SampleRect = { x: 0.45, y: 0.2, width: 0.1, height: 0.6 }

test('color and blur fills export into the pillarbox bars; none stays black (#260)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  for (const position of [1, 2]) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of banded.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  // Crop the second placement to its blue right half: it presents 160×180
  // while the uncropped first entry keeps the frame at 320×180.
  const cropField = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 2 (percent)',
  })
  await cropField.fill('50')
  await cropField.blur()

  // Fill-free control: the bars decode black, the picture blue — proving
  // the bars the fills below must paint really are black in the file.
  const bare = await exportProject(page)
  const bareBar = await sampleExportedFrame(page, bare, 0.4, LEFT_BAR)
  expect(bareBar.width).toBe(320)
  expect(bareBar.height).toBe(180)
  expect(bareBar.r + bareBar.g + bareBar.b).toBeLessThan(90)
  const barePicture = await sampleExportedFrame(page, bare, 0.4, PICTURE_CENTER)
  expect(barePicture.b).toBeGreaterThan(barePicture.g + 60)

  // A color fill paints the exported bars that color.
  const fillSelect = page.getByRole('combobox', {
    name: 'Background fill of banded.webm at position 2',
  })
  await fillSelect.selectOption('color')
  await page.getByLabel('Background fill color of banded.webm at position 2').fill('#cc0000')
  const colored = await exportProject(page)
  const coloredBar = await sampleExportedFrame(page, colored, 0.4, LEFT_BAR)
  // The frame's shape is untouched — fill never reshapes the export.
  expect(coloredBar.width).toBe(320)
  expect(coloredBar.height).toBe(180)
  expect(coloredBar.r).toBeGreaterThan(120)
  expect(coloredBar.r).toBeGreaterThan(coloredBar.b + 60)
  // The fitted picture above the backdrop is untouched.
  const coloredPicture = await sampleExportedFrame(page, colored, 0.4, PICTURE_CENTER)
  expect(coloredPicture.b).toBeGreaterThan(coloredPicture.r + 60)

  // Blur: the exported bars show non-black content derived from the entry's
  // own frame — the kept region is all blue, so the blurred backdrop is too.
  await fillSelect.selectOption('blur')
  const blurred = await exportProject(page)
  const blurredBar = await sampleExportedFrame(page, blurred, 0.4, LEFT_BAR)
  expect(blurredBar.width).toBe(320)
  expect(blurredBar.height).toBe(180)
  expect(blurredBar.b).toBeGreaterThan(60)
  expect(blurredBar.b).toBeGreaterThan(blurredBar.r + 40)
  expect(blurredBar.b).toBeGreaterThan(blurredBar.g + 40)
})
