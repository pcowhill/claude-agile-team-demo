import { expect, test } from '@playwright/test'

/**
 * Preview rendering of the zoom effect (#64). A colour-banded WebM (left
 * half green, right half blue) is recorded in-browser; a zoom targeting the
 * green band's centre must make the stage read as green only during the
 * hold, show an intermediate magnification mid-ramp, and leave times outside
 * the window unzoomed — sampled from real compositor output like the #66/#74
 * specs, plus transform assertions in the style of the seek-into-overlap
 * spec.
 */
/**
 * Pin the viewport so the geometry below is stable by construction (#116).
 * The preview stage's height is whatever the app grid leaves after the
 * content-sized rows below it, so with the default wide-and-short viewport
 * the stage ends up height-limited: the clip's contain-fit then occupies a
 * slice of the stage width that shrinks whenever unrelated panel copy wraps
 * to another line — and the zoom scale derived from that slice blew past the
 * sanity bound over a wording change (see the issue). A portrait-ish
 * viewport makes the stage width-limited instead: the fit fills the stage
 * width, the green band is half the frame whatever the panels below weigh,
 * and the derived scale sits at its floor of 3. Even the grid's 200px row
 * floor keeps the fit wide enough that the scale stays well under the bound,
 * so no amount of panel copy can push the geometry off this cliff.
 */
test.use({ viewport: { width: 800, height: 1100 } })

async function recordBandedWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
        // Every frame identical: left half green, right half blue, so paused
        // seeks sample exactly.
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
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

test('a zoom magnifies its region in the preview, easing in and out (#64)', async ({ page }) => {
  await page.goto('./')

  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of banded.webm at position 1 in seconds',
  })
  await outField.fill('1')
  await outField.blur()

  // The video element fills the stage, and the stage box is the frame the
  // zoom fractions refer to; the clip letterboxes inside it (object-fit:
  // contain), so the green band's frame-fraction geometry comes from the
  // real boxes.
  const video = page.getByTestId('preview-video')
  const stage = (await video.boundingBox())!
  const containScale = Math.min(stage.width / 320, stage.height / 180)
  const fit = {
    x: stage.x + (stage.width - 320 * containScale) / 2,
    y: stage.y + (stage.height - 180 * containScale) / 2,
    width: 320 * containScale,
    height: 180 * containScale,
  }
  // Zoom into the green (left) band's centre. The zoom fractions refer to
  // the frame (the stage box), and the desktop stage is far wider than the
  // clip, so the band is a narrow slice of the frame: derive the smallest
  // quarter-step scale whose visible region (1/scale of the frame per axis)
  // fits inside the band with 20% headroom, then sanity-check the geometry
  // rather than assuming a viewport.
  const greenBandWidth = fit.width / 2 / stage.width
  const scale = Math.max(3, Math.ceil(4 / (greenBandWidth * 0.8)) / 4)
  const midRampScale = 1 + (scale - 1) * 0.5
  const centerX = Math.round(((fit.x - stage.x + fit.width / 4) / stage.width) * 100) / 100
  const centerY = 0.5
  const greenLeft = (fit.x - stage.x) / stage.width
  const greenRight = (fit.x - stage.x + fit.width / 2) / stage.width
  expect(scale).toBeLessThanOrEqual(10)
  expect(centerX - 1 / (2 * scale)).toBeGreaterThan(greenLeft - 0.001)
  expect(centerX + 1 / (2 * scale)).toBeLessThan(greenRight - 0.005)
  expect(fit.height / stage.height).toBeGreaterThan(1 / scale)
  // The reducer clamps the centre to keep the region inside the frame; the
  // chosen centre must survive that clamp unchanged.
  expect(Math.abs(centerX - 0.5)).toBeLessThanOrEqual((1 - 1 / scale) / 2)

  // Window [0.2, 0.9] of the 1s entry: 0.2s ramps around a 0.3s hold.
  await page.getByRole('button', { name: 'Add zoom to banded.webm at position 1' }).click()
  const fillZoomField = async (label: string, value: string) => {
    const field = page.getByRole('spinbutton', { name: label })
    await field.fill(value)
    await field.blur()
  }
  await fillZoomField('Zoom 1 start of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom 1 ramp-in of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom 1 hold of banded.webm at position 1 in seconds', '0.3')
  await fillZoomField('Zoom 1 ramp-out of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom 1 scale of banded.webm at position 1', String(scale))
  await fillZoomField('Zoom 1 centre X of banded.webm at position 1 (0 to 1)', String(centerX))
  await fillZoomField('Zoom 1 centre Y of banded.webm at position 1 (0 to 1)', String(centerY))

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  /** Seeks (paused) and waits for a decodable frame. */
  const seekAndSettle = async (time: string) => {
    await seek.fill(time)
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
      .toBeGreaterThanOrEqual(2)
  }

  // Probes inside the fitted clip's box: the left band's quarter, and the
  // right band's quarter — plus the stage centre, where the band boundary
  // sits unzoomed.
  const probe = (fraction: number) => ({
    x: fit.x + fit.width * fraction - fit.width * 0.05,
    y: fit.y + fit.height * 0.4,
    width: fit.width * 0.1,
    height: fit.height * 0.2,
  })
  const leftProbe = probe(0.25)
  const rightProbe = probe(0.75)

  // Outside the window (before): the unzoomed frame shows both bands and no
  // zoom styling is applied.
  await seekAndSettle('0.1')
  expect(await video.evaluate((el) => el.style.transform)).toBe('')
  const beforeLeft = await sampleScreenRect(page, leftProbe)
  const beforeRight = await sampleScreenRect(page, rightProbe)
  expect(beforeLeft.g).toBeGreaterThan(120)
  expect(beforeLeft.b).toBeLessThan(40)
  expect(beforeRight.b).toBeGreaterThan(120)
  expect(beforeRight.g).toBeLessThan(40)

  // Ramp-in midpoint: g = smoothstep(0.5) = 0.5, so the magnification is
  // exactly 1 + (scale − 1)·0.5 — an intermediate state between 1× and the
  // full scale, asserted on the rendered transform.
  await seekAndSettle('0.3')
  const midRampTransform = await video.evaluate((el) => el.style.transform)
  expect(midRampTransform.startsWith(`scale(${midRampScale}) translate(`)).toBe(true)
  expect(await video.evaluate((el) => el.style.clipPath)).toContain('inset(')

  // Mid-hold: the region (inside the green band) fills the frame, so every
  // probe — left, right, and everything the fitted box spans — reads green
  // only: the blue band is off-frame and no letterbox black is pulled in
  // (the region never crosses a frame edge, and the scale is uniform, so
  // the aspect ratio is unchanged).
  await seekAndSettle('0.55')
  const holdTransform = await video.evaluate((el) => el.style.transform)
  expect(holdTransform.startsWith(`scale(${scale}) translate(`)).toBe(true)
  const holdLeft = await sampleScreenRect(page, leftProbe)
  const holdRight = await sampleScreenRect(page, rightProbe)
  expect(holdLeft.g).toBeGreaterThan(120)
  expect(holdLeft.b).toBeLessThan(25)
  expect(holdLeft.r).toBeLessThan(25)
  expect(holdRight.g).toBeGreaterThan(120)
  expect(holdRight.b).toBeLessThan(25)
  expect(holdRight.r).toBeLessThan(25)

  // Outside the window (after): unzoomed again.
  await seekAndSettle('0.95')
  expect(await video.evaluate((el) => el.style.transform)).toBe('')
  const afterRight = await sampleScreenRect(page, rightProbe)
  expect(afterRight.b).toBeGreaterThan(120)
  expect(afterRight.g).toBeLessThan(40)
})

test('two zooms on one clip each magnify their own window, identity between (#129)', async ({
  page,
}) => {
  await page.goto('./')

  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of banded.webm at position 1 in seconds',
  })
  await outField.fill('1.4')
  await outField.blur()

  // Same geometry derivation as the single-zoom spec: the stage box is the
  // frame the zoom fractions refer to, the clip letterboxes inside it, and
  // the scale is the smallest quarter-step whose visible region fits inside
  // one band with 20% headroom. The blue band's centre mirrors the green's.
  const video = page.getByTestId('preview-video')
  const stage = (await video.boundingBox())!
  const containScale = Math.min(stage.width / 320, stage.height / 180)
  const fit = {
    x: stage.x + (stage.width - 320 * containScale) / 2,
    y: stage.y + (stage.height - 180 * containScale) / 2,
    width: 320 * containScale,
    height: 180 * containScale,
  }
  const greenBandWidth = fit.width / 2 / stage.width
  const scale = Math.max(3, Math.ceil(4 / (greenBandWidth * 0.8)) / 4)
  const centerGreenX = Math.round(((fit.x - stage.x + fit.width / 4) / stage.width) * 100) / 100
  const centerBlueX =
    Math.round(((fit.x - stage.x + (fit.width * 3) / 4) / stage.width) * 100) / 100
  expect(scale).toBeLessThanOrEqual(10)
  // Both centres must survive the reducer's keep-inside-the-frame clamp.
  expect(Math.abs(centerGreenX - 0.5)).toBeLessThanOrEqual((1 - 1 / scale) / 2)
  expect(Math.abs(centerBlueX - 0.5)).toBeLessThanOrEqual((1 - 1 / scale) / 2)
  // And each visible region must sit inside its own band.
  const greenLeft = (fit.x - stage.x) / stage.width
  const bandBoundary = (fit.x - stage.x + fit.width / 2) / stage.width
  const blueRight = (fit.x - stage.x + fit.width) / stage.width
  expect(centerGreenX - 1 / (2 * scale)).toBeGreaterThan(greenLeft - 0.001)
  expect(centerGreenX + 1 / (2 * scale)).toBeLessThan(bandBoundary - 0.005)
  expect(centerBlueX - 1 / (2 * scale)).toBeGreaterThan(bandBoundary + 0.005)
  expect(centerBlueX + 1 / (2 * scale)).toBeLessThan(blueRight + 0.001)

  const fillZoomField = async (label: string, value: string) => {
    const field = page.getByRole('spinbutton', { name: label })
    await field.fill(value)
    await field.blur()
  }
  const configureZoom = async (
    ordinal: number,
    values: { start: string; scale: string; centerX: string },
  ) => {
    const name = (field: string) => `Zoom ${ordinal} ${field} of banded.webm at position 1`
    await fillZoomField(`${name('start')} in seconds`, values.start)
    await fillZoomField(`${name('ramp-in')} in seconds`, '0.1')
    await fillZoomField(`${name('hold')} in seconds`, '0.2')
    await fillZoomField(`${name('ramp-out')} in seconds`, '0.1')
    await fillZoomField(name('scale'), values.scale)
    await fillZoomField(`${name('centre X')} (0 to 1)`, values.centerX)
    await fillZoomField(`${name('centre Y')} (0 to 1)`, '0.5')
  }

  // Zoom 1 into the green band over window [0.2, 0.6] of the 1.4s entry.
  const addZoom = page.getByRole('button', { name: 'Add zoom to banded.webm at position 1' })
  await addZoom.click()
  await configureZoom(1, { start: '0.2', scale: String(scale), centerX: String(centerGreenX) })
  // Zoom 2 into the blue band over window [0.9, 1.3]; the gap between the
  // windows is (0.6, 0.9).
  await addZoom.click()
  await configureZoom(2, { start: '0.9', scale: String(scale), centerX: String(centerBlueX) })

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const seekAndSettle = async (time: string) => {
    await seek.fill(time)
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
      .toBeGreaterThanOrEqual(2)
  }
  const probe = (fraction: number) => ({
    x: fit.x + fit.width * fraction - fit.width * 0.05,
    y: fit.y + fit.height * 0.4,
    width: fit.width * 0.1,
    height: fit.height * 0.2,
  })
  const leftProbe = probe(0.25)
  const rightProbe = probe(0.75)

  // Before the first window: identity, both bands visible.
  await seekAndSettle('0.1')
  expect(await video.evaluate((el) => el.style.transform)).toBe('')

  // Mid-hold of zoom 1: the green region fills the frame everywhere.
  await seekAndSettle('0.4')
  expect(
    (await video.evaluate((el) => el.style.transform)).startsWith(`scale(${scale}) translate(`),
  ).toBe(true)
  const firstLeft = await sampleScreenRect(page, leftProbe)
  const firstRight = await sampleScreenRect(page, rightProbe)
  expect(firstLeft.g).toBeGreaterThan(120)
  expect(firstLeft.b).toBeLessThan(25)
  expect(firstRight.g).toBeGreaterThan(120)
  expect(firstRight.b).toBeLessThan(25)

  // In the gap between the windows: identity again — both bands visible.
  await seekAndSettle('0.75')
  expect(await video.evaluate((el) => el.style.transform)).toBe('')
  const gapLeft = await sampleScreenRect(page, leftProbe)
  const gapRight = await sampleScreenRect(page, rightProbe)
  expect(gapLeft.g).toBeGreaterThan(120)
  expect(gapLeft.b).toBeLessThan(40)
  expect(gapRight.b).toBeGreaterThan(120)
  expect(gapRight.g).toBeLessThan(40)

  // Mid-hold of zoom 2: the blue region fills the frame everywhere.
  await seekAndSettle('1.1')
  expect(
    (await video.evaluate((el) => el.style.transform)).startsWith(`scale(${scale}) translate(`),
  ).toBe(true)
  const secondLeft = await sampleScreenRect(page, leftProbe)
  const secondRight = await sampleScreenRect(page, rightProbe)
  expect(secondLeft.b).toBeGreaterThan(120)
  expect(secondLeft.g).toBeLessThan(25)
  expect(secondRight.b).toBeGreaterThan(120)
  expect(secondRight.g).toBeLessThan(25)

  // After the second window: identity once more.
  await seekAndSettle('1.35')
  expect(await video.evaluate((el) => el.style.transform)).toBe('')
})
