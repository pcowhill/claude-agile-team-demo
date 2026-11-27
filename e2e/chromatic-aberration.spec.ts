import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { chooseEffect } from './timelineRowMenu'

/**
 * Chromatic aberration (#871, step 1): the Visual effects plugin's split of
 * the picture's red and blue, through #977's `channel-offset` filter. The
 * filter itself is measured in `channel-offset.spec.ts` with a test-only
 * effect; this spec measures the shipped effect, added from + Effect ▾,
 * at its Amount.
 *
 * The source is a white square on black, so each channel's lit extent
 * says exactly where that channel landed. The preview and a saved frame
 * (the export's composer) are compared as fractions of their own frame's
 * width at the same instant, inside the effect's default window (0–2 s)
 * and after it.
 */

const STILL = 'square.png'
const POSITION = `${STILL} at position 1`
const SOURCE = { width: 1920, height: 1080, square: { x: 800, y: 300, size: 400 } }
/** `CHROMATIC_ABERRATION.offset`: the split at Amount 100, as a fraction of the frame's width. */
const FULL_SPLIT = 0.01
/**
 * How far a channel's edge may sit from where the split puts it, in pixels
 * of the image measured. Both renderers round the shift to whole pixels of
 * the surface they draw on (#980), which Chromium and Firefox land alike,
 * so a channel sits within half a pixel of the exact shift; and the
 * threshold crossing can fall on either side of an edge pixel. As in
 * `channel-offset.spec.ts`, whose numbers in both browsers fit it.
 */
const TOLERANCE_PX = 2

/** Each channel's lit extent along x, as fractions of the image's width, and that width in px. */
type Extents = Record<'r' | 'g' | 'b', [number, number]> & { width: number }

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

/** Each channel's first and last lit column (over 128) anywhere in a PNG, as fractions of its width. */
async function extentsOfPng(page: Page, png: Buffer): Promise<Extents> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const out = { width } as Record<'r' | 'g' | 'b', [number, number]> & { width: number }
    ;(['r', 'g', 'b'] as const).forEach((name, channel) => {
      let first = width
      let last = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + channel] > 128) {
            if (x < first) first = x
            if (x > last) last = x
          }
        }
      }
      out[name] = [(first + 0.5) / width, (last + 0.5) / width]
    })
    return out
  }, png.toString('base64'))
}

/** Enables Visual effects, adds the square for 4 s, and adds Chromatic aberration from + Effect ▾. */
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
  await chooseEffect(page, POSITION, 'Chromatic aberration')
}

async function setAmount(page: Page, amount: number) {
  const field = page.getByRole('spinbutton', { name: `Chromatic aberration 1 amount of ${POSITION} (percent)` })
  await field.fill(String(amount))
  await field.blur()
  await expect(field).toHaveValue(String(amount))
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

/** Red moved left and blue right by `split` of the frame's width, at both of the square's edges. */
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
}

test.describe('Chromatic aberration (#871)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('+ Effect ▾ adds it at Amount 30; the preview and a saved frame split red and blue alike, more at a higher Amount, and not at all outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await setup(page)
    await expect(
      page.getByRole('spinbutton', { name: `Chromatic aberration 1 amount of ${POSITION} (percent)` }),
    ).toHaveValue('30')
    await expect(page.getByRole('spinbutton', { name: `Chromatic aberration 1 end of ${POSITION} in seconds` })).toHaveValue(
      '2',
    )

    // At its default, 1 s is inside the window and at full weight.
    const preview30 = await previewAt(page, 1, true, 'Amount 30')
    const saved30 = await savedFrame(page, 'Amount 30')
    await setAmount(page, 100)
    const preview100 = await previewAt(page, 1, true, 'Amount 100')
    const saved100 = await savedFrame(page, 'Amount 100')
    // After the window, nothing is split.
    const previewAfter = await previewAt(page, 3, false, 'after the window')
    const savedAfter = await savedFrame(page, 'after the window')
    console.log(
      `[${testInfo.project.name}] chromatic aberration: ${JSON.stringify({
        preview30,
        saved30,
        preview100,
        saved100,
        previewAfter,
        savedAfter,
      })}`,
    )

    expectSplit(preview30, 0.3 * FULL_SPLIT, 'preview at Amount 30')
    expectSplit(saved30, 0.3 * FULL_SPLIT, 'saved frame at Amount 30')
    expectPreviewMatchesSaved(preview30, saved30, 'Amount 30')
    expectSplit(preview100, FULL_SPLIT, 'preview at Amount 100')
    expectSplit(saved100, FULL_SPLIT, 'saved frame at Amount 100')
    expectPreviewMatchesSaved(preview100, saved100, 'Amount 100')
    // A higher Amount splits further, in both renderers.
    expect(shifts(saved100).blueLeft, 'saved frame: wider at 100 than at 30').toBeGreaterThan(
      shifts(saved30).blueLeft + 0.5 * FULL_SPLIT,
    )
    expect(shifts(preview100).blueLeft, 'preview: wider at 100 than at 30').toBeGreaterThan(
      shifts(preview30).blueLeft + 0.5 * FULL_SPLIT,
    )
    for (const [name, extents] of Object.entries({ previewAfter, savedAfter })) {
      for (const [edge, value] of Object.entries(shifts(extents))) {
        expect(Math.abs(value), `${name}: ${edge} unsplit`).toBeLessThan(tolerance(extents))
      }
    }
  })
})
