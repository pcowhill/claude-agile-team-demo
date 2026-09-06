import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the preview transport's frame actions that #417 moved into
 * Frame ▾ (from the approved button redesign #401 / feedback #395).
 *
 * Split, Save frame and both Freeze frame placements were top-level buttons;
 * they are menu items now, under the same test ids (`preview-split`,
 * `preview-save-frame`, `preview-freeze-frame` for split & hold, and
 * `preview-freeze-frame-append`). What they do is unchanged, so the specs
 * that exercise them keep their assertions and only change how they reach
 * the control — these helpers are that change, in one place.
 *
 * ⇥ Mark in / ⇤ Mark out and ✕ Marks are still buttons and need nothing here.
 */
export const frameMenuTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: 'Frame', exact: true })
export const frameMenu = (page: Page): Locator => page.getByRole('menu', { name: 'Frame menu' })

/** Opens Frame ▾ and returns its panel, visible. */
export async function openFrameMenu(page: Page): Promise<Locator> {
  await frameMenuTrigger(page).click()
  const menu = frameMenu(page)
  await expect(menu).toBeVisible()
  return menu
}

/** Frame ▾ → the item with `testId`; waits for the menu to close on selection. */
export async function chooseFromFrameMenu(page: Page, testId: string): Promise<void> {
  const menu = await openFrameMenu(page)
  await page.getByTestId(testId).click()
  // The menu closes on selection; waiting for that keeps a later click from
  // landing on the panel while it is still up.
  await expect(menu).toHaveCount(0)
}

/**
 * Closes an open Frame ▾ with Escape and blurs the trigger it hands focus
 * back to. The blur matters: a focused button claims the transport keys
 * (`targetClaimsKeys`), so a spec that presses an arrow or a letter right
 * after reading an item's state would otherwise press it into the button.
 */
export async function closeFrameMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(frameMenu(page)).toHaveCount(0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
}

/**
 * Reads whether Frame ▾'s item is enabled, leaving the menu closed and the
 * transport keys free afterwards — for the specs that use Split's disabled
 * state as the "exactly on a boundary" check (#391).
 */
export async function expectFrameItemEnabled(
  page: Page,
  testId: string,
  enabled: boolean,
): Promise<void> {
  await openFrameMenu(page)
  const item = page.getByTestId(testId)
  if (enabled) await expect(item).toBeEnabled()
  else await expect(item).toBeDisabled()
  await closeFrameMenu(page)
}
