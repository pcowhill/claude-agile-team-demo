import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectNoWrap } from './layout'

type Page = import('@playwright/test').Page

/**
 * Cut out marked range's ripple (#824), in a real browser, on a populated
 * project: `fixtures/trim-clip.webm` (6.008 s) added twice to the sequence,
 * two subtitles imported at 7 s and 9 s, and the clip added as a video
 * overlay starting at 8 s. The marks bound [2, 4), inside the first entry,
 * so everything placed after them moves 2 s earlier.
 */

const CLIP = 'trim-clip.webm'

const SRT = [
  '1',
  '00:00:07,000 --> 00:00:08,000',
  'First line',
  '',
  '2',
  '00:00:09,000 --> 00:00:10,500',
  'Second line',
  '',
].join('\n')

const subtitleStart = (page: Page, position: number) =>
  page.getByRole('spinbutton', { name: `Start time of text overlay at position ${position} in seconds` })
const overlayStart = (page: Page) =>
  page.getByRole('spinbutton', { name: `Start time of overlay ${CLIP} at position 1 in seconds` })

async function populated(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  const add = page.getByRole('button', { name: `Add ${CLIP} to timeline` })
  await add.click()
  await add.click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
  await page.getByTestId('subtitle-file-input').setInputFiles({
    name: 'captions.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(SRT, 'utf-8'),
  })
  await expect(page.getByRole('list', { name: 'Text overlays' }).getByRole('listitem')).toHaveCount(2)
  await chooseClipAction(page, CLIP, 'Add as overlay')
  await overlayStart(page).fill('8')
  await overlayStart(page).blur()
  await expect(overlayStart(page)).toHaveValue('8')
  await expect(subtitleStart(page, 1)).toHaveValue('7')
  await expect(subtitleStart(page, 2)).toHaveValue('9')
}

/** Sets a mark with its key, at a playhead placed through the slider. */
async function markAt(page: Page, time: number, key: 'i' | 'o') {
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill(String(time))
  await expect(seek).toHaveValue(String(time))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(key)
}

const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Cut out marked range?' })

test('the cut asks first, then moves the subtitles and the overlay after it earlier, in one undo step (#824)', async ({
  page,
}) => {
  await populated(page)
  await markAt(page, 2, 'i')
  await markAt(page, 4, 'o')
  await chooseFromFrameMenu(page, 'preview-cut-range')

  await expect(confirmation(page)).toContainText(
    'Removes 2 s. 2 subtitles and 1 video overlay after it move earlier.',
  )
  // Nothing has changed while it asks.
  await expect(page.getByTestId('timeline-total')).toHaveText('0:12')
  await expect(subtitleStart(page, 1)).toHaveValue('7')

  await confirmation(page).getByRole('button', { name: 'Cut out' }).click()
  await expect(confirmation(page)).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
  await expect(subtitleStart(page, 1)).toHaveValue('5')
  await expect(subtitleStart(page, 2)).toHaveValue('7')
  await expect(overlayStart(page)).toHaveValue('6')

  // One undo step puts the picture and everything placed on it back.
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:12')
  await expect(subtitleStart(page, 1)).toHaveValue('7')
  await expect(subtitleStart(page, 2)).toHaveValue('9')
  await expect(overlayStart(page)).toHaveValue('8')
})

test('Cancel leaves the project as it was (#824)', async ({ page }) => {
  await populated(page)
  await markAt(page, 2, 'i')
  await markAt(page, 4, 'o')
  await page.keyboard.press('x')
  await confirmation(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation(page)).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:12')
  await expect(subtitleStart(page, 2)).toHaveValue('9')
  await expect(overlayStart(page)).toHaveValue('8')
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the confirmation lies inside a ${viewport.width}px window, its buttons on one line (#824)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populated(page)
    await markAt(page, 2, 'i')
    await markAt(page, 4, 'o')
    await page.keyboard.press('x')
    const dialog = confirmation(page)
    await expect(dialog).toBeVisible()
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    const box = (await dialog.boundingBox())!
    expect(box.x, `the confirmation's left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.y, `the confirmation's top at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `the confirmation's right at ${viewport.width}px`).toBeLessThanOrEqual(view.width)
    expect(box.y + box.height, `the confirmation's bottom at ${viewport.width}px`).toBeLessThanOrEqual(
      view.height,
    )
    await expectNoWrap(dialog.getByRole('button'), `the confirmation's buttons at ${viewport.width}px`)
    await expectNoHorizontalScroll(page, `confirmation open at ${viewport.width}px`)
    await page.screenshot({ path: testInfo.outputPath(`cut-range-ripple-${viewport.width}.png`) })
  })
}
