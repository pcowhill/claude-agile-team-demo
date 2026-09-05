import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { firstFrame, scanExportedFrames } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export compositing of overlay video layers (#146): an exported file must
 * carry the overlay's picture during its window, at its placement rectangle
 * — drawn by the real canvas `drawImage` path the unit tests cannot reach.
 * The fixture is a red color slate (#143, media-free base) with a recorded
 * green clip as the default corner overlay, so decoded frames reveal the
 * draw: a frame inside the overlay's window contains green pixels confined
 * to the bottom-right region; a frame after the window has none anywhere.
 */

/** Records a short real WebM so the overlay has a decodable source. */
async function recordWebm(page: Page): Promise<Buffer> {
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

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

interface GreenScan {
  green: number
  total: number
  duration: number
  /** Bounding box of the green pixels, as fractions of the frame. */
  minX: number
  minY: number
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * scans the frame for green pixels — the overlay clip's green against the
 * slate's red, which never brightens the green channel alone.
 */
async function scanGreenPixels(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
): Promise<GreenScan> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve(video.duration)
              return
            }
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => {
              if (Number.isFinite(video.duration) && video.duration > 0) {
                resolve(video.duration)
              }
            }
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = Math.max(0, duration - fromEndSeconds)
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')!
        context.drawImage(video, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let green = 0
        let minX = 1
        let minY = 1
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 100 && pixels[index + 1] > 150 && pixels[index + 2] < 100) {
            green++
            const pixel = index / 4
            minX = Math.min(minX, (pixel % canvas.width) / canvas.width)
            minY = Math.min(minY, Math.floor(pixel / canvas.width) / canvas.height)
          }
        }
        return { green, total: pixels.length / 4, duration, minX, minY }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds },
  )
}

test('an exported file composites the overlay at its rectangle, during its window only', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')

  // A 3 s red slate as the base; the green clip (~1.5 s) as the default
  // corner overlay — whole clip from sequence start, rect 0.62/0.62/0.35².
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('3')
  await slateDuration.blur()

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'cam.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add cam.webm as overlay' }).click()
  await expect(page.getByRole('list', { name: 'Overlay layers' })).toBeVisible()

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Sample times are measured from the file's own content, not nominal
  // offsets from its ends (#370): the export's front pad is black and the
  // real-time recording stretches under CPU load, so "0.5 s from the end"
  // once landed while the stretched overlay window was still showing. The
  // red slate runs the whole 3 s sequence, so its first frame anchors the
  // content span and sequence times scale onto it; both sampled instants
  // sit around a second of nominal slack from the window's edge.
  const scan = await scanExportedFrames(page, exported, {
    full: { x: 0, y: 0, width: 1, height: 1 },
  })
  expect(scan.duration).toBeGreaterThan(3 * 0.6)
  expect(scan.duration).toBeLessThan(3 + 2)
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands.full.r > 100,
    'the red slate starting',
  ).time
  const atSequenceTime = (seconds: number) =>
    contentStart + (seconds / 3) * (scan.duration - contentStart)

  // Inside the overlay's window (sequence time 0.5 s — well inside the
  // ~1.5 s clip): the green picture covers about 0.35² ≈ 12% of the frame,
  // confined to the bottom-right rectangle.
  const early = await scanGreenPixels(page, exported, scan.duration - atSequenceTime(0.5))
  expect(early.green).toBeGreaterThan(early.total * 0.05)
  expect(early.green).toBeLessThan(early.total * 0.25)
  // Nothing green left or above the placement rectangle (0.62 of the frame;
  // the margin absorbs encoder chroma bleed at the color boundary).
  expect(early.minX).toBeGreaterThan(0.55)
  expect(early.minY).toBeGreaterThan(0.55)

  // After the window (sequence time ≈ 2.5 s, past the ~1.5 s clip): the
  // overlay is gone; the frame is pure slate/padding.
  const late = await scanGreenPixels(page, exported, scan.duration - atSequenceTime(2.5))
  expect(late.green).toBe(0)
})
