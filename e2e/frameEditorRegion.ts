type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Clicks a visual editor's region the way a person does, so the keys that
 * follow reach it through the focus the press gives it (#662).
 *
 * Not `locator.focus()`: that is how every editor spec reached its keyboard
 * nudges until #662, and it is exactly what hid the bug — the region's drag
 * handler cancels the browser's focus-on-press, so a real click left focus
 * on <body> and no key did anything, while `focus()` went around the press
 * and passed. Not `locator.click()` either: a spotlight's silhouette and a
 * handle can sit over parts of the rectangle, and the point is to press
 * wherever a person would, so this presses the middle of the part of the
 * region that is drawn (clipped to the frame, as `crop-editor.spec.ts`'s
 * `grabPointOf` does for a handle) and lets the browser decide what is hit.
 * A press without movement commits nothing (`visual-editors.md`, "What
 * commits as an edit"), so it adds no undo step of its own.
 */
export async function clickRegion(page: Page, region: Locator) {
  await region.scrollIntoViewIfNeeded()
  const point = await region.evaluate((rect) => {
    const own = rect.getBoundingClientRect()
    const frame = rect.closest('.frame-editor-frame')!.getBoundingClientRect()
    const left = Math.max(own.left, frame.left)
    const right = Math.min(own.right, frame.right)
    const top = Math.max(own.top, frame.top)
    const bottom = Math.min(own.bottom, frame.bottom)
    return { x: (left + right) / 2, y: (top + bottom) / 2 }
  })
  await page.mouse.click(point.x, point.y)
}
