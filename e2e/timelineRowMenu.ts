import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the timeline actions that #419 moved behind menus (from the
 * approved button redesign #401 / feedback #395 "So Many Buttons").
 *
 * - **⋯ per row** (`More actions for <position>`) — Duplicate, Copy
 *   settings, Paste settings and Rename…, which were buttons named for the
 *   row ("Duplicate <position>", "Rename <position>", …). ▾ ↑ ↓ ✕ stayed
 *   inline and need nothing from here.
 * - **+ Effect ▾** on an expanded sequence entry (`+ Effect on <position>`)
 *   — Zoom, Speed segment and Pause, which were + Zoom, + Speed and
 *   + Pause. Their disabled state moved onto the items, so a spec that read
 *   it off a button reads it off `effectItem`.
 *
 * What the controls do is unchanged, so the specs that exercised them keep
 * their assertions and only change how they reach the control — these
 * helpers are that change, in one place.
 */

const rowMenuLabel = (position: string) => `More actions for ${position}`
const effectMenuLabel = (position: string) => `+ Effect on ${position}`

// `exact`, because Playwright matches an accessible name by substring by
// default and a position string is routinely a prefix of another: "audio
// track m.mp3 at position 1" and "… at position 10" would both match, and
// a renamed element can make one row's name a prefix of another's.
export const rowMenuTrigger = (page: Page, position: string): Locator =>
  page.getByRole('button', { name: rowMenuLabel(position), exact: true })

export const rowMenu = (page: Page, position: string): Locator =>
  page.getByRole('menu', { name: rowMenuLabel(position), exact: true })

/** Opens a row's ⋯ and returns its panel, visible. */
export async function openRowMenu(page: Page, position: string): Promise<Locator> {
  await rowMenuTrigger(page, position).click()
  const menu = rowMenu(page, position)
  await expect(menu).toBeVisible()
  return menu
}

/** A row's ⋯ → the item; waits for the menu to close on selection. */
export async function chooseRowAction(
  page: Page,
  position: string,
  item: string,
): Promise<void> {
  const menu = await openRowMenu(page, position)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
  // The menu closes on selection; waiting for that keeps a later click from
  // landing on the panel while it is still up.
  await expect(menu).toHaveCount(0)
}

export const effectMenuTrigger = (page: Page, position: string): Locator =>
  page.getByRole('button', { name: effectMenuLabel(position), exact: true })

export const effectMenu = (page: Page, position: string): Locator =>
  page.getByRole('menu', { name: effectMenuLabel(position), exact: true })

/** Opens an entry's + Effect ▾ and returns its panel, visible. */
export async function openEffectMenu(page: Page, position: string): Promise<Locator> {
  await effectMenuTrigger(page, position).click()
  const menu = effectMenu(page, position)
  await expect(menu).toBeVisible()
  return menu
}

/**
 * One + Effect ▾ item, with the menu left open — for reading the disabled
 * state that used to sit on + Zoom / + Speed / + Pause.
 */
export async function effectItem(
  page: Page,
  position: string,
  item: string,
): Promise<Locator> {
  const menu = await openEffectMenu(page, position)
  return menu.getByRole('menuitem', { name: item, exact: true })
}

/** + Effect ▾ → the item; waits for the menu to close on selection. */
export async function chooseEffect(page: Page, position: string, item: string): Promise<void> {
  const menu = await openEffectMenu(page, position)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
  await expect(menu).toHaveCount(0)
}
