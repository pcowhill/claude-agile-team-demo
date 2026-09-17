import { expect, test } from '@playwright/test'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * Copy chapter list (#488, part 2 of the approved suggestion #461) in real
 * Chromium: the button in the export dialog's Range group writes the
 * chapter markers inside the exported span to the clipboard, offset to its
 * start, and the clipboard is read back rather than the call being
 * inspected — the whole point of the feature is what lands there.
 *
 * Media-free, on one colour slate stretched to 1:45 so every time is exact
 * and the criteria can be measured at **their own parameters** (#471): a
 * marked range starting at 1:00 with a marker at 1:30, which needs a
 * sequence that long.
 *
 * The hour form (`h:mm:ss`) is unit-tested instead (`chapterList.test.ts`):
 * it needs an exported span of an hour, and the typed range is validated
 * against the sequence's length, so producing one in a browser would mean a
 * genuinely hour-long timeline.
 */

// Reading the clipboard back needs both, and the write needs the page to
// own the clipboard at all.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const SEQUENCE_SECONDS = 105
const copyButton = (page: Page) => page.getByRole('button', { name: 'Copy chapter list' })
const clipboardText = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Seeks the transport to `time`, the retried block `export-range` uses. */
async function seekTo(page: Page, time: number) {
  const slider = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(async () => {
    const max = Number(await slider.getAttribute('max'))
    expect(max).toBeGreaterThanOrEqual(time)
    await slider.fill(String(time))
    expect(Number(await slider.inputValue())).toBeCloseTo(time, 3)
  }).toPass({ timeout: 15_000 })
}

/** Adds a named chapter marker at `time` (#487's Frame ▾ route). */
async function markerAt(page: Page, time: number, name: string) {
  await seekTo(page, time)
  await chooseFromFrameMenu(page, 'preview-add-marker')
  const field = page.getByRole('textbox', { name: /^Name of chapter marker at/ })
  await expect(field).toBeFocused()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(field).toHaveCount(0)
}

/**
 * One slate of 1:45 carrying three markers — at 0:10, 1:00 and 1:30. None
 * sits at zero, so the whole-project list is the inserted-first-line case.
 */
async function sequenceWithMarkers(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill(String(SEQUENCE_SECONDS))
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('1:45')
  await markerAt(page, 10, 'Setup')
  await markerAt(page, 60, 'The demo')
  await markerAt(page, 90, 'Wrap up')
  await expect(page.getByTestId('preview-marker')).toHaveCount(3)
}

const openExportDialog = async (page: Page) => {
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('the whole project copies as a mm:ss list, with the first line inserted (#488)', async ({
  page,
}, testInfo) => {
  await sequenceWithMarkers(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  const dialog = await openExportDialog(page)

  await expect(page.getByTestId('export-scope-whole')).toBeChecked()
  await copyButton(page).click()

  // Read the clipboard back, not the call: what lands there is the feature.
  // Polled — the write resolves a tick after the click (`quality-and-ci.md`).
  await expect
    .poll(() => clipboardText(page), { message: 'the whole project as a chapter list' })
    .toBe('00:00 Intro\n00:10 Setup\n01:00 The demo\n01:30 Wrap up')
  await expect(dialog.getByText('Chapter list copied')).toBeVisible()

  // The note says why a line nobody placed is in the list.
  await expect(dialog.getByText(/Players need a chapter at the very start/)).toBeVisible()
  await expectNoHorizontalScroll(page, 'with the chapter-list row in the export dialog')

  // Rendered evidence for a new visible surface (`development.md`): the
  // geometry lives in export-modal-layout.spec.ts; this is the half only
  // looking can catch.
  await dialog.screenshot({ path: testInfo.outputPath('export-chapter-list.png') })
})

test('the times offset to the exported span, whether it is marked or typed (#488)', async ({
  page,
}) => {
  await sequenceWithMarkers(page)

  // The criterion's own parameters: a range starting at 1:00, and a marker
  // at 1:30 that must come out as 00:30.
  await seekTo(page, 60)
  await page.getByTestId('preview-mark-in').click()
  await seekTo(page, 100)
  await page.getByTestId('preview-mark-out').click()
  await expect(page.getByTestId('preview-marked-range')).toBeVisible()

  const dialog = await openExportDialog(page)
  await page.getByTestId('export-scope-range').check()
  await copyButton(page).click()
  // Setup at 0:10 is outside the span and absent; The demo sits exactly at
  // the start, so it IS the 00:00 line and nothing is inserted.
  const offset = '00:00 The demo\n00:30 Wrap up'
  await expect.poll(() => clipboardText(page), { message: 'the marked range' }).toBe(offset)

  // A span typed into the Range line (#400) offsets the same way. A
  // deliberately DIFFERENT span from the marks: a second copy of the same
  // text could not be told from the clipboard still holding the first.
  await page.getByTestId('export-range-start').fill('0:20')
  await page.getByTestId('export-range-end').fill('1:45')
  await expect(page.getByTestId('export-scope-custom')).toBeChecked()
  // The confirmation expires with the range it described: this span writes
  // a different list, so it is no longer true of the button.
  await expect(dialog.getByText('Chapter list copied')).toHaveCount(0)
  await copyButton(page).click()
  // Setup at 0:10 is before this start too; nothing sits at 0:20, so the
  // first line is inserted here where the marked range needed none.
  await expect
    .poll(() => clipboardText(page), { message: 'the typed range' })
    .toBe('00:00 Intro\n00:40 The demo\n01:10 Wrap up')
})

test('the button is disabled, and says why, when the span holds no markers (#488)', async ({
  page,
}) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  const dialog = await openExportDialog(page)
  await expect(copyButton(page)).toBeDisabled()
  await expect(copyButton(page)).toHaveAttribute(
    'title',
    'No chapter markers in the exported range.',
  )
  // And the note still explains what the button would do, so a user can see
  // what they are missing rather than only that it is greyed out.
  await expect(dialog.getByText(/mm:ss Name/)).toBeVisible()
})
