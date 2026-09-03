import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * A bounded media library (#308): past a cap the clip list scrolls on its own
 * instead of pushing the timeline down the page, and the controls above the
 * list stay in place while it scrolls. With few clips nothing scrolls.
 */

const wavs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `clip-${String(from + i).padStart(2, '0')}.wav`,
    mimeType: 'audio/wav',
    buffer: sineWav(0.2),
  }))

test('a large library scrolls internally and stops pushing the timeline down (#308)', async ({
  page,
}) => {
  await page.goto('./')
  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')
  const list = page.getByRole('list', { name: 'Imported clips' })
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const importButton = page.getByRole('button', { name: 'Import clips' })
  const selectAll = page.getByRole('checkbox', { name: 'Select all' })

  await input.setInputFiles(wavs(1, 15))
  await expect(rows).toHaveCount(15)
  const timelineTopAt15 = (await timeline.boundingBox())!.y
  const importBoxAt15 = (await importButton.boundingBox())!
  const selectAllBoxAt15 = (await selectAll.boundingBox())!

  await input.setInputFiles(wavs(16, 15))
  await expect(rows).toHaveCount(30)

  // (a) The library stopped growing: the timeline did not move.
  expect((await timeline.boundingBox())!.y).toBe(timelineTopAt15)

  // (b) The list really scrolls.
  const metrics = () =>
    list.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
    }))
  const before = await metrics()
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)

  // (c) Scrolling the list to the bottom shows the last row and leaves the
  // controls above the list exactly where they were.
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(rows.last()).toBeInViewport()
  await expect(rows.first()).not.toBeInViewport()
  expect((await metrics()).scrollTop).toBeGreaterThan(0)
  expect(await importButton.boundingBox()).toEqual(importBoxAt15)
  expect(await selectAll.boundingBox()).toEqual(selectAllBoxAt15)
  await expect(importButton).toBeInViewport()
  await expect(selectAll).toBeInViewport()

  // (d) No horizontal page scroll with the scrollbar present (#208 guard).
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})

test('a small library does not scroll and reserves no space (#308)', async ({ page }) => {
  await page.goto('./')
  const input = page.getByTestId('clip-file-input')
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')

  await input.setInputFiles(wavs(1, 3))
  await expect(rows).toHaveCount(3)

  const metrics = await list.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(metrics.scrollHeight).toBe(metrics.clientHeight)
  // The list is exactly its rows plus the gaps between them — no fixed height.
  const listBox = (await list.boundingBox())!
  const first = (await rows.first().boundingBox())!
  const last = (await rows.last().boundingBox())!
  expect(listBox.y).toBeCloseTo(first.y, 0)
  expect(listBox.y + listBox.height).toBeCloseTo(last.y + last.height, 0)
})
