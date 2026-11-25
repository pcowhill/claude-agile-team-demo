import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * After a click on **Disable `name`** in the Plugins dialog: answers the
 * confirmation the manager shows when the open project uses the plugin
 * (#953), and returns once the toggle reads **Enable `name`**. On a project
 * that does not use the plugin there is no confirmation, and this only
 * waits for the toggle. Either the confirmation or the flipped toggle
 * appears, never neither, so the wait is deterministic.
 */
export async function confirmDisableIfAsked(page: Page, name: string): Promise<void> {
  const confirm = page.getByRole('dialog', { name: `Disable ${name}?` })
  const flipped = page.getByRole('button', { name: `Enable ${name}` })
  await expect(confirm.or(flipped)).toBeVisible()
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Disable', exact: true }).click()
  await expect(flipped).toBeVisible()
}
