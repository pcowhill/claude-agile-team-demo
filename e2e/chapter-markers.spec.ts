import { expect, test } from '@playwright/test'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * Chapter markers (#487, the approved suggestion #461) in real Chromium,
 * media-free with two 5 s colour slates so every time is exact: adding from
 * Frame ▾ and with M, the inline name field, the ticks' positions on the
 * seek bar, ↑ / ↓ and snapping landing on markers, the readout naming the
 * marker under the playhead, the per-tick menu, Undo — and the rendered
 * evidence jsdom cannot give (`development.md`): the row does not grow, no
 * label wraps, nothing scrolls sideways, and a screenshot.
 */

const blurActive = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

const seek = (page: Page) => page.getByRole('slider', { name: 'Seek within sequence' })
const ticks = (page: Page) => page.getByTestId('preview-marker')
const nameField = (page: Page) => page.getByRole('textbox', { name: /^Name of chapter marker at/ })

async function twoSlates(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
  await blurActive(page)
}

/** Seeks by the transport keys to an exact multiple of 0.1 s from 0. */
async function seekTo(page: Page, time: number) {
  await page.keyboard.press('Home')
  const whole = Math.floor(time)
  for (let i = 0; i < whole; i++) await page.keyboard.press('Shift+ArrowRight')
  const tenths = Math.round((time - whole) * 10)
  for (let i = 0; i < tenths; i++) await page.keyboard.press('ArrowRight')
  await expect(seek(page)).toHaveValue(String(time))
}

test('Frame ▾ and M add named markers at the playhead; the ticks sit at their times; the readout names the one under the playhead', async ({
  page,
}, testInfo) => {
  await twoSlates(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  const rowBefore = (await page.locator('.preview-seek').boundingBox())!

  // Frame ▾ → Add chapter marker: a marker at 2.5 with the default name
  // selected in a field; typing replaces it.
  await seekTo(page, 2.5)
  await chooseFromFrameMenu(page, 'preview-add-marker')
  await expect(nameField(page)).toBeFocused()
  await expect(nameField(page)).toHaveValue('Chapter 1')
  await page.keyboard.type('Intro')
  await page.keyboard.press('Enter')
  await expect(nameField(page)).toHaveCount(0)
  await expect(ticks(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Chapter marker Intro at 0:03' })).toBeVisible()

  // M at 7: Escape keeps the default name.
  await seekTo(page, 7)
  await page.keyboard.press('m')
  await expect(nameField(page)).toHaveValue('Chapter 2')
  await page.keyboard.press('Escape')
  await expect(nameField(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chapter marker Chapter 2 at 0:07' })).toBeVisible()

  // A third, at the cut at 5: the readout names it while the playhead sits there.
  await seekTo(page, 5)
  await page.keyboard.press('M')
  await page.keyboard.type('Middle')
  await page.keyboard.press('Enter')
  await expect(ticks(page)).toHaveCount(3)
  await expect(page.getByTestId('preview-position-marker')).toHaveText(' · Middle')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-position-marker')).toHaveCount(0)

  // Geometry: each tick's centre at its fraction of the slider's width
  // (within 2 px); the seek row no taller than before; badges on one line;
  // no sideways scroll.
  const bar = (await seek(page).boundingBox())!
  for (const [time, index] of [
    [2.5, 0],
    [5, 1],
    [7, 2],
  ] as const) {
    const box = (await ticks(page).nth(index).boundingBox())!
    const centre = box.x + box.width / 2
    expect(Math.abs(centre - (bar.x + (time / 10) * bar.width)), `tick ${index} at ${time}s`).toBeLessThanOrEqual(2)
    const badge = ticks(page).nth(index).getByRole('button')
    const overflow = await badge.evaluate((node) => ({ sw: node.scrollWidth, cw: node.clientWidth }))
    expect(overflow.sw, `badge ${index} wraps`).toBeLessThanOrEqual(overflow.cw)
  }
  const rowAfter = (await page.locator('.preview-seek').boundingBox())!
  expect(Math.abs(rowAfter.height - rowBefore.height), 'seek row grew with markers').toBeLessThanOrEqual(1)
  await expectNoHorizontalScroll(page, 'three markers at 1280px')
  await page.locator('.preview-controls').screenshot({ path: testInfo.outputPath('chapter-markers-transport.png') })

  await page.setViewportSize({ width: 800, height: 1100 })
  const narrowNone = await page.evaluate(() => {
    const row = document.querySelector('.preview-seek')!.getBoundingClientRect()
    return row.height
  })
  expect(narrowNone).toBeGreaterThan(0)
  await expectNoHorizontalScroll(page, 'three markers at 800px')
  await page.locator('.preview-controls').screenshot({ path: testInfo.outputPath('chapter-markers-transport-800.png') })
})

test('↑ / ↓ stop on markers and a released seek snaps onto one; Alt bypasses', async ({ page }) => {
  await twoSlates(page)
  await seekTo(page, 2.5)
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  await expect(ticks(page)).toHaveCount(1)

  // Down from 0: the marker at 2.5 comes before the cut at 5.
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await expect(seek(page)).toHaveValue('2.5')
  await page.keyboard.press('ArrowDown')
  await expect(seek(page)).toHaveValue('5')
  await page.keyboard.press('ArrowUp')
  await expect(seek(page)).toHaveValue('2.5')
  await page.getByRole('button', { name: 'Jump to previous cut' }).click()
  await expect(seek(page)).toHaveValue('0')

  // A pointer release just off the marker lands on it (the #391 snap rule,
  // now over the marker set too), with the tick; Alt lands where dragged.
  const box = (await seek(page).boundingBox())!
  // The upper part of the slider, not its centre line: the marker's tick
  // sits just under the track and would take the click for its own menu —
  // which is the tick's job, and why a seek near a marker aims above it.
  const y = box.y + box.height * 0.25
  const thumbX = (value: number) => box.x + (value / 10) * box.width
  await seek(page).focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 244; i++) await page.keyboard.press('ArrowRight')
  await expect(seek(page)).toHaveValue('2.44')
  await page.mouse.click(thumbX(2.44), y)
  await expect(seek(page)).toHaveValue('2.5')
  await expect(page.getByTestId('preview-snap-tick')).toBeVisible()
  await expect(page.getByTestId('preview-position-marker')).toHaveText(' · Chapter 1')

  await seek(page).focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
  await expect(seek(page)).toHaveValue('2.44')
  await page.keyboard.down('Alt')
  await page.mouse.click(thumbX(2.44), y)
  await page.keyboard.up('Alt')
  await expect(seek(page)).toHaveValue('2.44')
})

test('a tick’s menu renames, moves and removes; each is one undo step', async ({ page }) => {
  await twoSlates(page)
  await seekTo(page, 2.5)
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  const tick = page.getByRole('button', { name: 'Chapter marker Chapter 1 at 0:03' })
  await expect(tick).toBeVisible()

  // Rename… opens the same field; the new name shows on the tick.
  await tick.click()
  const menu = page.getByRole('menu', { name: 'Chapter marker Chapter 1' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename…', 'Move to playhead', 'Remove'])
  await menu.getByRole('menuitem', { name: 'Rename…' }).click()
  await expect(nameField(page)).toHaveValue('Chapter 1')
  await page.keyboard.type('Opening')
  await page.keyboard.press('Enter')
  const renamed = page.getByRole('button', { name: 'Chapter marker Opening at 0:03' })
  await expect(renamed).toBeVisible()

  // Move to playhead: the tick follows the playhead to 7.
  await blurActive(page)
  await seekTo(page, 7)
  await renamed.click()
  await page.getByRole('menuitem', { name: 'Move to playhead' }).click()
  const moved = page.getByRole('button', { name: 'Chapter marker Opening at 0:07' })
  await expect(moved).toBeVisible()
  const bar = (await seek(page).boundingBox())!
  const box = (await ticks(page).first().boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (bar.x + 0.7 * bar.width))).toBeLessThanOrEqual(2)

  // Remove, then Undo three times walks back: removal, move, rename, add.
  await moved.click()
  await page.getByRole('menuitem', { name: 'Remove' }).click()
  await expect(ticks(page)).toHaveCount(0)
  const undo = page.getByRole('button', { name: /^Undo/ })
  await undo.click()
  await expect(page.getByRole('button', { name: 'Chapter marker Opening at 0:07' })).toBeVisible()
  await undo.click()
  await expect(page.getByRole('button', { name: 'Chapter marker Opening at 0:03' })).toBeVisible()
  await undo.click()
  await expect(page.getByRole('button', { name: 'Chapter marker Chapter 1 at 0:03' })).toBeVisible()
  await undo.click()
  await expect(ticks(page)).toHaveCount(0)
  // The Save button shows the project dirty for a marker edit like any other.
  await expect(page.locator('.project-dirty')).toBeVisible()
})

test('M is inert in a field and with an empty timeline; adding on an existing marker reopens its field', async ({
  page,
}) => {
  await page.goto('./')
  await blurActive(page)
  await page.keyboard.press('m')
  await expect(nameField(page)).toHaveCount(0)

  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.focus()
  await page.keyboard.press('m')
  await expect(nameField(page)).toHaveCount(0)
  await blurActive(page)

  await page.keyboard.press('m')
  await expect(nameField(page)).toHaveValue('Chapter 1')
  await page.keyboard.type('Start')
  await page.keyboard.press('Enter')
  await expect(ticks(page)).toHaveCount(1)
  // Again at the same instant: the existing marker's field, not a second tick.
  await page.keyboard.press('m')
  await expect(nameField(page)).toHaveValue('Start')
  await page.keyboard.press('Escape')
  await expect(ticks(page)).toHaveCount(1)
})
