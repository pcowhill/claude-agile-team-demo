import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { firstFrame, frameAt, lastFrame, scanExportedFrames } from './decodedFrame'
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
 * Patches of the decoded frame, sampled by scanning every grid frame of the
 * exported file (#370). Sample positions are measured from the file's own
 * phases rather than computed from the nominal timeline: the export is a
 * real-time recording whose phases stretch and shift under CPU load, so the
 * old fixed offsets from the file's end landed in the wrong phase on a
 * loaded machine (this spec's centre sample was one of #370's recorded
 * failures). `centre` is the middle tenth of the frame; `corner` the
 * top-left tenth-by-tenth — at mid-iris the centre lies inside the reveal
 * ellipse and the corner well outside it.
 */
const PATCHES: Record<'centre' | 'corner', SampleRect> = {
  centre: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
  corner: { x: 0, y: 0, width: 0.1, height: 0.1 },
}

/** Strong presence of a slate's own color channel in a patch average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60
/**
 * A channel has clearly appeared in a patch — above codec bleed on a
 * saturated slate, far below real presence. Used only to LOCATE phase
 * boundaries; content assertions keep the thresholds above. The measured
 * window sits slightly inside the true overlap, which only moves sampled
 * positions toward phase middles, where every claim holds with the widest
 * margin.
 */
const APPEAR = 80

test('a fade through black exports with the frame dipped to black at the overlap middle (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'fade-through-black')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  const scan = await scanExportedFrames(page, exported, PATCHES)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // The dip's own signature is the file's darkest presented frame (#370):
  // the veil dims the whole frame toward black at the overlap middle, so
  // the minimum of r + b over the scan IS the mid-dip frame, wherever load
  // stretched it to. The scan's grid may sit a frame off the veil's exact
  // peak — the threshold below still discriminates a dip from any
  // crossfade-like blend, which would keep r + b ≈ 255 everywhere.
  const DIMMED = 110
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands.centre.r > DOMINANT,
    'the red slate starting',
  ).time
  let dip = firstFrame(scan, (frame) => frame.time >= contentStart, 'a frame after content start')
  for (const frame of scan.frames) {
    if (frame.time < contentStart) continue
    if (frame.bands.centre.r + frame.bands.centre.b < dip.bands.centre.r + dip.bands.centre.b) {
      dip = frame
    }
  }
  expect(dip.bands.centre.r).toBeLessThan(DIMMED)
  expect(dip.bands.centre.b).toBeLessThan(DIMMED)
  expect(dip.bands.corner.r).toBeLessThan(DIMMED)
  expect(dip.bands.corner.b).toBeLessThan(DIMMED)

  // Before the overlap the frame is still all red; deep in the final slate
  // the dip is over and the frame is all blue — the veil really ramps out.
  // The dip sits at the overlap middle, so halfway between the content
  // start and the dip lies inside the red solo, and halfway between the dip
  // and the file's end inside the blue solo.
  const early = frameAt(scan, (contentStart + dip.time) / 2).bands.centre
  expect(early.r).toBeGreaterThan(DOMINANT)
  expect(early.b).toBeLessThan(ABSENT)
  const late = frameAt(scan, (dip.time + scan.duration) / 2).bands.centre
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

  const scan = await scanExportedFrames(page, exported, PATCHES)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the growing ellipse
  // reaches the centre patch early in the reveal, so the incoming blue
  // first appearing there marks the overlap's start; the corner is covered
  // only at the very end, so the outgoing red last surviving there marks
  // its end.
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands.centre.r > DOMINANT,
    'the red slate starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands.centre.b > APPEAR,
    'the reveal ellipse reaching the centre',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands.corner.r > APPEAR,
    'the outgoing red surviving in the corner',
  ).time

  // Mid-iris: the centre of the frame lies inside the reveal ellipse (the
  // incoming blue), the corner outside it (still the outgoing red) — and
  // neither is a blend, the iris edge is a hard reveal.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands
  expect(mid.centre.b).toBeGreaterThan(DOMINANT)
  expect(mid.centre.r).toBeLessThan(ABSENT)
  expect(mid.corner.r).toBeGreaterThan(DOMINANT)
  expect(mid.corner.b).toBeLessThan(ABSENT)

  // Deep in the final slate the iris is fully open: corners are blue too.
  const late = frameAt(scan, (overlapEnd + scan.duration) / 2).bands
  expect(late.corner.b).toBeGreaterThan(DOMINANT)
  expect(late.corner.r).toBeLessThan(ABSENT)
})
