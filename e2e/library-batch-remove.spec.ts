import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Batch Remove from the media library's selection bar (#293): the selected
 * clips and every timeline item created from them go in one confirmed step.
 */

/** A small real PNG, so the sequence lane gets a still entry to remove. */
async function makePng(page: import('@playwright/test').Page): Promise<Buffer> {
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0c6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(pngBase64, 'base64')
}

test('select all, Remove, confirm — the library and the timeline are emptied together (#293)', async ({
  page,
}) => {
  await page.goto('./')

  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')

  // Three clips; two go onto the timeline — a still on the sequence and an
  // audio track on its lane — so the removal has to reach both lanes.
  await input.setInputFiles([
    { name: 'still.png', mimeType: 'image/png', buffer: await makePng(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
    { name: 'spare.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
  ])
  await expect(rows).toHaveCount(3)

  await page.getByRole('button', { name: 'Add still.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' })).toContainText('still.png')
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toContainText('tone.wav')

  const bar = page.getByRole('toolbar', { name: 'Selected clips' })
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await expect(bar).toContainText('3 selected')

  // Cancelling changes nothing.
  await bar.getByRole('button', { name: 'Remove selected clips' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Remove 3 clips?')
  await expect(dialog).toContainText('all 2 timeline entries')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(rows).toHaveCount(3)
  await expect(page.getByRole('list', { name: 'Sequence' })).toContainText('still.png')
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toContainText('tone.wav')
  await expect(bar).toContainText('3 selected')

  // Confirming empties the library and both lanes the removed clips filled.
  await bar.getByRole('button', { name: 'Remove selected clips' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()

  await expect(rows).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Sequence' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toHaveCount(0)
  // The selection is spent, so the bar is gone with it.
  await expect(bar).toHaveCount(0)
})

test('a batch Remove leaves the clips that were not selected (#293)', async ({ page }) => {
  await page.goto('./')

  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')

  await input.setInputFiles([
    { name: 'gone-one.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
    { name: 'gone-two.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
    { name: 'kept.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
  ])
  await expect(rows).toHaveCount(3)

  await page.getByRole('button', { name: 'Add gone-one.wav to timeline' }).click()
  await page.getByRole('button', { name: 'Add kept.wav to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Audio tracks' }).getByRole('listitem')).toHaveCount(2)

  await page.getByRole('checkbox', { name: 'Select gone-one.wav' }).click()
  await page.getByRole('checkbox', { name: 'Select gone-two.wav' }).click()
  const bar = page.getByRole('toolbar', { name: 'Selected clips' })
  await bar.getByRole('button', { name: 'Remove selected clips' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()

  await expect(rows).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Imported clips' })).toContainText('kept.wav')
  // The survivor keeps its track; only the removed clip's track went.
  const tracks = page.getByRole('list', { name: 'Audio tracks' })
  await expect(tracks.getByRole('listitem')).toHaveCount(1)
  await expect(tracks).toContainText('kept.wav')
})
