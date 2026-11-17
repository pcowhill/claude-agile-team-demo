import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * #584: in Firefox, Play from a position past a recording's first second
 * jumped straight to the end, with no frame played. The recording had no
 * seek index (Cues), one keyframe at 0, and a cluster every second, so every
 * cluster after the first held no keyframe, and Firefox's seek into one ran
 * to end of stream. The app now gives such a file Cues as it comes in
 * (src/lib/webmCues.ts).
 *
 * The fixture has that shape (src/lib/webmCues.test.ts says how it was
 * made). In a bare Firefox page, with no app code, it jumps to the end from
 * 1.5 s. The customer's own recording is not committed; it reproduced the
 * same way (#584's comments).
 *
 * Each test records the position the app publishes on every animation frame
 * while it plays. A jump to the end leaves no sample between where Play
 * started and the end, so "some sample lies strictly between them" is the
 * criterion's "passes through intermediate values". This spec runs in both
 * projects: Chromium never jumped, and must still play forward.
 */

const fixture = () =>
  Buffer.from(readFileSync('src/lib/fixtures/cueless-clusters.webm.base64', 'utf8'), 'base64')

async function importFixture(page: Page, name: string) {
  await page.getByTestId('clip-file-input').setInputFiles([
    { name, mimeType: 'video/webm', buffer: fixture() },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(1)
}

/**
 * Fills a range input on its step grid (0.01), retrying while its max is
 * still settling: a value past the current max is refused outright (#365).
 * Returns the max it filled against.
 */
async function seekTo(slider: Locator, at: (max: number) => number): Promise<number> {
  let max = 0
  await expect(async () => {
    max = Number(await slider.getAttribute('max'))
    expect(max).toBeGreaterThan(5)
    // String(), not toFixed(2): a range input reads "2.50" back as "2.5",
    // which Playwright reports as a malformed value.
    await slider.fill(String(Math.round(at(max) * 100) / 100))
  }).toPass({ timeout: 10_000 })
  return max
}

/** Starts sampling `slider`'s value every animation frame, into the page. */
async function startSampling(slider: Locator) {
  await slider.evaluate((input) => {
    const store = window as unknown as { __positions: number[] }
    store.__positions = []
    const tick = () => {
      store.__positions.push(Number((input as HTMLInputElement).value))
      if (store.__positions.length < 2000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const sampled = (page: Page) =>
  page.evaluate(() => (window as unknown as { __positions: number[] }).__positions)

/** Samples strictly inside (from, to), with a margin either side. */
const between = (positions: number[], from: number, to: number) =>
  positions.filter((p) => p > from + 0.1 && p < to - 0.1)

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

for (const fromEnd of [0.5, 3.5]) {
  test(`Play ${fromEnd} s before the end of a cue-less recording plays forward (#584)`, async ({
    page,
  }) => {
    await importFixture(page, 'recording.webm')
    await page.getByRole('button', { name: 'Add recording.webm to timeline' }).click()

    const seek = page.getByRole('slider', { name: 'Seek within sequence' })
    const max = await seekTo(seek, (m) => m - fromEnd)
    const start = Number(await seek.inputValue())

    await startSampling(seek)
    await page.getByRole('button', { name: 'Play preview' }).click()
    // The last entry: playback ends at the sequence's end either way.
    await expect.poll(async () => Number(await seek.inputValue()), { timeout: 10_000 }).toBeGreaterThan(max - 0.1)

    const positions = await sampled(page)
    expect(
      between(positions, start, max).length,
      `positions from ${start} to ${max}: ${positions.slice(0, 40).join(', ')}`,
    ).toBeGreaterThan(0)
  })
}

test('Play 0.5 s before the end of an entry followed by another plays forward into it (#584)', async ({
  page,
}) => {
  await importFixture(page, 'recording.webm')
  const add = page.getByRole('button', { name: 'Add recording.webm to timeline' })
  await add.click()
  await add.click()

  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  // Two entries of one clip: the first ends halfway through the sequence.
  const max = await seekTo(seek, (m) => m / 2 - 0.5)
  const start = Number(await seek.inputValue())
  const handover = max / 2

  await startSampling(seek)
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(async () => Number(await seek.inputValue()), { timeout: 10_000 }).toBeGreaterThan(handover + 0.2)

  const positions = await sampled(page)
  expect(
    between(positions, start, handover).length,
    `positions from ${start} to the handover at ${handover}: ${positions.slice(0, 40).join(', ')}`,
  ).toBeGreaterThan(0)
})

test('the library preview of a cue-less recording plays forward from past its first second (#584)', async ({
  page,
}) => {
  await importFixture(page, 'recording.webm')
  await page.getByRole('button', { name: 'Preview recording.webm' }).click()
  await expect(page.getByRole('button', { name: 'Play source' })).toBeVisible()

  const seek = page.getByRole('slider', { name: 'Seek within source' })
  // The customer's third form: the library's ▶, past 0:02 (#617).
  const max = await seekTo(seek, () => 2.5)
  const start = Number(await seek.inputValue())

  await startSampling(seek)
  await page.getByRole('button', { name: 'Play source' }).click()
  await expect.poll(async () => Number(await seek.inputValue()), { timeout: 10_000 }).toBeGreaterThan(start + 1)

  const positions = await sampled(page)
  // Forward means it is still short of the end once it has gone a second.
  expect(between(positions, start, max).length).toBeGreaterThan(0)
  expect(Math.min(...positions.filter((p) => p > start + 0.1))).toBeLessThan(max - 1)
})
