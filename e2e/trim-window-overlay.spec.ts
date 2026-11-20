import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Trim window on a video overlay (#711), in a real browser:
 * - it plays the overlay's own source;
 * - the overlay's own zoom is marked;
 * - the warning says what Apply then does to that zoom, through the
 *   overlay row's own fields;
 * - the row's Trim… and the window fit at 1280×720 and 360px, on a populated
 *   project (a sequence entry and an overlay carrying a zoom).
 *
 * The entry's window is `trim-window.spec.ts`'s and `trim-effects.spec.ts`'s,
 * and the audio track's is `trim-window-audio.spec.ts`'s. The clip is
 * `fixtures/trim-clip.webm` (#707's fixture): 6.008 s of 320×180 VP8.
 */

const CLIP = 'trim-clip.webm'
const OVERLAY = `overlay ${CLIP} at position 1`

async function fill(field: Locator, value: string) {
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

const zoomField = (page: Page, part: string) =>
  page.getByRole('spinbutton', { name: `Zoom 1 ${part} of ${OVERLAY} in seconds` })

/** A sequence entry, and the same clip as an overlay with Zoom 1 at 2 → 4 s into its trim. */
async function addOverlayWithZoom(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await chooseClipAction(page, CLIP, 'Add as overlay')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${OVERLAY} in seconds` })).toBeVisible()
  await chooseEffect(page, OVERLAY, 'Zoom')
  await fill(zoomField(page, 'start'), '2')
  await fill(zoomField(page, 'ramp-in'), '0.5')
  await fill(zoomField(page, 'hold'), '1')
  await fill(zoomField(page, 'ramp-out'), '0.5')
}

async function openTrim(page: Page) {
  await page.getByRole('button', { name: `Trim ${OVERLAY} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${OVERLAY}` })
  await expect(dialog).toBeVisible()
  // The overlay's source is loaded, so its clock is the clip's.
  await expect
    .poll(() => dialog.getByTestId('trim-video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

test('an overlay’s Trim window marks its own zoom, warns before Out cuts into it, and Apply then does exactly that (#711)', async ({
  page,
}) => {
  await addOverlayWithZoom(page)
  const outField = page.getByRole('spinbutton', { name: `Trim out point of ${OVERLAY} in seconds` })
  const outBefore = await outField.inputValue()
  const dialog = await openTrim(page)
  const marks = dialog.getByTestId('trim-effect-mark')
  const warning = dialog.getByTestId('trim-warning')

  // As it stands: the zoom is marked, nothing is cut, and an overlay has no
  // transition to shade.
  await expect(marks).toHaveCount(1)
  await expect(marks).toHaveAttribute('data-kind', 'zoom')
  await expect(marks).toHaveAttribute('title', 'Zoom 1')
  await expect(warning).toHaveText('')
  await expect(dialog.locator('.trim-strip-transition')).toHaveCount(0)

  // Out at 3 s cuts into the zoom's 2 → 4 s window.
  const out = dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' })
  await out.fill('3')
  await out.blur()
  await expect(dialog.getByTestId('trim-clamp-out')).toHaveAttribute('aria-valuenow', '3')
  await expect(warning).toHaveText('Trimming here shortens Zoom 1.')

  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(outField).toHaveValue('3')
  // What the warning said: Zoom 1 still starts at 2 s, and has lost its ramp out.
  await expect(zoomField(page, 'start')).toHaveValue('2')
  await expect(zoomField(page, 'ramp-out')).toHaveValue('0')

  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(outField).toHaveValue(outBefore)
  await expect(zoomField(page, 'ramp-out')).toHaveValue('0.5')
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`an overlay’s Trim… and Trim window fit a ${viewport.width}px window (#711)`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await addOverlayWithZoom(page)
    const what = `at ${viewport.width}px`
    // The row's Trim… first: inside its row, on one line, the page still.
    const row = page.getByRole('list', { name: 'Overlay layers' }).getByRole('listitem').first()
    const trim = row.getByRole('button', { name: `Trim ${OVERLAY} in the Trim window` })
    await trim.scrollIntoViewIfNeeded()
    await expectWithin(trim, row, { what: `the overlay row's Trim… ${what}` })
    await expectNoWrap(trim, `the overlay row's Trim… ${what}`)
    await expectNoHorizontalScroll(page, `with Trim… on the overlay row ${what}`)
    await row.screenshot({ path: testInfo.outputPath(`trim-overlay-row-${viewport.width}.png`) })

    const dialog = await openTrim(page)
    const strip = dialog.getByTestId('trim-strip')
    await expectWithin(strip, dialog, { what: `the strip ${what}` })
    await expectWithin(dialog.getByTestId('trim-effect-mark'), strip, { what: `the zoom's mark ${what}` })
    await expectNoHorizontalScroll(page, `with the overlay's Trim window open ${what}`)
    await dialog.screenshot({ path: testInfo.outputPath(`trim-window-overlay-${viewport.width}.png`) })
  })
}
