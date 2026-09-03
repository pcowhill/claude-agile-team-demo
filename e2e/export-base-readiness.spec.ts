import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * The base layer must never record a **black frame** because its replay
 * element momentarily could not supply a picture (#324, from the
 * investigation that closed #323).
 *
 * `drawFrame` clears the canvas to black and then draws the base
 * unconditionally, and the export's frame loop is driven by
 * `requestAnimationFrame` — it composes on every tick, whatever the
 * element's readiness. So a stalled base layer looks like it must record
 * black, and #323 was filed on exactly that reading.
 *
 * It does not, and this spec is the evidence plus the guard. A media element
 * that has already decoded a frame paints its **retained** frame while
 * seeking — measured at `readyState` 1 with full alpha, the same behavior a
 * <video> in the DOM has — so the unconditional draw is truthful even
 * mid-stall. Only a never-decoded element paints nothing, and `cueTo` awaits
 * readiness before the first frame composes.
 *
 * This therefore passes on the code as it stands, by construction. Its job
 * is to keep it that way: a readiness check added to the base layer would
 * turn those frames black, and that check is precisely the "fix" #323
 * proposed. It has teeth — with the element's picture swapped for an empty
 * canvas when it reports unready, this spec fails with 28 black frames of 85
 * presented (#324 records the injection).
 *
 * The provocation is a **real seek**, the way `alignReplayClock` snaps a
 * clock that drifted past `VIDEO_DRIFT_EPSILON`, and never a faked
 * `readyState`: the base path does not read `readyState`, so faking it would
 * provoke nothing and the check would pass vacuously. The seeks are counted
 * and the element's real readiness sampled, and both are asserted, so a
 * machine whose seeks never stall the element fails loudly instead of
 * quietly proving nothing.
 *
 * Every presented frame of the exported file is scanned (the sampling
 * discipline #276 established) rather than nominal timestamps being probed,
 * because the defect this guards against is a frame or two wide.
 */

/** Records a real WebM of one flat color, so the source decodes for real. */
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

test('the base layer never records a black frame while its element is seeking (#324)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')

  // One solid-blue clip: the base fills the whole output frame, so any frame
  // the base failed to draw reads as black over the whole picture.
  const blue = await recordWebm(page, 'rgb(0, 0, 205)', 3000)

  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.webm', mimeType: 'video/webm', buffer: blue }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)

  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()

  // Hold the export's primary replay element unready over a span of composed
  // frames. The span is counted in frames, not milliseconds, so it lands in
  // the same place on a fast or slow machine — and it opens only after the
  // element has supplied real frames, since `cueTo` awaits readiness before
  // the first frame composes and a layer that never decoded anything has
  // nothing to fall back to.
  // Provoke the real thing: seek the export's own primary replay element
  // during the export, the way a drift snap does (`alignReplayClock` seeks
  // when a clock drifts past VIDEO_DRIFT_EPSILON). A seeking element is
  // *genuinely* unable to supply a picture, which is what the defect needs —
  // faking `readyState` would prove nothing here, because the unfixed base
  // path never reads it (unlike #319's overlay path, whose skip did).
  //
  // The seeks are tiny and forward, so the export clock — read from this
  // same element — advances normally and the export still finishes. The
  // stalls they cause are counted by sampling the element's *real* readiness
  // from this loop, independent of anything the composer does, so the check
  // cannot pass vacuously on a machine whose seeks never drop readiness.
  await page.evaluate(() => {
    const probe = { stalls: 0, seeks: 0, ticks: 0, captured: false, source: '' }
    ;(window as unknown as { __probe: typeof probe }).__probe = probe
    const arm = (element: HTMLMediaElement) => {
      probe.captured = true
      probe.source = element.src
      const tick = () => {
        probe.ticks += 1
        if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) probe.stalls += 1
        // Open the seeking window once the element has supplied real frames:
        // `cueTo` awaits readiness before the first frame composes, and a
        // layer that never decoded anything has nothing to fall back to.
        if (probe.ticks > 15 && probe.ticks < 70 && !element.ended) {
          element.currentTime = element.currentTime + 0.005
          probe.seeks += 1
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    const realPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      // The export builds its replay elements detached from the document,
      // and the primary is the first of them to play; the preview's own
      // <video> elements are in the document and must not be touched.
      if (!probe.captured && !this.isConnected) arm(this)
      return realPlay.call(this)
    }
  })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile(await download.path())
  expect(exported.byteLength).toBeGreaterThan(1000)

  const probe = await page.evaluate(
    () =>
      (
        window as unknown as {
          __probe: { stalls: number; seeks: number; captured: boolean; source: string }
        }
      ).__probe,
  )
  // Without these the check could pass vacuously, having provoked nothing.
  expect(probe.captured, 'the export primary replay element was never captured').toBe(true)
  expect(probe.source, 'the armed element was not playing the clip').toMatch(/^blob:/)
  expect(probe.seeks, 'the element was never seeked during the export').toBeGreaterThan(0)
  // The provocation is only evidence if it actually stalled the element.
  expect(
    probe.stalls,
    'the seeks never left the element unable to supply a frame',
  ).toBeGreaterThan(0)

  // Walk every presented frame of the exported file, sampling the middle of
  // the picture — where the base is, whichever way the frame is letterboxed.
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
        x: Math.floor(canvas.width * 0.4),
        y: Math.floor(canvas.height * 0.4),
        width: Math.max(1, Math.floor(canvas.width * 0.2)),
        height: Math.max(1, Math.floor(canvas.height * 0.2)),
      }
      const black: number[] = []
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
        let dark = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] < 40 && pixels[index + 1] < 40 && pixels[index + 2] < 40) dark++
        }
        frames += 1
        if (dark / (pixels.length / 4) > 0.5) black.push(Number(metadata.mediaTime.toFixed(3)))
        withCallback.requestVideoFrameCallback(onFrame)
      }
      withCallback.requestVideoFrameCallback(onFrame)
      await video.play()
      await finished
      return { frames, black }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, exported.toString('base64'))

  expect(scan.frames).toBeGreaterThan(20)
  expect(scan.black, `black frames, of ${scan.frames} presented`).toEqual([])
})
