import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of fades through a color and irises (#181), exercised media-free
 * with two slates — a red one then a blue one — whose flat, exactly-known
 * colors let a decoded frame attribute each region to either clip (or to the
 * dip's veil) unambiguously, the export-transitions sampling approach.
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
 * Samples a patch of the exported file through the shared presented-frame
 * decoder (#276). Sample times anchor to the END of the file because export
 * overhead pads the front: the final entry always occupies the file's last
 * second, so the overlap is exactly [end − 1.0, end − 0.5] regardless of
 * the padding (the export-transitions spec's rule). `centre` is the middle
 * tenth of the frame; `corner` the top-left tenth-by-tenth — at mid-iris
 * the centre lies inside the reveal ellipse and the corner well outside it.
 */
const PATCHES: Record<'centre' | 'corner', SampleRect> = {
  centre: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
  corner: { x: 0, y: 0, width: 0.1, height: 0.1 },
}

const samplePatch = (
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  patch: keyof typeof PATCHES,
) => sampleExportedFrame(page, webm, fromEndSeconds, PATCHES[patch])

/** Strong presence of a slate's own color channel in a patch average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60

test('a fade through black exports with the frame dipped to black at the overlap middle (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'fade-through-black')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-dip (0.75 s from the end = overlap middle): the veil dims the whole
  // frame. Real-time recording timestamps jitter a frame or two, so the
  // sampled instant may sit slightly off the exact midpoint where the veil
  // is fully opaque — the threshold below still discriminates a dip from
  // any crossfade-like blend, which would keep r + b ≈ 255 everywhere.
  const DIMMED = 110
  const centre = await samplePatch(page, exported, 0.75, 'centre')
  const corner = await samplePatch(page, exported, 0.75, 'corner')
  expect(centre.duration).toBeGreaterThan(1.5 * 0.6)
  expect(centre.duration).toBeLessThan(1.5 + 1)
  expect(centre.r).toBeLessThan(DIMMED)
  expect(centre.b).toBeLessThan(DIMMED)
  expect(corner.r).toBeLessThan(DIMMED)
  expect(corner.b).toBeLessThan(DIMMED)

  // Before the overlap the frame is still all red; deep in the final slate
  // the dip is over and the frame is all blue — the veil really ramps out.
  const early = await samplePatch(page, exported, 1.3, 'centre')
  expect(early.r).toBeGreaterThan(DOMINANT)
  expect(early.b).toBeLessThan(ABSENT)
  const late = await samplePatch(page, exported, 0.2, 'centre')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})

test('an iris-open exports with the incoming clip revealed inside a centre ellipse (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'iris-open')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-iris: the centre of the frame lies inside the reveal ellipse (the
  // incoming blue), the corner outside it (still the outgoing red) — and
  // neither is a blend, the iris edge is a hard reveal.
  const centre = await samplePatch(page, exported, 0.75, 'centre')
  const corner = await samplePatch(page, exported, 0.75, 'corner')
  expect(centre.duration).toBeGreaterThan(1.5 * 0.6)
  expect(centre.duration).toBeLessThan(1.5 + 1)
  expect(centre.b).toBeGreaterThan(DOMINANT)
  expect(centre.r).toBeLessThan(ABSENT)
  expect(corner.r).toBeGreaterThan(DOMINANT)
  expect(corner.b).toBeLessThan(ABSENT)

  // Deep in the final slate the iris is fully open: corners are blue too.
  const late = await samplePatch(page, exported, 0.2, 'corner')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})
