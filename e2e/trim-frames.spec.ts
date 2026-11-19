import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Trim window's frame row (#708, PR 2 of the approved design #703 for
 * #701), in a real browser: the frames really are the clip at their times,
 * and the row lies inside the strip at 1280×720 and 360px.
 *
 * `fixtures/trim-colours.webm`, made with FFmpeg: 6 s of 320×180 VP8 at
 * 30 fps, red for two seconds, green for two, then blue, with an Opus
 * 440 Hz tone. The frames sit at the centres of twentieths of the clip, so
 * the first (0.15 s) is red and the last (5.85 s) is blue.
 * `fixtures/trim-clip.webm` is #707's fixture, a yellow box crossing a blue
 * frame, used for the screenshot.
 */

const FRAME_COUNT = 20

async function openTrimOn(page: Page, clip: string): Promise<Locator> {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', clip))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: clip, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${clip} to timeline` }).click()
  await page.getByRole('button', { name: `Trim ${clip} at position 1 in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${clip} at position 1` })
  await expect(dialog).toBeVisible()
  // The row arrives in the background: wait until every frame is drawn.
  await expect(dialog.getByTestId('trim-frame')).toHaveCount(FRAME_COUNT, { timeout: 15_000 })
  await expect
    .poll(() =>
      dialog
        .getByTestId('trim-frame')
        .evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.complete && image.naturalWidth > 0)),
    )
    .toBe(true)
  return dialog
}

/** The mean colour of a frame image's middle, read from its decoded pixels. */
function colourOf(frame: Locator) {
  return frame.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const x = Math.floor(canvas.width / 4)
    const y = Math.floor(canvas.height / 4)
    const { data } = context.getImageData(x, y, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2))
    let r = 0
    let g = 0
    let b = 0
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
    }
    const pixels = data.length / 4
    return { r: r / pixels, g: g / pixels, b: b / pixels }
  })
}

test('the strip’s frames are the clip at their times: the first red, the middle green, the last blue (#708)', async ({
  page,
}) => {
  const dialog = await openTrimOn(page, 'trim-colours.webm')
  const frames = dialog.getByTestId('trim-frame')

  const first = await colourOf(frames.first())
  expect(first.r, JSON.stringify(first)).toBeGreaterThan(180)
  expect(first.g, JSON.stringify(first)).toBeLessThan(80)
  expect(first.b, JSON.stringify(first)).toBeLessThan(80)

  // nth(10), the 11th of 20, sits at 3.15 s, inside the green stretch.
  const middle = await colourOf(frames.nth(FRAME_COUNT / 2))
  expect(middle.g, JSON.stringify(middle)).toBeGreaterThan(180)
  expect(middle.r, JSON.stringify(middle)).toBeLessThan(80)

  const last = await colourOf(frames.last())
  expect(last.b, JSON.stringify(last)).toBeGreaterThan(180)
  expect(last.r, JSON.stringify(last)).toBeLessThan(80)
  expect(last.g, JSON.stringify(last)).toBeLessThan(80)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the frame row lies inside the strip, above the waveform, at ${viewport.width}px (#708)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const dialog = await openTrimOn(page, 'trim-clip.webm')
    // A trim set, so the clamps sit apart and the dim parts show over the
    // frames as over the waveform.
    await dialog.getByRole('spinbutton', { name: 'In point to apply in seconds' }).fill('1.5')
    await dialog.getByRole('spinbutton', { name: 'In point to apply in seconds' }).press('Enter')
    await dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' }).fill('4.5')
    await dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' }).press('Enter')
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()

    const what = `at ${viewport.width}px`
    const strip = dialog.getByTestId('trim-strip')
    const row = dialog.getByTestId('trim-frames')
    await expectWithin(row, strip, { what: `the frame row ${what}` })
    const frames = await dialog.getByTestId('trim-frame').all()
    for (const [index, frame] of frames.entries()) {
      await expectWithin(frame, row, { what: `frame ${index + 1} ${what}` })
    }
    // Twenty cells share the row's width evenly: a frame that kept its
    // natural 96px would push the last ones out (caught by the loop above)
    // or squeeze the rest, which this catches.
    const widths = await dialog
      .getByTestId('trim-frame')
      .evaluateAll((images: HTMLImageElement[]) => images.map((image) => image.getBoundingClientRect().width))
    expect(Math.max(...widths) - Math.min(...widths), `frame widths ${what}: ${widths.join(', ')}`).toBeLessThan(1)
    // The row sits above the waveform, not over it.
    const rowBox = (await row.boundingBox())!
    const waveBox = (await dialog.getByTestId('trim-waveform').boundingBox())!
    expect(rowBox.y + rowBox.height, `the frame row's bottom ${what} vs the waveform's top`).toBeLessThanOrEqual(
      waveBox.y + 1,
    )
    await expectWithin(strip, dialog, { what: `the strip ${what}` })
    await expectNoHorizontalScroll(page, `with the Trim window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`trim-frames-${viewport.width}.png`) })
  })
}
