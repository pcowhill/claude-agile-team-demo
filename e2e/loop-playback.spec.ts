import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * Loop playback (#459, the approved #392), exercised media-free with two
 * slates like the transport-keys spec: the marked span [4, 6] straddles the
 * cut at 5, so every pass crosses an entry handover, and the wrap at the
 * mark-out is a real seek back into the first slate. The evidence is the
 * published position sampled through several passes — it stays inside the
 * span, keeps moving, and drops back at least twice — while the transport
 * still shows Pause. Plus the rendered evidence for the new control: inside
 * the transport row, on the play button's line at the default width, no
 * sideways page scroll, and a screenshot with the toggle pressed.
 */

/** Clears control focus after a click or fill, so I / O reach the transport. */
const blurActive = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

test('Loop repeats the marked span across a cut until paused, and the toggle fits the transport', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(seek).toHaveAttribute('max', '10')

  // Marks at 4 and 6 through the keys (#417), around the cut at 5.
  await seek.fill('4')
  await blurActive(page)
  await page.keyboard.press('i')
  await seek.fill('6')
  await blurActive(page)
  await page.keyboard.press('o')
  await expect(page.getByTestId('preview-marked-range')).toHaveAttribute(
    'title',
    /Marked range: 0:04 – 0:06/,
  )

  const loop = page.getByRole('button', { name: 'Loop playback' })
  await expect(loop).toHaveAttribute('aria-pressed', 'false')
  await loop.click()
  await expect(loop).toHaveAttribute('aria-pressed', 'true')

  // Geometry (new visible control on the transport): inside the row, on the
  // play button's line at 1280px, and the page gained no sideways scroll.
  const controls = page.locator('.preview-controls')
  const play = page.getByRole('button', { name: 'Play preview' })
  await expectWithin(loop, controls, { what: 'the Loop toggle' })
  await expectNoHorizontalScroll(page, 'transport with the Loop toggle')
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2
  const playBox = (await play.boundingBox())!
  const loopBox = (await loop.boundingBox())!
  expect(
    Math.abs(centre(loopBox) - centre(playBox)),
    'the Loop toggle shares the play button’s line at 1280px',
  ).toBeLessThan(playBox.height / 2)
  await controls.screenshot({ path: testInfo.outputPath('transport-loop-pressed.png') })

  // Play from before the span: with Loop on it starts at the mark-in.
  await seek.fill('1')
  await play.click()
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(4)

  // Sample the published position for a little over three passes of the
  // 2 s span. Every read is a poll (quality-and-ci.md); the poll's own
  // clock decides when enough has been seen.
  const samples: number[] = []
  const started = Date.now()
  await expect
    .poll(
      async () => {
        samples.push(Number(await seek.inputValue()))
        return Date.now() - started
      },
      { intervals: [100], timeout: 15_000 },
    )
    .toBeGreaterThan(6_500)
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()

  // Inside the span throughout — a wrap is a frame late at most, so the top
  // edge carries a frame's tolerance — and it kept moving.
  for (const sample of samples) {
    expect(sample, `position ${sample} left the marked span [4, 6]`).toBeGreaterThanOrEqual(3.95)
    expect(sample, `position ${sample} left the marked span [4, 6]`).toBeLessThan(6.15)
  }
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(1)
  // At least two wraps: the position dropped back by most of the span.
  let drops = 0
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] < samples[i - 1] - 1) drops++
  }
  expect(drops, `wraps seen in ${JSON.stringify(samples)}`).toBeGreaterThanOrEqual(2)

  // Off again mid-pass: nothing seeks, and this pass runs on past the
  // mark-out instead of wrapping.
  await loop.click()
  await expect(loop).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => Number(await seek.inputValue()), { timeout: 5_000 }).toBeGreaterThan(6.2)
  await page.getByRole('button', { name: 'Pause preview' }).click()
  await expect(play).toBeVisible()
})
