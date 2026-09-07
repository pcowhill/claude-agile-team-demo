import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Reaching the picture treatments that #420 moved under one disclosure
 * (from the approved button redesign #401 / feedback #395 "So Many
 * Buttons").
 *
 * Look/color (#192, #233), orientation (#232), crop (#255) and the row's
 * own fourth group — shape mask on an overlay (#266), background fill on a
 * sequence entry (#259) — were five always-visible rows. They are one
 * collapsed `Picture` disclosure now, so a test that edits any of those
 * controls opens it first. Every field keeps its accessible name and
 * dispatches the same action, so the tests keep their assertions and change
 * only how they reach the control — this helper is that change, in one
 * place.
 *
 * The direct `userEvent` API by default, because the Timeline suite drives
 * everything with it; a suite holding a `userEvent.setup()` instance passes
 * it, as `timelineRowMenu.ts` does for App's (#419).
 */

type Clicker = Pick<ReturnType<typeof userEvent.setup>, 'click'>

const pictureName = (position: string) => `Picture of ${position}`

export const pictureToggle = (position: string): HTMLElement =>
  screen.getByRole('button', { name: pictureName(position) })

export const queryPictureToggle = (position: string): HTMLElement | null =>
  screen.queryByRole('button', { name: pictureName(position) })

export const isPictureOpen = (position: string): boolean =>
  pictureToggle(position).getAttribute('aria-expanded') === 'true'

/** Opens a row's Picture disclosure if it is not already open. */
export async function openPicture(position: string, user: Clicker = userEvent): Promise<void> {
  if (!isPictureOpen(position)) await user.click(pictureToggle(position))
}

/** Closes it if it is open — for asserting what a closed row does not show. */
export async function closePicture(position: string, user: Clicker = userEvent): Promise<void> {
  if (isPictureOpen(position)) await user.click(pictureToggle(position))
}

/**
 * The groups the summary names as applied, in order — `[]` where it names
 * none. Read through `aria-describedby`, which is how the hint reaches a
 * screen reader, so this asserts the wiring as well as the text.
 */
export function appliedPictureGroups(position: string): string[] {
  const describedBy = pictureToggle(position).getAttribute('aria-describedby')
  if (describedBy === null) return []
  const hint = document.getElementById(describedBy)
  if (hint === null) throw new Error(`aria-describedby="${describedBy}" names no element`)
  return (hint.textContent ?? '')
    .replace(/^·\s*/, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}
