import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Audio tracks on the timeline (#102): a real WAV imports, is placed on the
 * audio lane (twice — overlap is legal), and its start time and trim are
 * edited from the lane's numeric controls. Nothing is audible yet (#103).
 */

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: sineWav(4),
  })
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toContainText('tone.wav')
})

test('placing an audio clip creates a track on the audio lane', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add tone.wav to timeline' })
  await add.click()
  await add.click()

  // Two tracks from the same clip, fully overlapping — both on the lane.
  const lane = page.getByRole('list', { name: 'Audio tracks' })
  await expect(lane.getByRole('listitem')).toHaveCount(2)
  // The video sequence stays empty: audio never becomes a sequence entry.
  await expect(page.getByRole('list', { name: 'Sequence' })).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:00')
})

test('start time and trim are edited from the lane', async ({ page }) => {
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()

  const startField = page.getByRole('spinbutton', {
    name: 'Start time of audio track tone.wav at position 1 in seconds',
  })
  await startField.fill('2')
  await startField.blur()
  await expect(startField).toHaveValue('2')

  const inField = page.getByRole('spinbutton', {
    name: 'Trim in point of audio track tone.wav at position 1 in seconds',
  })
  await inField.fill('1')
  await inField.blur()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of audio track tone.wav at position 1 in seconds',
  })
  await outField.fill('3')
  await outField.blur()

  await expect(inField).toHaveValue('1')
  await expect(outField).toHaveValue('3')
  await expect(page.getByText('plays 2s of 4s')).toBeVisible()
  // The bar reflects offset 2s + length 2s on a lane spanning 4s.
  const bar = page.getByTestId('audio-track-bar-0')
  await expect(bar).toHaveCSS('left', /.+/)
  await expect(bar).toHaveAttribute('style', /left: 50%; width: 50%/)
})

test('a track can be removed; removing the library clip removes its tracks', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add tone.wav to timeline' })
  await add.click()
  await add.click()

  await page
    .getByRole('button', { name: 'Remove audio track tone.wav at position 1 from timeline' })
    .click()
  // Track removal confirms first (#178).
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  const lane = page.getByRole('list', { name: 'Audio tracks' })
  await expect(lane.getByRole('listitem')).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove tone.wav from library' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('the 1 timeline entry')
  await dialog.getByRole('button', { name: 'Remove' }).click()

  await expect(page.getByRole('list', { name: 'Audio tracks' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Imported clips' })).toHaveCount(0)
})
