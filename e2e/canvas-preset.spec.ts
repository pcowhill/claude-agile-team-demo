import { expect, test } from '@playwright/test'

/**
 * The project's canvas preset (#273): choosing a fixed output-frame aspect
 * must visibly reshape the preview stage, with the clip letterboxed into it,
 * and Auto must restore the source-derived shape.
 *
 * Real rendered geometry, not the CSS variable: the variable is what the
 * component tests already pin, and a stage that carried the right variable
 * while laying out at the wrong shape would satisfy them and still be
 * broken. So this measures the stage's own bounding box, and the video
 * element's box inside it, in a real browser.
 *
 * The viewport is pinned so the geometry asserted below is stable by
 * construction — the #116/#117 lesson that a spec deriving assertions from
 * live layout must pin the layout inputs it depends on.
 */
test.use({ viewport: { width: 1280, height: 900 } })

/**
 * Samples a screenshot of an element: the average colour of a fractional
 * band across its width. The clip is solid blue and the frame's ground is
 * not, so this is how the letterboxing bars are measured — the video
 * element's own box fills the frame and `object-fit: contain` letterboxes
 * the picture inside it, so a bounding box cannot see the bars.
 */
async function bandColours(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  bands: number[],
): Promise<{ r: number; g: number; b: number }[]> {
  const shot = (await locator.screenshot()).toString('base64')
  return await page.evaluate(
    async ({ shot, bands }) => {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('screenshot failed to decode'))
        image.src = `data:image/png;base64,${shot}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return bands.map((fraction) => {
        const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height * fraction)))
        const strip = ctx.getImageData(
          Math.floor(canvas.width * 0.3),
          y,
          Math.max(1, Math.floor(canvas.width * 0.4)),
          1,
        ).data
        let r = 0
        let g = 0
        let b = 0
        const pixels = strip.length / 4
        for (let index = 0; index < strip.length; index += 4) {
          r += strip[index]
          g += strip[index + 1]
          b += strip[index + 2]
        }
        return { r: r / pixels, g: g / pixels, b: b / pixels }
      })
    },
    { shot, bands },
  )
}


/** Records a real WebM of the given frame size, so the preview has a decodable source. */
async function recordWebm(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
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
          ctx.fillStyle = 'rgb(0, 0, 205)'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > 1200) resolve()
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
    { width, height },
  )
  return Buffer.from(base64, 'base64')
}

test('a canvas preset reshapes the preview stage, and Auto restores it (#273)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  // A landscape source — the customer's case is a landscape recording bound
  // for a vertical project.
  const landscape = await recordWebm(page, 640, 360)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'wide.webm', mimeType: 'video/webm', buffer: landscape }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add wide.webm to timeline' }).click()

  // The frame, not the stage: the stage fills its row, and the frame is the
  // largest rectangle of the output aspect that fits inside it (#176) — the
  // element whose shape *is* the output frame's.
  const stage = page.getByTestId('preview-frame')
  const video = page.getByTestId('preview-video')
  const aspectOf = async (locator: typeof stage) => {
    const box = await locator.boundingBox()
    if (box === null) throw new Error('no box')
    return box.width / box.height
  }

  // Auto: the stage follows the source, 16:9.
  await expect
    .poll(async () => Math.round((await aspectOf(stage)) * 100) / 100, {
      message: 'the Auto frame should follow the 640×360 source',
    })
    .toBeCloseTo(16 / 9, 1)
  const autoBox = await stage.boundingBox()

  const preset = page.getByRole('combobox', { name: 'Canvas aspect' })
  await preset.selectOption('9:16')

  // 9:16: a genuinely portrait stage — taller than it is wide, which the
  // landscape stage never is. Asserted as a real measured box.
  await expect
    .poll(async () => Math.round((await aspectOf(stage)) * 1000) / 1000, {
      message: 'the 9:16 frame should measure 9:16',
    })
    .toBeCloseTo(9 / 16, 2)
  const portraitBox = await stage.boundingBox()
  expect(portraitBox!.height).toBeGreaterThan(portraitBox!.width)
  expect(autoBox!.width).toBeGreaterThan(autoBox!.height)

  // The clip letterboxes into the tall frame rather than filling or being
  // cropped by it. Measured in rendered pixels: the middle of the frame is
  // the clip's blue, and bands near the top and bottom are not — those are
  // the bars, which is exactly the shape background fill (#259) treats.
  // A paused seek into the clip, so the sampled frame is deterministic and
  // the element actually has a picture to letterbox (the preview cues on
  // demand — the pattern the other preview-pixel specs use).
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.6')
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)
  const [top, middle, bottom] = await bandColours(page, stage, [0.06, 0.5, 0.94])
  const isClipBlue = ({ r, g, b }: { r: number; g: number; b: number }) =>
    b > 120 && r < 90 && g < 90
  expect(isClipBlue(middle), `middle band ${JSON.stringify(middle)} was not the clip`).toBe(true)
  expect(isClipBlue(top), `top band ${JSON.stringify(top)} should be a bar`).toBe(false)
  expect(isClipBlue(bottom), `bottom band ${JSON.stringify(bottom)} should be a bar`).toBe(false)

  // And in Auto the same bands are all the clip — no bars, so the check
  // above is measuring the reshape rather than something always true.
  await preset.selectOption('')
  await expect
    .poll(async () => Math.round((await aspectOf(stage)) * 100) / 100)
    .toBeCloseTo(16 / 9, 1)
  for (const band of await bandColours(page, stage, [0.06, 0.5, 0.94])) {
    expect(isClipBlue(band), `Auto band ${JSON.stringify(band)} should be the clip`).toBe(true)
  }
  await preset.selectOption('9:16')
  await expect.poll(async () => Math.round((await aspectOf(stage)) * 1000) / 1000).toBeCloseTo(9 / 16, 2)

  // Square, for a preset that is neither the source's nor a rotation of it.
  await preset.selectOption('1:1')
  await expect
    .poll(async () => Math.round((await aspectOf(stage)) * 1000) / 1000, {
      message: 'the 1:1 frame should measure square',
    })
    .toBeCloseTo(1, 2)

  // Auto restores the source-derived shape exactly.
  await preset.selectOption('')
  await expect
    .poll(async () => Math.round((await aspectOf(stage)) * 100) / 100, {
      message: 'Auto should restore the source-derived frame',
    })
    .toBeCloseTo(16 / 9, 1)
})

test('a canvas preset is an undoable timeline edit (#273)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const landscape = await recordWebm(page, 640, 360)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'wide.webm', mimeType: 'video/webm', buffer: landscape }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add wide.webm to timeline' }).click()

  const stage = page.getByTestId('preview-frame')
  const preset = page.getByRole('combobox', { name: 'Canvas aspect' })
  const portrait = async () => {
    const box = await stage.boundingBox()
    return box !== null && box.height > box.width
  }

  await preset.selectOption('9:16')
  await expect.poll(portrait, { message: 'the frame should be portrait' }).toBe(true)

  // Undo puts the frame back and the control with it: the preset is timeline
  // state on the same history as any other edit (#189).
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(portrait, { message: 'undo should restore Auto' }).toBe(false)
  await expect(preset).toHaveValue('')

  await page.getByRole('button', { name: 'Redo' }).click()
  await expect.poll(portrait, { message: 'redo should restore the preset' }).toBe(true)
  await expect(preset).toHaveValue('9:16')
})
