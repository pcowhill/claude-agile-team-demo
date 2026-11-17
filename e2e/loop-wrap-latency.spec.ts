import { expect, test, type Page } from '@playwright/test'

/**
 * Loop's wrap does not stall on a seek (#585, customer feedback #581). A
 * wrap used to seek the playing element back to the mark-in, and in Firefox
 * that seek held the mark-in frame for 100–170 ms on every pass (Chromium:
 * about a frame). On a short span that froze a quarter of each pass, which
 * is the stutter the customer saw. The player now keeps the idle second
 * element paused on the mark-in and swaps to it at the wrap.
 *
 * The evidence, sampled in-page on every animation frame while Loop plays,
 * in both projects (Chromium and Firefox):
 * - **No wrap seeks the element on screen.** At each wrap the visible
 *   element is never `seeking`. This is the structural property, and it
 *   fails without the fix: the old wrap seeked the playing element in both
 *   browsers.
 * - **Each pass makes progress**, from near the mark-in to near the
 *   mark-out (#585's first criterion), over at least five passes.
 * - **The freeze after a wrap is short.** The median time the published
 *   position stays on the mark-in, measured locally (Playwright Firefox 153,
 *   headless): 99–166 ms before the fix and 46–58 ms after, which is about
 *   Firefox's ordinary clock step mid-pass. Chromium: 15–34 ms before and
 *   14–19 ms after. The bound is a median with headroom for CI load. The
 *   structural check is the one that is sharp.
 */

/** Clears control focus after a click or fill, so I / O reach the transport. */
const blurActive = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

/** A video-only WebM recorded in-page, its colour changing every frame. */
async function recordWebm(page: Page, ms: number): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async (ms) => {
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
    let n = 0
    await new Promise<void>((resolve) => {
      const draw = () => {
        n++
        ctx.fillStyle = `rgb(${(n * 37) % 256}, ${(n * 91) % 256}, ${(n * 53) % 256})`
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
  }, ms)
  return Buffer.from(webmBase64, 'base64')
}

type Sample = { t: number; position: number; visibleSeeking: boolean }

/** Every animation frame for `ms`: the published position, and whether the element on screen is seeking. */
async function sampleWhilePlaying(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(async (ms) => {
    const slider = document.querySelector('input[aria-label="Seek within sequence"]') as HTMLInputElement
    const videos = [...document.querySelectorAll('video.preview-media')] as HTMLVideoElement[]
    const out: { t: number; position: number; visibleSeeking: boolean }[] = []
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const step = () => {
        const t = performance.now() - start
        out.push({
          t,
          position: Number(slider.value),
          visibleSeeking: videos.some((video) => video.closest('.preview-video-idle') === null && video.seeking),
        })
        if (t > ms) resolve()
        else requestAnimationFrame(step)
      }
      step()
    })
    return out
  }, ms)
}

// `marks: null` loops the whole sequence, which wraps at the sequence end
// to 0: the other place the wrap happens.
const cases: { name: string; clips: number; recordMs: number; marks: [number, number] | null }[] = [
  { name: 'a 1 s span inside one clip', clips: 1, recordMs: 6200, marks: [3, 4] },
  { name: 'a 0.3 s span, the customer’s "too close together"', clips: 1, recordMs: 6200, marks: [3, 3.3] },
  { name: 'a 1 s span straddling a cut', clips: 2, recordMs: 3200, marks: [2.6, 3.6] },
  { name: 'the whole sequence, with no marks', clips: 1, recordMs: 1200, marks: null },
]

for (const { name, clips, recordMs, marks } of cases) {
  test(`Loop wraps without seeking the element on screen: ${name} (#585)`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.goto('./')
    // The straddling case adds one 3.2 s clip twice, so the cut sits at
    // about 3.2 s, inside [2.6, 3.6].
    const webm = await recordWebm(page, recordMs)
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
    const add = page.getByRole('button', { name: 'Add clip.webm to timeline' })
    for (let i = 0; i < clips; i++) await add.click()
    const seek = page.getByRole('slider', { name: 'Seek within sequence' })
    await expect.poll(async () => Number(await seek.getAttribute('max'))).toBeGreaterThan(recordMs / 1000 - 0.3)
    const total = Number(await seek.getAttribute('max'))
    const [markIn, markOut] = marks ?? [0, total]

    if (marks !== null) {
      await seek.fill(String(markIn))
      await blurActive(page)
      await page.keyboard.press('i')
      await seek.fill(String(markOut))
      await blurActive(page)
      await page.keyboard.press('o')
    }
    await page.getByRole('button', { name: 'Loop playback' }).click()
    await page.getByRole('button', { name: 'Play preview' }).click()
    await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(markIn)

    const span = markOut - markIn
    // At least six wraps, so five whole passes lie between them.
    const samples = await sampleWhilePlaying(page, Math.max(3000, span * 6500 + 500))
    await page.getByRole('button', { name: 'Pause preview' }).click()

    // A wrap is a drop of most of the span between two frames.
    const wraps: number[] = []
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].position < samples[i - 1].position - span / 2) wraps.push(i)
    }
    expect(wraps.length, 'wraps seen').toBeGreaterThanOrEqual(6)

    const freezes: number[] = []
    for (const at of wraps) {
      // From the frame that shows the drop until the position next moves.
      let end = at
      while (end + 1 < samples.length && samples[end + 1].position === samples[at].position) end++
      if (end + 1 < samples.length) freezes.push(Math.round(samples[end + 1].t - samples[at].t))
      // The structural property: across the wrap (the frame before it,
      // through the frozen stretch after it), nothing on screen seeks.
      for (let i = at - 1; i <= end; i++) {
        expect(samples[i].visibleSeeking, `the element on screen was seeking ${Math.round(samples[i].t)} ms into sampling, at a wrap`).toBe(false)
      }
    }

    // Each whole pass, between two wraps, rises from near the mark-in to
    // near the mark-out. The edges carry a little over a frame's tolerance,
    // plus Firefox's coarser clock steps.
    for (let k = 0; k + 1 < wraps.length; k++) {
      const pass = samples.slice(wraps[k], wraps[k + 1]).map((s) => s.position)
      expect(Math.min(...pass), `pass ${k + 1} starts near the mark-in`).toBeLessThanOrEqual(markIn + 0.06)
      expect(Math.max(...pass), `pass ${k + 1} reaches near the mark-out`).toBeGreaterThanOrEqual(markOut - 0.1)
      expect(new Set(pass).size, `pass ${k + 1} moves through intermediate positions`).toBeGreaterThanOrEqual(4)
    }

    const sorted = [...freezes].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    testInfo.annotations.push({ type: 'wrap freezes (ms)', description: JSON.stringify(freezes) })
    console.log(`[${testInfo.project.name}] ${name}: wrap freezes ${JSON.stringify(freezes)} ms, median ${median}`)
    expect(median, `median freeze on the mark-in after a wrap, of ${JSON.stringify(freezes)}`).toBeLessThan(90)
  })
}
