import { expect, test } from '@playwright/test'
import { expectFrameItemEnabled } from './frameMenu'
import { expectWithin } from './layout'

/**
 * Jump to cuts and snap the committed seek to boundaries (#391), exercised
 * media-free with color slates (5 s each, so every boundary is exact):
 * ↑ / ↓ and the two transport buttons land the playhead exactly on entry
 * cuts and on both edges of a transition blend, and releasing a pointer
 * seek near a boundary snaps onto it with a visible tick — unless Alt is
 * held or the release is out of the snap zone. Landings are read off the
 * seek slider's value, a state load cannot fake (#362): a wrong boundary
 * rule lands on a wrong number.
 */

/** Clears button focus after a click, so the transport keys reach window. */
const blurActive = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

test('↑ / ↓ and the transport buttons land exactly on cuts and blend edges', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
  await blurActive(page)

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // Hard cut at 5, sequence end at 10: Down walks the boundaries and clamps.
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('5')
  // The landing is exact: the razor has nothing to split exactly on a cut,
  // so Split disabled here is the discriminating "precisely on the boundary"
  // check — one 0.1 s step away it re-enables. Split is a Frame ▾ item since
  // #417; the helper reads it and hands the keys back to the transport.
  await expectFrameItemEnabled(page, 'preview-split', false)
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveValue('5.1')
  await expectFrameItemEnabled(page, 'preview-split', true)
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('5')
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('10')
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('10')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('0')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('0')

  // The buttons make the same jumps.
  await page.getByRole('button', { name: 'Jump to next cut' }).click()
  await expect(seek).toHaveValue('5')
  await page.getByRole('button', { name: 'Jump to previous cut' }).click()
  await expect(seek).toHaveValue('0')

  // Geometry (new visible surface): both buttons sit inside the transport
  // row, and the row's growth pushed nothing into a sideways page scroll.
  const controls = page.locator('.preview-controls')
  await expectWithin(page.getByRole('button', { name: 'Jump to previous cut' }), controls, {
    what: 'previous-cut button',
  })
  await expectWithin(page.getByRole('button', { name: 'Jump to next cut' }), controls, {
    what: 'next-cut button',
  })
  const pageScroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(pageScroll.scrollWidth).toBeLessThanOrEqual(pageScroll.clientWidth)
  // The human check for the PR's rendered evidence, re-taken every run.
  await controls.screenshot({ path: testInfo.outputPath('jump-snap-transport.png') })

  // A transition contributes BOTH blend edges: the default 1 s crossfade
  // overlaps [4, 5], total 9 — walking up from the end visits 5, then 4.
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:09')
  await blurActive(page)
  await page.keyboard.press('End')
  await expect(seek).toHaveValue('9')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('5')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('4')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('0')
})

test('a committed pointer seek snaps onto the cut with a tick; Alt or distance bypasses', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
  await blurActive(page)

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const tick = page.getByTestId('preview-snap-tick')
  const box = (await seek.boundingBox())!
  const y = box.y + box.height / 2
  // A click within the thumb grabs it without moving the value (measured
  // before writing this — clicks up to ~7 px off the thumb's center all kept
  // the current value), so positioning by the slider's own keys and then
  // clicking the thumb is a deterministic pointer commit at a known value.
  const thumbX = (value: number) => box.x + (value / 10) * box.width
  /** Steps the focused slider natively to `value` 0.01 s at a time. */
  const stepSliderTo = async (from: number, to: number) => {
    await seek.focus()
    const steps = Math.round(Math.abs(to - from) / 0.01)
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press(to < from ? 'ArrowLeft' : 'ArrowRight')
    }
    await expect(seek).toHaveValue(String(to))
  }

  // Jump to the cut, then step 0.06 s off it on the focused slider: native
  // 0.01 s stepping, and — although 4.94 is well inside the snap zone — no
  // snap and no tick, because only a pointer release commits with snapping;
  // a keyboard step near a cut can always escape.
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('5')
  await stepSliderTo(5, 4.94)
  await expect(tick).toHaveCount(0)

  // A pointer release there — inside the 8 px snap zone — lands exactly on
  // the boundary and flashes the tick.
  await page.mouse.click(thumbX(4.94), y)
  await expect(seek).toHaveValue('5')
  await expect(tick).toBeVisible()
  // The human check on the tick itself, re-taken every run while it shows —
  // a region clip rather than the element, since the tick deliberately
  // overflows the seek row to stay visible around the thumb.
  await page.screenshot({
    path: testInfo.outputPath('snap-tick.png'),
    clip: { x: thumbX(5) - 60, y: box.y - 15, width: 120, height: box.height + 30 },
  })
  // The tick is transient: it clears itself without another interaction.
  await expect(tick).not.toBeVisible({ timeout: 3000 })

  // The same release with Alt held lands where dragged — near, not on.
  await stepSliderTo(5, 4.94)
  await page.keyboard.down('Alt')
  await page.mouse.click(thumbX(4.94), y)
  await page.keyboard.up('Alt')
  await expect(seek).toHaveValue('4.94')
  await expect(tick).toHaveCount(0)

  // A release far from every boundary stands as dragged: no snap, no tick.
  await page.mouse.click(thumbX(2.5), y)
  const free = Number(await seek.inputValue())
  expect(free).toBeGreaterThan(1.5)
  expect(free).toBeLessThan(3.5)
  await expect(tick).toHaveCount(0)

  // The landed snap is a real seek: marking the range here records exactly
  // the boundary (#385's marks capture the playhead), so downstream tools
  // act precisely on the cut.
  await page.mouse.click(thumbX(4.94), y)
  await expect(seek).toHaveValue('5')
  await page.getByTestId('preview-mark-in').click()
  await blurActive(page)
  await page.keyboard.press('End')
  await expect(seek).toHaveValue('10')
  await page.getByTestId('preview-mark-out').click()
  await expect(page.getByTestId('preview-marked-range')).toHaveAttribute(
    'title',
    'Marked range: 0:05 – 0:10',
  )
})
