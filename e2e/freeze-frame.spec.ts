import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Freeze frame (#379): the transport's Freeze frame button captures the
 * composed frame under the playhead as a library image clip and places it on
 * the timeline as a 2 s still — split & hold between the razor's halves by
 * default, or appended after the current entry, with defined fallbacks at
 * boundaries. The banded fixture (left green, right blue — the
 * save-frame.spec idiom) plus a 90° orientation makes the composition
 * evidence unmistakable: only a capture through the export's draw path
 * (#232/#233) yields a portrait still with the left band carried to the top.
 */

/** Records a WebM whose left half is green and right half blue. */
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
        if (performance.now() - start > 2000) resolve()
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

interface RegionSample {
  r: number
  g: number
  b: number
}

interface FrozenPngSamples {
  width: number
  height: number
  top: RegionSample
  bottom: RegionSample
}

/**
 * Fetches the frozen clip's PNG straight from its library-card object URL —
 * the library clip IS the capture — and averages a top and a bottom band.
 */
async function sampleFrozenPng(page: Page, imgTestId: string): Promise<FrozenPngSamples> {
  const src = await page.getByTestId(imgTestId).getAttribute('src')
  expect(src).not.toBeNull()
  return await page.evaluate(async (url) => {
    const response = await fetch(url!)
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const average = (x: number, y: number, w: number, h: number) => {
      const data = ctx.getImageData(
        Math.floor(x * canvas.width),
        Math.floor(y * canvas.height),
        Math.max(1, Math.floor(w * canvas.width)),
        Math.max(1, Math.floor(h * canvas.height)),
      ).data
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
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      top: average(0.25, 0, 0.5, 0.25),
      bottom: average(0.25, 0.75, 0.5, 0.25),
    }
  }, src)
}

test('freeze frame captures the composed frame and splits & holds at the playhead (#379)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()

  // Rotate 90° (#232): the capture must be the composition, not the raw
  // decode — only the export draw path turns the landscape bands portrait.
  await page
    .getByRole('button', {
      name: 'Rotate banded.webm at position 1 90 degrees clockwise (currently 0 degrees)',
    })
    .click()

  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(1)

  // Seek strictly inside the clip. The slider's max settles with the
  // recording's probed duration, so read-and-fill retries as one unit
  // (the #371 idiom) rather than trusting a stale max.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const freeze = page.getByTestId('preview-freeze-frame')
  await expect(async () => {
    const max = Number(await seek.getAttribute('max'))
    expect(max).toBeGreaterThan(0.5)
    // The slider's step is 0.01, and fill refuses off-step values.
    await seek.fill((Math.round((max / 2) * 100) / 100).toFixed(2))
    await expect(freeze).toBeEnabled()
  }).toPass()

  // Split & hold is the default placement. One click: the capture joins the
  // library as an image clip and the timeline as a 2 s still between the
  // razor's halves.
  await freeze.click()
  await expect(sequence.getByRole('listitem')).toHaveCount(3)
  const frozenDuration = page.getByRole('spinbutton', {
    name: /Duration of Freeze 0:0\d\.png at position 2 in seconds/,
  })
  await expect(frozenDuration).toHaveValue('2')
  // Both halves around it still carry the source clip.
  await expect(sequence.getByRole('listitem').nth(0)).toContainText('banded.webm')
  await expect(sequence.getByRole('listitem').nth(2)).toContainText('banded.webm')

  // The library clip is the capture at the output resolution: portrait
  // after the 90° turn (180×320), left band carried to the top — evidence
  // the freeze went through the export's composition, not the raw source.
  // The card's <img> renders in thumbnail view (#123's list view shows rows).
  await page.getByRole('button', { name: 'Thumbnail view' }).click()
  const samples = await sampleFrozenPng(page, 'clip-card-image-1')
  expect(samples.width).toBe(180)
  expect(samples.height).toBe(320)
  expect(samples.top.g).toBeGreaterThan(samples.top.b + 60)
  expect(samples.bottom.b).toBeGreaterThan(samples.bottom.g + 60)

  // The whole freeze — cut and still — is ONE undo step, and undoing it
  // keeps the captured clip in the library (a deliverable of its own, like
  // a recording).
  await page.keyboard.press('Control+z')
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByTestId('clip-card-image-1')).toBeVisible()
})

test('freeze frame boundary fallback, append placement, and transport geometry (#379)', async ({
  page,
}, testInfo) => {
  await page.goto('./')

  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')

  const sequence = page.getByRole('list', { name: 'Sequence' })
  const freeze = page.getByTestId('preview-freeze-frame')
  const placement = page.getByTestId('preview-freeze-placement')

  // At the sequence start the razor has nothing to cut (split.spec), but the
  // freeze still works: the still holds BEFORE the entry — hold, then play.
  await expect(page.getByTestId('preview-split')).toBeDisabled()
  await expect(freeze).toBeEnabled()
  await freeze.click()
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect(sequence.getByRole('listitem').nth(0)).toContainText('Freeze 0:00.png')
  await expect(sequence.getByRole('listitem').nth(1)).toContainText('Color slate')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:07')

  // Append mode: the still goes AFTER the entry under the playhead, without
  // cutting it — the end-card placement.
  await placement.selectOption('append')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('4')
  await freeze.click()
  await expect(sequence.getByRole('listitem')).toHaveCount(3)
  await expect(sequence.getByRole('listitem').nth(1)).toContainText('Color slate')
  await expect(sequence.getByRole('listitem').nth(2)).toContainText('Freeze 0:04.png')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:09')
  // The slate was not cut: its duration field still reads the full 5 s.
  await expect(
    page.getByRole('spinbutton', { name: 'Duration of Color slate at position 2 in seconds' }),
  ).toHaveValue('5')

  // Geometry (#379 is a new visible surface): the control and its placement
  // choice sit inside the transport row, the button's label does not wrap or
  // overflow, and the page gained no sideways scroll.
  const controls = page.locator('.preview-controls')
  const controlsBox = (await controls.boundingBox())!
  for (const element of [freeze, placement]) {
    const box = (await element.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(controlsBox.x - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(controlsBox.x + controlsBox.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(controlsBox.y - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(controlsBox.y + controlsBox.height + 1)
  }
  const overflow = await freeze.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight)
  const pageScroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(pageScroll.scrollWidth).toBeLessThanOrEqual(pageScroll.clientWidth)

  // A rendered look at the new surface for the PR's evidence (#379's
  // rendered-evidence requirement) — the assertions above are the durable
  // guard; the screenshot is the human check.
  await page.screenshot({ path: testInfo.outputPath('freeze-transport.png') })
})
