import { expect, test } from '@playwright/test'
import { expectWithin } from './layout'

type Locator = import('@playwright/test').Locator

/**
 * Export-modal format-picker layout (#268): the selected format's note must
 * render on its own line below the radio options, and the picker must stay
 * within the dialog's bounds however many formats are registered — the GIF
 * plugin (#198) adds a fourth radio plus the longest note the picker shows,
 * which is exactly the configuration the customer's screenshots broke in
 * (#264, #265). Real rendered geometry, so this runs in the browser.
 */

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test('the format note sits below the radios and the picker stays inside the dialog (#268)', async ({
  page,
}) => {
  await page.goto('./')

  // Enable the GIF plugin: the fullest picker the product can show.
  await page.getByRole('button', { name: 'Plugins…' }).click()
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  const options = dialog.locator('.export-format-option')
  expect(await options.count()).toBeGreaterThanOrEqual(3)

  // Both formats that state a note: the audio-only line (#264's screenshot)
  // and the GIF plugin's caps (#265's).
  const cases: { radio: string; note: RegExp }[] = [
    { radio: 'Audio only (WebM/Opus)', note: /Saves just the mixed soundtrack/ },
    { radio: 'Animated GIF', note: /soundless and sample at 10 fps/ },
  ]
  for (const { radio, note } of cases) {
    await dialog.getByRole('radio', { name: radio }).check()
    const noteText = dialog.getByText(note)
    await expect(noteText).toBeVisible()

    const noteBox = await boxOf(noteText)
    for (const [index, option] of (await options.all()).entries()) {
      const optionBox = await boxOf(option)
      // Below every radio option, not beside any of them…
      expect(noteBox.y).toBeGreaterThanOrEqual(optionBox.y + optionBox.height - 1)
      // …and every option inside the dialog's horizontal bounds. Horizontal
      // only: the dialog scrolls vertically on purpose when the settings
      // fieldset is long, so asserting the vertical edges would fail on
      // correct layout.
      await expectWithin(option, dialog, { axis: 'x', what: `format option ${index}` })
    }
    // The note itself stays inside the dialog too — the half #265's
    // screenshot showed hanging out of it.
    await expectWithin(noteText, dialog, { axis: 'x', what: `${radio} note` })
  }
})
