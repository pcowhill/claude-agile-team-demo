import { expect, test } from '@playwright/test'

/**
 * Transport keyboard shortcuts (#203), exercised media-free with a slate:
 * Space play/pause against the real rAF clock, arrow stepping read back off
 * the seek slider, the focus guard (typing a space into a number input must
 * not toggle playback), and the ? cheat-sheet overlay.
 */

/** Clears button focus after a click, so Space reaches the transport. */
const blurActive = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

test('space plays and pauses; arrows, Home and End move the playhead', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await blurActive(page)

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // Arrow stepping: 0.1s per press, 1s with Shift, clamped at the start.
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveValue('0.1')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(seek).toHaveValue('1.1')
  await page.keyboard.press('ArrowLeft')
  await expect(seek).toHaveValue('1')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(seek).toHaveValue('0')

  // End / Home jump across the 5s slate.
  await page.keyboard.press('End')
  await expect(seek).toHaveValue('5')
  await page.keyboard.press('Home')
  await expect(seek).toHaveValue('0')

  // Space plays: the control flips to Pause and the slate's wall clock
  // advances the published position. Space again pauses and freezes it.
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(0)
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()
  const frozen = await seek.inputValue()
  await page.waitForTimeout(200)
  await expect(seek).toHaveValue(frozen)
})

test('space typed into a number input edits the field, never the transport', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.focus()
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()
})

test('? opens the shortcut cheat sheet; Escape closes it', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await blurActive(page)

  await page.keyboard.press('Shift+?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Play / pause the preview')
  await expect(dialog).toContainText('Undo the last timeline edit')

  // While the sheet is open the transport is inert like under any modal.
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})
