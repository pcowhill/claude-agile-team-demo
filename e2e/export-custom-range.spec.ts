import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { lastFrame, scanExportedFrames } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'

type Page = import('@playwright/test').Page

/**
 * A typed export range (#400): the export modal's Custom range exports the
 * span between two typed times, with no marks set — and pre-fills from the
 * marks when they form one. Media-free on 5 s color slates, green then red,
 * so the exported file's own pixels say what span it carries (a range inside
 * the red slate contains no green), and every landing is read off model
 * state a load cannot fake (#362).
 */

const FULL: Record<string, SampleRect> = { full: { x: 0, y: 0, width: 1, height: 1 } }
/** Strong presence of a slate's own color channel in a frame average. */
const DOMINANT = 80
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 30

/** Two 5 s slates: green [0, 5), red [5, 10). */
async function seedGreenThenRed(page: Page) {
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByLabel('Color of Color slate at position 1').fill('#00cd00')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
}

/** Opens the modal, types the range, picks a format, and returns the file. */
async function exportTypedRange(
  page: Page,
  start: string,
  end: string,
  format?: string,
): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  if (format !== undefined) await page.getByRole('radio', { name: format }).check()
  await page.getByTestId('export-range-start').fill(start)
  await page.getByTestId('export-range-end').fill(end)
  await expect(page.getByTestId('export-scope-custom')).toBeChecked()
  await expect(page.getByTestId('export-range-error')).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

test('a typed range exports only that span with no marks set; the fields validate (#400)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await seedGreenThenRed(page)

  // No marks: Whole project and Custom range are offered, Marked range is
  // not, and the fields pre-fill from the whole sequence.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(page.getByTestId('export-scope-whole')).toBeChecked()
  await expect(page.getByTestId('export-scope-range')).toHaveCount(0)
  await expect(page.getByTestId('export-range-start')).toHaveValue('0:00')
  await expect(page.getByTestId('export-range-end')).toHaveValue('0:10')

  // An end past the sequence names the limit and disables Export; typing
  // selected the Custom option on its own.
  await page.getByTestId('export-range-end').fill('12')
  await expect(page.getByTestId('export-scope-custom')).toBeChecked()
  await expect(page.getByTestId('export-range-error')).toHaveText(
    /The end cannot be past the end of the sequence \(0:10\)/,
  )
  await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await page.getByTestId('export-range-end').fill('0:08')
  await expect(page.getByTestId('export-range-error')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)

  // Export [6, 8] — inside the red slate — in the default video format.
  const exported = await exportTypedRange(page, '6', '0:08')
  expect(exported.byteLength).toBeGreaterThan(500)
  const scan = await scanExportedFrames(page, exported, FULL)
  // Duration is the range's 2 s with the suite's real-time slack; the whole
  // sequence (10 s) fails the upper bound outright.
  expect(scan.duration).toBeGreaterThan(2 * 0.5)
  expect(scan.duration).toBeLessThan(2 + 1.5)
  // Every frame is red: the green slate before the typed start never
  // reaches the file.
  const maxGreen = Math.max(...scan.frames.map((frame) => frame.bands.full.g))
  expect(maxGreen).toBeLessThan(ABSENT)
  const last = lastFrame(scan, () => true, 'any frame')
  expect(last.bands.full.r).toBeGreaterThan(DOMINANT)
})

test('marks pre-fill the typed range, and a GIF honors a typed range (#400)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await seedGreenThenRed(page)

  // Marks at 3 and 4: the modal offers the marked range and pre-fills the
  // custom fields from it, whole project still the default.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('3')
  await page.getByTestId('preview-mark-in').click()
  await seek.fill('4')
  await page.getByTestId('preview-mark-out').click()
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByTestId('export-scope-whole')).toBeChecked()
  await expect(page.getByTestId('export-scope-range').locator('..')).toHaveText(
    /Marked range \(0:03 – 0:04\)/,
  )
  await expect(page.getByTestId('export-range-start')).toHaveValue('0:03')
  await expect(page.getByTestId('export-range-end')).toHaveValue('0:04')
  await page.getByRole('dialog', { name: 'Export project' }).getByRole('button', { name: 'Cancel' }).click()

  // The GIF plugin samples at 10 fps: a typed 2 s range is about 20 frames,
  // where the whole 10 s sequence would be about 100.
  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()
  const gif = await exportTypedRange(page, '6', '8', 'Animated GIF')
  expect(gif.subarray(0, 6).toString('latin1')).toMatch(/^GIF8[79]a$/)
  let frames = 0
  {
    // Minimal image-descriptor walk (the export-gif.spec parser's core).
    const packed = gif[10]
    let offset = 13
    if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1)
    const skipSubBlocks = () => {
      for (;;) {
        const size = gif[offset]
        offset += 1
        if (size === 0) return
        offset += size
      }
    }
    while (offset < gif.length) {
      const block = gif[offset]
      if (block === 0x3b) break
      if (block === 0x21) {
        offset += 2
        skipSubBlocks()
      } else if (block === 0x2c) {
        frames += 1
        const localPacked = gif[offset + 9]
        offset += 10
        if (localPacked & 0x80) offset += 3 * 2 ** ((localPacked & 0x07) + 1)
        offset += 1
        skipSubBlocks()
      } else {
        break
      }
    }
  }
  expect(frames).toBeGreaterThanOrEqual(10)
  expect(frames).toBeLessThanOrEqual(40)
})
