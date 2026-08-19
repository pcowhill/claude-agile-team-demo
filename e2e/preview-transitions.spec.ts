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

/** Records a solid-color WebM of the given size (every frame identical). */
async function recordSolidWebm(
  page: import('@playwright/test').Page,
  family: 'red' | 'blue',
  width: number,
  height: number,
): Promise<Buffer> {
  const webmBase64 = await page.evaluate(
    async ({ family, width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
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
    },
    { family, width, height },
  )
  return Buffer.from(webmBase64, 'base64')
}

/** Per-channel average of a screenshot clip, decoded in-page. */
async function sampleScreenRect(
  page: import('@playwright/test').Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ r: number; g: number; b: number }> {
  const png = await page.screenshot({ clip: rect })
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
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
    return { r: r / pixels, g: g / pixels, b: b / pixels }
  }, png.toString('base64'))
}

test('a crossfade between different aspect ratios fades the uncovered margins to black (#66)', async ({
  page,
}) => {
  await page.goto('./')

  // A wide outgoing clip and a square incoming one: inside the stage the
  // square clip pillarboxes, leaving side margins only the outgoing clip
  // reaches. Solid colors make every frame's level identical, so paused
  // seeks compare exactly.
  const red = await recordSolidWebm(page, 'red', 320, 180)
  const blue = await recordSolidWebm(page, 'blue', 180, 180)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.webm', mimeType: 'video/webm', buffer: red },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
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
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(seek).toHaveAttribute('max', '1.5')

  // Both elements fill the stage with object-fit: contain, so each clip's
  // painted box is the aspect-fit of its source size into the stage box.
  const stage = (await page.getByTestId('preview-video').boundingBox())!
  const contain = (sourceWidth: number, sourceHeight: number) => {
    const scale = Math.min(stage.width / sourceWidth, stage.height / sourceHeight)
    return {
      x: stage.x + (stage.width - sourceWidth * scale) / 2,
      y: stage.y + (stage.height - sourceHeight * scale) / 2,
      width: sourceWidth * scale,
      height: sourceHeight * scale,
    }
  }
  const redBox = contain(320, 180)
  const blueBox = contain(180, 180)
  // A band inside the outgoing clip's box but left of the incoming clip's:
  // the margin the incoming clip never covers.
  const margin = {
    x: redBox.x + 3,
    y: redBox.y + redBox.height * 0.4,
    width: blueBox.x - redBox.x - 6,
    height: redBox.height * 0.2,
  }
  // Layout sanity: the fixtures actually produce an uncovered margin.
  expect(margin.width).toBeGreaterThan(10)
  const center = {
    x: blueBox.x + blueBox.width * 0.4,
    y: blueBox.y + blueBox.height * 0.4,
    width: blueBox.width * 0.2,
    height: blueBox.height * 0.2,
  }

  /** Seeks (paused), waits for decodable frames on both live elements. */
  const seekAndSettle = async (time: string) => {
    await seek.fill(time)
    await expect
      .poll(() =>
        page
          .getByTestId('preview-video')
          .evaluate((el: HTMLVideoElement) => el.readyState),
      )
      .toBeGreaterThanOrEqual(2)
    if ((await page.getByTestId('preview-video-incoming').count()) > 0) {
      await expect
        .poll(() =>
          page
            .getByTestId('preview-video-incoming')
            .evaluate((el: HTMLVideoElement) => el.readyState),
        )
        .toBeGreaterThanOrEqual(2)
    }
  }
  const marginRedAt = async (time: string) => {
    await seekAndSettle(time)
    return (await sampleScreenRect(page, margin)).r
  }

  // Margin ladder across the overlap [0.5, 1.0): solo, progress 0.2, 0.5,
  // 0.9, then past the handover.
  const solo = await marginRedAt('0.25')
  expect(solo).toBeGreaterThan(120)
  const early = await marginRedAt('0.6')
  const mid = await marginRedAt('0.75')
  // Where the clips overlap, mid-crossfade carries both color families.
  const centerMid = await sampleScreenRect(page, center)
  expect(centerMid.r).toBeGreaterThan(40)
  expect(centerMid.b).toBeGreaterThan(40)
  const late = await marginRedAt('0.95')
  const after = await marginRedAt('1.2')

  // Mid-overlap the margin is the outgoing clip blended toward black in
  // proportion to progress — not at full brightness (#66's failing case).
  expect(mid).toBeGreaterThan(solo * 0.3)
  expect(mid).toBeLessThan(solo * 0.7)

  // Monotonic decrease into black: nothing pops at the handover.
  expect(early).toBeLessThan(solo + 6)
  expect(early).toBeGreaterThan(solo * 0.6)
  expect(mid).toBeLessThan(early - 20)
  expect(late).toBeLessThan(mid - 20)
  expect(late).toBeLessThan(solo * 0.3)
  expect(after).toBeLessThan(12)
})

test('a slide between different aspect ratios slides a black card over the margins (#74)', async ({
  page,
}) => {
  await page.goto('./')

  // Wide outgoing clip, square incoming one: the square clip pillarboxes,
  // leaving side margins its fitted box never reaches — but the sliding
  // element is a full-stage card with a black backing (#74), so those
  // margins are covered by sliding black, at full brightness until the
  // card's edge arrives and black after it.
  const red = await recordSolidWebm(page, 'red', 320, 180)
  const blue = await recordSolidWebm(page, 'blue', 180, 180)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.webm', mimeType: 'video/webm', buffer: red },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
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
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-above')
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(seek).toHaveAttribute('max', '1.5')

  const stage = (await page.getByTestId('preview-video').boundingBox())!
  const contain = (sourceWidth: number, sourceHeight: number) => {
    const scale = Math.min(stage.width / sourceWidth, stage.height / sourceHeight)
    return {
      x: stage.x + (stage.width - sourceWidth * scale) / 2,
      y: stage.y + (stage.height - sourceHeight * scale) / 2,
      width: sourceWidth * scale,
      height: sourceHeight * scale,
    }
  }
  const redBox = contain(320, 180)
  const blueBox = contain(180, 180)
  const marginWidth = blueBox.x - redBox.x - 6
  // Layout sanity: the fixtures actually produce an uncovered margin.
  expect(marginWidth).toBeGreaterThan(10)

  // Two strips of the margin at different heights: the card's leading edge
  // (at stage top + progress·stage height) passes the upper strip early in
  // the overlap and the lower strip late, so one mid-overlap look shows
  // black behind the edge and undimmed outgoing clip ahead of it.
  const upper = {
    x: redBox.x + 3,
    y: redBox.y + redBox.height * 0.05,
    width: marginWidth,
    height: redBox.height * 0.15,
  }
  const lower = {
    x: redBox.x + 3,
    y: redBox.y + redBox.height * 0.6,
    width: marginWidth,
    height: redBox.height * 0.15,
  }
  // Progress at which the edge fully passes the upper strip / first touches
  // the lower one, from the real geometry; the mid sample sits between them.
  const passUpper = (upper.y + upper.height - stage.y) / stage.height
  const reachLower = (lower.y - stage.y) / stage.height
  const passLower = (lower.y + lower.height - stage.y) / stage.height
  expect(passUpper + 0.05).toBeLessThan(reachLower)
  expect(passLower).toBeLessThan(0.95)
  const midProgress = (passUpper + reachLower) / 2
  // String(…) rather than toFixed: a range input's fill rejects trailing
  // zeros like "0.70" as malformed.
  const overlapTime = (progress: number) => String(Math.round((0.5 + 0.5 * progress) * 100) / 100)

  /** Seeks (paused), waits for decodable frames on both live elements. */
  const seekAndSettle = async (time: string) => {
    await seek.fill(time)
    await expect
      .poll(() =>
        page.getByTestId('preview-video').evaluate((el: HTMLVideoElement) => el.readyState),
      )
      .toBeGreaterThanOrEqual(2)
    if ((await page.getByTestId('preview-video-incoming').count()) > 0) {
      await expect
        .poll(() =>
          page
            .getByTestId('preview-video-incoming')
            .evaluate((el: HTMLVideoElement) => el.readyState),
        )
        .toBeGreaterThanOrEqual(2)
    }
  }

  // Solo: both strips show the outgoing clip at full brightness.
  await seekAndSettle('0.25')
  const soloUpper = (await sampleScreenRect(page, upper)).r
  const soloLower = (await sampleScreenRect(page, lower)).r
  expect(soloUpper).toBeGreaterThan(120)
  expect(soloLower).toBeGreaterThan(120)

  // Mid-overlap: black behind the card's edge, undimmed red ahead of it.
  await seekAndSettle(overlapTime(midProgress))
  const midUpper = await sampleScreenRect(page, upper)
  const midLower = await sampleScreenRect(page, lower)
  expect(midUpper.r).toBeLessThan(15)
  expect(midUpper.b).toBeLessThan(15)
  expect(midLower.r).toBeGreaterThan(soloLower * 0.85)
  // The card carries its clip: within the visible slice of the translated
  // blue box (clipped to the stage and to the card's covered region), the
  // incoming clip shows, not backing.
  const blueTop = blueBox.y + (midProgress - 1) * stage.height
  const blueVisibleTop = Math.max(blueTop, stage.y)
  const blueVisibleBottom = Math.min(blueTop + blueBox.height, stage.y + midProgress * stage.height)
  expect(blueVisibleBottom - blueVisibleTop).toBeGreaterThan(10)
  const blueProbe = {
    x: blueBox.x + blueBox.width * 0.4,
    y: blueVisibleTop + (blueVisibleBottom - blueVisibleTop) * 0.25,
    width: blueBox.width * 0.2,
    height: (blueVisibleBottom - blueVisibleTop) * 0.5,
  }
  expect((await sampleScreenRect(page, blueProbe)).b).toBeGreaterThan(100)

  // Late in the overlap the edge has passed the lower strip too.
  await seekAndSettle(overlapTime(passLower + 0.03))
  expect((await sampleScreenRect(page, lower)).r).toBeLessThan(15)

  // Past the handover the margins stay black — nothing pops back or lingers.
  await seekAndSettle('1.2')
  expect((await sampleScreenRect(page, upper)).r).toBeLessThan(15)
  expect((await sampleScreenRect(page, lower)).r).toBeLessThan(15)
})

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
  expect(await incoming.evaluate((el) => el.style.transform)).toBe('translate(0%, -50%)')
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

test('seeking into each other slide direction renders the mid-effect transform (#62)', async ({
  page,
}) => {
  await page.goto('./')
  await buildTwoEntrySequence(page)

  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(seek).toHaveAttribute('max', '1.5')

  // Same sequence and overlap as the slide-from-above spec above; each
  // remaining direction is checked half-way through the overlap, where the
  // incoming element must sit half a frame from its own entry edge.
  const cases = [
    ['slide-from-below', 'translate(0%, 50%)', 'slide from below'],
    ['slide-from-left', 'translate(-50%, 0%)', 'slide from left'],
    ['slide-from-right', 'translate(50%, 0%)', 'slide from right'],
  ] as const
  for (const [type, transform, label] of cases) {
    // Leave the overlap before switching type so the re-entry re-renders
    // the incoming element from a change event.
    await seek.fill('0.25')
    await expect(page.getByTestId('preview-video-incoming')).toHaveCount(0)
    await page
      .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
      .selectOption(type)
    await seek.fill('0.75')
    const incoming = page.getByTestId('preview-video-incoming')
    await expect(incoming).toBeVisible()
    expect(await incoming.evaluate((el) => el.style.transform)).toBe(transform)
    // The #74 card backing applies to every direction.
    expect(await incoming.evaluate((el) => el.style.backgroundColor)).toBe('rgb(0, 0, 0)')
    await expect(page.getByTestId('preview-now-playing')).toHaveText(
      `Clip 1 of 2: first.webm → second.webm (${label})`,
    )
  }
})
