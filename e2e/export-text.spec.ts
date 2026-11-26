import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { presentedExportedFrame } from './decodedFrame'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * Export of text overlays (#142): an exported file must carry the overlay's
 * text during its window — drawn by the real canvas `fillText` path the unit
 * tests cannot reach. The fixture is a red color slate (#143, media-free) with
 * a white overlay covering only the sequence's tail, so decoded frames reveal
 * the draw: a frame inside the window contains near-white pixels; a frame
 * before it is pure red-on-black. Sampling anchors to the end of the file, as
 * the other export specs do, because export overhead pads the front.
 */

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * counts the frame's whitish pixels (all three channels bright) — text-white
 * against the slate's red, which never brightens green or blue. The frame
 * is read once it has been presented (`presentedExportedFrame`, #276):
 * drawing straight after `seeked` read an all-black frame under load, a
 * whitish count of exactly 0 (#921, as #374 found in export-settings).
 */
async function countWhitishPixels(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
): Promise<{ whitish: number; total: number; duration: number }> {
  const frame = await presentedExportedFrame(page, webm, { fromEndSeconds })
  const counted = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let whitish = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 150 && pixels[index + 1] > 150 && pixels[index + 2] > 150) {
        whitish++
      }
    }
    return { whitish, total: pixels.length / 4 }
  }, frame.png.toString('base64'))
  return { ...counted, duration: frame.duration }
}

test('an exported file shows the text overlay during its window only', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('./')

  // A 3 s red slate; a large white overlay covering [1.5, end) of it.
  await chooseFromAddMenu(page, ADD_SLATE)
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('3')
  await slateDuration.blur()

  await chooseFromAddMenu(page, ADD_TEXT)
  const offset = page.getByRole('spinbutton', {
    name: 'Start time of text overlay at position 1 in seconds',
  })
  await offset.fill('1.5')
  await offset.blur()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of text overlay at position 1 in seconds',
  })
  await duration.fill('10')
  await duration.blur()
  // A quarter of the frame height per line: thousands of lit pixels.
  const size = page.getByRole('spinbutton', {
    name: 'Size of text overlay at position 1 (fraction of frame height)',
  })
  await size.fill('0.25')
  await size.blur()

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Inside the window (0.5 s from the end, well past 1.5 s of 3): the white
  // "Title" is on the frame.
  const inWindow = await countWhitishPixels(page, exported, 0.5)
  expect(inWindow.duration).toBeGreaterThan(3 * 0.6)
  expect(inWindow.duration).toBeLessThan(3 + 2)
  expect(inWindow.whitish).toBeGreaterThan(inWindow.total * 0.005)

  // Before the window (0.5 s from the start — export overhead only ever pads
  // the front, so this instant is at or before sequence time 0.5 s): nothing
  // white anywhere, whether the frame is the red slate or leading padding.
  const beforeWindow = await countWhitishPixels(page, exported, inWindow.duration - 0.5)
  expect(beforeWindow.whitish).toBe(0)
})

test('an exported fade renders: bright text early in the window, dimmed past the ramp (#177)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')

  // The same red-slate fixture; the overlay covers the whole 3 s sequence
  // and fades out across all of it, so brightness falls monotonically: near
  // the start the white text is (almost) full-strength; near the end its
  // alpha is a small fraction and no pixel clears the whitish threshold.
  await chooseFromAddMenu(page, ADD_SLATE)
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('3')
  await slateDuration.blur()

  await chooseFromAddMenu(page, ADD_TEXT)
  const size = page.getByRole('spinbutton', {
    name: 'Size of text overlay at position 1 (fraction of frame height)',
  })
  await size.fill('0.25')
  await size.blur()
  const fadeOut = page.getByRole('spinbutton', {
    name: 'Fade-out of text overlay at position 1 in seconds',
  })
  await fadeOut.fill('3')
  await fadeOut.blur()

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Early in the window (~2.5 s from the end of a ~3 s file — export
  // overhead only ever pads the front, so this instant maps to a sequence
  // time no later than 0.5 s, envelope ≥ 0.8): white text over red brightens
  // green and blue well past the threshold.
  const early = await countWhitishPixels(page, exported, 2.5)
  expect(early.duration).toBeGreaterThan(3 * 0.6)
  expect(early.duration).toBeLessThan(3 + 2)
  expect(early.whitish).toBeGreaterThan(early.total * 0.005)

  // Deep into the fade (0.3 s from the end, envelope ≤ 0.1): the text's
  // contribution to green/blue is a few tens of levels at most — nothing
  // clears the whitish threshold, though the overlay is still active.
  const late = await countWhitishPixels(page, exported, 0.3)
  expect(late.whitish).toBe(0)
})
