import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * The settings dialog (#286, from customer feedback #281). What only a real
 * browser can establish is here: the dialog's rows actually fitting inside
 * it once laid out (jsdom has no layout, and this is the defect class that
 * reached the customer twice — #268, #287), the fit at a short viewport
 * where a `position: fixed` overlay cannot be scrolled, a preference
 * surviving a genuine page load through real `localStorage`, and the export
 * modal — whose format list needs a real MediaRecorder — opening on the
 * chosen format.
 *
 * The component tests own everything jsdom can see: which controls exist,
 * what they are labelled, Escape and click-outside, and the four effects.
 */

const SETTINGS_KEY = 'browser-video-editor.settings'

/** A real PNG, so a still can be imported and added to the sequence. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#28c'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' })
const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(dialog(page)).toBeVisible()
}
const row = (page: Page, label: string) =>
  page.locator('.settings-row').filter({ hasText: label })
const select = (page: Page, label: string) => dialog(page).getByLabel(label)

test('every settings row lays out inside the dialog, at a wide viewport and a narrow one (#286)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')
  await openSettings(page)

  // The dialog fits the window. Its overlay is `inset: 0` on a fixed
  // element, so the overlay's box *is* the viewport: a dialog outside it is
  // a dialog the user cannot fully reach.
  await expectWithin(dialog(page), page.locator('.dialog-overlay'), { what: 'settings dialog' })

  // Every row inside the dialog, and every control inside its row. A label
  // that could not shrink, or a <select> sized by a long option, would hang
  // out of the dialog exactly as the export modal's format note did (#268).
  const labels = [
    'Playhead nudge',
    'Playhead jump',
    'New still or slate duration',
    'When a previous session is found',
    'Default export format',
  ]
  for (const label of labels) {
    const settingRow = row(page, label)
    await expectWithin(settingRow, dialog(page), { what: `row "${label}"` })
    await expectWithin(settingRow.locator('select'), settingRow, {
      what: `control of "${label}"`,
    })
  }

  await expectNoHorizontalScroll(page, 'settings dialog open at 1280px')

  // A narrow, short window: the ⚙ has to remain reachable in the wrapped
  // header, the dialog has to stay inside the viewport (it caps its own
  // height for this reason), and its Close button has to be usable — an
  // unreachable Close on a fixed overlay is a trapped user.
  await page.setViewportSize({ width: 800, height: 420 })
  await expectWithin(dialog(page), page.locator('.dialog-overlay'), {
    what: 'settings dialog at 800x420',
  })
  await expectNoHorizontalScroll(page, 'settings dialog open at 800px')
  // Close without scrolling to it: the rows take the overflow, the dialog's
  // heading and actions do not move. A Close button that needed a scroll
  // *inside* a modal is one a user does not find.
  const close = dialog(page).getByRole('button', { name: 'Close' })
  await expect(close).toBeInViewport()
  await expectWithin(close, dialog(page), { what: 'Close at 800x420' })
  await close.click()
  await expect(dialog(page)).toBeHidden()
})

test('a chosen preference survives a reload, in the store and in its effect (#286)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')

  await openSettings(page)
  await select(page, 'Playhead nudge (← / →)').selectOption('0.25')
  await select(page, 'New still or slate duration').selectOption('10')
  await select(page, 'Default export format').selectOption('mp4')
  await dialog(page).getByRole('button', { name: 'Close' }).click()

  await page.reload()

  // The stored value, in the real browser store under its own key.
  const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)
  expect(stored).not.toBeNull()
  expect(JSON.parse(stored as string)).toMatchObject({
    stepSeconds: 0.25,
    stillDurationSeconds: 10,
    exportFormat: 'mp4',
  })

  // …and the dialog comes up on them after the load.
  await openSettings(page)
  await expect(select(page, 'Playhead nudge (← / →)')).toHaveValue('0.25')
  await expect(select(page, 'Default export format')).toHaveValue('mp4')
  await dialog(page).getByRole('button', { name: 'Close' }).click()

  // The effects, after the reload rather than in the session that set them.
  // (a) The cheat sheet describes the keys as they now behave.
  await page.keyboard.press('?')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toContainText('Step the playhead 0.25 s back / forward')
  await sheet.getByRole('button', { name: 'Close' }).click()

  // (b) A still added now shows for the chosen duration.
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'still.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add still.png to timeline' }).click()
  await expect(
    page.getByRole('spinbutton', { name: 'Duration of still.png at position 1 in seconds' }),
  ).toHaveValue('10')

  // (c) The export modal opens preselected on the chosen format — the one
  // effect no jsdom test can see, because the format list comes from this
  // browser's MediaRecorder (#114).
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const exportModal = page.getByRole('dialog', { name: 'Export project' })
  await expect(exportModal.getByRole('radio', { name: 'MP4' })).toBeChecked()
  // Exact, because "Audio only (WebM/Opus)" also contains "WebM".
  await expect(exportModal.getByRole('radio', { name: 'WebM', exact: true })).not.toBeChecked()
})
