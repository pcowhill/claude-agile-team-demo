import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the preview's layout choice, which #667 (from the customer's
 * #660) moved from the Expand / Restore size button into a View ▾ menu in
 * the Preview header, adding Fit to width. What Default and Expanded do is
 * unchanged, so the specs that exercise them keep their assertions and only
 * change how they reach the control — these helpers are that change, in one
 * place, as `frameMenu.ts` is for Frame ▾.
 *
 * The trigger reads "View", like the media library's View ▾; its accessible
 * name is "Preview view", so the two never collide in a page-wide query.
 */
export type PreviewLayoutName = 'Default' | 'Expanded' | 'Fit to width'

export const previewViewTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: 'Preview view', exact: true })
export const previewViewMenu = (page: Page): Locator =>
  page.getByRole('menu', { name: 'Preview view menu' })

/** Opens the Preview's View ▾ and returns its panel, visible. */
export async function openPreviewView(page: Page): Promise<Locator> {
  await previewViewTrigger(page).click()
  const menu = previewViewMenu(page)
  await expect(menu).toBeVisible()
  return menu
}

/** View ▾ → `layout`; waits for the menu to close on selection. */
export async function choosePreviewLayout(page: Page, layout: PreviewLayoutName): Promise<void> {
  const menu = await openPreviewView(page)
  await menu.getByRole('menuitemradio', { name: layout, exact: true }).click()
  await expect(menu).toHaveCount(0)
}

/** Asserts View ▾ has `layout` checked, then closes the menu unchanged. */
export async function expectPreviewLayout(page: Page, layout: PreviewLayoutName): Promise<void> {
  const menu = await openPreviewView(page)
  await expect(menu.getByRole('menuitemradio', { name: layout, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
}
