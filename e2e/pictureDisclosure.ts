import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Reaching the picture treatments that #420 moved under one disclosure
 * (from the approved button redesign #401 / feedback #395 "So Many
 * Buttons").
 *
 * Look/color (#192, #233), orientation (#232), crop (#255) and the row's
 * own fourth group — shape mask on an overlay (#266), background fill on a
 * sequence entry (#259) — were five always-visible rows on every expanded
 * video/image entry and overlay. They are one collapsed `Picture`
 * disclosure now, so a spec that touches any of those controls opens it
 * first and keeps every assertion it had.
 */

const pictureName = (position: string) => `Picture of ${position}`

// `exact`, for the reason `timelineRowMenu.ts` spells out: Playwright
// matches an accessible name by substring, and one position string is
// routinely a prefix of another ("… at position 1" of "… at position 10").
export const pictureToggle = (page: Page, position: string): Locator =>
  page.getByRole('button', { name: pictureName(position), exact: true })

/** Opens a row's Picture disclosure if it is not already open. */
export async function openPicture(page: Page, position: string): Promise<void> {
  const toggle = pictureToggle(page, position)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

/** Closes it if it is open. */
export async function closePicture(page: Page, position: string): Promise<void> {
  const toggle = pictureToggle(page, position)
  if ((await toggle.getAttribute('aria-expanded')) === 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  }
}

/**
 * The groups the summary names as applied, in order — `[]` where it names
 * none. Read through `aria-describedby`, which is how the hint reaches a
 * screen reader, so this asserts the wiring as well as the text.
 */
export async function appliedPictureGroups(page: Page, position: string): Promise<string[]> {
  const describedBy = await pictureToggle(page, position).getAttribute('aria-describedby')
  if (describedBy === null) return []
  const text = await page.locator(`[id="${describedBy}"]`).textContent()
  return (text ?? '')
    .replace(/^·\s*/, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}
