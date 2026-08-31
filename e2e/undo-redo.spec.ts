import { expect, test } from '@playwright/test'

/**
 * Undo/redo over timeline edits (#189): toolbar buttons and keyboard
 * shortcuts, exercised media-free with slates so the spec stays fast.
 */

test('toolbar undo/redo walk real edits back and forward', async ({ page }) => {
  await page.goto('./')

  const undo = page.getByRole('button', { name: 'Undo last timeline edit' })
  const redo = page.getByRole('button', { name: 'Redo timeline edit' })
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  // Two edits: add a slate, then lengthen it to 8 s.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('8')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:08')

  // Undo the duration edit (one committed field edit = one step)…
  await undo.click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  // …then the add itself.
  await undo.click()
  await expect(page.getByRole('list', { name: 'Sequence' })).not.toBeAttached()
  await expect(undo).toBeDisabled()

  // Redo both, landing exactly where the edits left off.
  await redo.click()
  await redo.click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:08')
  await expect(redo).toBeDisabled()
})

test('keyboard shortcuts undo a confirmed removal and redo it', async ({ page }) => {
  await page.goto('./')

  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' })).toBeAttached()

  // Remove the slate through the confirmation dialog (#178).
  await page
    .getByRole('button', { name: 'Remove Color slate at position 1 from timeline' })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' })).not.toBeAttached()

  // Ctrl+Z brings the slate back; Ctrl+Shift+Z removes it again.
  await page.keyboard.press('Control+z')
  await expect(page.getByRole('list', { name: 'Sequence' })).toBeAttached()
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByRole('list', { name: 'Sequence' })).not.toBeAttached()
})
