import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { chooseEffect } from './timelineRowMenu'

/**
 * Glitch (#871, steps 2a and 2b(ii)): the Visual effects plugin's bursts
 * of a tear and a channel split, through the `slices` filter and #977's
 * `channel-offset` filter, at the moments its Frequency picks from the
 * entry's time (`glitchBurst`, `glitchBands`). The shared
 * measuring follows `chromatic-aberration.spec.ts`: a white square on
 * black, so each channel's lit extent says where that channel landed, read
 * in the preview and in a saved frame (the export's composer) as fractions
 * of their own frame's width at the same instant.
 *
 * The instants come from the plugin's unit test's rule, worked out for the
 * default Frequency, 30 %, over the default window, 0 to 2 s (bursts are
 * three 24ths of a second, 0.125 s):
 * - 1.55 s is step 37, burst 12, which glitches at 30 % with size 0.982;
 * - 1.30 s is step 31, burst 10, which holds still at 30 % and glitches
 *   at 100 % with size 0.514.
 * Both lie before the window's ease begins at 1.7 s, so at full weight.
 *
 * The split is read on rows of the square that no band of either burst
 * covers (`SPLIT_ROWS`). Burst 12's bands all lie below the square, so its
 * tear moves nothing measured. Burst 10's first and third bands cross the
 * square (`glitchBands(1.3)`: rows 0.357–0.455 moved right by 0.0438 and
 * rows 0.592–0.623 moved left by 0.0486, of the full tear at size 1), so
 * at Frequency 100 the square's edges on those rows move by those shifts
 * times the burst's size: the tear, read in green, which the split leaves
 * where it is.
 */

const STILL = 'square.png'
const POSITION = `${STILL} at position 1`
const SOURCE = { width: 1920, height: 1080, square: { x: 800, y: 300, size: 400 } }
/** `GLITCH.offset`: the split at Intensity 100 in a burst of size 1, as a fraction of the frame's width. */
const FULL_SPLIT = 0.02
const GLITCHING = { time: 1.55, size: 0.982 }
const QUIET = { time: 1.3, sizeAtFull: 0.514 }
/** Rows of the square, as fractions of the frame's height, inside no band of either burst. */
const SPLIT_ROWS: [number, number] = [0.29, 0.34]
/** Rows inside burst 10's two bands that cross the square, and each band's shift at size 1 and Intensity 100. */
const TEAR = {
  a: { rows: [0.39, 0.42] as [number, number], shift: 0.04376 },
  b: { rows: [0.6, 0.615] as [number, number], shift: -0.04862 },
}
/**
 * How far a channel's edge may sit from where the split puts it, in pixels
 * of the image measured: `chromatic-aberration.spec.ts`'s tolerance, for
 * its reason (each renderer rounds the shift to whole pixels of the
 * surface it draws on, which Chromium and Firefox land alike, #980).
 */
const TOLERANCE_PX = 2

/**
 * Each channel's lit extent along x on `SPLIT_ROWS`, as fractions of the
 * image's width, and that width in px; and green's extent on each of
 * `TEAR`'s rows.
 */
type Extents = Record<'r' | 'g' | 'b', [number, number]> & {
  width: number
  tear: Record<keyof typeof TEAR, [number, number]>
}

async function makeSquare(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((source) => {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.fillStyle = '#fff'
    ctx.fillRect(source.square.x, source.square.y, source.square.size, source.square.size)
    return canvas.toDataURL('image/png').split(',')[1]
  }, SOURCE)
  return Buffer.from(base64, 'base64')
}

/**
 * Each channel's first and last lit column (over 128) on `SPLIT_ROWS` of a
 * PNG, and green's on each of `TEAR`'s rows, as fractions of its width.
 */
async function extentsOfPng(page: Page, png: Buffer): Promise<Extents> {
  return await page.evaluate(
    async ({ base64, splitRows, tearRows }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const extent = (channel: number, rows: [number, number]): [number, number] => {
        let first = width
        let last = -1
        for (let y = Math.round(rows[0] * height); y <= Math.round(rows[1] * height); y++) {
          for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + channel] > 128) {
              if (x < first) first = x
              if (x > last) last = x
            }
          }
        }
        return [(first + 0.5) / width, (last + 0.5) / width]
      }
      return {
        width,
        r: extent(0, splitRows),
        g: extent(1, splitRows),
        b: extent(2, splitRows),
        tear: { a: extent(1, tearRows.a), b: extent(1, tearRows.b) },
      }
    },
    { base64: png.toString('base64'), splitRows: SPLIT_ROWS, tearRows: { a: TEAR.a.rows, b: TEAR.b.rows } },
  )
}

/** Enables Visual effects, adds the square for 4 s, and adds Glitch from + Effect ▾. */
async function setup(page: Page) {
  await page.goto('./')
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await page.getByRole('button', { name: 'Enable Visual effects' }).click()
  await expect(page.getByRole('button', { name: 'Disable Visual effects' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: await makeSquare(page) }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  await chooseEffect(page, POSITION, 'Glitch')
}

async function setParam(page: Page, key: 'intensity' | 'frequency', value: number) {
  const field = page.getByRole('spinbutton', { name: `Glitch 1 ${key} of ${POSITION} (percent)` })
  await field.fill(String(value))
  await field.blur()
  await expect(field).toHaveValue(String(value))
}

async function previewAt(page: Page, seconds: number, split: boolean, label: string): Promise<Extents> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  if (split) await expect(image).toHaveCSS('filter', /url\(/)
  else await expect(image).toHaveCSS('filter', 'none')
  const png = await page
    .getByTestId('preview-frame')
    .screenshot({ path: test.info().outputPath(`preview-${label.replaceAll(' ', '-')}.png`) })
  await test.info().attach(`preview (${label})`, { body: png, contentType: 'image/png' })
  return await extentsOfPng(page, png)
}

async function savedFrame(page: Page, label: string): Promise<Extents> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const saved = await readFile((await (await downloadPromise).path())!)
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return await extentsOfPng(page, saved)
}

/** Each channel's extent minus green's, at both edges: where the split moved it. */
function shifts(extents: Extents) {
  return {
    redLeft: extents.r[0] - extents.g[0],
    redRight: extents.r[1] - extents.g[1],
    blueLeft: extents.b[0] - extents.g[0],
    blueRight: extents.b[1] - extents.g[1],
  }
}

const tolerance = (extents: Extents) => TOLERANCE_PX / extents.width

/** Red moved left and blue right by `split` of the frame's width, at both of the square's edges; 0 is no split. */
function expectSplit(extents: Extents, split: number, label: string) {
  const moved = shifts(extents)
  const within = tolerance(extents)
  expect(Math.abs(moved.redLeft + split), `${label}: red's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.redRight + split), `${label}: red's right edge`).toBeLessThan(within)
  expect(Math.abs(moved.blueLeft - split), `${label}: blue's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.blueRight - split), `${label}: blue's right edge`).toBeLessThan(within)
}

function expectPreviewMatchesSaved(preview: Extents, saved: Extents, label: string) {
  const previewShifts = shifts(preview)
  for (const [edge, value] of Object.entries(shifts(saved))) {
    expect(
      Math.abs(previewShifts[edge as keyof typeof previewShifts] - value),
      `${label}: ${edge}, preview vs saved`,
    ).toBeLessThan(tolerance(preview))
  }
  // Green is the source's own square in both: nothing else moved.
  expect(Math.abs(preview.g[0] - saved.g[0]), `${label}: green, preview vs saved`).toBeLessThan(tolerance(preview))
  expect(Math.abs(preview.g[1] - saved.g[1]), `${label}: green, preview vs saved`).toBeLessThan(tolerance(preview))
  // The torn rows landed alike too.
  for (const band of ['a', 'b'] as const) {
    for (const edge of [0, 1] as const) {
      expect(
        Math.abs(preview.tear[band][edge] - saved.tear[band][edge]),
        `${label}: band ${band}'s edge ${edge}, preview vs saved`,
      ).toBeLessThan(tolerance(preview))
    }
  }
}

/**
 * On each of `TEAR`'s rows, green's edges moved from the unbanded rows'
 * by that band's shift times `factor` (Intensity's share times the
 * burst's size), both edges; 0 is no tear.
 */
function expectTear(extents: Extents, factor: number, label: string) {
  const within = tolerance(extents)
  for (const band of ['a', 'b'] as const) {
    for (const edge of [0, 1] as const) {
      expect(
        Math.abs(extents.tear[band][edge] - extents.g[edge] - TEAR[band].shift * factor),
        `${label}: band ${band}'s edge ${edge}`,
      ).toBeLessThan(within)
    }
  }
}

test.describe('Glitch (#871)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('+ Effect ▾ adds it at Intensity 50 and Frequency 30; the preview and a saved frame tear and split the picture alike in a glitching burst, not in a quiet one, and not outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await setup(page)
    await expect(page.getByRole('spinbutton', { name: `Glitch 1 intensity of ${POSITION} (percent)` })).toHaveValue('50')
    await expect(page.getByRole('spinbutton', { name: `Glitch 1 frequency of ${POSITION} (percent)` })).toHaveValue('30')
    await expect(page.getByRole('spinbutton', { name: `Glitch 1 end of ${POSITION} in seconds` })).toHaveValue('2')

    const measured: Record<string, { preview: Extents; saved: Extents }> = {}
    const measure = async (name: string, time: number, split: boolean) => {
      const preview = await previewAt(page, time, split, name)
      const saved = await savedFrame(page, name)
      measured[name] = { preview, saved }
      return { preview, saved }
    }
    // At the defaults: a glitching burst splits, a quiet one does not.
    const glitching = await measure('glitching burst at the defaults', GLITCHING.time, true)
    const quiet = await measure('quiet burst at the defaults', QUIET.time, false)
    // Intensity 100 doubles the glitching burst's split.
    await setParam(page, 'intensity', 100)
    const intense = await measure('glitching burst at Intensity 100', GLITCHING.time, true)
    // Frequency 100 makes the quiet burst glitch, at its own size, tearing
    // the square with two of its bands; Frequency 0 stills the glitching one.
    await setParam(page, 'frequency', 100)
    const everyBurst = await measure('quiet burst at Frequency 100', QUIET.time, true)
    await setParam(page, 'frequency', 0)
    const never = await measure('glitching burst at Frequency 0', GLITCHING.time, false)
    // After the window, nothing is split, at any Frequency.
    await setParam(page, 'frequency', 100)
    const after = await measure('after the window', 3, false)
    console.log(`[${testInfo.project.name}] glitch: ${JSON.stringify(measured)}`)

    const atDefaults = 0.5 * FULL_SPLIT * GLITCHING.size
    expectSplit(glitching.preview, atDefaults, 'preview, glitching burst')
    expectSplit(glitching.saved, atDefaults, 'saved frame, glitching burst')
    expectPreviewMatchesSaved(glitching.preview, glitching.saved, 'glitching burst')
    expectSplit(intense.preview, FULL_SPLIT * GLITCHING.size, 'preview, Intensity 100')
    expectSplit(intense.saved, FULL_SPLIT * GLITCHING.size, 'saved frame, Intensity 100')
    expectPreviewMatchesSaved(intense.preview, intense.saved, 'Intensity 100')
    expectSplit(everyBurst.preview, FULL_SPLIT * QUIET.sizeAtFull, 'preview, quiet burst at Frequency 100')
    expectSplit(everyBurst.saved, FULL_SPLIT * QUIET.sizeAtFull, 'saved frame, quiet burst at Frequency 100')
    expectPreviewMatchesSaved(everyBurst.preview, everyBurst.saved, 'quiet burst at Frequency 100')
    expectTear(everyBurst.preview, QUIET.sizeAtFull, 'preview, quiet burst at Frequency 100')
    expectTear(everyBurst.saved, QUIET.sizeAtFull, 'saved frame, quiet burst at Frequency 100')
    // Burst 12's bands lie below the square, so its rows read untorn.
    for (const [name, { preview, saved }] of Object.entries({ glitching, intense })) {
      expectTear(preview, 0, `preview, ${name}`)
      expectTear(saved, 0, `saved frame, ${name}`)
    }
    for (const [name, { preview, saved }] of Object.entries({ quiet, never, after })) {
      expectSplit(preview, 0, `preview, ${name}`)
      expectSplit(saved, 0, `saved frame, ${name}`)
      expectTear(preview, 0, `preview, ${name}`)
      expectTear(saved, 0, `saved frame, ${name}`)
    }
  })
})
