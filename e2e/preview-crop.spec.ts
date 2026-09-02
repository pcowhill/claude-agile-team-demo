import { expect, test } from '@playwright/test'

/**
 * Per-clip crop (#255): trimming an edge visibly changes the previewed
 * region — the e2e criterion of #255. Records a real WebM whose left half
 * is green and right half blue (the preview-orientation.spec idiom: every
 * frame identical, so paused seeks sample exactly), then samples screenshot
 * pixels to prove that cropping the left half reshapes the frame and leaves
 * only the blue band rendering, and that reset restores the full picture.
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

test('cropping the left half reshapes the frame and renders only the kept region', async ({
  page,
}) => {
  const video = await setup(page)
  const frame = page.getByTestId('preview-frame')

  // Uncropped: the landscape frame shows the green band on its left.
  const landscape = (await frame.boundingBox())!
  expect(landscape.width / landscape.height).toBeCloseTo(320 / 180, 1)
  const leftHalfBefore = {
    x: landscape.x,
    y: landscape.y,
    width: landscape.width / 2,
    height: landscape.height,
  }
  const before = await sampleScreenRect(page, leftHalfBefore)
  expect(before.g).toBeGreaterThan(before.b + 60)

  const cropField = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 1 (percent)',
  })
  await cropField.fill('50')
  await cropField.blur()

  // The sole source now presents 160×180 to the frame rule (#176): the
  // frame itself reshapes to the kept region.
  await expect
    .poll(async () => {
      const box = (await frame.boundingBox())!
      return box.width / box.height
    })
    .toBeCloseTo(160 / 180, 1)

  // Only the kept (blue) half renders — the cropped-away green band is
  // gone from the whole frame, sampled from real pixels.
  const cropped = (await frame.boundingBox())!
  const whole = { x: cropped.x, y: cropped.y, width: cropped.width, height: cropped.height }
  const after = await sampleScreenRect(page, whole)
  expect(after.b).toBeGreaterThan(after.g + 60)

  // Reset restores the full picture and the landscape frame.
  await page.getByRole('button', { name: 'Reset crop of banded.webm at position 1' }).click()
  await expect
    .poll(async () => {
      const box = (await frame.boundingBox())!
      return box.width / box.height
    })
    .toBeCloseTo(320 / 180, 1)
  const restored = (await frame.boundingBox())!
  const leftQuarter = {
    x: restored.x,
    y: restored.y,
    width: restored.width / 4,
    height: restored.height,
  }
  const back = await sampleScreenRect(page, leftQuarter)
  expect(back.g).toBeGreaterThan(back.b + 60)
  await expect(video).toBeVisible()
})

test('a crop deeper than the floor clamps to keep a tenth of the axis', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('spinbutton', {
    name: 'Crop left of banded.webm at position 1 (percent)',
  })
  const right = page.getByRole('spinbutton', {
    name: 'Crop right of banded.webm at position 1 (percent)',
  })
  await left.fill('60')
  await left.blur()
  await right.fill('50')
  await right.blur()
  // The reducer scales the pair back so 10% survives; the fields show the
  // stored (clamped) state — the clamp is visible, not silent.
  const leftValue = Number(await left.inputValue())
  const rightValue = Number(await right.inputValue())
  expect(leftValue + rightValue).toBeCloseTo(90, 1)
  expect(leftValue / rightValue).toBeCloseTo(60 / 50, 2)
})
