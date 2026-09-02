import { expect, test } from '@playwright/test'

/**
 * Subtitle import (#249): a real browser runs the whole pipeline — the .srt
 * file picked into the hidden input, parsed, landed as ordinary text
 * overlays, and rendered by the existing preview text path at the cues'
 * times and the bottom-center subtitle default. A media-free slate carries
 * the sequence, as the text specs do (#139/#143).
 */

const SRT = [
  '1',
  '00:00:00,500 --> 00:00:02,000',
  'First caption',
  '',
  '2',
  '00:00:02,500 --> 00:00:04,000',
  '<i>Second</i> caption',
  '',
].join('\n')

const importSrt = async (page: import('@playwright/test').Page, content: string) => {
  await page.getByTestId('subtitle-file-input').setInputFiles({
    name: 'captions.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(content, 'utf-8'),
  })
}

test('imported cues land as text overlays and render at their times, bottom-center', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await importSrt(page, SRT)

  // Both cues are ordinary overlays in the text lane, markup stripped.
  const lane = page.getByRole('list', { name: 'Text overlays' })
  await expect(lane.getByRole('listitem')).toHaveCount(2)
  await expect(
    page.getByRole('textbox', { name: 'Content of text overlay at position 2' }),
  ).toHaveValue('Second caption')

  // Inside the first cue's window only the first shows, at the subtitle
  // default: horizontally centred, its block centred at 0.9 of the frame.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('1')
  const first = page.getByTestId('preview-text-0')
  await expect(first).toHaveText('First caption')
  await expect(page.getByTestId('preview-text-1')).not.toBeAttached()
  const frame = await page.getByTestId('preview-frame').boundingBox()
  const box = await first.boundingBox()
  expect(frame).not.toBeNull()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width / 2).toBeCloseTo(frame!.x + frame!.width / 2, 0)
  expect(box!.y + box!.height / 2).toBeCloseTo(frame!.y + frame!.height * 0.9, 0)

  // Inside the second cue's window the roles swap; past both, neither shows.
  await seek.fill('3')
  await expect(page.getByTestId('preview-text-1')).toHaveText('Second caption')
  await expect(page.getByTestId('preview-text-0')).not.toBeAttached()
  await seek.fill('4.5')
  await expect(page.getByTestId('preview-text-0')).not.toBeAttached()
  await expect(page.getByTestId('preview-text-1')).not.toBeAttached()
})

test('a cue past the sequence end imports but never displays', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await importSrt(page, '1\n00:00:10,000 --> 00:00:12,000\nBeyond the end\n')

  // The overlay exists — same as a hand-made overlay timed past the end —
  // but playback never reaches its window, so it never renders.
  await expect(
    page.getByRole('list', { name: 'Text overlays' }).getByRole('listitem'),
  ).toHaveCount(1)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('5')
  await expect(page.getByTestId('preview-text-0')).not.toBeAttached()
})

test('a file with no usable cues reports a failure and adds nothing', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await importSrt(page, 'this is prose, not subtitles')

  await expect(page.getByRole('alert')).toContainText(
    'No subtitle cues found in "captions.srt".',
  )
  await expect(page.getByRole('list', { name: 'Text overlays' })).not.toBeAttached()
})
