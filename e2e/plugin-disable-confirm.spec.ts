import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { expectWithin } from './layout'
import { chooseEffect } from './timelineRowMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * Disabling a plugin the open project uses asks first (#953, from the
 * customer's #951): the confirmation names the plugin, says how many times
 * the project uses it and what those uses are, and says that disabling
 * removes nothing. A plugin the project does not use disables at once.
 *
 * Measured on a populated project, as `development.md` asks of a layout
 * measurement: two slates with a Vignette and a Blur on the first and a
 * Box open transition between them, so the confirmation carries its longest
 * realistic sentence over a Plugins dialog listing every plugin.
 */

const FIRST = 'Color slate at position 1'

async function plugins(page: Page): Promise<Locator> {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Two slates, two Visual effects on the first, and a Shaped wipes transition between them. */
async function populated(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  const dialog = await plugins(page)
  for (const name of ['Visual effects', 'Shaped wipes', 'GIF export']) {
    await dialog.getByRole('button', { name: `Enable ${name}` }).click()
    await expect(dialog.getByRole('button', { name: `Disable ${name}` })).toBeVisible()
  }
  await dialog.getByRole('button', { name: 'Close' }).click()
  await chooseEffect(page, FIRST, 'Vignette')
  await chooseEffect(page, FIRST, 'Blur')
  await expect(page.getByTestId('picture-effect-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption({ label: 'Box open' })
}

/**
 * The confirmation lies inside the viewport, and it is on top: the points
 * just inside each of its corners, and its centre, hit the confirmation
 * itself rather than the Plugins dialog under it. `elementFromPoint` reads
 * what a click there would reach, which is what "not clipped by the Plugins
 * dialog" means for the user.
 */
async function expectOnTop(page: Page, confirm: Locator, what: string) {
  await expectWithin(confirm, page.locator('body'), { what })
  const hits = await confirm.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const inset = 4
    const points = [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
      [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
    ]
    return points.map(([x, y]) => element.contains(document.elementFromPoint(x, y)))
  })
  expect(hits, `${what}: its corners and centre reach the confirmation`).toEqual([true, true, true, true, true])
}

test.describe('Disabling a plugin the project uses asks first (#953)', () => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 740 },
  ]) {
    test(`asks with the count, Cancel keeps the plugin, Disable disables it, an unused plugin disables at once: ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await populated(page)
      const dialog = await plugins(page)

      // Visual effects, used twice: the confirmation, on top, inside the window.
      await dialog.getByRole('button', { name: 'Disable Visual effects' }).click()
      const confirm = page.getByRole('dialog', { name: 'Disable Visual effects?' })
      await expect(confirm).toContainText(
        "This project uses Visual effects 2 times: 2 picture effects. Disabling removes nothing: while the plugin is off, an effect's row is named (unavailable), and the picture shows without it.",
      )
      await expectOnTop(page, confirm, `the Visual effects confirmation at ${viewport.width}px`)
      await testInfo.attach(`confirm-${viewport.width}.png`, { body: await page.screenshot(), contentType: 'image/png' })

      // Cancel: still enabled, and the Plugins dialog is still open behind it.
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirm).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Disable Visual effects' })).toBeFocused()

      // Disable: the plugin goes off, and the effect rows stay, unavailable.
      await dialog.getByRole('button', { name: 'Disable Visual effects' }).click()
      await confirm.getByRole('button', { name: 'Disable' }).click()
      await expect(confirm).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Enable Visual effects' })).toBeFocused()

      // Shaped wipes, used once.
      await dialog.getByRole('button', { name: 'Disable Shaped wipes' }).click()
      const wipes = page.getByRole('dialog', { name: 'Disable Shaped wipes?' })
      await expect(wipes).toContainText('This project uses Shaped wipes once: 1 transition.')
      await expectOnTop(page, wipes, `the Shaped wipes confirmation at ${viewport.width}px`)
      await wipes.getByRole('button', { name: 'Disable' }).click()
      await expect(dialog.getByRole('button', { name: 'Enable Shaped wipes' })).toBeVisible()

      // GIF export: no project depends on it, so it disables at once.
      await dialog.getByRole('button', { name: 'Disable GIF export' }).click()
      await expect(dialog.getByRole('button', { name: 'Enable GIF export' })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(1)

      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(page.getByTestId('picture-effect-row')).toHaveCount(2)
      await expect(page.getByTestId('picture-effect-row').first()).toContainText('(unavailable)')
    })
  }
})
