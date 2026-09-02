import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Per-entry background fill (#259): the bars a non-frame-filling entry
 * leaves render the chosen backdrop, from real pixels. The setup places the
 * same banded WebM (left half green, right half blue — the
 * preview-crop.spec idiom) twice and crops the second placement to its blue
 * right half: the uncropped first entry keeps the frame at 320×180, so the
 * cropped 160×180 entry pillarboxes with a bar on each side. A `color` fill
 * paints the bars that color (deterministic pixels); `blur` visibly
 * replaces the black bars with non-black content sampled from the entry's
 * own (all-blue) frame; `none` restores today's black bars.
 */
async function recordBandedWebm(page: Page): Promise<Buffer> {
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
  page: Page,
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

test('color and blur fills paint the pillarbox bars; none restores black', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  for (const position of [1, 2]) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of banded.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  // Crop the second placement to its blue right half: it presents 160×180
  // while the uncropped first entry keeps the frame at 320×180 — the
  // cropped entry pillarboxes with a bar on each side.
  const cropField = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 2 (percent)',
  })
  await cropField.fill('50')
  await cropField.blur()

  // A paused seek into the second entry: the sampled frame is deterministic.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1.5')
  const video = page.getByTestId('preview-video')
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)
  const frame = page.getByTestId('preview-frame')
  // Editing the timeline rows scrolls the page, and screenshots clip
  // against the viewport — so every sample brings the preview back into
  // view and measures the frame fresh. Regions are fractions of the frame:
  // the left pillarbox bar spans its left quarter (the 160×180 picture
  // contain-fits into the centre half), inset from the rounded corners.
  const sampleFrameRegion = async (fx: number, fw: number) => {
    await frame.scrollIntoViewIfNeeded()
    const box = (await frame.boundingBox())!
    return sampleScreenRect(page, {
      x: box.x + box.width * fx,
      y: box.y + box.height * 0.2,
      width: box.width * fw,
      height: box.height * 0.6,
    })
  }
  const leftBar = () => sampleFrameRegion(0.03, 0.18)
  const center = () => sampleFrameRegion(0.45, 0.1)

  // The fill never shapes the frame: the uncropped entry's 320×180 holds.
  await frame.scrollIntoViewIfNeeded()
  const box = (await frame.boundingBox())!
  expect(box.width / box.height).toBeCloseTo(320 / 180, 1)

  // Fill-free: the bars are the frame's own black; the picture is blue.
  const bare = await leftBar()
  expect(bare.r + bare.g + bare.b).toBeLessThan(90)
  const picture = await center()
  expect(picture.b).toBeGreaterThan(picture.g + 60)

  // A color fill paints the bars that color, deterministic pixels.
  const fillSelect = page.getByRole('combobox', {
    name: 'Background fill of banded.webm at position 2',
  })
  await fillSelect.selectOption('color')
  await page
    .getByLabel('Background fill color of banded.webm at position 2')
    .fill('#cc0000')
  await expect
    .poll(async () => {
      const bar = await leftBar()
      return bar.r > 120 && bar.r > bar.b + 60
    })
    .toBe(true)
  // The fitted picture above the backdrop is untouched.
  const overRed = await center()
  expect(overRed.b).toBeGreaterThan(overRed.r + 60)

  // Blur: the bars show non-black content sampled from the entry's own
  // frame — the kept region is all blue, so the blurred backdrop is too.
  await fillSelect.selectOption('blur')
  await expect
    .poll(async () => {
      const bar = await leftBar()
      return bar.b > 60 && bar.b > bar.r + 40 && bar.b > bar.g + 40
    })
    .toBe(true)

  // None restores today's black bars.
  await fillSelect.selectOption('none')
  await expect
    .poll(async () => {
      const bar = await leftBar()
      return bar.r + bar.g + bar.b < 90
    })
    .toBe(true)
})
