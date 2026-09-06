import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
 *   audio, Rename… and Remove. Items say only what they do: the panel is
 *   named for the clip, and a visible "Add as overlay" under an accessible
 *   name of "Add a.mp4 as overlay" would be a name that does not contain
 *   its own label.
 *
 * What the controls do is unchanged, so the tests that exercise them keep
 * their assertions and only change how they reach the control — these
 * helpers are that change, in one place. `userEvent`, because the library
 * suites drive everything with it.
 *
 * ▶ Preview, Add and the selection controls are still plain buttons and
 * need nothing here.
 */

const clipMenuLabel = (clipName: string) => `More actions for ${clipName}`

/** Opens a row's ⋯ if it is not already open, and returns its panel. */
export async function openClipMenu(clipName: string): Promise<HTMLElement> {
  const label = clipMenuLabel(clipName)
  if (screen.queryByRole('menu', { name: label }) === null) {
    await userEvent.click(screen.getByRole('button', { name: label }))
  }
  return screen.getByRole('menu', { name: label })
}

/** Closes whichever ⋯ is open, if any. Only one menu can be (Menu, #412). */
export async function closeClipMenu(clipName: string): Promise<void> {
  const menu = screen.queryByRole('menu', { name: clipMenuLabel(clipName) })
  if (menu !== null) await userEvent.keyboard('{Escape}')
}

/**
 * A row's ⋯ item, for reading its state or clicking it. Leaves the menu
 * open, so `userEvent.click(await clipMenuItem(…))` is the whole gesture:
 * selecting closes the panel, exactly as clicking the former button did.
 */
export async function clipMenuItem(clipName: string, item: string): Promise<HTMLElement> {
  return within(await openClipMenu(clipName)).getByRole('menuitem', { name: item })
}

/**
 * Whether a row's ⋯ offers `item` — for the per-kind exclusions (no overlay
 * for audio, no extract for anything but video). Leaves the menu closed, so
 * a run of these does not depend on the order they are written in.
 */
export async function queryClipMenuItem(
  clipName: string,
  item: string,
): Promise<HTMLElement | null> {
  const found = within(await openClipMenu(clipName)).queryByRole('menuitem', { name: item })
  await closeClipMenu(clipName)
  return found
}

/** ⋯ → the item; the menu closes on selection. */
export async function chooseClipAction(clipName: string, item: string): Promise<void> {
  await userEvent.click(await clipMenuItem(clipName, item))
}

/** Opens View ▾ if it is not already open, and returns its panel. */
export async function openViewMenu(): Promise<HTMLElement> {
  if (screen.queryByRole('menu', { name: 'View menu' }) === null) {
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
  }
  return screen.getByRole('menu', { name: 'View menu' })
}

/** Closes View ▾ if it is open. */
export async function closeViewMenu(): Promise<void> {
  if (screen.queryByRole('menu', { name: 'View menu' }) !== null) {
    await userEvent.keyboard('{Escape}')
  }
}

/**
 * View ▾'s item for a layout, for reading its checked state. The current
 * choice is `aria-checked` on a `menuitemradio` — what `aria-pressed` on the
 * old toggle buttons said.
 */
export async function viewMenuItem(view: 'List' | 'Thumbnails'): Promise<HTMLElement> {
  return within(await openViewMenu()).getByRole('menuitemradio', { name: view })
}

/**
 * View ▾'s "Sort by" group, or null where it is not offered (one clip or
 * none — the condition the standalone cluster rendered under). Leaves the
 * menu closed.
 */
export async function querySortGroup(): Promise<HTMLElement | null> {
  const found = within(await openViewMenu()).queryByRole('group', { name: 'Sort by' })
  await closeViewMenu()
  return found
}

/** View ▾ → the layout: 'List' or 'Thumbnails'. */
export async function chooseView(view: 'List' | 'Thumbnails'): Promise<void> {
  await userEvent.click(within(await openViewMenu()).getByRole('menuitemradio', { name: view }))
}

/**
 * View ▾ → a sort key: 'Name', 'Type' or 'Length'. Picking the key that is
 * already checked reverses that sort, as re-clicking the pressed button did.
 */
export async function sortClipsBy(key: 'Name' | 'Type' | 'Length'): Promise<void> {
  await userEvent.click(within(await openViewMenu()).getByRole('menuitemradio', { name: key }))
}

/** View ▾'s item for `key`, for reading its checked state and arrow. */
export async function sortMenuItem(key: 'Name' | 'Type' | 'Length'): Promise<HTMLElement> {
  return within(await openViewMenu()).getByRole('menuitemradio', { name: key })
}
