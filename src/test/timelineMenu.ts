import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Reaching the timeline header's actions that #418 moved into Add ▾ (from
 * the approved button redesign #401 option T1 / feedback #395).
 *
 * `+ Color slate`, `+ Text` and `Import subtitles…` were top-level buttons
 * named "Add color slate to timeline", "Add text overlay to timeline" and
 * "Import subtitles from an SRT file"; they are menu items now, named for
 * what they add under a menu that supplies the "Add" — "Color slate",
 * "Text overlay", "Subtitles from .srt file…".
 *
 * What they do is unchanged, so the tests that exercise them keep every
 * assertion and only change how they reach the action — this helper is that
 * change, in one place. `userEvent`, because the Timeline suite drives
 * everything with it.
 *
 * Undo, Redo, the ▲ ▼ fold-all pair and Total are still plain controls and
 * need nothing here — the fold-all pair kept its accessible names when it
 * lost its words, so its tests were not touched at all.
 */

/** The three items, by the button each replaced. */
export const ADD_SLATE = 'Color slate'
export const ADD_TEXT = 'Text overlay'
export const IMPORT_SUBTITLES = 'Subtitles from .srt file…'

/** Opens Add ▾ if it is not already open, and returns its panel. */
export async function openAddMenu(): Promise<HTMLElement> {
  if (screen.queryByRole('menu', { name: 'Add menu' }) === null) {
    // No `exact` needed, unlike the Playwright helper: *ByRole's `name`
    // matches a string against the whole accessible name, so this cannot
    // also pick up "Add <clip> to timeline" or "Add transition between …".
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  }
  return screen.getByRole('menu', { name: 'Add menu' })
}

/** Add ▾ → the item; the menu closes on selection. */
export async function chooseFromAddMenu(item: string): Promise<void> {
  const menu = await openAddMenu()
  await userEvent.click(screen.getByRole('menuitem', { name: item }))
  // Selection closes the panel; asserting it keeps a later query from
  // finding a control the still-open menu is covering.
  if (menu.isConnected) throw new Error(`Add ▾ stayed open after choosing "${item}"`)
}

/** Escape closes the menu, returning focus to the trigger. */
export async function closeAddMenu(): Promise<void> {
  if (screen.queryByRole('menu', { name: 'Add menu' }) !== null) {
    await userEvent.keyboard('{Escape}')
  }
}

/**
 * The "Subtitle style" disclosure (#418), which replaced the always-visible
 * style row: absent until the timeline has a text overlay to restyle, and
 * collapsed until opened. Returns its toggle button.
 */
export const subtitleStyleToggle = (): HTMLElement =>
  screen.getByRole('button', { name: 'Subtitle style' })

export const querySubtitleStyleToggle = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'Subtitle style' })

/** Opens the disclosure if it is closed, so the style fields are rendered. */
export async function openSubtitleStyle(): Promise<void> {
  const toggle = subtitleStyleToggle()
  if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(toggle)
}
