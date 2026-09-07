import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the timeline header's actions that #418 moved into Add ▾ (from
 * the approved button redesign #401 option T1 / feedback #395).
 *
 * `+ Color slate`, `+ Text` and `Import subtitles…` were top-level buttons
 * named "Add color slate to timeline", "Add text overlay to timeline" and
 * "Import subtitles from an SRT file"; they are menu items now, named for
 * what they add under a menu that supplies the "Add".
 *
 * What they do is unchanged, so the specs that exercise them keep every
 * assertion and only change how they reach the action — this helper is that
 * change, in one place.
 *
 * Undo, Redo and Total need nothing here, and neither does the ▲ ▼ fold-all
 * pair: it kept the accessible names its words used to duplicate, so
 * `timeline-collapse.spec.ts` and `timeline-sections.spec.ts` are untouched.
 */

/** The three items, by the button each replaced. */
export const ADD_SLATE = 'Color slate'
export const ADD_TEXT = 'Text overlay'
export const IMPORT_SUBTITLES = 'Subtitles from .srt file…'

// Exact: "Add" is a substring of the media library's "Add <clip> to
// timeline" and of the timeline's own "Add transition between 1 and 2".
export const addMenuTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: 'Add', exact: true })

export const addMenu = (page: Page): Locator => page.getByRole('menu', { name: 'Add menu' })

/** Opens Add ▾ and returns its panel, visible. */
export async function openAddMenu(page: Page): Promise<Locator> {
  await addMenuTrigger(page).click()
  const menu = addMenu(page)
  await expect(menu).toBeVisible()
  return menu
}

/** Add ▾ → the item; waits for the menu to close on selection. */
export async function chooseFromAddMenu(page: Page, item: string): Promise<void> {
  const menu = await openAddMenu(page)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
  // The menu closes on selection; waiting for that keeps a later click from
  // landing on the panel while it is still up.
  await expect(menu).toHaveCount(0)
}

/**
 * Add ▾ → Subtitles from .srt file…, and the file the picker it opens
 * receives. The item clicks the same hidden input the button did, so the
 * spec sets the files on that input rather than handling a chooser — the
 * click is needed anyway, because it is what opens the style disclosure.
 */
export async function importSubtitles(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await chooseFromAddMenu(page, IMPORT_SUBTITLES)
  await page.getByTestId('subtitle-file-input').setInputFiles(file)
}

/**
 * The "Subtitle style" disclosure (#418), which replaced the always-visible
 * style row: absent until the timeline has a text overlay to restyle, and
 * collapsed until opened — except right after an import, which opens it.
 */
// Exact: Playwright matches an accessible name by substring, and
// "Subtitle style" is one of "Reset default subtitle style" — the Reset
// button inside the disclosure it opens, so the loose match resolves to
// both and fails strict mode.
export const subtitleStyleToggle = (page: Page): Locator =>
  page.getByRole('button', { name: 'Subtitle style', exact: true })

/** Opens the disclosure if it is closed, so the style fields are rendered. */
export async function openSubtitleStyle(page: Page): Promise<void> {
  const toggle = subtitleStyleToggle(page)
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}
