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
 * - **The element swapped in plays on** (#641). For a span that ends
 *   mid-clip, no element fires `ended` while Loop plays. In Firefox one
 *   kept out of paint until the swap (`visibility: hidden`, or `opacity:
 *   0`) jumped to its end when played, and the next frame seeked the
 *   element on screen back to the mark-in.
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

/**
 * Every animation frame for `ms`: the published position, and whether the
 * element on screen is seeking. Also every `ended` event either element
 * fires meanwhile, at the ms into sampling it fired.
 */
async function sampleWhilePlaying(page: Page, ms: number): Promise<{ samples: Sample[]; ended: number[] }> {
  return page.evaluate(async (ms) => {
    const slider = document.querySelector('input[aria-label="Seek within sequence"]') as HTMLInputElement
    const videos = [...document.querySelectorAll('video.preview-media')] as HTMLVideoElement[]
    const out: { t: number; position: number; visibleSeeking: boolean }[] = []
    const ended: number[] = []
    const start = performance.now()
    const onEnded = () => ended.push(Math.round(performance.now() - start))
    for (const video of videos) video.addEventListener('ended', onEnded)
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
    for (const video of videos) video.removeEventListener('ended', onEnded)
    return { samples: out, ended }
  }, ms)
}

test('the idle element Loop pre-cues shows nothing and takes no clicks (#641)', async ({ page }) => {
  // #641 keeps the idle element painted at a near-zero opacity, because
  // Firefox stops decoding a video it does not paint. That must stay
  // invisible and inert: its card sits above the one on screen (z-index 1).
  test.setTimeout(90_000)
  await page.goto('./')
  const webm = await recordWebm(page, 6200)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect.poll(async () => Number(await seek.getAttribute('max'))).toBeGreaterThan(5.9)
  await seek.fill('3')
  await blurActive(page)
  await page.keyboard.press('i')
  await seek.fill('4')
  await blurActive(page)
  await page.keyboard.press('o')
  await page.getByRole('button', { name: 'Loop playback' }).click()
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(3.3)
  await page.getByRole('button', { name: 'Pause preview' }).click()

  // Paused mid-pass: the idle element stands on the mark-in's frame, a
  // different colour from the frame on screen (the clip changes every frame).
  const idle = page.locator('.preview-video-idle')
  await expect(idle).toHaveCount(1)
  await expect
    .poll(() => idle.locator('video').evaluate((video: HTMLVideoElement) => !video.seeking && video.readyState >= 2))
    .toBe(true)
  const stage = idle.locator('..')
  const setIdleOpacity = (value: string) =>
    idle.evaluate((card: HTMLElement, value) => {
      card.style.opacity = value
    }, value)

  // Nothing at the stage's centre is inside the idle card.
  const box = (await stage.boundingBox())!
  const hitIdle = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.preview-video-idle') != null,
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(hitIdle, 'the idle card is hit at the stage centre').toBe(false)

  // The control: the card fully opaque must change the stage, or the
  // comparison below proves nothing.
  await setIdleOpacity('0')
  const transparent = await stage.screenshot()
  await setIdleOpacity('1')
  const opaque = await stage.screenshot()
  await setIdleOpacity('')
  expect(opaque.equals(transparent), 'control: the idle frame differs from the frame on screen').toBe(false)

  // The stage as styled is pixel-identical to the stage with the idle card
  // fully transparent, each pair shot back to back and retried. Firefox can
  // repaint the paused frame on screen well after the pause, even after two
  // consecutive shots have agreed on the frame before it (#642's review: 3
  // of 25 runs failed that way, the late shot as styled matching the
  // transparent one exactly). A repaint costs one attempt here; a card that
  // shows fails every attempt, since its contribution is in each shot as
  // styled and in no transparent one.
  await expect
    .poll(
      async () => {
        const asStyled = await stage.screenshot()
        await setIdleOpacity('0')
        const transparentNow = await stage.screenshot()
        await setIdleOpacity('')
        return asStyled.equals(transparentNow)
      },
      { message: 'the idle card changes the picture' },
    )
    .toBe(true)
})

// `marks: null` loops the whole sequence, which wraps at the sequence end
// to 0: the other place the wrap happens. `insideClip`: the span ends well
// before its clip does, so no element has any reason to reach its end.
const cases: { name: string; clips: number; recordMs: number; marks: [number, number] | null; insideClip: boolean }[] = [
  { name: 'a 1 s span inside one clip', clips: 1, recordMs: 6200, marks: [3, 4], insideClip: true },
  { name: 'a 0.3 s span, the customer’s "too close together"', clips: 1, recordMs: 6200, marks: [3, 3.3], insideClip: true },
  { name: 'a 1 s span straddling a cut', clips: 2, recordMs: 3200, marks: [2.6, 3.6], insideClip: false },
  { name: 'the whole sequence, with no marks', clips: 1, recordMs: 1200, marks: null, insideClip: false },
]

for (const { name, clips, recordMs, marks, insideClip } of cases) {
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
    const { samples, ended } = await sampleWhilePlaying(page, Math.max(3000, span * 6500 + 500))
    await page.getByRole('button', { name: 'Pause preview' }).click()

    // The element the wrap swaps to plays on from the mark-in (#641). In
    // Firefox an element hidden with `visibility: hidden` until the swap
    // jumped to its clip's end when played, so the next frame read the
    // sequence's end and seeked the element on screen back to the mark-in:
    // the stutter #585 removed, on the first wrap of every play. The checks
    // below see that seek only when a sampled frame lands inside it; an
    // `ended` event is fired every time.
    if (insideClip) expect(ended, 'ms into sampling at which an element ended, inside a span that ends mid-clip').toEqual([])

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
