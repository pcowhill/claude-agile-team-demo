import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Reaching the header actions that #415 moved into File ▾ (from the approved
 * button redesign #401 / feedback #395).
 *
 * New Project, Open Project…, Save As…, Plugins… and Settings… were top-level
 * buttons; they are menu items now. What they do is unchanged, so the specs
 * that exercise them keep every assertion and only change how they reach the
 * action — this helper is that change, in one place.
 *
 * Save (💾) and Export Project… are still buttons and need nothing from here.
 */
export async function chooseFromFileMenu(page: Page, name: string): Promise<void> {
  // Exact: "File" is a substring of Add ▾'s "Subtitles from .srt file…"
  // (#418), which is where the SRT import went — and accessible-name
  // matching is case-insensitive, so the lowercase "file" matches too.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'File menu' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name, exact: true }).click()
  // The menu closes on selection; waiting for that keeps a later click from
  // landing on the panel while it is still up.
  await expect(menu).toHaveCount(0)
}

/**
 * File ▾ → Export ▸ → a format, the path #415 added for starting an export
 * on a chosen format. The submenu opens on hover as well as on click, so the
 * click here is the keyboard-equivalent entry rather than the only one.
 */
export async function chooseExportFormat(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
  const submenu = page.getByRole('menu', { name: 'Export' })
  await expect(submenu).toBeVisible()
  await submenu.getByRole('menuitem', { name: label, exact: true }).click()
  await expect(submenu).toHaveCount(0)
}
