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
  await fillZoomField('Zoom start of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom ramp-in of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom hold of banded.webm at position 1 in seconds', '0.3')
  await fillZoomField('Zoom ramp-out of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField('Zoom scale of banded.webm at position 1', String(scale))
  await fillZoomField('Zoom centre X of banded.webm at position 1 (0 to 1)', String(centerX))
  await fillZoomField('Zoom centre Y of banded.webm at position 1 (0 to 1)', String(centerY))

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
