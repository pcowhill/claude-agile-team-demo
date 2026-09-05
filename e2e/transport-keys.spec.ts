import { expect, test } from '@playwright/test'
import { expectWithin } from './layout'

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

  // The guard against #287's mid-combo wrap returning (#349), as two checks
  // that #349's measurements showed are the discriminating pair — a naive
  // single-line assertion passes on every reversion of the defect, because
  // no current combo is wide enough to wrap inside its 45% column while the
  // dialog sits at its width cap:
  // 1. One <kbd> per alternative combo. #287's actual defect was both Redo
  //    alternatives joined in one <kbd> ('… or …'), which wraps mid-combo;
  //    per-combo <kbd>s are what #289 split them into. 8 = 7 rows + Redo's
  //    second alternative — update alongside shortcutsFor when a shortcut
  //    is added or changed.
  const combos = dialog.locator('.shortcut-row kbd')
  await expect(combos).toHaveCount(8)
  // 2. Every combo's box lies inside its own row — the box that actually
  //    breaks when a combo grows too wide. Measured before writing this: a
  //    nowrap combo wider than the 45% column does not wrap and does not
  //    stay put — the dt's default min-width:auto lets the column grow to
  //    the combo (kbd-inside-dt stays true, so THAT check is vacuous), and
  //    the grown column overflows the fixed-width row. Containment against
  //    the row is what fails, with ~90px to spare over the tolerance.
  for (const [rowIndex, row] of (await dialog.locator('.shortcut-row').all()).entries()) {
    for (const [comboIndex, combo] of (await row.locator('kbd').all()).entries()) {
      await expectWithin(combo, row, { what: `row ${rowIndex} combo ${comboIndex}` })
    }
  }

  // While the sheet is open the transport is inert like under any modal.
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})
