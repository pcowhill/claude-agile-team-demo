import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { firstFrame, lastFrame, scanExportedFrames } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export a range (#385, approved suggestion #381): mark in / mark out on the
 * transport scope the export to the span between them, in every format. The
 * fixtures are color-phased so the exported file's own pixels say what span
 * it carries: content outside the marks reads as the wrong color, and a
 * range starting inside a transition must show the blend, not either clip
 * alone. All pixel positions are located in the file itself (#370) — the
 * export is a real-time recording whose phases shift under load — and every
 * poll anchors on states load cannot fake (#362).
 */

/** Records a WebM that is solid green for ~1 s, then solid red for ~1 s,
 * with a steady tone throughout so audio formats have a mix to carry. */
async function recordTwoPhaseWebm(page: Page, toneHz?: number): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ toneHz }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)
    let audio: AudioContext | null = null
    if (toneHz !== undefined) {
      audio = new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      const destination = audio.createMediaStreamDestination()
      const gain = audio.createGain()
      gain.gain.value = 0.5
      const oscillator = audio.createOscillator()
      oscillator.frequency.value = toneHz
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()
      stream.addTrack(destination.stream.getAudioTracks()[0])
    }
    const mimeType = toneHz === undefined ? 'video/webm' : 'video/webm;codecs=vp8,opus'
    const recorder = new MediaRecorder(stream, { mimeType })
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
    await audio?.close()
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, { toneHz })
  return Buffer.from(webmBase64, 'base64')
}

/** Records a ~2 s solid-color WebM (the transition test's clip families). */
async function recordSolidWebm(page: Page, family: 'red' | 'blue'): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ family }) => {
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
        ctx.fillStyle = family === 'red' ? 'rgb(205, 0, 0)' : 'rgb(0, 0, 205)'
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
  }, { family })
  return Buffer.from(webmBase64, 'base64')
}

/** Clicking first gives the page the user activation an AudioContext needs. */
async function activate(page: Page) {
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
}

/**
 * Seeks the transport slider to `time` and clicks a mark button. The clip's
 * duration metadata settles asynchronously, so the slider's max can lag the
 * added clip (#371's race class): the read, the fill, and the landing are one
 * retried block — a stale max re-reads rather than dying on a rejected fill.
 */
async function markAt(page: Page, time: number, button: 'preview-mark-in' | 'preview-mark-out') {
  const slider = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(async () => {
    const max = Number(await slider.getAttribute('max'))
    expect(max).toBeGreaterThanOrEqual(time)
    await slider.fill(String(time))
    expect(Number(await slider.inputValue())).toBeCloseTo(time, 3)
  }).toPass({ timeout: 15_000 })
  await page.getByTestId(button).click()
}

/** Runs one export through the modal, scoped to the marked range. */
async function exportMarkedRange(page: Page, format?: string): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  if (format !== undefined) await page.getByRole('radio', { name: format }).check()
  await page.getByTestId('export-scope-range').check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

const FULL: Record<string, SampleRect> = { full: { x: 0, y: 0, width: 1, height: 1 } }

/** Strong presence of a clip's own color channel in a frame average. */
const DOMINANT = 80
/** A blended frame must show both channels well above codec noise. */
const BLENDED = 40
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 30

test('marked range exports only the span between the marks, and the transport shows it (#385)', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const webm = await recordTwoPhaseWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'phases.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add phases.webm to timeline' }).click()

  // Mark a span lying entirely inside the red phase: [1.4, 1.9] of the ~2 s
  // clip. The marks are the proof the export is scoped — a whole-sequence
  // file would open green.
  await markAt(page, 1.4, 'preview-mark-in')
  await markAt(page, 1.9, 'preview-mark-out')

  // The marked span highlights on the seek bar, named with its times.
  const highlight = page.getByTestId('preview-marked-range')
  await expect(highlight).toBeVisible()
  await expect(highlight).toHaveAttribute('title', /Marked range: 0:01 – 0:02/)

  // Geometry (new visible surface): the mark controls and the highlight sit
  // inside the transport row, nothing wraps, and the page gained no sideways
  // scroll. Containment carries a +1 px tolerance for borders, as the
  // freeze-frame spec's checks do.
  const controls = page.locator('.preview-controls')
  const controlsBox = (await controls.boundingBox())!
  for (const testId of ['preview-mark-in', 'preview-mark-out', 'preview-clear-marks']) {
    const element = page.getByTestId(testId)
    const box = (await element.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(controlsBox.x - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(controlsBox.x + controlsBox.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(controlsBox.y - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(controlsBox.y + controlsBox.height + 1)
    const overflow = await element.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  }
  // The highlight lies inside the seek wrapper's box — on the bar, not
  // floating elsewhere in the row.
  const seekBox = (await page.locator('.preview-seek').boundingBox())!
  const highlightBox = (await highlight.boundingBox())!
  expect(highlightBox.x).toBeGreaterThanOrEqual(seekBox.x - 1)
  expect(highlightBox.x + highlightBox.width).toBeLessThanOrEqual(seekBox.x + seekBox.width + 1)
  const pageScroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(pageScroll.scrollWidth).toBeLessThanOrEqual(pageScroll.clientWidth)
  // The human check for the PR's rendered evidence, re-taken every run.
  await page.screenshot({ path: testInfo.outputPath('export-range-transport.png') })

  // Export the marked range and decode what actually landed in the file.
  const exported = await exportMarkedRange(page)
  expect(exported.byteLength).toBeGreaterThan(500)
  const scan = await scanExportedFrames(page, exported, FULL)

  // Duration is the range's 0.5 s, with the suite's real-time slack — a
  // whole-sequence export (~2 s) fails the upper bound outright.
  expect(scan.duration).toBeGreaterThan(0.5 * 0.5)
  expect(scan.duration).toBeLessThan(0.5 + 1)

  // Every frame is the red phase: the green phase before the in mark never
  // reaches the file. (Load can delay frames, never recolor them — a scoped
  // export contains no green to find.)
  const red = firstFrame(scan, (frame) => frame.bands.full.r > DOMINANT, 'the red phase')
  expect(red.bands.full.g).toBeLessThan(ABSENT)
  const maxGreen = Math.max(...scan.frames.map((frame) => frame.bands.full.g))
  expect(maxGreen).toBeLessThan(ABSENT)
  const last = lastFrame(scan, () => true, 'any frame')
  expect(last.bands.full.r).toBeGreaterThan(DOMINANT)
})

test('a range starting mid-transition exports the blend, not either clip alone (#385)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordSolidWebm(page, 'red')
  const blue = await recordSolidWebm(page, 'blue')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.webm', mimeType: 'video/webm', buffer: red },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add red.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add blue.webm to timeline' }).click()
  for (const [position, name] of [
    [1, 'red'],
    [2, 'blue'],
  ] as const) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${name}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  // The overlap-aware total: 1 + 1 − 0.5. The overlap covers [0.5, 1.0).
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '1.5',
  )

  // In mark in the middle of the crossfade, out mark at the sequence end.
  await markAt(page, 0.75, 'preview-mark-in')
  await markAt(page, 1.5, 'preview-mark-out')
  const exported = await exportMarkedRange(page)
  const scan = await scanExportedFrames(page, exported, FULL)

  // The range spans 0.75 s of overlap tail plus blue solo.
  expect(scan.duration).toBeGreaterThan(0.75 * 0.5)
  expect(scan.duration).toBeLessThan(0.75 + 1)

  // Somewhere in the file the two clips blend: substantially red AND
  // substantially blue in one frame — the transition itself, mid-range.
  // (The incoming element can engage a few frames late under load, which
  // shortens the blend, never removes it: the overlap still has ~0.25 s to
  // run when the export starts.)
  const blended = firstFrame(
    scan,
    (frame) => frame.bands.full.r > BLENDED && frame.bands.full.b > BLENDED,
    'a blended frame',
  )
  // Nothing before the blend is the incoming clip alone: the file opened on
  // the transition's outgoing side (recorder lead-in frames are black, and a
  // late engage draws red alone — both fine; a pure-blue open is what
  // snapping the range start to the incoming clip would look like, and that
  // must not happen).
  const blueSoloBeforeBlend = scan.frames.filter(
    (frame) =>
      frame.time < blended.time && frame.bands.full.b > DOMINANT && frame.bands.full.r < ABSENT,
  )
  expect(blueSoloBeforeBlend).toEqual([])
  // And it ends on blue alone: the transition completed inside the range.
  const last = lastFrame(scan, () => true, 'any frame')
  expect(last.bands.full.b).toBeGreaterThan(DOMINANT)
  expect(last.bands.full.r).toBeLessThan(ABSENT)
})

test('GIF and MP3 exports honor the range, and marks are session-only (#385)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')
  await activate(page)

  // A toned fixture so the MP3 has a mix to carry.
  const webm = await recordTwoPhaseWebm(page, 440)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'phases.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add phases.webm to timeline' }).click()

  // Enable the GIF plugin (the #198 flow), then mark a 0.5 s range.
  await page.getByRole('button', { name: 'Plugins…' }).click()
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()
  await markAt(page, 1.2, 'preview-mark-in')
  await markAt(page, 1.7, 'preview-mark-out')

  // GIF of the range: ~0.5 s at the plugin's fixed 10 fps is ~5 frames; the
  // whole ~2 s sequence would be ~20. Frame count is the duration evidence
  // GIF timing carries natively.
  const gif = await exportMarkedRange(page, 'Animated GIF')
  expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  let frames = 0
  {
    // Minimal image-descriptor walk (the export-gif.spec parser's core).
    const packed = gif[10]
    let offset = 13
    if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1)
    const skipSubBlocks = () => {
      for (;;) {
        const size = gif[offset]
        offset += 1
        if (size === 0) return
        offset += size
      }
    }
    while (offset < gif.length) {
      const block = gif[offset]
      if (block === 0x3b) break
      if (block === 0x21) {
        offset += 2
        skipSubBlocks()
      } else if (block === 0x2c) {
        frames += 1
        const localPacked = gif[offset + 9]
        offset += 10
        if (localPacked & 0x80) offset += 3 * 2 ** ((localPacked & 0x07) + 1)
        offset += 1
        skipSubBlocks()
      } else {
        break
      }
    }
  }
  expect(frames).toBeGreaterThanOrEqual(2)
  expect(frames).toBeLessThanOrEqual(12)

  // MP3 of the range: the decoded duration is the range's, not the
  // project's — a whole-sequence soundtrack (~2 s) fails the upper bound.
  const mp3 = await exportMarkedRange(page, 'Audio only (MP3)')
  const decoded = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(bytes.buffer)
      return { duration: buffer.duration, channels: buffer.numberOfChannels }
    } finally {
      await context.close()
    }
  }, mp3.toString('base64'))
  expect(decoded.channels).toBeGreaterThan(0)
  expect(decoded.duration).toBeGreaterThan(0.5 * 0.4)
  expect(decoded.duration).toBeLessThan(0.5 + 1)

  // Marks are session-only (#381's approved recommendation): after a reload
  // and autosave restore the project is back, the marks are not — no
  // highlight, and the export modal offers no range.
  await waitForSnapshot(page, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('button', { name: 'Add phases.webm to timeline' })).toBeVisible()
  await expect(page.getByTestId('preview-marked-range')).not.toBeAttached()
  await expect(page.getByTestId('preview-clear-marks')).not.toBeAttached()
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('export-scope-range')).not.toBeAttached()
  await expect(page.getByTestId('export-scope-whole')).not.toBeAttached()
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
