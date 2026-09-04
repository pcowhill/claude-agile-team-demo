import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * An overlay layer must survive its replay element momentarily being unable
 * to supply a frame (#319, from the customer's report in #317: a color slate
 * covering an overlay for about a frame, in the export only).
 *
 * `drawImage` of a media element below `HAVE_CURRENT_DATA` draws nothing, so
 * the export used to skip such a layer for that frame — deleting it from the
 * output and letting the base show through. The preview cannot exhibit this:
 * its overlay is a real <video> in the DOM, which goes on displaying the last
 * decoded frame while an element seeks or re-buffers.
 *
 * The unit tests in `exportVideo.test.ts` pin the composer's decision; this
 * one exercises it through the real canvas, recorder and decoder, and scans
 * **every presented frame** of the exported file (the sampling discipline
 * #276 established) rather than probing nominal timestamps, because the
 * defect is a frame or two wide.
 *
 * The element is made unready by construction rather than by racing the
 * decoder: a real seek does drop readiness and does reproduce this (with the
 * fix reverted, seeking the element throughout the export lost 26 of 84
 * exported frames), but how long a seek takes is the machine's business, and
 * a check whose provocation may quietly stop firing is not evidence. So the
 * element is held unready over a fixed span of composed frames, and the test
 * asserts that the provocation actually happened.
 */

/** Records a real WebM of one flat color, so the sources decode for real. */
async function recordWebm(page: Page, color: string, ms: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ color, ms }) => {
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
          ctx.fillStyle = color
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > ms) resolve()
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
    },
    { color, ms },
  )
  return Buffer.from(base64, 'base64')
}

test('an overlay layer stays in the export while its element cannot supply a frame (#319)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')

  const blue = await recordWebm(page, 'rgb(0, 0, 205)', 1500)
  // The overlay outlasts the sequence: every output frame owes it a picture,
  // so its own window ending can never read as a dropout.
  const green = await recordWebm(page, 'rgb(0, 205, 0)', 6000)

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'base.webm', mimeType: 'video/webm', buffer: blue },
    { name: 'over.webm', mimeType: 'video/webm', buffer: green },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)

  // video A → color slate B across a transition, the customer's shape.
  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 2 in seconds',
  })
  await slateDuration.fill('2')
  await slateDuration.blur()
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const transitionDuration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await transitionDuration.fill('0.5')
  await transitionDuration.blur()
  await page.getByRole('button', { name: 'Add over.webm as overlay' }).click()
  await expect(page.getByRole('list', { name: 'Overlay layers' })).toBeVisible()

  const overlayUrl = await page
    .getByTestId('preview-overlay-0')
    .evaluate((element) => (element as HTMLVideoElement).src)

  // Hold the export's overlay replay element unready over a span of frames
  // that covers the transition handover. The span is counted in frames, not
  // milliseconds, so it lands in the same place on a fast or slow machine —
  // and it opens only after the element has supplied real frames, since a
  // layer that never decoded anything has nothing to fall back to.
  await page.evaluate((url: string) => {
    const probe = { readyFrames: 0, unreadyFrames: 0, captured: false }
    ;(window as unknown as { __probe: typeof probe }).__probe = probe
    const realReadyState = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'readyState',
    )!.get!
    const arm = (element: HTMLMediaElement) => {
      probe.captured = true
      Object.defineProperty(element, 'readyState', {
        configurable: true,
        get() {
          const actual = realReadyState.call(element) as number
          if (actual < HTMLMediaElement.HAVE_CURRENT_DATA) return actual
          probe.readyFrames += 1
          // Twenty real frames in, report "no frame available" for the next
          // twenty — the state a seeking or re-buffering element is in.
          if (probe.readyFrames > 20 && probe.unreadyFrames < 20) {
            probe.unreadyFrames += 1
            return HTMLMediaElement.HAVE_METADATA
          }
          return actual
        },
      })
    }
    const realPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      // The export's replay elements are never in the document; the preview's
      // overlay <video> shares the src and must not be touched.
      if (!probe.captured && this.src === url && !this.isConnected) arm(this)
      return realPlay.call(this)
    }
  }, overlayUrl)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile(await download.path())
  expect(exported.byteLength).toBeGreaterThan(1000)

  const probe = await page.evaluate(
    () => (window as unknown as { __probe: { unreadyFrames: number; captured: boolean } }).__probe,
  )
  // Without this the check could pass vacuously, having provoked nothing.
  expect(probe.captured, 'the export overlay replay element was never captured').toBe(true)
  expect(probe.unreadyFrames, 'the element was never held unready').toBeGreaterThan(0)

  // Walk every presented frame of the exported file, sampling well inside the
  // overlay's placement rectangle so encoder chroma bleed at the colour
  // boundary cannot decide the result.
  const scan = await page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    video.muted = true
    try {
      await new Promise<void>((resolve, reject) => {
        video.onerror = () => reject(new Error('exported file failed to decode'))
        video.onloadedmetadata = () => resolve()
        video.src = url
      })
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = 0
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')!
      const rect = {
        x: Math.floor(canvas.width * 0.7),
        y: Math.floor(canvas.height * 0.7),
        width: Math.max(1, Math.floor(canvas.width * 0.18)),
        height: Math.max(1, Math.floor(canvas.height * 0.18)),
      }
      const missing: number[] = []
      let frames = 0
      const finished = new Promise<void>((resolve) => {
        video.onended = () => resolve()
      })
      type FrameMetadata = { mediaTime: number }
      const withCallback = video as unknown as {
        requestVideoFrameCallback: (callback: (now: number, metadata: FrameMetadata) => void) => void
      }
      const onFrame = (_now: number, metadata: FrameMetadata) => {
        context.drawImage(video, 0, 0)
        const pixels = context.getImageData(rect.x, rect.y, rect.width, rect.height).data
        let green = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 120 && pixels[index + 1] > 130 && pixels[index + 2] < 120) green++
        }
        frames += 1
        if (green / (pixels.length / 4) < 0.5) missing.push(Number(metadata.mediaTime.toFixed(3)))
        withCallback.requestVideoFrameCallback(onFrame)
      }
      withCallback.requestVideoFrameCallback(onFrame)
      await video.play()
      await finished
      return { frames, missing }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, exported.toString('base64'))

  expect(scan.frames).toBeGreaterThan(20)
  expect(
    scan.missing,
    `frames with no overlay picture, of ${scan.frames} presented`,
  ).toEqual([])
})
