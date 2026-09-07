import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the media library's controls that #416 moved into menus (from
 * the approved button redesign #401 option L1 / feedback #395).
 *
 * Two menus replaced five header controls and three per-row buttons:
 *
 * - **View ▾** — the layout radio group (List / Thumbnails, #311) and, with
 *   more than one clip, the Sort by group (Name / Type / Length, #123).
 *   The old controls were named "List view", "Thumbnail view" and "Sort by
 *   name"; the items are named for their place in a labelled group, so they
 *   read "List", "Thumbnails", "Name".
 * - **⋯ per row** (`More actions for <name>`) — Add as overlay, Extract
 *   audio, Rename… and Remove.
 *
 * What the controls do is unchanged, so the specs that exercise them keep
 * their assertions and only change how they reach the control — these
 * helpers are that change, in one place.
 *
 * ▶ Preview, Add and the selection controls are still plain buttons and
 * need nothing here.
 */

const clipMenuLabel = (clipName: string) => `More actions for ${clipName}`

// `exact`, because Playwright matches an accessible name by substring by
// default and one clip's name is routinely a prefix of another's: an
// extracted clip is "tone.webm (audio)" beside its source "tone.webm"
// (#154), so the loose match resolves to both rows' ⋯ and fails strict mode.
export const clipMenuTrigger = (page: Page, clipName: string): Locator =>
  page.getByRole('button', { name: clipMenuLabel(clipName), exact: true })

export const clipMenu = (page: Page, clipName: string): Locator =>
  page.getByRole('menu', { name: clipMenuLabel(clipName), exact: true })

/** Opens a row's ⋯ and returns its panel, visible. */
export async function openClipMenu(page: Page, clipName: string): Promise<Locator> {
  await clipMenuTrigger(page, clipName).click()
  const menu = clipMenu(page, clipName)
  await expect(menu).toBeVisible()
  return menu
}

/** ⋯ → the item; waits for the menu to close on selection. */
export async function chooseClipAction(page: Page, clipName: string, item: string): Promise<void> {
  const menu = await openClipMenu(page, clipName)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
  // The menu closes on selection; waiting for that keeps a later click from
  // landing on the panel while it is still up.
  await expect(menu).toHaveCount(0)
}

export const viewMenuTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: 'View', exact: true })

export const viewMenu = (page: Page): Locator => page.getByRole('menu', { name: 'View menu' })

/** Opens View ▾ and returns its panel, visible. */
export async function openViewMenu(page: Page): Promise<Locator> {
  await viewMenuTrigger(page).click()
  const menu = viewMenu(page)
  await expect(menu).toBeVisible()
  return menu
}

/**
 * View ▾'s item for a layout, for reading its checked state. The current
 * choice is `aria-checked` on a `menuitemradio` — what `aria-pressed` on the
 * old toggle buttons said. The caller opens the menu first.
 */
export const viewMenuItem = (page: Page, view: 'List' | 'Thumbnails'): Locator =>
  viewMenu(page).getByRole('menuitemradio', { name: view, exact: true })

/**
 * Asserts which layout View ▾ has checked, leaving the menu closed — the
 * `aria-pressed` reading the two toggle buttons used to offer inline.
 */
export async function expectViewChecked(
  page: Page,
  view: 'List' | 'Thumbnails',
): Promise<void> {
  const menu = await openViewMenu(page)
  await expect(viewMenuItem(page, view)).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
}

/** View ▾ → the layout: 'List' or 'Thumbnails'. */
export async function chooseView(page: Page, view: 'List' | 'Thumbnails'): Promise<void> {
  const menu = await openViewMenu(page)
  await menu.getByRole('menuitemradio', { name: view, exact: true }).click()
  await expect(menu).toHaveCount(0)
}

/**
 * View ▾ → a sort key: 'Name', 'Type' or 'Length'. Picking the key that is
 * already checked reverses that sort, as re-clicking the pressed button did.
 */
export async function sortClipsBy(
  page: Page,
  key: 'Name' | 'Type' | 'Length',
): Promise<void> {
  const menu = await openViewMenu(page)
  await menu.getByRole('menuitemradio', { name: key, exact: true }).click()
  await expect(menu).toHaveCount(0)
}
