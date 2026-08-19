import { expect, test } from '@playwright/test'

/**
 * Preview rendering of transitions (#42): during an overlap the outgoing
 * clip keeps playing while the incoming clip renders on top under the
 * effect. As in the other specs a real WebM is recorded in-browser so the
 * player has genuinely decodable video, and entries are trimmed to exactly
 * 1s so overlap arithmetic is deterministic.
 */
async function recordWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
        // Animated content so seeked frames differ and playback is visible.
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
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

/** Imports two clips, adds both to the timeline, and trims each to 1s. */
async function buildTwoEntrySequence(page: import('@playwright/test').Page) {
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()
  for (const position of [1, 2]) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${position === 1 ? 'first' : 'second'}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')
}

test('playing across a crossfade keeps both clips live, fading the incoming one in', async ({
  page,
}) => {
  await page.goto('./')
  await buildTwoEntrySequence(page)

  // Default transition: 1s crossfade, clamped to the 1s neighbors — the
  // overlap spans the whole first entry, so the sequence total is 0:01.
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:01')

  // Watch every frame from inside the page: during the overlap both video
  // elements must be playing simultaneously and the incoming element must
  // pass through a mid-fade opacity. Started before Play so no frame of the
  // 1s overlap is missed.
  const overlapWatcher = page.evaluate(
    () =>
      new Promise<{ bothPlaying: boolean; sawMidFade: boolean }>((resolve) => {
        const result = { bothPlaying: false, sawMidFade: false }
        const started = performance.now()
        const check = () => {
          const primary = document.querySelector<HTMLVideoElement>(
            '[data-testid="preview-video"]',
          )
          const incoming = document.querySelector<HTMLVideoElement>(
            '[data-testid="preview-video-incoming"]',
          )
          if (primary && incoming) {
            if (!primary.paused && !incoming.paused) result.bothPlaying = true
            const opacity = Number(getComputedStyle(incoming).opacity)
            if (opacity > 0.05 && opacity < 0.95) result.sawMidFade = true
          }
          if ((result.bothPlaying && result.sawMidFade) || performance.now() - started > 15_000) {
            resolve(result)
          } else {
            requestAnimationFrame(check)
          }
        }
        check()
      }),
  )
  await page.getByRole('button', { name: 'Play preview' }).click()
  expect(await overlapWatcher).toEqual({ bothPlaying: true, sawMidFade: true })

  // During the overlap the readout names both clips and the effect.
  // (The overlap spans the whole sequence here, so this holds until the
  // handover; afterwards the second clip is primary.)
  await expect(page.getByTestId('preview-now-playing')).toContainText(
    'Clip 2 of 2: second.webm',
    { timeout: 10_000 },
  )
  // After the handover the transition is over: the incoming element is gone.
  await expect(page.getByTestId('preview-video-incoming')).toHaveCount(0)

  // The sequence finishes at the shrunken total.
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
    timeout: 10_000,
  })
  const positionText = await page.getByTestId('preview-position').textContent()
  const [current, total] = positionText!.split(' / ')
  expect(current).toBe(total)
})

/**
 * In-page frame watcher for #61: resolves once playback has finished (or a
 * flash is caught, or 15s pass). A "flash" is the outgoing clip's src on the
 * top layer while that element is effectively visible — opacity past mid-fade
 * and translated into frame. During a correct transition the top layer only
 * ever holds the *incoming* clip, so any sighting of the first clip's src
 * there is the bug regardless of timing.
 */
function watchForEndFlash(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      new Promise<{ sawOverlay: boolean; sawFlash: boolean; detail: string }>((resolve) => {
        const result = { sawOverlay: false, sawFlash: false, detail: '' }
        let firstSrc = ''
        let sawPlaying = false
        const started = performance.now()
        const check = () => {
          const primary = document.querySelector<HTMLVideoElement>(
            '[data-testid="preview-video"]',
          )
          const incoming = document.querySelector<HTMLVideoElement>(
            '[data-testid="preview-video-incoming"]',
          )
          const pauseButton = document.querySelector('[aria-label="Pause preview"]')
          if (pauseButton) sawPlaying = true
          if (!firstSrc && primary?.currentSrc) firstSrc = primary.currentSrc
          if (incoming && firstSrc) {
            result.sawOverlay = true
            if (incoming.currentSrc === firstSrc) {
              const style = getComputedStyle(incoming)
              const opacity = Number(style.opacity)
              const matrix = new DOMMatrixReadOnly(
                style.transform === 'none' ? undefined : style.transform,
              )
              const inFrame = matrix.m42 > -incoming.clientHeight * 0.05
              if (style.visibility !== 'hidden' && opacity > 0.5 && inFrame) {
                result.sawFlash = true
                result.detail = `outgoing clip on the top layer (opacity=${opacity.toFixed(3)}, translateY=${matrix.m42.toFixed(1)}px)`
              }
            }
          }
          const ended = sawPlaying && !pauseButton
          if (result.sawFlash || ended || performance.now() - started > 15_000) resolve(result)
          else requestAnimationFrame(check)
        }
        check()
      }),
  )
}

for (const type of ['crossfade', 'slide-from-above'] as const) {
  test(`ending a ${type} never flashes the outgoing clip over the incoming one (#61)`, async ({
    page,
  }) => {
    await page.goto('./')
    await buildTwoEntrySequence(page)

    // 0.5s transition, shorter than the 1s outgoing clip (#61's condition):
    // the overlap covers sequence [0.5, 1.0) of the 1.5s total.
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    if (type !== 'crossfade') {
      await page
        .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
        .selectOption(type)
    }
    const duration = page.getByRole('spinbutton', {
      name: 'Transition duration between position 1 and 2 in seconds',
    })
    await duration.fill('0.5')
    await duration.blur()
    await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
      'max',
      '1.5',
    )

    // Started before Play so the handover frame cannot be missed.
    const watcher = watchForEndFlash(page)
    await page.getByRole('button', { name: 'Play preview' }).click()
    const result = await watcher
    // The overlay must actually have rendered (otherwise a pass proves nothing)…
    expect(result.sawOverlay).toBe(true)
    // …and at no frame was the outgoing clip visible on the top layer.
    expect(result.sawFlash, result.detail).toBe(false)

    // After the handover the overlay element is gone and playback runs out.
    await expect(page.getByTestId('preview-video-incoming')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
      timeout: 10_000,
    })
  })
}

test('seeking into a slide-from-above overlap renders the mid-effect state', async ({ page }) => {
  await page.goto('./')
  await buildTwoEntrySequence(page)

  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-above')
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()

  // 1s + 1s − 0.5s overlap: the scrubber spans 1.5s and the overlap covers
  // sequence [0.5, 1.0).
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(seek).toHaveAttribute('max', '1.5')

  // Seek (while paused) to the middle of the overlap: the incoming element
  // appears half-slid over the outgoing one, nothing autoplays, and both
  // elements are cued to the right source times.
  await seek.fill('0.75')
  const incoming = page.getByTestId('preview-video-incoming')
  await expect(incoming).toBeVisible()
  expect(await incoming.evaluate((el) => el.style.transform)).toBe('translateY(-50%)')
  await expect(page.getByTestId('preview-now-playing')).toHaveText(
    'Clip 1 of 2: first.webm → second.webm (slide from above)',
  )
  const video = page.getByTestId('preview-video')
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)
  expect(await incoming.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(0.75, 1)
  await expect
    .poll(async () => incoming.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(0.25, 1)

  // Seeking back out of the overlap cleanly returns to single-clip playback.
  await seek.fill('0.25')
  await expect(page.getByTestId('preview-video-incoming')).toHaveCount(0)
  await expect(page.getByTestId('preview-now-playing')).toHaveText('Clip 1 of 2: first.webm')
})
