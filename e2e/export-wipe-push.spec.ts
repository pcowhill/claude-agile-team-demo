import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { firstFrame, frameAt, lastFrame, scanExportedFrames } from './decodedFrame'
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
 * Named bands of the decoded frame, sampled by scanning every grid frame of
 * the exported file (#370). Sample positions are measured from the file's
 * own phases, not computed from the nominal timeline: the export is a
 * real-time recording whose phases stretch and shift under CPU load, so the
 * old fixed offsets from the file's end landed in the wrong phase on a
 * loaded machine (this spec's top-band sample was one of #370's recorded
 * failures). The overlap window is located by the transition's own color
 * signature — the incoming blue first appearing in its entry band, the
 * outgoing red last surviving in its exit band — and assertions sample at
 * positions inside that measured window.
 */
const BANDS: Record<'left-fifth' | 'right-fifth' | 'top-quarter' | 'bottom-quarter', SampleRect> = {
  'left-fifth': { x: 0, y: 0, width: 0.2, height: 1 },
  'right-fifth': { x: 0.8, y: 0, width: 0.2, height: 1 },
  'top-quarter': { x: 0, y: 0, width: 1, height: 0.25 },
  'bottom-quarter': { x: 0, y: 0.75, width: 1, height: 0.25 },
}

/** Strong presence of a slate's own color channel in a band average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60
/**
 * A channel has clearly appeared in a band — above codec bleed on a
 * saturated slate, far below any real presence. Used only to LOCATE phase
 * boundaries; the content assertions keep the thresholds above. The
 * measured window sits slightly inside the true overlap (the signature
 * crosses the threshold a few percent of progress in), which only moves
 * sampled positions toward the middle — where every asserted claim holds
 * with the widest margin.
 */
const APPEAR = 80

test('a wipe-from-left exports with the incoming clip revealed from the left (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'wipe-from-left')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the wipe reveals from the
  // left, so the incoming blue first appears in the left fifth, and the
  // outgoing red last survives in the right fifth (uncovered until the
  // wipe's final fifth of progress).
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['left-fifth'].r > DOMINANT,
    'the red slate starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands['left-fifth'].b > APPEAR,
    'the incoming blue entering the left fifth',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands['right-fifth'].r > APPEAR,
    'the outgoing red surviving in the right fifth',
  ).time

  // Mid-wipe: the left of the frame shows the incoming blue behind the
  // wipe's edge, the right still the outgoing red — and neither side is a
  // blend, the edge is a hard reveal.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands
  expect(mid['left-fifth'].b).toBeGreaterThan(DOMINANT)
  expect(mid['left-fifth'].r).toBeLessThan(ABSENT)
  expect(mid['right-fifth'].r).toBeGreaterThan(DOMINANT)
  expect(mid['right-fifth'].b).toBeLessThan(ABSENT)

  // Deep in the final slate the wipe is over: the whole frame is blue.
  const late = frameAt(scan, (overlapEnd + scan.duration) / 2).bands
  expect(late['right-fifth'].b).toBeGreaterThan(DOMINANT)
  expect(late['right-fifth'].r).toBeLessThan(ABSENT)
})

test('a push-from-above exports with the incoming clip pushing the outgoing one down (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'push-from-above')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the push enters from
  // above, so the incoming blue first appears in the top quarter, and the
  // outgoing red — pushed down in lockstep — last survives in the bottom
  // quarter (which it still occupies until the push's final quarter of
  // progress).
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['top-quarter'].r > DOMINANT,
    'the red slate starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands['top-quarter'].b > APPEAR,
    'the incoming blue entering the top quarter',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands['bottom-quarter'].r > APPEAR,
    'the outgoing red surviving in the bottom quarter',
  ).time

  // Mid-push: the incoming blue occupies the top half while the outgoing
  // red, pushed down in lockstep, still fills the bottom.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands
  expect(mid['top-quarter'].b).toBeGreaterThan(DOMINANT)
  expect(mid['top-quarter'].r).toBeLessThan(ABSENT)
  expect(mid['bottom-quarter'].r).toBeGreaterThan(DOMINANT)
  expect(mid['bottom-quarter'].b).toBeLessThan(ABSENT)

  // Before the overlap begins the frame is still all red.
  const early = frameAt(scan, (contentStart + overlapStart) / 2).bands
  expect(early['top-quarter'].r).toBeGreaterThan(DOMINANT)
  expect(early['top-quarter'].b).toBeLessThan(ABSENT)
})
