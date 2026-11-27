import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFrameMenu } from './frameMenu'
import { openPicture } from './pictureDisclosure'
import { chooseEffect } from './timelineRowMenu'

/**
 * The `slices` picture filter (#871, step 2b(i)): horizontal bands of the
 * picture moved sideways, through one SVG filter that the preview's CSS
 * `filter` and the export's `ctx.filter` both reference. No effect the app
 * ships uses the kind yet (Glitch adopts it in step 2b(ii)), so this spec
 * registers a test-only definition into the running app's registry through
 * the dev server's own module URL, as `channel-offset.spec.ts` does, and
 * adds it from + Effect ▾ like any other.
 *
 * The source is a white square on opaque black, and both bands cross it,
 * so the square's lit extent along a row says where that row landed. Band
 * A moves right and band B left, each edge of the square by the band's
 * shift: the moved band is opaque, so the source merged under it does not
 * show through. The preview and a saved frame are compared as fractions of
 * their own frame's width, at the same instant.
 */

const STILL = 'square.png'
const POSITION = `${STILL} at position 1`
const SOURCE = { width: 1920, height: 1080, square: { x: 760, y: 340, size: 400 } }
const EFFECT_NAME = 'Test slices'
/**
 * The test effect's bands at full weight. Both lie inside the square's
 * rows in the plain frame (0.315–0.685 of its height) and in the
 * quarter-turned one (0.396–0.604), with a gap between them.
 */
const BANDS = [
  { top: 0.42, height: 0.05, shift: 0.02 },
  { top: 0.52, height: 0.05, shift: -0.03 },
]
/** The rows read, as fractions of the image's height: the middle of each band, and the gap between them. */
const ROWS = { a: 0.445, b: 0.545, between: 0.495 }
/**
 * How far an edge may sit from where the band puts it, in pixels of the
 * image measured: for the rounding of the filter's numbers to whole device
 * px (#1021), the
 * image's own pixel grid, and the threshold crossing landing on either
 * side of an edge pixel.
 */
const TOLERANCE_PX = 2

/** The square's first and last lit column on each row read, as fractions of the image's width, and that width in px. */
type Rows = Record<keyof typeof ROWS, [number, number]> & { width: number }

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

/** The lit extent (green over 128) of each row read, in a PNG. */
async function rowsOfPng(page: Page, png: Buffer): Promise<Rows> {
  return await page.evaluate(
    async ({ base64, rows }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const out = { width } as Record<string, [number, number]> & { width: number }
      for (const [name, fraction] of Object.entries(rows)) {
        const y = Math.floor(fraction * height)
        let first = width
        let last = -1
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 1] > 128) {
            if (x < first) first = x
            if (x > last) last = x
          }
        }
        // A column's centre, so the extent reads the same at any width.
        out[name] = [(first + 0.5) / width, (last + 0.5) / width]
      }
      return out as Rows
    },
    { base64: png.toString('base64'), rows: ROWS },
  )
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
    async ({ name, bands }) => {
      const url = new URL('src/lib/pictureEffect.ts', document.baseURI).href
      const module = (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/pictureEffect')
      module.pictureEffectRegistry.register({
        id: 'test-slices',
        name,
        params: [],
        look: (_params, weight) => ({
          filters: [{ kind: 'slices', bands: bands.map((band) => ({ ...band, shift: band.shift * weight })) }],
          layers: [],
        }),
      })
    },
    { name: EFFECT_NAME, bands: BANDS },
  )
  await chooseEffect(page, POSITION, EFFECT_NAME)
}

async function previewAt(page: Page, seconds: number, sliced: boolean, label: string): Promise<Rows> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  if (sliced) await expect(image).toHaveCSS('filter', /url\(/)
  else await expect(image).toHaveCSS('filter', 'none')
  const png = await page.getByTestId('preview-frame').screenshot()
  await test.info().attach(`preview (${label})`, { body: png, contentType: 'image/png' })
  return await rowsOfPng(page, png)
}

async function savedFrame(page: Page, label: string): Promise<Rows> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const saved = await readFile((await (await downloadPromise).path())!)
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return await rowsOfPng(page, saved)
}

/** Each band row's edges less the gap row's: where the band moved them. */
function moves(rows: Rows) {
  return {
    aLeft: rows.a[0] - rows.between[0],
    aRight: rows.a[1] - rows.between[1],
    bLeft: rows.b[0] - rows.between[0],
    bRight: rows.b[1] - rows.between[1],
  }
}

const tolerance = (rows: Rows) => TOLERANCE_PX / rows.width

function expectSliced(rows: Rows, label: string) {
  const moved = moves(rows)
  const within = tolerance(rows)
  // The square is there to be measured on every row.
  expect(rows.between[1] - rows.between[0], `${label}: the square's width`).toBeGreaterThan(0.1)
  // Band A moved right and band B left, both edges by the band's shift.
  expect(Math.abs(moved.aLeft - BANDS[0].shift), `${label}: band A's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.aRight - BANDS[0].shift), `${label}: band A's right edge`).toBeLessThan(within)
  expect(Math.abs(moved.bLeft - BANDS[1].shift), `${label}: band B's left edge`).toBeLessThan(within)
  expect(Math.abs(moved.bRight - BANDS[1].shift), `${label}: band B's right edge`).toBeLessThan(within)
}

function expectSameAs(preview: Rows, saved: Rows, label: string) {
  for (const row of Object.keys(ROWS) as (keyof typeof ROWS)[]) {
    for (const edge of [0, 1] as const) {
      expect(Math.abs(preview[row][edge] - saved[row][edge]), `${label}: row ${row}, edge ${edge}`).toBeLessThan(
        tolerance(preview),
      )
    }
  }
}

test.describe('Slices picture filter (#871)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('the preview and a saved frame move the same bands of rows by the same share of the frame, and nothing outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page)
    const preview = await previewAt(page, 1, true, 'inside the window')
    const saved = await savedFrame(page, 'inside the window')
    const previewAfter = await previewAt(page, 3, false, 'after the window')
    const savedAfter = await savedFrame(page, 'after the window')
    console.log(`[${testInfo.project.name}] slices: ${JSON.stringify({ preview, saved, previewAfter, savedAfter })}`)

    expectSliced(preview, 'preview')
    expectSliced(saved, 'saved frame')
    expectSameAs(preview, saved, 'preview vs saved')
    for (const [name, rows] of Object.entries({ previewAfter, savedAfter })) {
      for (const [edge, value] of Object.entries(moves(rows))) {
        expect(Math.abs(value), `${name}: ${edge} unmoved`).toBeLessThan(tolerance(rows))
      }
    }
  })

  test('inside a zoom, the bands stay on the same rows of the frame in the preview as in a saved frame', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page)
    // The default zoom holds over 0.5–1.5 s, so 1 s is at its full scale:
    // the card's transform magnifies the preview's filter, which takes the
    // bands back through the zoom to land where the export's do.
    await chooseEffect(page, POSITION, 'Zoom')
    const preview = await previewAt(page, 1, true, 'zoomed')
    const saved = await savedFrame(page, 'zoomed')
    console.log(`[${testInfo.project.name}] slices, zoomed: ${JSON.stringify({ preview, saved })}`)
    // The zoom magnified the square itself.
    expect(saved.between[1] - saved.between[0], 'the square, magnified').toBeGreaterThan(
      (SOURCE.square.size / SOURCE.width) * 1.1,
    )
    expectSliced(preview, 'preview, zoomed')
    expectSliced(saved, 'saved frame, zoomed')
    expectSameAs(preview, saved, 'preview vs saved, zoomed')
  })

  test('on a clip turned a quarter and flipped, the preview still moves horizontal bands sideways on the screen, as the saved frame does', async ({
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
    console.log(`[${testInfo.project.name}] slices, turned and flipped: ${JSON.stringify({ preview, saved })}`)
    expectSliced(preview, 'preview, turned and flipped')
    expectSliced(saved, 'saved frame, turned and flipped')
    expectSameAs(preview, saved, 'preview vs saved, turned and flipped')
  })
})
