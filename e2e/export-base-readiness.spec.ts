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
 * In Chromium it does not: a media element that has already decoded a frame
 * paints its **retained** frame while seeking — measured at `readyState` 1
 * with full alpha, the same behavior a <video> in the DOM has. In Firefox it
 * does: an element at `readyState` 1 mid-seek paints nothing, and the export
 * recorded black frames there (#635). So the export loop draws the base
 * through `heldVideoFrame`, which holds a copy of the element's last good
 * frame while it cannot supply one — the stand-in overlays have had since
 * #319 — and this spec runs in both browsers.
 *
 * Its job is to keep that property. A readiness check that *skips* or blanks
 * the base would turn those frames black, and that check is precisely the
 * "fix" #323 proposed. It has teeth — with the element's picture swapped for
 * an empty canvas when it reports unready, this spec fails with 28 black
 * frames of 85 presented (#324 records the injection).
 *
 * The provocation is a **real seek**, the way `alignReplayClock` snaps a
 * clock that drifted past `VIDEO_DRIFT_EPSILON`, and never a faked
 * `readyState`: the base path does not read `readyState`, so faking it would
 * provoke nothing and the check would pass vacuously. The seeks are counted,
 * and the element's real readiness is read **as each frame is composed**,
 * and both are asserted, so a machine whose seeks never leave a composed
 * frame without a picture fails loudly instead of quietly proving nothing.
 *
 * Why as each frame is composed (#553). This guard used to sample readiness
 * from its own animation-frame loop, at the start of each tick, before that
 * tick's seek. In Chromium a seek drops `readyState` to 1 synchronously, and
 * the composer's frame later in the same animation frame sees it; by the
 * next tick the seek has finished and the sample reads 4. So the sample
 * almost never saw the stall the composer drew through: in 7 of 10 local
 * runs the 54 seeks registered no stall at all, and the guard passed only on
 * the one it counted after the export released the element (`readyState` 0
 * at teardown). When no tick fell between that release and the read, it read
 * 0 and failed: in nearly every CI run, hidden by retries.
 *
 * In Firefox a seek does not drop `readyState` synchronously: the element
 * reports 4 with `seeking` true for a while, and paints normally, then 1,
 * and paints nothing. The guard counts the second state, which is the one a
 * frame can be lost in. Measured under Firefox 153 with #635's fix, 40–56
 * of about 220 composed frames per run, in 12 of 12 runs.
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
  // same element — advances normally and the export still finishes.
  //
  // The stalls are counted where they matter: at each frame the composer
  // composes, reading the element's *real* readiness at that moment (#553).
  // A frame composed while the element reports less than
  // `HAVE_CURRENT_DATA` is exactly a frame that a readiness check on the base
  // would turn black, so the check cannot pass vacuously on a machine whose
  // seeks never leave a composed frame without a picture. The export canvas
  // is the one whose `captureStream()` the export records, and `drawFrame`
  // opens every frame by filling that whole canvas with black. Counting
  // there, and not at the draw of the element, keeps the count independent
  // of whatever the composer then chooses to draw.
  //
  // The element is kept seeking for the whole window, not seeked once per
  // frame (#673). Setting `currentTime` does not lower `readyState` at once:
  // the drop arrives later as a task, and no task runs between two
  // animation-frame callbacks, so the composer never sees the seek issued in
  // its own frame. It sees a stall only while a seek from an earlier frame
  // is still pending. Measured in Firefox 153, most single seeks settle
  // within one frame (`seeked` after 11-17 ms) and only some outlive it, so
  // one seek per frame stalled 24-37 of ~220 composed frames locally and
  // exactly 0 in about one CI run in four. Re-seeking on every `seeked`
  // leaves the element settled only for the moment between that event and
  // the next seek's drop, however fast its seeks complete.
  await page.evaluate(() => {
    const probe = { stalls: 0, frames: 0, seeks: 0, ticks: 0, captured: false, source: '' }
    ;(window as unknown as { __probe: typeof probe }).__probe = probe
    let armed: HTMLMediaElement | null = null
    const exportCanvases = new WeakSet<HTMLCanvasElement>()
    const realCaptureStream = HTMLCanvasElement.prototype.captureStream
    HTMLCanvasElement.prototype.captureStream = function (this: HTMLCanvasElement, ...args) {
      exportCanvases.add(this)
      return realCaptureStream.apply(this, args)
    }
    const realFillRect = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      const canvas = this.canvas
      if (
        armed !== null &&
        canvas instanceof HTMLCanvasElement &&
        exportCanvases.has(canvas) &&
        x === 0 &&
        y === 0 &&
        w === canvas.width &&
        h === canvas.height
      ) {
        probe.frames += 1
        if (armed.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) probe.stalls += 1
      }
      return realFillRect.call(this, x, y, w, h)
    }
    const arm = (element: HTMLMediaElement) => {
      probe.captured = true
      probe.source = element.src
      armed = element
      // Open the seeking window once the element has supplied real frames:
      // `cueTo` awaits readiness before the first frame composes, and a
      // layer that never decoded anything has nothing to fall back to.
      const inWindow = () => probe.ticks > 15 && probe.ticks < 70 && !element.ended
      const seek = () => {
        element.currentTime = element.currentTime + 0.005
        probe.seeks += 1
      }
      element.addEventListener('seeked', () => {
        if (inWindow()) seek()
      })
      const tick = () => {
        probe.ticks += 1
        // Starts the chain, and restarts it should the element ever settle
        // without a `seeked` of its own.
        if (inWindow() && !element.seeking) seek()
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
          __probe: {
            stalls: number
            frames: number
            seeks: number
            ticks: number
            captured: boolean
            source: string
          }
        }
      ).__probe,
  )
  // Printed so a failure says what the probe saw, not only that it failed.
  const seen = `stalls ${probe.stalls} of ${probe.frames} frames, ${probe.seeks} seeks, ${probe.ticks} ticks`
  console.log(`PROBE ${test.info().titlePath.at(-1)?.slice(0, 3)} ${test.info().project.name} ${seen}`)
  // Without these the check could pass vacuously, having provoked nothing.
  expect(probe.captured, 'the export primary replay element was never captured').toBe(true)
  expect(probe.source, 'the armed element was not playing the clip').toMatch(/^blob:/)
  expect(probe.seeks, `the element was never seeked during the export (${seen})`).toBeGreaterThan(0)
  expect(probe.frames, `no composed frame of the export canvas was seen (${seen})`).toBeGreaterThan(0)
  // The provocation is only evidence if the composer composed frames while
  // the element was unable to supply one.
  expect(
    probe.stalls,
    `the seeks never left the element unable to supply a frame while one was composed (${seen})`,
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
      // Firefox drops a seek issued before the first frame has loaded: at
      // readyState 1 the assignment can be lost with no seeking event, leaving
      // currentTime at 0 (#615). Seek only once loadeddata has fired.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true })
          video.addEventListener('error', () => reject(new Error('exported file failed to decode')), {
            once: true,
          })
        })
      }
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
