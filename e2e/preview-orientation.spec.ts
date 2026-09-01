import { expect, test } from '@playwright/test'

/**
 * Clip orientation (#232): rotating and flipping a clip visibly transforms
 * the preview — the e2e criterion of #232. Records a real WebM whose left
 * half is green and right half blue (the preview-zoom.spec idiom: every
 * frame identical, so paused seeks sample exactly), then samples screenshot
 * pixels to prove a flip mirrors the bands and a quarter turn reshapes the
 * frame and carries the left band to the top.
 */
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

const setup = async (page: import('@playwright/test').Page) => {
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
  // A paused mid-clip seek: the sampled frame is deterministic.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
  const video = page.getByTestId('preview-video')
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)
  return video
}

test('flipping a clip horizontally mirrors its picture in the preview', async ({ page }) => {
  const video = await setup(page)

  // Unoriented: the fitted picture's left quarter is the green band.
  const stage = (await video.boundingBox())!
  const scale = Math.min(stage.width / 320, stage.height / 180)
  const fit = {
    x: stage.x + (stage.width - 320 * scale) / 2,
    y: stage.y + (stage.height - 180 * scale) / 2,
    width: 320 * scale,
    height: 180 * scale,
  }
  const leftQuarter = { x: fit.x, y: fit.y, width: fit.width / 4, height: fit.height }
  const before = await sampleScreenRect(page, leftQuarter)
  expect(before.g).toBeGreaterThan(before.b + 60)

  // Flip H: the same screen rectangle now shows the blue band, and the
  // element carries the shared transform rule (#66 pattern).
  await page
    .getByRole('checkbox', { name: 'Flip banded.webm at position 1 horizontally' })
    .check()
  expect(await video.evaluate((el) => el.style.transform)).toBe('scale(-1, 1)')
  const after = await sampleScreenRect(page, leftQuarter)
  expect(after.b).toBeGreaterThan(after.g + 60)

  // Reset returns the picture (and the element) to identity.
  await page
    .getByRole('button', { name: 'Reset orientation of banded.webm at position 1' })
    .click()
  expect(await video.evaluate((el) => el.style.transform)).toBe('')
  const reset = await sampleScreenRect(page, leftQuarter)
  expect(reset.g).toBeGreaterThan(reset.b + 60)
})

test('a quarter turn reshapes the frame portrait and turns the picture', async ({ page }) => {
  const video = await setup(page)
  const frame = page.getByTestId('preview-frame')
  const landscape = (await frame.boundingBox())!
  expect(landscape.width).toBeGreaterThan(landscape.height)

  await page
    .getByRole('button', {
      name: 'Rotate banded.webm at position 1 90 degrees clockwise (currently 0 degrees)',
    })
    .click()

  // The sole source now presents 180×320 to the frame rule (#176): the
  // frame itself turns portrait.
  await expect
    .poll(async () => {
      const box = (await frame.boundingBox())!
      return box.width / box.height
    })
    .toBeCloseTo(180 / 320, 1)

  // The rotated picture fills the portrait frame: the source's left (green)
  // band now covers the top, the right (blue) band the bottom — a 90°
  // clockwise turn, sampled from real pixels.
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)
  const portrait = (await frame.boundingBox())!
  const topQuarter = {
    x: portrait.x,
    y: portrait.y,
    width: portrait.width,
    height: portrait.height / 4,
  }
  const bottomQuarter = {
    x: portrait.x,
    y: portrait.y + (portrait.height * 3) / 4,
    width: portrait.width,
    height: portrait.height / 4,
  }
  const top = await sampleScreenRect(page, topQuarter)
  const bottom = await sampleScreenRect(page, bottomQuarter)
  expect(top.g).toBeGreaterThan(top.b + 60)
  expect(bottom.b).toBeGreaterThan(bottom.g + 60)

  // The browser accepted the swapped-box transform: it resolves to a matrix
  // rather than being discarded as invalid.
  expect(await video.evaluate((el) => el.style.transform)).toBe(
    'translate(-50%, -50%) rotate(90deg)',
  )
  expect(await video.evaluate((el) => getComputedStyle(el).transform)).toContain('matrix(')
})
