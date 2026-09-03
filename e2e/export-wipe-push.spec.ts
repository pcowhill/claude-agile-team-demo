import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of wipes and pushes (#181), exercised media-free with two slates —
 * a red one then a blue one — whose flat, exactly-known colors let a decoded
 * frame attribute each region to either clip unambiguously, the
 * export-transitions fixture idea without recording fixtures.
 */

/** Two 1 s slates (red, then blue) with a 0.5 s transition of the type. */
async function buildSlateSequence(page: Page, type: string) {
  for (const position of [1, 2] as const) {
    await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
    const duration = page.getByRole('spinbutton', {
      name: `Duration of Color slate at position ${position} in seconds`,
    })
    await duration.fill('1')
    await duration.blur()
  }
  // The first slate keeps its default red; the second turns blue.
  await page.getByLabel('Color of Color slate at position 2').fill('#0000ff')
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption(type)
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '1.5',
  )
}

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * Samples a named band of the exported file through the shared
 * presented-frame decoder (#276). Sample times anchor to the END of the
 * file because export overhead pads the front (the export-transitions
 * spec's rule).
 */
const BANDS: Record<'left-fifth' | 'right-fifth' | 'top-quarter' | 'bottom-quarter', SampleRect> = {
  'left-fifth': { x: 0, y: 0, width: 0.2, height: 1 },
  'right-fifth': { x: 0.8, y: 0, width: 0.2, height: 1 },
  'top-quarter': { x: 0, y: 0, width: 1, height: 0.25 },
  'bottom-quarter': { x: 0, y: 0.75, width: 1, height: 0.25 },
}

const sampleBand = (
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  band: keyof typeof BANDS,
) => sampleExportedFrame(page, webm, fromEndSeconds, BANDS[band])

/** Strong presence of a slate's own color channel in a band average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60

test('a wipe-from-left exports with the incoming clip revealed from the left (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'wipe-from-left')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-wipe (0.75 s from the end = overlap middle): the left of the frame
  // shows the incoming blue behind the wipe's edge, the right still the
  // outgoing red — and neither side is a blend, the edge is a hard reveal.
  const left = await sampleBand(page, exported, 0.75, 'left-fifth')
  const right = await sampleBand(page, exported, 0.75, 'right-fifth')
  expect(left.duration).toBeGreaterThan(1.5 * 0.6)
  expect(left.duration).toBeLessThan(1.5 + 1)
  expect(left.b).toBeGreaterThan(DOMINANT)
  expect(left.r).toBeLessThan(ABSENT)
  expect(right.r).toBeGreaterThan(DOMINANT)
  expect(right.b).toBeLessThan(ABSENT)

  // Deep in the final slate the wipe is over: the whole frame is blue.
  const late = await sampleBand(page, exported, 0.2, 'right-fifth')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})

test('a push-from-above exports with the incoming clip pushing the outgoing one down (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'push-from-above')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-push: the incoming blue occupies the top half while the outgoing
  // red, pushed down in lockstep, still fills the bottom.
  const top = await sampleBand(page, exported, 0.75, 'top-quarter')
  const bottom = await sampleBand(page, exported, 0.75, 'bottom-quarter')
  expect(top.duration).toBeGreaterThan(1.5 * 0.6)
  expect(top.duration).toBeLessThan(1.5 + 1)
  expect(top.b).toBeGreaterThan(DOMINANT)
  expect(top.r).toBeLessThan(ABSENT)
  expect(bottom.r).toBeGreaterThan(DOMINANT)
  expect(bottom.b).toBeLessThan(ABSENT)

  // Before the overlap begins the frame is still all red.
  const early = await sampleBand(page, exported, 1.3, 'top-quarter')
  expect(early.r).toBeGreaterThan(DOMINANT)
  expect(early.b).toBeLessThan(ABSENT)
})
