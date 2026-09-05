import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Idle preview (#382, customer report #380): a player that has never been
 * played or seeked must show the frame under the playhead, not a black box.
 * The fixture is a two-phase recording — solid green for the first second,
 * solid red for the second — so the sampled pixels say unambiguously WHICH
 * frame the idle preview holds: green proves the first frame (not black),
 * red after an in-point trim proves the trimmed in-point (not source 0).
 */

/** Records a WebM that is solid green for ~1 s, then solid red for ~1 s. */
async function recordTwoPhaseWebm(page: Page): Promise<Buffer> {
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
        const elapsed = performance.now() - start
        ctx.fillStyle = elapsed < 1000 ? 'rgb(0, 205, 0)' : 'rgb(205, 0, 0)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (elapsed > 2000) resolve()
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

interface VideoSample {
  r: number
  g: number
  b: number
  /** Whether the element had decodable pixels at all when sampled. */
  hasFrame: boolean
}

/** Averages the idle preview <video>'s current frame via a canvas draw. */
async function samplePreviewVideo(page: Page): Promise<VideoSample> {
  return await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="preview-video"]')
    if (video === null || video.videoWidth === 0 || video.readyState < 2) {
      return { r: 0, g: 0, b: 0, hasFrame: false }
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let r = 0
    let g = 0
    let b = 0
    const pixels = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels, hasFrame: true }
  })
}

/**
 * Asserts the idle preview settles on a frame dominated by `channel`. The
 * poll anchors on a state load cannot fake (#362): decoding and presenting
 * the cued frame can be *delayed* by load, but nothing can turn the wrong
 * frame the asserted color — a stale, black, or source-0 frame never reads
 * as the expected channel dominating both others by 60.
 */
async function expectIdleFrame(page: Page, channel: 'g' | 'r') {
  await expect(async () => {
    const sample = await samplePreviewVideo(page)
    expect(sample.hasFrame).toBe(true)
    const others: number =
      channel === 'g' ? Math.max(sample.r, sample.b) : Math.max(sample.g, sample.b)
    expect(sample[channel]).toBeGreaterThan(others + 60)
  }).toPass({ timeout: 15_000 })
}

test('the idle preview shows the first frame on add, and the trimmed in-point after an edit (#382)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordTwoPhaseWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'phases.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add phases.webm to timeline' }).click()

  // Never pressing play: the first frame (green phase) appears on its own.
  await expectIdleFrame(page, 'g')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  // Trimming the in point into the red phase re-cues the idle frame: the
  // preview shows the in-point's frame, not source time 0.
  const trimIn = page.getByRole('spinbutton', {
    name: 'Trim in point of phases.webm at position 1 in seconds',
  })
  await trimIn.fill('1.5')
  await trimIn.blur()
  await expectIdleFrame(page, 'r')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  // A rendered look at the fixed surface for the PR's evidence — the pixel
  // assertions above are the durable guard; the screenshot is the human
  // check, re-taken on every run.
  await page.screenshot({ path: testInfo.outputPath('idle-preview.png') })
})

test('a restored session shows the frame under the playhead without pressing play (#382)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordTwoPhaseWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'phases.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add phases.webm to timeline' }).click()

  // The debounced autosave snapshot lands (the autosave.spec poll: structure
  // plus the clip's blob), then the page simply goes away.
  await waitForSnapshot(page, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()

  // The restored playhead is the sequence start: its frame (green phase)
  // appears with no play press.
  await expectIdleFrame(page, 'g')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()
})

/**
 * The autosave.spec.ts snapshot poll, verbatim: polled via `page.evaluate`
 * (which awaits page promises) rather than `waitForFunction`, whose
 * predicate is not awaited when async.
 */
async function waitForSnapshot(page: Page, blobs: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async (expectedBlobs) => {
          const openDb = () =>
            new Promise<IDBDatabase | null>((resolve) => {
              const request = indexedDB.open('bvep-autosave')
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => resolve(null)
            })
          const db = await openDb()
          if (db === null) return false
          try {
            if (
              !db.objectStoreNames.contains('structure') ||
              !db.objectStoreNames.contains('media')
            ) {
              return false
            }
            const tx = db.transaction(['structure', 'media'], 'readonly')
            const get = <T>(request: IDBRequest<T>) =>
              new Promise<T>((resolve, reject) => {
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
            const structure = await get(tx.objectStore('structure').get('current'))
            const mediaKeys = await get(tx.objectStore('media').getAllKeys())
            return structure !== undefined && mediaKeys.length === expectedBlobs
          } finally {
            db.close()
          }
        }, blobs),
      { timeout: 20_000 },
    )
    .toBe(true)
}
