import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { sineWav } from './sineWav'
import { chooseView } from './clipMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Source preview (#403, from feedback #397): a library clip auditioned alone
 * in the preview panel without touching the timeline. What only a browser
 * can establish is here — the source element's clock actually advancing on
 * Space and landing where the source slider is set, the real waveform
 * decode for an audio clip, an image laid out at its natural aspect — plus
 * the geometry of the new surface and the row action. Every landing is read
 * off state a load cannot fake (#362): media clocks and slider values.
 */

/** A real WebM recorded in the browser, so the source element has frames. */
async function recordWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
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
  return Buffer.from(base64, 'base64')
}

/** A real 4:3 PNG (64×48), so the natural-aspect claim has a number. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0c6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

const blurActive = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

const clockOf = (media: Locator) =>
  media.evaluate((element) => (element as HTMLMediaElement).currentTime)

/**
 * The Preview action fits its row (#403's rendered evidence): inside its
 * list item, one line tall like the Add button beside it, and its glyph not
 * clipped. In the list view it also shares the clip name's line — the
 * action stayed beside what it previews rather than being pushed onto a
 * wrapped line. (It used to be checked against Add's line; since the ✎
 * Rename joined the name, #404, the row's actions wrap after Preview at the
 * default width, so the name is the anchor that says what this check means.)
 * Cards wrap their action cluster by design (#311), so that last check is
 * the list view's alone.
 */
async function expectActionFits(page: Page, name: string, view: 'list' | 'thumbnails') {
  const row = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem').first()
  const preview = page.getByRole('button', { name: `Preview ${name}` })
  const add = page.getByRole('button', { name: `Add ${name} to timeline` })
  await expectWithin(preview, row, { what: `Preview action (${view})` })
  const previewBox = (await preview.boundingBox())!
  const addBox = (await add.boundingBox())!
  expect(previewBox.height, `${view}: Preview is one line tall`).toBeLessThanOrEqual(
    addBox.height + 1,
  )
  const overflow = await preview.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  if (view === 'list') {
    const nameBox = (await row.locator('.clip-name').boundingBox())!
    expect(
      Math.abs(previewBox.y + previewBox.height / 2 - (nameBox.y + nameBox.height / 2)),
      'list: Preview shares the name’s line',
    ).toBeLessThan(previewBox.height / 2)
  }
}

test('a video previews alone with its own transport, and the sequence comes back untouched (#403)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const sequenceSeek = page.getByRole('slider', { name: 'Seek within sequence' })
  // A playhead the mode must hand back exactly — a value the load cannot fake.
  await sequenceSeek.fill('0.5')
  await expect(sequenceSeek).toHaveValue('0.5')

  // The row action, in both views (new visible surface, both layouts).
  await expectActionFits(page, 'clip.webm', 'list')
  await chooseView(page, 'Thumbnails')
  await expectActionFits(page, 'clip.webm', 'thumbnails')
  await chooseView(page, 'List')

  await page.getByRole('button', { name: 'Preview clip.webm' }).click()
  await blurActive(page)
  const panel = page.getByRole('region', { name: 'Preview' })
  const frame = page.getByTestId('source-frame')
  const video = page.getByTestId('source-video')
  await expect(frame).toBeVisible()
  await expect(page.getByTestId('source-preview-name')).toHaveText('clip.webm')
  await expect(sequenceSeek).toBeHidden()
  await expect(page.getByTestId('preview-now-playing')).toBeHidden()

  // Space plays the source: its own clock advances.
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause source' })).toBeVisible()
  await expect.poll(() => clockOf(video)).toBeGreaterThan(0.2)
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play source' })).toBeVisible()

  // The source slider lands the source's clock; the readout follows.
  const sourceSeek = page.getByRole('slider', { name: 'Seek within source' })
  await sourceSeek.fill('1')
  await expect.poll(() => clockOf(video)).toBeGreaterThan(0.95)
  await expect.poll(() => clockOf(video)).toBeLessThan(1.05)
  await expect(page.getByTestId('source-position')).toHaveText(/^0:01 \//)

  // Geometry (new visible surface): the source frame and its transport lie
  // inside the preview panel, and the page gained no sideways scroll.
  await expectWithin(frame, panel, { what: 'source frame' })
  await expectWithin(page.locator('.source-preview-controls'), panel, {
    what: 'source transport',
  })
  await expectWithin(page.locator('.source-preview-header'), panel, {
    what: 'source header',
  })
  await expectNoHorizontalScroll(page, 'video source preview')
  // The human check for the PR's rendered evidence, re-taken every run.
  await panel.screenshot({ path: testInfo.outputPath('source-preview-video.png') })

  // Back: the sequence transport returns with the playhead where it was.
  await page.getByTestId('source-back').click()
  await expect(frame).toHaveCount(0)
  await expect(sequenceSeek).toBeVisible()
  await expect(sequenceSeek).toHaveValue('0.5')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  // Escape does the same, from the keyboard.
  await page.getByRole('button', { name: 'Preview clip.webm' }).click()
  await blurActive(page)
  await expect(frame).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(frame).toHaveCount(0)
  await expect(sequenceSeek).toHaveValue('0.5')
})

test('an audio clip previews with its waveform and a running clock (#403)', async ({ page }) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) }])
  await page.getByRole('button', { name: 'Preview tone.wav' }).click()
  await blurActive(page)

  // The real decode chain drew the whole clip's waveform (#191).
  await expect(page.getByTestId('source-waveform-svg')).toBeVisible()
  const audio = page.getByTestId('source-audio')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause source' })).toBeVisible()
  await expect.poll(() => clockOf(audio)).toBeGreaterThan(0.2)
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play source' })).toBeVisible()
  await expectNoHorizontalScroll(page, 'audio source preview')
})

test('an image previews at its natural aspect, with no transport (#403)', async ({ page }) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Preview logo.png' }).click()

  const image = page.getByTestId('source-image')
  await expect(image).toBeVisible()
  const box = (await image.boundingBox())!
  // 64×48 is 4:3; the frame it sits in is 16:9, so the image is height-bound
  // and its rendered box carries the natural aspect. 2% covers sub-pixel
  // rounding of the two edges.
  expect(box.width / box.height).toBeGreaterThan((4 / 3) * 0.98)
  expect(box.width / box.height).toBeLessThan((4 / 3) * 1.02)
  await expectWithin(image, page.getByTestId('source-frame'), { what: 'image in frame' })
  await expect(page.getByRole('button', { name: 'Play source' })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Seek within source' })).toHaveCount(0)
})
