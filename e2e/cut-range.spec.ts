import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseFromFrameMenu, closeFrameMenu, expectFrameItemEnabled, frameMenu, openFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectNoWrap } from './layout'

type Page = import('@playwright/test').Page

/**
 * Cut out marked range (#823), in a real browser, on a populated sequence:
 * `fixtures/trim-clip.webm` (6.008 s) added twice, so the sequence is about
 * 12 s with a hard cut at 6.008. The marks are set at 4 and 8, across that
 * cut, so the cut trims the end of the first entry and the start of the
 * second.
 */

const CLIP = 'trim-clip.webm'
const CLIP_SECONDS = 6.008

async function twoEntries(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  const add = page.getByRole('button', { name: `Add ${CLIP} to timeline` })
  await add.click()
  await add.click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:12')
}

const trimField = (page: Page, edge: 'in' | 'out', position: number) =>
  page.getByRole('spinbutton', {
    name: `Trim ${edge} point of ${CLIP} at position ${position} in seconds`,
  })

/** Sets a mark with its key, at a playhead placed through the slider. */
async function markAt(page: Page, time: number, key: 'i' | 'o') {
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill(String(time))
  await expect(seek).toHaveValue(String(time))
  // The transport keys act wherever the focus is not a control of its own.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(key)
}

test('Frame ▾ › Cut out marked range removes the span across a cut, clears the marks, and undoes in one step (#823)', async ({
  page,
}) => {
  await twoEntries(page)
  const sequence = page.getByRole('list', { name: 'Sequence' })
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // No marks, no range: the item is disabled.
  await expectFrameItemEnabled(page, 'preview-cut-range', false)

  await markAt(page, 4, 'i')
  await markAt(page, 8, 'o')
  await expect(page.getByTestId('preview-marked-range')).toHaveAttribute(
    'title',
    'Marked range: 0:04 – 0:08',
  )
  await chooseFromFrameMenu(page, 'preview-cut-range')

  // The first entry now ends at 4; the second starts 8 − 6.008 into its
  // clip (the fields show two decimals). Still two rows: neither entry lay wholly inside the range.
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect(trimField(page, 'in', 1)).toHaveValue('0')
  await expect(trimField(page, 'out', 1)).toHaveValue('4')
  await expect
    .poll(async () => Number(await trimField(page, 'in', 2).inputValue()))
    .toBeCloseTo(8 - CLIP_SECONDS, 2)
  await expect
    .poll(async () => Number(await trimField(page, 'out', 2).inputValue()))
    .toBeCloseTo(CLIP_SECONDS, 2)
  // About 12.016 − 4 = 8.016 s.
  await expect(page.getByTestId('timeline-total')).toHaveText('0:08')
  // The marks bounded a range that no longer exists, so they are cleared,
  // and the playhead stands on the join.
  await expect(page.getByTestId('preview-mark-in-marker')).toHaveCount(0)
  await expect(page.getByTestId('preview-mark-out-marker')).toHaveCount(0)
  await expect(page.getByTestId('preview-clear-marks')).toHaveCount(0)
  await expect(seek).toHaveValue('4')

  // One undo step restores both entries whole.
  await page.keyboard.press('Control+z')
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect
    .poll(async () => Number(await trimField(page, 'out', 1).inputValue()))
    .toBeCloseTo(CLIP_SECONDS, 2)
  await expect(trimField(page, 'in', 2)).toHaveValue('0')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:12')
})

test('X cuts the marked range inside one entry, and does nothing without a range (#823)', async ({ page }) => {
  await twoEntries(page)
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // No range: X is inert.
  await page.keyboard.press('x')
  await expect(sequence.getByRole('listitem')).toHaveCount(2)

  // A range inside the first entry splits it around the removed part.
  await markAt(page, 1, 'i')
  await markAt(page, 3, 'o')
  await page.keyboard.press('x')
  await expect(sequence.getByRole('listitem')).toHaveCount(3)
  await expect(trimField(page, 'out', 1)).toHaveValue('1')
  await expect(trimField(page, 'in', 2)).toHaveValue('3')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
})

test('the Cut out marked range item is one line, and the open Frame ▾ fits the viewport, at 1280 and 360 px (#823)', async ({
  page,
}, testInfo) => {
  await twoEntries(page)
  await markAt(page, 4, 'i')
  await markAt(page, 8, 'o')
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    const menu = await openFrameMenu(page)
    const item = page.getByTestId('preview-cut-range')
    await expect(item).toBeEnabled()
    await expectNoWrap(item, `Frame ▾ item at ${viewport.width}px`)
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    const box = (await item.boundingBox())!
    expect(box.x, `item left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `item right at ${viewport.width}px`).toBeLessThanOrEqual(view.width)
    await expectNoHorizontalScroll(page, `Frame menu open at ${viewport.width}px`)
    // For the PR's rendered evidence: the open menu at this width.
    const menuBox = (await menu.boundingBox())!
    await page.screenshot({
      path: testInfo.outputPath(`cut-range-menu-${viewport.width}.png`),
      clip: {
        x: Math.max(0, menuBox.x - 8),
        y: Math.max(0, menuBox.y - 40),
        width: Math.min(view.width - Math.max(0, menuBox.x - 8), menuBox.width + 16),
        height: Math.min(view.height - Math.max(0, menuBox.y - 40), menuBox.height + 48),
      },
    })
    await closeFrameMenu(page)
    await expect(frameMenu(page)).toHaveCount(0)
  }
})
