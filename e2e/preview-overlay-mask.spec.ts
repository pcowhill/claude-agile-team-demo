import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Overlay shape masks in the preview (#266): a masked overlay's placed
 * rectangle is clipped to the inscribed ellipse, from real pixels. The base
 * is the default red slate (#143) and the overlay a solid-green recording
 * whose 16:9 shape fills its default card exactly, so every card pixel is
 * green under the hard rectangle. With the ellipse mask the card's corner
 * regions — outside the inscribed ellipse — show the red base through the
 * cut, while the card's centre stays green; switching back to Rectangle
 * restores the green corners.
 */

/** Records a short solid-green WebM so the overlay has a decodable source. */
async function recordGreenWebm(page: Page): Promise<Buffer> {
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

test('an ellipse mask cuts the overlay corners to the base; Rectangle restores them (#266)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  // The base: the default red slate (#143) — a flat, deterministic ground.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  const webm = await recordGreenWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'cam.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add cam.webm as overlay' }).click()

  // A paused seek inside the overlay's window; wait for a decodable frame.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
  const overlay = page.getByTestId('preview-overlay-0')
  await expect(overlay).toBeVisible()
  await expect
    .poll(() => overlay.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)

  // Editing the timeline can scroll the page and screenshots clip against
  // the viewport, so every sample re-anchors on the card's fresh box.
  // Regions are fractions of the overlay card: a corner square well outside
  // the inscribed ellipse, and the card's centre.
  const card = page.getByTestId('preview-overlay-card-0')
  const sampleCardRegion = async (fx: number, fy: number, fw: number, fh: number) => {
    await card.scrollIntoViewIfNeeded()
    const box = (await card.boundingBox())!
    return sampleScreenRect(page, {
      x: box.x + box.width * fx,
      y: box.y + box.height * fy,
      width: box.width * fw,
      height: box.height * fh,
    })
  }
  const corner = () => sampleCardRegion(0.02, 0.02, 0.1, 0.1)
  const center = () => sampleCardRegion(0.45, 0.45, 0.1, 0.1)

  // Hard rectangle (the default): the 16:9 clip fills its 16:9 default
  // card, so the corner is the overlay's own green — the pixels the mask
  // must cut away really are there.
  const bareCorner = await corner()
  expect(bareCorner.g).toBeGreaterThan(bareCorner.r + 60)

  // Ellipse: the corner region lies outside the inscribed ellipse — the red
  // base shows through the cut — while the centre stays the overlay's green.
  await page
    .getByRole('combobox', { name: 'Shape mask of overlay cam.webm at position 1' })
    .selectOption('ellipse')
  await expect
    .poll(async () => {
      const cut = await corner()
      return cut.r > cut.g + 60
    })
    .toBe(true)
  const maskedCenter = await center()
  expect(maskedCenter.g).toBeGreaterThan(maskedCenter.r + 60)

  // Back to Rectangle: the corners are the overlay's own pixels again.
  await page
    .getByRole('combobox', { name: 'Shape mask of overlay cam.webm at position 1' })
    .selectOption('rectangle')
  await expect
    .poll(async () => {
      const restored = await corner()
      return restored.g > restored.r + 60
    })
    .toBe(true)
})
