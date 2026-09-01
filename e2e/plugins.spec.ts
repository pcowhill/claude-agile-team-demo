import { expect, test } from '@playwright/test'

/**
 * The plugin manager (#197, ADR 0003): toggling a plugin through the real
 * chain — the manager UI, the lazy chunk actually fetched over the dev
 * server, activation into the export-format registry, live appearance in the
 * export picker, deactivation on disable — and startup re-activation from
 * the persisted enabled set after a reload.
 */

/** Opens the manager and toggles the sample plugin to the wanted state. */
async function setSamplePlugin(page: import('@playwright/test').Page, enabled: boolean) {
  await page.getByRole('button', { name: 'Plugins…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page
    .getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Sample plugin` })
    .click()
  // The toggle flips only after the chunk loads and activate ran (or the
  // deactivate unregistered) — this wait is the real proof of the chain.
  await expect(
    page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Sample plugin` }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** Opens the export modal (a slate makes the timeline exportable). */
async function openExportModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('dialog', { name: 'Export project' })).toBeVisible()
}

test('enabling the sample plugin adds its export format; disabling removes it', async ({
  page,
}) => {
  await page.goto('./')

  // The manager lists the sample plugin, disabled by default.
  await page.getByRole('button', { name: 'Plugins…' }).click()
  await expect(page.getByText('Sample plugin')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable Sample plugin' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  // Before enabling: the export picker offers the core formats only.
  await openExportModal(page)
  await expect(page.getByRole('radio', { name: 'WebM', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Sample (WebM)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Enable → the contributed format appears in the picker, live.
  await setSamplePlugin(page, true)
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('radio', { name: 'Sample (WebM)' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Disable → the format leaves the picker again.
  await setSamplePlugin(page, false)
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('dialog', { name: 'Export project' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Sample (WebM)' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'WebM', exact: true })).toBeVisible()
})

test('the enabled set persists and re-activates on startup after a reload', async ({ page }) => {
  await page.goto('./')
  await setSamplePlugin(page, true)

  await page.reload()

  // No manager interaction after the reload: the persisted set re-activated
  // at startup, so the contributed format is simply there.
  await openExportModal(page)
  await expect(page.getByRole('radio', { name: 'Sample (WebM)' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Plugins…' }).click()
  await expect(page.getByRole('button', { name: 'Disable Sample plugin' })).toBeVisible()
})
