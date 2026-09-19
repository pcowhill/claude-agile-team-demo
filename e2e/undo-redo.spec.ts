import { expect, test } from '@playwright/test'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

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
  await chooseFromAddMenu(page, ADD_SLATE)
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

test('the undo chord waits while a dialog is open, and works again once it closes (#559)', async ({
  page,
}) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence).toBeAttached()

  // The export dialog is modal (#203), and the transport keys already wait
  // behind it; the undo chord now does too, so a dialog describes the
  // project it opened on for as long as it is open. "Nothing happened" is
  // not something a retrying assertion can wait for, so the Escape that
  // follows is the commit that is waited on: keydowns are handled in
  // order, and once the dialog has gone any undo the chord had caused
  // would have rendered as well — the sequence is read from that render.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(sequence).toBeAttached()

  // With the dialog closed the same chord undoes the add.
  await page.keyboard.press('Control+z')
  await expect(sequence).not.toBeAttached()
})

test('keyboard shortcuts undo a confirmed removal and redo it', async ({ page }) => {
  await page.goto('./')

  await chooseFromAddMenu(page, ADD_SLATE)
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
