import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectWithin } from './layout'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Trim window's effect marks, warning and transition shading (#709,
 * from the approved design #703 §3), in a real browser.
 *
 * - The warning is read as the clamps move, then compared with what Apply
 *   actually does to the effect, through the row's own fields.
 * - A transition's shaded span is measured against the strip.
 *
 * The clip is `fixtures/trim-clip.webm` (#707's fixture): 6.008 s of
 * 320×180 VP8.
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`

async function addClips(page: Page, count: number) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  for (let added = 0; added < count; added++) {
    await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  }
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })).toBeVisible()
}

async function fill(field: Locator, value: string) {
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

const zoomField = (page: Page, part: string) =>
  page.getByRole('spinbutton', { name: `Zoom 1 ${part} of ${ENTRY} in seconds` })

/** Zoom 1 on position 1, its window 2 → 4 s into the trim: ramp 0.5, hold 1, ramp 0.5. */
async function addZoom(page: Page) {
  await chooseEffect(page, ENTRY, 'Zoom')
  await fill(zoomField(page, 'start'), '2')
  await fill(zoomField(page, 'ramp-in'), '0.5')
  await fill(zoomField(page, 'hold'), '1')
  await fill(zoomField(page, 'ramp-out'), '0.5')
}

async function openTrim(page: Page) {
  await page.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${ENTRY}` })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Types an Out for the window to apply, as its own footer field does. */
async function setOut(dialog: Locator, seconds: string) {
  const out = dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' })
  await out.fill(seconds)
  await out.blur()
  await expect(dialog.getByTestId('trim-clamp-out')).toHaveAttribute('aria-valuenow', seconds)
}

test('the warning names what a trim would do to a zoom, live, and Apply then does exactly that (#709)', async ({
  page,
}) => {
  await addClips(page, 1)
  await addZoom(page)
  let dialog = await openTrim(page)
  const warning = dialog.getByTestId('trim-warning')
  const marks = dialog.getByTestId('trim-effect-mark')

  // Untrimmed: the zoom is marked, and nothing is cut.
  await expect(marks).toHaveCount(1)
  await expect(marks).toHaveAttribute('data-kind', 'zoom')
  await expect(marks).toHaveAttribute('title', 'Zoom 1')
  await expect(warning).toHaveText('')

  // Out inside the zoom's window, then before its start, then back out.
  await setOut(dialog, '3.5')
  await expect(warning).toHaveText('Trimming here shortens Zoom 1.')
  await setOut(dialog, '1.5')
  await expect(warning).toHaveText('Trimming here removes Zoom 1.')
  await expect(marks).toHaveCount(0)
  await setOut(dialog, '5')
  await expect(warning).toHaveText('')
  await expect(marks).toHaveCount(1)

  // A drag says it as the clamp moves, before any release-time commit:
  // Out dragged to about 3 s, inside the window.
  const strip = (await dialog.getByTestId('trim-strip').boundingBox())!
  const grip = (await dialog.getByTestId('trim-clamp-out').boundingBox())!
  const y = grip.y + grip.height / 2
  await page.mouse.move(grip.x + grip.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(strip.x + strip.width * 0.5, y, { steps: 6 })
  await expect(warning).toHaveText('Trimming here shortens Zoom 1.')
  await page.mouse.up()

  // "shortens", applied: the window loses its ramp-out, keeping its start,
  // ramp-in and hold, and ends at the new end.
  await setOut(dialog, '3.5')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(zoomField(page, 'start')).toHaveValue('2')
  await expect(zoomField(page, 'ramp-in')).toHaveValue('0.5')
  await expect(zoomField(page, 'hold')).toHaveValue('1')
  await expect(zoomField(page, 'ramp-out')).toHaveValue('0')

  // "removes", applied: Undo, then trim before the zoom starts. The zoom is
  // kept, but at the end and with nothing left of any phase.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(zoomField(page, 'ramp-out')).toHaveValue('0.5')
  dialog = await openTrim(page)
  await setOut(dialog, '1.5')
  await expect(dialog.getByTestId('trim-warning')).toHaveText('Trimming here removes Zoom 1.')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(zoomField(page, 'start')).toHaveValue('1.5')
  for (const part of ['ramp-in', 'hold', 'ramp-out']) await expect(zoomField(page, part)).toHaveValue('0')
})

test("a transition at the entry's end shades the source span it covers, as wide as its duration at the clamps (#709)", async ({
  page,
}) => {
  await addClips(page, 2)
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await fill(page.getByRole('spinbutton', { name: 'Transition duration between position 1 and 2 in seconds' }), '1')
  const dialog = await openTrim(page)
  const duration = Number(await dialog.getByTestId('trim-clamp-out').getAttribute('aria-valuemax'))
  expect(duration).toBeGreaterThan(5.9)

  for (const out of ['5', '3']) {
    await setOut(dialog, out)
    // setOut's retrying assertion saw this render commit; both boxes come
    // from one page read of it.
    const measured = await dialog.getByTestId('trim-strip').evaluate((strip) => {
      const span = strip.querySelector('[data-testid="trim-transition-end"]')
      if (span === null) throw new Error('no transition span')
      const inner = strip.getBoundingClientRect().left + strip.clientLeft
      const box = span.getBoundingClientRect()
      return { left: box.left - inner, width: box.width, strip: strip.clientWidth }
    })
    // Seconds per pixel of strip. One pixel each way is the tolerance: the
    // span is placed by percentages of the strip, which round to the pixel.
    const perPixel = duration / measured.strip
    const tolerance = perPixel * 1.01
    const startSeconds = measured.left * perPixel
    const widthSeconds = measured.width * perPixel
    // No remaps, so 1 s of crossfade output is 1 s of source, ending at Out.
    expect(Math.abs(widthSeconds - 1), `the span is ${widthSeconds.toFixed(3)} s wide at Out ${out}`).toBeLessThanOrEqual(tolerance)
    expect(Math.abs(startSeconds - (Number(out) - 1)), `the span starts at ${startSeconds.toFixed(3)} s`).toBeLessThanOrEqual(tolerance)
  }
  // No transition before position 1, so nothing is shaded at its start.
  await expect(dialog.getByTestId('trim-transition-start')).toHaveCount(0)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`marks, a warning and shading fit the Trim window at ${viewport.width}px (#709)`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    // Populated: two entries, a transition between them, and on the first a
    // zoom, a speed segment and a pause.
    await addClips(page, 2)
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await addZoom(page)
    await chooseEffect(page, ENTRY, 'Speed segment')
    await chooseEffect(page, ENTRY, 'Pause')
    const dialog = await openTrim(page)
    const marks = dialog.getByTestId('trim-effect-mark')
    await expect(marks).toHaveCount(3)
    // Out at 3.5 s cuts into something, so the warning shows.
    await setOut(dialog, '3.5')
    const warning = dialog.getByTestId('trim-warning')
    await expect(warning).toContainText('Trimming here ')
    await expect(dialog.getByTestId('trim-transition-end')).toHaveCount(1)

    const strip = dialog.getByTestId('trim-strip')
    for (const mark of await marks.all()) {
      await expectWithin(mark, strip, { what: `the ${await mark.getAttribute('title')} mark` })
    }
    await expectWithin(dialog.getByTestId('trim-transition-end'), strip, { what: 'the transition span' })
    await expectWithin(warning, dialog, { what: 'the warning' })
    // The window itself inside the viewport. Not expectNoHorizontalScroll:
    // at 360px the editor column behind the modal already overflows once a
    // transition exists, on main and without this window (#749).
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    await dialog.screenshot({ path: testInfo.outputPath(`trim-effects-${viewport.width}.png`) })
  })
}
