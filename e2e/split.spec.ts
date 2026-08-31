import { expect, test } from '@playwright/test'

/**
 * Split at playhead (#190), exercised media-free with a slate: position the
 * preview inside the entry, split it into two independently editable halves,
 * remove one, and undo the lot (#189 makes the split undoable for free).
 */

test('splitting a slate at the playhead yields two halves; either half removes independently', async ({
  page,
}) => {
  await page.goto('./')

  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')

  const split = page.getByTestId('preview-split')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // At the sequence start the playhead sits on the entry's edge — there is
  // nothing to split, so the razor disables.
  await expect(split).toBeDisabled()

  // Strictly inside the slate it enables; splitting at 2s cuts the 5s slate
  // into a 2s and a 3s half without changing the total.
  await seek.fill('2')
  await expect(split).toBeEnabled()
  await split.click()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect(
    page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' }),
  ).toHaveValue('2')
  await expect(
    page.getByRole('spinbutton', { name: 'Duration of Color slate at position 2 in seconds' }),
  ).toHaveValue('3')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')

  // The halves are independent: removing the first (through the #178
  // confirmation) leaves only the 3s half.
  await page
    .getByRole('button', { name: 'Remove Color slate at position 1 from timeline' })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:03')

  // The split went through the reducer, so it is an ordinary undo step:
  // undo the removal, then the split itself.
  await page.keyboard.press('Control+z')
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  await page.keyboard.press('Control+z')
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(
    page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' }),
  ).toHaveValue('5')
})
