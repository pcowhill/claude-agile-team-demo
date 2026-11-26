import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFrameMenu } from './frameMenu'
import { openPicture } from './pictureDisclosure'
import { chooseEffect } from './timelineRowMenu'

/**
 * The `channel-offset` picture filter (#870, step 2b(ii)2): red moved left
 * and blue moved right by a fraction of the frame width, through one SVG
 * filter that the preview's CSS `filter` and the export's `ctx.filter`
 * both reference. No effect the app ships uses the kind yet (VHS adopts
 * it in step 2b(ii)3), so this spec registers a test-only definition into
 * the running app's registry through the dev server's own module URL, the
 * same module instance the app imported, and adds it from + Effect ▾ like
 * any other.
 *
 * The source is a white square on black, so each channel's lit extent
 * says exactly where that channel landed. The preview and a saved frame
 * are compared as fractions of their own frame's width, at the same
 * instant: the shift each renderer resolves from the same fraction.
 */

const STILL = 'square.png'
const POSITION = `${STILL} at position 1`
const SOURCE = { width: 1920, height: 1080, square: { x: 800, y: 300, size: 400 } }
/** The test effect's shift at full weight, as a fraction of the frame's width. */
const OFFSET = 0.03
const EFFECT_NAME = 'Test channel offset'
/**
 * How far a channel's edge may sit from where the shift puts it, in pixels
 * of the image measured: for the shift's rounding to 0.1 px, the image's
 * own pixel grid, and the threshold crossing landing on either side of an
 * edge pixel. As a fraction of the image's width, it is wider for the
 * preview, the smaller image.
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
      // A column's centre, so the extent reads the same at any width.
      out[name] = [(first + 0.5) / width, (last + 0.5) / width]
    })
    return out
  }, png.toString('base64'))
}

/** The still on the timeline for 4 s, with the test effect from + Effect ▾ over 0–2 s. */
async function setup(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: await makeSquare(page) }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  await page.evaluate(
    async ({ name, offset }) => {
      const url = new URL('src/lib/pictureEffect.ts', document.baseURI).href
      const module = (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/pictureEffect')
      module.pictureEffectRegistry.register({
        id: 'test-channel-offset',
        name,
        params: [],
        look: (_params, weight) => ({ filters: [{ kind: 'channel-offset', offset: offset * weight }], layers: [] }),
      })
    },
    { name: EFFECT_NAME, offset: OFFSET },
  )
  await chooseEffect(page, POSITION, EFFECT_NAME)
}

async function previewAt(page: Page, seconds: number, shifted: boolean, label: string): Promise<Extents> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  if (shifted) await expect(image).toHaveCSS('filter', /url\(/)
  else await expect(image).toHaveCSS('filter', 'none')
  const png = await page.getByTestId('preview-frame').screenshot()
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

/** Each channel's extent minus green's, at both edges: where the shift moved it. */
function shifts(extents: Extents) {
  return {
    redLeft: extents.r[0] - extents.g[0],
    redRight: extents.r[1] - extents.g[1],
    blueLeft: extents.b[0] - extents.g[0],
    blueRight: extents.b[1] - extents.g[1],
  }
}

const tolerance = (extents: Extents) => TOLERANCE_PX / extents.width

function expectShifted(extents: Extents, label: string) {
  const moved = shifts(extents)
  const within = tolerance(extents)
  expect(Math.abs(moved.redLeft + OFFSET), `${label}: red's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.redRight + OFFSET), `${label}: red's right edge`).toBeLessThan(within)
  expect(Math.abs(moved.blueLeft - OFFSET), `${label}: blue's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.blueRight - OFFSET), `${label}: blue's right edge`).toBeLessThan(within)
}

test.describe('Channel offset picture filter (#870)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('the preview and a saved frame move red left and blue right by the same share of the frame, and nothing outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page)
    const preview = await previewAt(page, 1, true, 'inside the window')
    const saved = await savedFrame(page, 'inside the window')
    const previewAfter = await previewAt(page, 3, false, 'after the window')
    const savedAfter = await savedFrame(page, 'after the window')
    console.log(
      `[${testInfo.project.name}] channel offset: ${JSON.stringify({ preview, saved, previewAfter, savedAfter })}`,
    )

    expectShifted(preview, 'preview')
    expectShifted(saved, 'saved frame')
    const previewShifts = shifts(preview)
    for (const [edge, value] of Object.entries(shifts(saved))) {
      expect(
        Math.abs(previewShifts[edge as keyof typeof previewShifts] - value),
        `${edge}, preview vs saved`,
      ).toBeLessThan(tolerance(preview))
    }
    // Green is the source's own square in both.
    expect(Math.abs(preview.g[0] - saved.g[0]), 'green, preview vs saved').toBeLessThan(tolerance(preview))
    for (const [name, extents] of Object.entries({ previewAfter, savedAfter })) {
      for (const [edge, value] of Object.entries(shifts(extents))) {
        expect(Math.abs(value), `${name}: ${edge} unshifted`).toBeLessThan(tolerance(extents))
      }
    }
  })

  test('inside a zoom, the shift stays the same share of the frame in the preview as in a saved frame', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page)
    // The default zoom holds over 0.5–1.5 s, so 1 s is at its full scale:
    // the card's transform magnifies the preview's filter, which divides
    // the shift by the zoom's scale to land where the export's does.
    await chooseEffect(page, POSITION, 'Zoom')
    const preview = await previewAt(page, 1, true, 'zoomed')
    const saved = await savedFrame(page, 'zoomed')
    console.log(`[${testInfo.project.name}] channel offset, zoomed: ${JSON.stringify({ preview, saved })}`)
    // The zoom magnified the square itself.
    expect(saved.g[1] - saved.g[0], 'the square, magnified').toBeGreaterThan(
      (SOURCE.square.size / SOURCE.width) * 1.1,
    )
    expectShifted(preview, 'preview, zoomed')
    expectShifted(saved, 'saved frame, zoomed')
  })

  test('on a clip turned a quarter and flipped, the preview still moves red left and blue right on the screen, as the saved frame does', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page)
    await openPicture(page, POSITION)
    await page
      .getByRole('button', { name: `Rotate ${POSITION} 90 degrees clockwise (currently 0 degrees)` })
      .click()
    await page.getByRole('checkbox', { name: `Flip ${POSITION} horizontally` }).check()
    await expect(page.getByTestId('preview-image')).toHaveCSS('transform', /matrix/)
    const preview = await previewAt(page, 1, true, 'turned and flipped')
    const saved = await savedFrame(page, 'turned and flipped')
    console.log(`[${testInfo.project.name}] channel offset, turned and flipped: ${JSON.stringify({ preview, saved })}`)
    expectShifted(preview, 'preview, turned and flipped')
    expectShifted(saved, 'saved frame, turned and flipped')
  })
})
