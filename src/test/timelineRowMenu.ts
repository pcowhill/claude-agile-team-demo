import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Reaching the timeline actions that #419 moved behind menus (from the
 * approved button redesign #401 / feedback #395 "So Many Buttons").
 *
 * Every row's ⧉ Duplicate, ⎘ Copy settings, ⎗ Paste settings and ✎ Rename
 * were top-level buttons named for the row — "Duplicate <position>", "Copy
 * settings of <position>", "Paste settings onto <position>", "Rename
 * <position>". They are items in that row's ⋯ menu now, named for what
 * they do under a panel named for the row. ▾ ↑ ↓ ✕ are untouched and need
 * nothing from here.
 *
 * An expanded sequence entry's + Zoom, + Speed and + Pause are likewise
 * items of one "+ Effect ▾" menu — and, being items, they carry their
 * disabled state where their buttons did, which is why `effectItem` exists
 * alongside `chooseEffect`.
 *
 * What all of them do is unchanged, so the tests that exercised the buttons
 * keep every assertion and change only how they reach the action — this
 * helper is that change, in one place. The direct `userEvent` API by
 * default, because the Timeline suite drives everything with it; a suite
 * holding a `userEvent.setup()` instance passes it, as `fileMenu.ts` does
 * for App's (#415).
 */

type Clicker = Pick<ReturnType<typeof userEvent.setup>, 'click'>

/** The ⋯ items, by the button each replaced. */
export const DUPLICATE = 'Duplicate'
export const COPY_SETTINGS = 'Copy settings'
export const PASTE_SETTINGS = 'Paste settings'
export const RENAME = 'Rename…'

/** The + Effect ▾ items, likewise. */
export const ADD_ZOOM = 'Zoom'
export const ADD_SPEED = 'Speed segment'
export const ADD_PAUSE = 'Pause'

const rowMenuName = (position: string) => `More actions for ${position}`
const effectMenuName = (position: string) => `+ Effect on ${position}`

export const rowMenuTrigger = (position: string): HTMLElement =>
  screen.getByRole('button', { name: rowMenuName(position) })

export const queryRowMenuTrigger = (position: string): HTMLElement | null =>
  screen.queryByRole('button', { name: rowMenuName(position) })

/** Opens a row's ⋯ if it is not already open, and returns its panel. */
export async function openRowMenu(
  position: string,
  user: Clicker = userEvent,
): Promise<HTMLElement> {
  if (screen.queryByRole('menu', { name: rowMenuName(position) }) === null) {
    await user.click(rowMenuTrigger(position))
  }
  return screen.getByRole('menu', { name: rowMenuName(position) })
}

/** The labels a row's ⋯ offers, in order — separators are not items. */
export async function rowMenuItems(position: string): Promise<(string | null)[]> {
  const menu = await openRowMenu(position)
  return within(menu)
    .queryAllByRole('menuitem')
    .map((item) => item.textContent)
}

/** One item of a row's ⋯, or null where the row does not offer it. */
export async function queryRowAction(position: string, item: string): Promise<HTMLElement | null> {
  const menu = await openRowMenu(position)
  return within(menu).queryByRole('menuitem', { name: item })
}

/** A row's ⋯ → the item; the menu closes on selection. */
export async function chooseRowAction(
  position: string,
  item: string,
  user: Clicker = userEvent,
): Promise<void> {
  const menu = await openRowMenu(position, user)
  await user.click(within(menu).getByRole('menuitem', { name: item }))
  // Selection closes the panel; asserting it keeps a later query from
  // finding a control the still-open menu is covering.
  if (menu.isConnected) {
    throw new Error(`the ⋯ for ${position} stayed open after choosing "${item}"`)
  }
}

/** Escape closes an open ⋯, returning focus to its trigger. */
export async function closeRowMenu(position: string): Promise<void> {
  if (screen.queryByRole('menu', { name: rowMenuName(position) }) !== null) {
    await userEvent.keyboard('{Escape}')
  }
}

export const effectMenuTrigger = (position: string): HTMLElement =>
  screen.getByRole('button', { name: effectMenuName(position) })

export const queryEffectMenuTrigger = (position: string): HTMLElement | null =>
  screen.queryByRole('button', { name: effectMenuName(position) })

/** Opens an entry's + Effect ▾ if it is not already open. */
export async function openEffectMenu(position: string): Promise<HTMLElement> {
  if (screen.queryByRole('menu', { name: effectMenuName(position) }) === null) {
    await userEvent.click(effectMenuTrigger(position))
  }
  return screen.getByRole('menu', { name: effectMenuName(position) })
}

/**
 * One + Effect ▾ item, with the menu left open — the disabled state its
 * button used to carry is on the item, so a test that read `toBeDisabled()`
 * off the button reads it off this.
 */
export async function effectItem(position: string, item: string): Promise<HTMLElement> {
  const menu = await openEffectMenu(position)
  return within(menu).getByRole('menuitem', { name: item })
}

export async function queryEffectItem(position: string, item: string): Promise<HTMLElement | null> {
  const menu = await openEffectMenu(position)
  return within(menu).queryByRole('menuitem', { name: item })
}

/** The labels + Effect ▾ offers, in order. */
export async function effectMenuItems(position: string): Promise<(string | null)[]> {
  const menu = await openEffectMenu(position)
  return within(menu)
    .queryAllByRole('menuitem')
    .map((item) => item.textContent)
}

/** + Effect ▾ → the item; the menu closes on selection. */
export async function chooseEffect(position: string, item: string): Promise<void> {
  const menu = await openEffectMenu(position)
  await userEvent.click(within(menu).getByRole('menuitem', { name: item }))
  if (menu.isConnected) {
    throw new Error(`+ Effect ▾ on ${position} stayed open after choosing "${item}"`)
  }
}

/** Escape closes an open + Effect ▾. */
export async function closeEffectMenu(position: string): Promise<void> {
  if (screen.queryByRole('menu', { name: effectMenuName(position) }) !== null) {
    await userEvent.keyboard('{Escape}')
  }
}
