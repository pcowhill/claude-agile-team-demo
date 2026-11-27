import { readFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { chooseClipAction } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { chooseEffect, openEffectMenu } from './timelineRowMenu'

/**
 * Picture effects on overlays (#872): a saved frame (the export's own frame
 * composer, step 2) and the preview (step 3a; channel offset and slices,
 * step 3b(i)) draw an overlay's effects on the overlay's own picture and
 * nowhere else.
 *
 * The rendering tests save the project, write the effects into the saved
 * file's overlay (the `pictureEffects` key step 1 added, schema 35), and
 * open that file, as a hand-made project would arrive. The effect types
 * are test-only definitions registered into the running app's registry
 * through the dev server's module URL, as `channel-offset.spec.ts` does,
 * so those tests do not depend on the Visual effects plugin's own
 * numbers. The UI tests (step 4) add the plugin's real effects through
 * the overlay's + Effect ▾.
 *
 * The overlay is an image overlay. Its draw shares every line of the
 * effect path with a video overlay's (`paintOverlay` in `exportVideo.ts`);
 * only where the picture comes from differs.
 */

/** A still the size of the frame the sequence composes at (#176). */
const FRAME = { width: 640, height: 360 }
/** Where a new overlay is placed (`export-image-overlay.spec.ts`): (0.62, 0.62)–(0.97, 0.97). */
const CARD = { x: 0.62, y: 0.62, width: 0.35, height: 0.35 }
const BLUR_NAME = 'Test overlay blur'
const VIGNETTE_NAME = 'Test overlay vignette'
const PIXELATE_NAME = 'Test overlay pixelate'
const OFFSET_NAME = 'Test overlay channel offset'
const SLICES_NAME = 'Test overlay slices'
/** The test channel offset's shift, and the test slice's band, as shares of the overlay's outline. */
const OFFSET = 0.1
const BAND = { top: 0.3, height: 0.3, shift: 0.1 }

type Region = { x: number; y: number; width: number; height: number }

/** A black-and-white checkerboard of `square` px, or a solid fill. */
async function makePng(page: Page, fill: { square: number } | { color: string }): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ frame, fill }) => {
      const canvas = document.createElement('canvas')
      canvas.width = frame.width
      canvas.height = frame.height
      const ctx = canvas.getContext('2d')!
      if ('color' in fill) {
        ctx.fillStyle = fill.color
        ctx.fillRect(0, 0, frame.width, frame.height)
      } else {
        for (let y = 0; y < frame.height; y += fill.square) {
          for (let x = 0; x < frame.width; x += fill.square) {
            ctx.fillStyle = (x / fill.square + y / fill.square) % 2 === 0 ? '#fff' : '#000'
            ctx.fillRect(x, y, fill.square, fill.square)
          }
        }
      }
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { frame: FRAME, fill },
  )
  return Buffer.from(base64, 'base64')
}

/**
 * Registers the test effects: a blur of 0.03 of the card's width, a strong
 * vignette, a pixelate in blocks of 0.05 of the card's width, a channel
 * offset of `OFFSET`, and one slice, `BAND`.
 */
async function registerTestEffects(page: Page) {
  await page.evaluate(
    async ({ blurName, vignetteName, pixelateName, offsetName, slicesName, offset, band }) => {
      const url = new URL('src/lib/pictureEffect.ts', document.baseURI).href
      const module = (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/pictureEffect')
      module.pictureEffectRegistry.register({
        id: 'test-overlay-blur',
        name: blurName,
        params: [],
        look: (_params, weight) => ({ filters: [{ kind: 'blur', radius: 0.03 * weight }], layers: [] }),
      })
      module.pictureEffectRegistry.register({
        id: 'test-overlay-vignette',
        name: vignetteName,
        params: [],
        look: (_params, weight) => ({ filters: [], layers: [{ kind: 'vignette', strength: 0.9 * weight, inner: 0.2 }] }),
      })
      module.pictureEffectRegistry.register({
        id: 'test-overlay-pixelate',
        name: pixelateName,
        params: [],
        look: () => ({ filters: [{ kind: 'pixelate', block: 0.05 }], layers: [] }),
      })
      module.pictureEffectRegistry.register({
        id: 'test-overlay-channel-offset',
        name: offsetName,
        params: [],
        look: (_params, weight) => ({ filters: [{ kind: 'channel-offset', offset: offset * weight }], layers: [] }),
      })
      module.pictureEffectRegistry.register({
        id: 'test-overlay-slices',
        name: slicesName,
        params: [],
        look: () => ({ filters: [{ kind: 'slices', bands: [band] }], layers: [] }),
      })
    },
    {
      blurName: BLUR_NAME,
      vignetteName: VIGNETTE_NAME,
      pixelateName: PIXELATE_NAME,
      offsetName: OFFSET_NAME,
      slicesName: SLICES_NAME,
      offset: OFFSET,
      band: BAND,
    },
  )
}

/**
 * A 4 s still on the timeline with a still overlay over it, saved as
 * references, re-opened with `overlayFields` written into the overlay.
 */
async function openWithOverlayFields(
  page: Page,
  base: { name: string; png: Buffer },
  overlay: { name: string; png: Buffer },
  overlayFields: Record<string, unknown>,
) {
  // Force the anchor-download save path (as save.spec.ts does).
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  await registerTestEffects(page)
  const files = base.name === overlay.name ? [base] : [base, overlay]
  await page
    .getByTestId('clip-file-input')
    .setInputFiles(files.map(({ name, png }) => ({ name, mimeType: 'image/png', buffer: png })))
  await page.getByRole('button', { name: `Add ${base.name} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${base.name} at position 1 in seconds` })
  await duration.fill('4')
  await duration.blur()
  await chooseClipAction(page, overlay.name, 'Add as overlay')
  await expect(page.getByTestId('preview-overlay-card-0')).toBeVisible()

  await chooseFromFileMenu(page, 'Save As…')
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const saved = await readFile((await (await downloadPromise).path())!)

  const document = JSON.parse(gunzipSync(saved).toString('utf8'))
  expect(document.timeline.videoOverlays).toHaveLength(1)
  Object.assign(document.timeline.videoOverlays[0], overlayFields)
  // The version an overlay's effects force (step 1's OVERLAY_PICTURE_EFFECTS_SCHEMA_VERSION).
  document.schemaVersion = Math.max(document.schemaVersion, 35)
  const edited = gzipSync(Buffer.from(JSON.stringify(document), 'utf8'))

  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'effects.bvep', mimeType: 'application/gzip', buffer: edited }])
  const relink = page.getByRole('dialog', { name: 'Open effects.bvep' })
  await expect(relink).toBeVisible()
  await page
    .getByTestId('relink-file-input')
    .setInputFiles(files.map(({ name, png }) => ({ name, mimeType: 'image/png', buffer: png })))
  const openButton = relink.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(relink).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
}

/** The saved frame (the export's composer) at `seconds`, attached to the report. */
async function savedFrameAt(page: Page, seconds: number, label: string): Promise<Buffer> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const png = await readFile((await (await downloadPromise).path())!)
  await test.info().attach(`saved frame (${label})`, { body: png, contentType: 'image/png' })
  return png
}

/**
 * The preview's frame at `seconds`, once the overlay's media element carries
 * the look's filter (`filter` matches it) or none, attached to the report.
 */
async function previewAt(page: Page, seconds: number, filter: RegExp | 'none', label: string): Promise<Buffer> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const overlay = page.getByTestId('preview-overlay-0')
  await expect.poll(() => overlay.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  await expect(page.getByTestId('preview-image')).toBeVisible()
  if (filter === 'none') await expect(overlay).toHaveCSS('filter', 'none')
  else await expect(overlay).toHaveCSS('filter', filter)
  const png = await page.getByTestId('preview-frame').screenshot()
  await test.info().attach(`preview (${label})`, { body: png, contentType: 'image/png' })
  return png
}

/**
 * Per region of a PNG (frame fractions): the mean green, and the mean
 * absolute difference between horizontally adjacent pixels' green — how
 * sharp the pattern in it is.
 */
async function measure(
  page: Page,
  png: Buffer,
  regions: Record<string, Region>,
): Promise<Record<string, { mean: number; contrast: number }> & { width: number; height: number }> {
  return await page.evaluate(
    async ({ base64, regions }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const out: Record<string, unknown> = { width, height }
      for (const [name, region] of Object.entries(regions)) {
        const x0 = Math.round(region.x * width)
        const y0 = Math.round(region.y * height)
        const x1 = Math.round((region.x + region.width) * width)
        const y1 = Math.round((region.y + region.height) * height)
        let sum = 0
        let count = 0
        let diff = 0
        let pairs = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const green = data[(y * width + x) * 4 + 1]
            sum += green
            count++
            if (x + 1 < x1) {
              diff += Math.abs(data[(y * width + x + 1) * 4 + 1] - green)
              pairs++
            }
          }
        }
        out[name] = { mean: sum / count, contrast: diff / pairs }
      }
      return out as Record<string, { mean: number; contrast: number }> & { width: number; height: number }
    },
    { base64: png.toString('base64'), regions },
  )
}

/**
 * A frame-sized PNG: black, with a white bar from 0.375 to 0.625 of its
 * width, top to bottom. Every row has its edges, so a channel's extent or
 * a band's shift reads on any row, and zoomed 2× about the centre the bar
 * still lies well inside an overlay's rectangle.
 */
async function makeBar(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((frame) => {
    const canvas = document.createElement('canvas')
    canvas.width = frame.width
    canvas.height = frame.height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, frame.width, frame.height)
    ctx.fillStyle = '#fff'
    ctx.fillRect(frame.width * 0.375, 0, frame.width * 0.25, frame.height)
    return canvas.toDataURL('image/png').split(',')[1]
  }, FRAME)
  return Buffer.from(base64, 'base64')
}

/**
 * Per row of a PNG inside `region` (frame fractions), each channel's first
 * and last lit column (over 128), as fractions of the image's width, or
 * null for a row with none lit. Column and row centres, so the readings
 * compare across the preview's and the saved frame's sizes.
 */
async function rowEdges(
  page: Page,
  png: Buffer,
  region: Region,
): Promise<{ width: number; height: number; rows: { y: number; r: number[] | null; g: number[] | null; b: number[] | null }[] }> {
  return await page.evaluate(
    async ({ base64, region }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const x0 = Math.round(region.x * width)
      const x1 = Math.round((region.x + region.width) * width)
      const y0 = Math.round(region.y * height)
      const y1 = Math.round((region.y + region.height) * height)
      const rows = []
      for (let y = y0; y < y1; y++) {
        const row: { y: number; r: number[] | null; g: number[] | null; b: number[] | null } = {
          y: (y + 0.5) / height,
          r: null,
          g: null,
          b: null,
        }
        ;(['r', 'g', 'b'] as const).forEach((name, channel) => {
          let first = -1
          let last = -1
          for (let x = x0; x < x1; x++) {
            if (data[(y * width + x) * 4 + channel] > 128) {
              if (first < 0) first = x
              last = x
            }
          }
          row[name] = first < 0 ? null : [(first + 0.5) / width, (last + 0.5) / width]
        })
        rows.push(row)
      }
      return { width, height, rows }
    },
    { base64: png.toString('base64'), region },
  )
}

/** The median of some numbers, so a row or two at an antialiased edge does not move it. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? Number.NaN : sorted[Math.floor(sorted.length / 2)]
}

/**
 * How far red's and blue's edges sit from green's, as fractions of the
 * image's width: the median over the rows of `region` that have all three.
 */
async function channelShifts(page: Page, png: Buffer, region: Region) {
  const { width, rows } = await rowEdges(page, png, region)
  const lit = rows.filter((row) => row.r !== null && row.g !== null && row.b !== null)
  return {
    width,
    rows: lit.length,
    redLeft: median(lit.map((row) => row.r![0] - row.g![0])),
    redRight: median(lit.map((row) => row.r![1] - row.g![1])),
    blueLeft: median(lit.map((row) => row.b![0] - row.g![0])),
    blueRight: median(lit.map((row) => row.b![1] - row.g![1])),
  }
}

/**
 * Where a slice moved the bar's left edge in `region`: the rows whose edge
 * sits more than half of `shift` (a fraction of the image's width) right
 * of the region's usual edge, as their first and last row (fractions of
 * the image's height), and their edge's median distance from the others'.
 */
async function slicedRows(page: Page, png: Buffer, region: Region, shift: number) {
  const { width, height, rows } = await rowEdges(page, png, region)
  const lit = rows.filter((row) => row.g !== null)
  const usual = median(lit.map((row) => row.g![0]))
  const moved = lit.filter((row) => row.g![0] - usual > shift / 2)
  const still = lit.filter((row) => row.g![0] - usual <= shift / 2)
  return {
    width,
    height,
    rows: moved.length,
    top: moved.length === 0 ? Number.NaN : moved[0].y,
    bottom: moved.length === 0 ? Number.NaN : moved[moved.length - 1].y,
    shift: median(moved.map((row) => row.g![0])) - median(still.map((row) => row.g![0])),
  }
}

test('a blur on an overlay softens its picture and not the frame around it', async ({ page }) => {
  test.setTimeout(90_000)
  // 32 px squares: about 11 px on the 224 px wide overlay, so a blur of
  // 0.03 of its width (6.7 px) all but flattens them, while the base's
  // squares stay crisp.
  const board = await makePng(page, { square: 32 })
  await openWithOverlayFields(
    page,
    { name: 'board.png', png: board },
    { name: 'board.png', png: board },
    // On screen 0–5 s (a still overlay's default length): the blur over 0–2 s.
    { pictureEffects: [{ id: 'b', type: 'test-overlay-blur', start: 0, end: 2, params: {} }] },
  )

  // Inside the overlay's picture, away from its edges, and the base above
  // and left of it.
  const regions = {
    inside: { x: CARD.x + 0.05, y: CARD.y + 0.05, width: CARD.width - 0.1, height: CARD.height - 0.1 },
    outside: { x: 0.05, y: 0.05, width: 0.5, height: 0.5 },
    beside: { x: CARD.x - 0.1, y: CARD.y + 0.05, width: 0.08, height: CARD.height - 0.1 },
    // A 6 px strip of the base ending 4 px short of the overlay's left edge,
    // where an unclipped blur's spread (0.03 of the overlay's 224 px, so
    // 6.7 px) would land. The 4 px keep it clear of the overlay's own
    // antialiased edge in the preview too, which shows the 640 px frame at
    // about 290 px, so a frame pixel there is under half a screen pixel.
    edge: { x: CARD.x - 10 / FRAME.width, y: CARD.y + 0.05, width: 6 / FRAME.width, height: CARD.height - 0.1 },
  }
  const blurred = await measure(page, await savedFrameAt(page, 1, 'blur on'), regions)
  // At 3 s the window (0–2 s) is over: the same overlay, unblurred.
  const sharp = await measure(page, await savedFrameAt(page, 3, 'blur over'), regions)
  // The preview (step 3a), at the same two instants.
  const previewBlurred = await measure(page, await previewAt(page, 1, /blur\(/, 'blur on'), regions)
  const previewSharp = await measure(page, await previewAt(page, 3, 'none', 'blur over'), regions)
  console.log(`overlay blur: ${JSON.stringify({ blurred, sharp, previewBlurred, previewSharp })}`)

  expect(blurred.width).toBe(FRAME.width)
  for (const [label, on, off] of [
    ['saved frame', blurred, sharp],
    ['preview', previewBlurred, previewSharp],
  ] as const) {
    // The overlay's checkerboard loses most of its edge contrast.
    expect(off.inside.contrast, `${label}: sharp inside`).toBeGreaterThan(10)
    expect(on.inside.contrast, `${label}: blurred inside`).toBeLessThan(off.inside.contrast * 0.5)
    // The base's does not move, far from the overlay or right beside it:
    // the blur is clipped to the overlay's picture.
    expect(Math.abs(on.outside.contrast - off.outside.contrast), `${label}: outside`).toBeLessThan(
      off.outside.contrast * 0.02,
    )
    expect(Math.abs(on.beside.contrast - off.beside.contrast), `${label}: beside`).toBeLessThan(
      off.beside.contrast * 0.02,
    )
    expect(Math.abs(on.beside.mean - off.beside.mean), `${label}: beside mean`).toBeLessThan(2)
    expect(Math.abs(on.edge.contrast - off.edge.contrast), `${label}: edge strip`).toBeLessThan(
      off.edge.contrast * 0.02 + 0.5,
    )
    expect(Math.abs(on.edge.mean - off.edge.mean), `${label}: edge strip mean`).toBeLessThan(2)
  }
  // The preview's blur is the export's: the share of the overlay's contrast
  // it keeps agrees within 0.1 (each share is measured at its own scale).
  expect(
    Math.abs(previewBlurred.inside.contrast / previewSharp.inside.contrast - blurred.inside.contrast / sharp.inside.contrast),
  ).toBeLessThan(0.1)
})

/**
 * The setup of #999: `overlay` over a white base, placed (0.62, 0.35) to
 * (0.97, 0.95), 224×216 px, so its 224×126 picture is letterboxed with
 * gutters above and below. A zoom of 2 about the centre, over the whole
 * window, magnifies the picture to 448×252, which fills the rectangle,
 * gutters included. The test pixelate (blocks of 0.05 of the 224 px
 * outline, about 11 px) runs over 0–2 s of its 5 s on screen. Returns the
 * saved frames' regions with the pixelate on (1 s) and over (3 s).
 */
async function zoomedPixelate(page: Page, overlay: { name: string; png: Buffer }) {
  await openWithOverlayFields(page, { name: 'white.png', png: await makePng(page, { color: '#fff' }) }, overlay, {
    y: 0.35,
    height: 0.6,
    zooms: [{ id: 'z', start: 0, rampIn: 0, hold: 5, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 }],
    pictureEffects: [{ id: 'p', type: 'test-overlay-pixelate', start: 0, end: 2, params: {} }],
  })
  const regions = {
    // Above the unzoomed picture (which starts at y 0.475), inside the
    // rectangle: a letterbox gutter that the zoomed picture fills. #999's
    // strip.
    gutter: { x: 0.65, y: 0.37, width: 0.28, height: 0.07 },
    // Inside the unzoomed picture's outline.
    outline: { x: 0.65, y: 0.55, width: 0.28, height: 0.2 },
  }
  const pixelated = await measure(page, await savedFrameAt(page, 1, 'pixelate on'), regions)
  const plain = await measure(page, await savedFrameAt(page, 3, 'pixelate over'), regions)
  return { pixelated, plain }
}

test('a pixelate on a zoomed, letterboxed overlay keeps its picture in the gutters (#999)', async ({ page }) => {
  test.setTimeout(90_000)
  const { pixelated, plain } = await zoomedPixelate(page, {
    name: 'green.png',
    png: await makePng(page, { color: '#00c800' }),
  })
  console.log(`overlay pixelate, zoomed, green: ${JSON.stringify({ pixelated, plain })}`)
  // Unpixelated, the zoomed green fills the gutter. Pixelated, it still
  // does, within a few levels, where the base's white (255) showed before.
  for (const region of ['gutter', 'outline'] as const) {
    expect(plain[region].mean, `${region}: unpixelated`).toBeGreaterThan(190)
    expect(Math.abs(pixelated[region].mean - plain[region].mean), `${region}: pixelated`).toBeLessThan(3)
  }
})

test('a pixelate on a zoomed, letterboxed overlay draws blocks in the gutters too (#999)', async ({ page }) => {
  test.setTimeout(90_000)
  // Green and black stripes 4 px wide, about 2.8 px in the saved frame once
  // placed and zoomed: sharp unpixelated, flat blocks pixelated.
  const stripes = Buffer.from(
    await page.evaluate((frame) => {
      const canvas = document.createElement('canvas')
      canvas.width = frame.width
      canvas.height = frame.height
      const ctx = canvas.getContext('2d')!
      for (let x = 0; x < frame.width; x += 4) {
        ctx.fillStyle = (x / 4) % 2 === 0 ? '#00c800' : '#000'
        ctx.fillRect(x, 0, 4, frame.height)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    }, FRAME),
    'base64',
  )
  const { pixelated, plain } = await zoomedPixelate(page, { name: 'stripes.png', png: stripes })
  console.log(`overlay pixelate, zoomed, stripes: ${JSON.stringify({ pixelated, plain })}`)
  for (const region of ['gutter', 'outline'] as const) {
    // Unpixelated, the zoomed stripes fill both regions: sharp, and darker
    // on average than the white base.
    expect(plain[region].contrast, `${region}: sharp stripes`).toBeGreaterThan(40)
    expect(plain[region].mean, `${region}: the stripes, not the base`).toBeLessThan(150)
    // Pixelated, the stripes are averaged away into blocks.
    expect(pixelated[region].contrast, `${region}: blocks`).toBeLessThan(plain[region].contrast * 0.3)
  }
  // The gutter's blocks are the outline's: the same picture under the same
  // downscale reads the same. (Against the unpixelated mean it reads about
  // 11 lower, in the outline as in the gutter, so that difference is the
  // downscale's averaging of fine stripes, not where it draws.)
  expect(pixelated.gutter.mean, 'gutter: not the base').toBeLessThan(150)
  expect(Math.abs(pixelated.gutter.mean - pixelated.outline.mean), 'gutter against outline').toBeLessThan(3)
})

test("a channel offset on an overlay moves red and blue by the outline's share, zoomed or not, in the preview as in a saved frame", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // The bar over a black base, placed at the default rectangle, which its
  // aspect fills: the outline is the rectangle, 0.35 of the frame wide.
  // The offset is on over the whole 5 s; a zoom of 2 from 2.5 s on.
  await openWithOverlayFields(
    page,
    { name: 'black.png', png: await makePng(page, { color: '#000' }) },
    { name: 'bar.png', png: await makeBar(page) },
    {
      zooms: [{ id: 'z', start: 2.5, rampIn: 0, hold: 2.5, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 }],
      pictureEffects: [{ id: 'c', type: 'test-overlay-channel-offset', start: 0, end: 5, params: {} }],
    },
  )
  // Rows inside the overlay, clear of its top and bottom edges.
  const region = { x: CARD.x, y: CARD.y + 0.05, width: CARD.width, height: CARD.height - 0.1 }
  const readings = {
    saved: await channelShifts(page, await savedFrameAt(page, 1, 'channel offset'), region),
    preview: await channelShifts(page, await previewAt(page, 1, /url\(/, 'channel offset'), region),
    savedZoomed: await channelShifts(page, await savedFrameAt(page, 3, 'channel offset, zoomed'), region),
    previewZoomed: await channelShifts(page, await previewAt(page, 3, /url\(/, 'channel offset, zoomed'), region),
  }
  console.log(`[${testInfo.project.name}] overlay channel offset: ${JSON.stringify(readings)}`)
  // Red left and blue right by OFFSET of the outline's width, which is
  // 0.35 of the frame's: 0.035 of the frame, 22.4 px of a 640 px saved
  // frame. Not magnified by the zoom. The tolerance is 2 px of the image
  // measured, for the shift's rounding and the image's own pixel grid.
  const expected = OFFSET * CARD.width
  for (const [label, reading] of Object.entries(readings)) {
    const within = 2 / reading.width
    expect(reading.rows, `${label}: rows read`).toBeGreaterThan(10)
    expect(Math.abs(reading.redLeft + expected), `${label}: red's left edge`).toBeLessThan(within)
    expect(Math.abs(reading.redRight + expected), `${label}: red's right edge`).toBeLessThan(within)
    expect(Math.abs(reading.blueLeft - expected), `${label}: blue's left edge`).toBeLessThan(within)
    expect(Math.abs(reading.blueRight - expected), `${label}: blue's right edge`).toBeLessThan(within)
  }
})

test("a slice on a zoomed, letterboxed overlay moves the outline's rows by the outline's share, in the preview as in a saved frame", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // #999's placement: (0.62, 0.35) to (0.97, 0.95), 224×216 px, so the
  // 224×126 picture is letterboxed with 45 px gutters, the outline at
  // 171–297 px. A zoom of 2 about the centre fills the rectangle with the
  // picture. BAND is a share of the outline: rows 0.3–0.6 of its height,
  // moved right by 0.1 of its width.
  await openWithOverlayFields(
    page,
    { name: 'black.png', png: await makePng(page, { color: '#000' }) },
    { name: 'bar.png', png: await makeBar(page) },
    {
      y: 0.35,
      height: 0.6,
      zooms: [{ id: 'z', start: 0, rampIn: 0, hold: 5, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 }],
      pictureEffects: [{ id: 's', type: 'test-overlay-slices', start: 0, end: 2, params: {} }],
    },
  )
  const placed = { x: CARD.x, y: 0.35, width: CARD.width, height: 0.6 }
  const outline = { y: 171 / 360, height: 126 / 360 }
  // The bands' rows on the screen, as fractions of the frame's height, and
  // their shift as a fraction of its width: the export's card is the
  // outline, unzoomed, so neither depends on the zoom.
  const expected = {
    top: outline.y + BAND.top * outline.height,
    bottom: outline.y + (BAND.top + BAND.height) * outline.height,
    shift: BAND.shift * CARD.width,
  }
  const readings = {
    saved: await slicedRows(page, await savedFrameAt(page, 1, 'slice, zoomed'), placed, expected.shift),
    preview: await slicedRows(page, await previewAt(page, 1, /url\(/, 'slice, zoomed'), placed, expected.shift),
    savedAfter: await slicedRows(page, await savedFrameAt(page, 3, 'slice over'), placed, expected.shift),
    previewAfter: await slicedRows(page, await previewAt(page, 3, 'none', 'slice over'), placed, expected.shift),
  }
  console.log(`[${testInfo.project.name}] overlay slice, zoomed: ${JSON.stringify({ expected, readings })}`)
  for (const label of ['saved', 'preview'] as const) {
    const reading = readings[label]
    // 2 px of the image measured, for the band's rounding and the image's
    // own pixel grid.
    const rows = 2 / reading.height
    expect(reading.rows, `${label}: rows moved`).toBeGreaterThan(5)
    expect(Math.abs(reading.top - expected.top), `${label}: the band's top`).toBeLessThan(rows)
    expect(Math.abs(reading.bottom - expected.bottom), `${label}: the band's bottom`).toBeLessThan(rows)
    expect(Math.abs(reading.shift - expected.shift), `${label}: the band's shift`).toBeLessThan(2 / reading.width)
  }
  // After the window, no row moves.
  expect(readings.savedAfter.rows, 'saved frame, after').toBe(0)
  expect(readings.previewAfter.rows, 'preview, after').toBe(0)
})

/**
 * A frame-sized PNG whose every block reads a different colour: red rises
 * left to right, green top to bottom, blue is constant. So a block drawn
 * at the wrong place, or averaging the wrong pixels, reads the wrong
 * colour.
 */
async function makeGradient(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((frame) => {
    const canvas = document.createElement('canvas')
    canvas.width = frame.width
    canvas.height = frame.height
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(frame.width, frame.height)
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const at = (y * frame.width + x) * 4
        image.data[at] = Math.round((x / (frame.width - 1)) * 255)
        image.data[at + 1] = Math.round((y / (frame.height - 1)) * 255)
        image.data[at + 2] = 96
        image.data[at + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  }, FRAME)
  return Buffer.from(base64, 'base64')
}

/** A channel difference allowed between a preview block and the saved frame's: pixelate.spec.ts's `PREVIEW_LEVELS`. */
const PREVIEW_LEVELS = 4

/**
 * The preview's blocks over `area` (frame fractions) against the saved
 * frame's, on `grid`, read from a screenshot of the preview's frame in
 * device px (`box` is the frame inside it): blocks whose interior, a
 * device px in from each edge, is one colour (`uniform`), and blocks whose
 * interior is within `PREVIEW_LEVELS` of the saved frame's block centre
 * (`matching`), with the worst channel difference seen.
 */
async function overlayBlocks(
  page: Page,
  preview: { png: Buffer; box: { x: number; y: number; width: number; height: number } },
  saved: Buffer,
  area: Region,
  grid: { columns: number; rows: number },
) {
  return await page.evaluate(
    async ({ preview, box, saved, area, grid, levels }) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const shown = await pixels(preview)
      const frame = await pixels(saved)
      const blockWidth = area.width / grid.columns
      const blockHeight = area.height / grid.rows
      let uniform = 0
      let matching = 0
      let worst = 0
      for (let row = 0; row < grid.rows; row++) {
        for (let column = 0; column < grid.columns; column++) {
          const left = area.x + column * blockWidth
          const top = area.y + row * blockHeight
          const x0 = Math.ceil(box.x + left * box.width) + 1
          const x1 = Math.floor(box.x + (left + blockWidth) * box.width) - 2
          const y0 = Math.ceil(box.y + top * box.height) + 1
          const y1 = Math.floor(box.y + (top + blockHeight) * box.height) - 2
          const first = (y0 * shown.width + x0) * 4
          const fx = Math.floor((left + blockWidth / 2) * frame.width)
          const fy = Math.floor((top + blockHeight / 2) * frame.height)
          const want = (fy * frame.width + fx) * 4
          let same = true
          let close = true
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const at = (y * shown.width + x) * 4
              for (let channel = 0; channel < 3; channel++) {
                if (shown.data[at + channel] !== shown.data[first + channel]) same = false
                const off = Math.abs(shown.data[at + channel] - frame.data[want + channel])
                if (off > worst) worst = off
                if (off > levels) close = false
              }
            }
          }
          if (same) uniform += 1
          if (close) matching += 1
        }
      }
      return { width: box.width, blocks: grid.columns * grid.rows, uniform, matching, worst }
    },
    {
      preview: preview.png.toString('base64'),
      box: preview.box,
      saved: saved.toString('base64'),
      area,
      grid,
      levels: PREVIEW_LEVELS,
    },
  )
}

/**
 * The preview's overlay pixelate at `seconds` against the saved frame
 * there, over `area`: polled until every block matches, since the canvas
 * paints on its own rAF loop, and the last reading returned either way.
 */
async function overlayPixelateAgainstSaved(
  page: Page,
  seconds: number,
  area: Region,
  grid: { columns: number; rows: number },
  label: string,
) {
  const saved = await savedFrameAt(page, seconds, label)
  await expect(page.getByTestId('preview-overlay-pixelate-0')).toHaveAttribute(
    'data-grid',
    `${grid.columns}x${grid.rows}`,
  )
  const frame = page.getByTestId('preview-frame')
  const shot = async () => {
    const box = (await frame.boundingBox())!
    const clip = {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.x + box.width) - Math.floor(box.x),
      height: Math.ceil(box.y + box.height) - Math.floor(box.y),
    }
    return {
      png: await page.screenshot({ clip }),
      box: { x: box.x - clip.x, y: box.y - clip.y, width: box.width, height: box.height },
    }
  }
  let reading: Awaited<ReturnType<typeof overlayBlocks>> | undefined
  await expect
    .poll(
      async () => {
        reading = await overlayBlocks(page, await shot(), saved, area, grid)
        return reading.uniform === reading.blocks && reading.matching === reading.blocks
      },
      { timeout: 10_000 },
    )
    .toBe(true)
    .catch(() => undefined)
  await test.info().attach(`preview (${label})`, { body: await frame.screenshot(), contentType: 'image/png' })
  return reading!
}

/** Enables the Visual effects plugin in the manager, as `visual-effects.spec.ts` does. */
async function enableVisualEffects(page: Page) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Enable Visual effects' }).click()
  await expect(page.getByRole('button', { name: 'Disable Visual effects' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** The Visual effects plugin's effects, in + Effect ▾'s order. */
const PLUGIN_EFFECTS = ['Vignette', 'Blur', 'Film grain', 'Old film', 'VHS', 'Chromatic aberration', 'Glitch', 'Pixelate']
const IMAGE_OVERLAY = 'overlay logo.png at position 1'
const VIDEO_OVERLAY = 'overlay trim-clip.webm at position 2'

/**
 * A populated timeline for the overlay rows' geometry (#872, step 4): two
 * stills in the sequence, an image overlay carrying a zoom, a Move and
 * every one of the plugin's effects, and a video overlay carrying a
 * vignette and a blur, so the effect rows sit among the other rows they
 * will sit among in use.
 */
async function populatedWithOverlayEffects(page: Page) {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'pattern.png', mimeType: 'image/png', buffer: await makePng(page, { square: 40 }) },
    { name: 'white.png', mimeType: 'image/png', buffer: await makePng(page, { color: '#fff' }) },
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page, { square: 20 }) },
  ])
  await page.getByRole('button', { name: 'Add pattern.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add white.png to timeline' }).click()
  await chooseClipAction(page, 'logo.png', 'Add as overlay')
  await page.getByTestId('clip-file-input').setInputFiles(join('e2e', 'fixtures', 'trim-clip.webm'))
  await chooseClipAction(page, 'trim-clip.webm', 'Add as overlay')
  await enableVisualEffects(page)
  await chooseEffect(page, IMAGE_OVERLAY, 'Zoom')
  await chooseEffect(page, IMAGE_OVERLAY, 'Move')
  for (const name of PLUGIN_EFFECTS) await chooseEffect(page, IMAGE_OVERLAY, name)
  await chooseEffect(page, VIDEO_OVERLAY, 'Vignette')
  await chooseEffect(page, VIDEO_OVERLAY, 'Blur')
  await expect(page.getByTestId('picture-effect-row')).toHaveCount(PLUGIN_EFFECTS.length + 2)
}

test.describe("Picture effects in an overlay's + Effect ▾ and its row (#872, step 4)", () => {
  test("+ Effect ▾ on a video and an image overlay lists the plugin's effects after Move, and the preview draws one added there", async ({
    page,
  }) => {
    await populatedWithOverlayEffects(page)
    const items = async (position: string) => {
      const menu = await openEffectMenu(page, position)
      const labels = (await menu.getByRole('menuitem').allTextContents()).map((label) => label.trim())
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      return labels
    }
    expect(await items(IMAGE_OVERLAY)).toEqual(['Zoom', 'Move', ...PLUGIN_EFFECTS])
    expect(await items(VIDEO_OVERLAY)).toEqual(['Zoom', 'Speed segment', 'Pause', 'Volume change', 'Move', ...PLUGIN_EFFECTS])
    // The video overlay's Blur, added through the menu, from 0 s to 2 s on
    // screen: inside its window the preview filters the overlay's element,
    // and the image overlay's vignette box is drawn.
    await expect(
      page.getByRole('spinbutton', { name: `Blur 1 end of ${VIDEO_OVERLAY} in seconds` }),
    ).toHaveValue('2')
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
    await expect(page.getByTestId('preview-overlay-1')).toHaveCSS('filter', /blur\(/)
    await expect(page.getByTestId('preview-overlay-look-0')).toHaveCount(1)
    // The guide's statement: a Pixelate at the default 20 divides an
    // overlay 96 blocks across, as it divides the frame (and 54 down on
    // this 16:9 picture).
    await expect(page.getByTestId('preview-overlay-pixelate-0')).toHaveAttribute('data-grid', '96x54')
  })

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
  ]) {
    test(`the effect rows stay inside the overlay's row, their labels and fields on one line, at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000)
      await page.setViewportSize(viewport)
      await populatedWithOverlayEffects(page)
      const rows = page.getByTestId('picture-effect-row')
      // The editor column, as the entry rows' test measures: a row too wide
      // for the column would widen the timeline panel with it.
      const column = page.locator('main')
      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded()
        const overlayRow = row.locator('xpath=ancestor::li[contains(@class, "video-overlay")][1]')
        await expect(overlayRow).toHaveCount(1)
        const name = ((await row.locator(':scope > span').first().textContent()) ?? 'row').replace(/ from$/, '')
        await expectWithin(row, overlayRow, { axis: 'x', what: `the ${name} row at ${viewport.width}px` })
        await expectWithin(row, column, { axis: 'x', what: `the ${name} row at ${viewport.width}px` })
        await expectNoWrap(row.locator(':scope > span'), `${name}'s labels and labelled fields`)
      }
      await expectNoHorizontalScroll(page, `with the overlay effect rows at ${viewport.width}px`)
      const overlayRow = rows.first().locator('xpath=ancestor::li[contains(@class, "video-overlay")][1]')
      const shot = await overlayRow.screenshot({ path: testInfo.outputPath(`overlay-effect-rows-${viewport.width}.png`) })
      await testInfo.attach(`overlay effect rows at ${viewport.width}px`, { body: shot, contentType: 'image/png' })
    })
  }
})

test.describe('Pixelate on an overlay in the preview (#872, step 3b(ii))', () => {
  // A large preview, as pixelate.spec.ts's preview tests use, so a block
  // is many device px wide.
  test.use({ viewport: { width: 1920, height: 1080 } })

  test("unzoomed, the preview draws the saved frame's blocks over the outline, and the plain picture after the window", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    // The gradient fills the default rectangle, so the outline is the
    // rectangle: 224 × 126 px of the 640 × 360 saved frame. Blocks of 0.05
    // of its width: 20 columns, and round(126 / 11.2) = 11 rows.
    await openWithOverlayFields(
      page,
      { name: 'black.png', png: await makePng(page, { color: '#000' }) },
      { name: 'gradient.png', png: await makeGradient(page) },
      { pictureEffects: [{ id: 'p', type: 'test-overlay-pixelate', start: 0, end: 2, params: {} }] },
    )
    const reading = await overlayPixelateAgainstSaved(page, 1, CARD, { columns: 20, rows: 11 }, 'pixelate, unzoomed')
    const overlay = page.getByTestId('preview-overlay-0')
    // The element plays on under the canvas, hidden and unfiltered.
    await expect(overlay).toHaveCSS('opacity', '0')
    await expect(overlay).toHaveCSS('filter', 'none')
    console.log(`[${testInfo.project.name}] overlay pixelate preview, unzoomed: ${JSON.stringify(reading)}`)
    // Over 500 px, a block (0.35 / 20 of the frame) is over 8 device px wide.
    expect(reading.width, 'the preview frame read').toBeGreaterThan(500)
    expect(reading.uniform, 'blocks of one colour').toBe(reading.blocks)
    expect(reading.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(reading.blocks)
    // After the window the canvas is gone and the element shows again.
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('3')
    await expect(page.getByTestId('preview-overlay-pixelate-0')).toHaveCount(0)
    await expect(overlay).toHaveCSS('opacity', '1')
  })

  test("on a zoomed, letterboxed overlay, the preview's blocks cover the gutters as the saved frame's do (#999)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    // #999's placement: 224 × 216 px, the 224 × 126 picture letterboxed,
    // zoomed 2× about the centre, so the zoomed picture fills the whole
    // rectangle, gutters included: that is the pixelate area. The block
    // stays 0.05 of the outline's 224 px: 20 columns, and
    // round(216 / 11.2) = 19 rows.
    await openWithOverlayFields(
      page,
      { name: 'black.png', png: await makePng(page, { color: '#000' }) },
      { name: 'gradient.png', png: await makeGradient(page) },
      {
        y: 0.35,
        height: 0.6,
        zooms: [{ id: 'z', start: 0, rampIn: 0, hold: 5, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 }],
        pictureEffects: [{ id: 'p', type: 'test-overlay-pixelate', start: 0, end: 2, params: {} }],
      },
    )
    const area = { x: CARD.x, y: 0.35, width: CARD.width, height: 0.6 }
    const reading = await overlayPixelateAgainstSaved(page, 1, area, { columns: 20, rows: 19 }, 'pixelate, zoomed')
    console.log(`[${testInfo.project.name}] overlay pixelate preview, zoomed: ${JSON.stringify(reading)}`)
    expect(reading.width, 'the preview frame read').toBeGreaterThan(500)
    expect(reading.uniform, 'blocks of one colour, gutters included').toBe(reading.blocks)
    expect(reading.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(reading.blocks)
  })
})

test('a vignette on a circle-masked overlay darkens inside the circle only', async ({ page }) => {
  test.setTimeout(90_000)
  await openWithOverlayFields(
    page,
    { name: 'white.png', png: await makePng(page, { color: '#fff' }) },
    { name: 'green.png', png: await makePng(page, { color: '#00c800' }) },
    {
      shapeMask: { kind: 'ellipse' },
      pictureEffects: [{ id: 'v', type: 'test-overlay-vignette', start: 0, end: 5, params: {} }],
    },
  )
  const side = 0.02
  const regions = {
    // The ellipse's centre, and just inside its left edge on the middle row.
    centre: { x: CARD.x + CARD.width / 2 - side / 2, y: CARD.y + CARD.height / 2 - side / 2, width: side, height: side },
    rim: { x: CARD.x + 0.015, y: CARD.y + CARD.height / 2 - side / 2, width: side, height: side },
    // The rectangle's top-left corner, outside the ellipse: the base shows
    // there, and a vignette is darkest at its corners, so a leak would show.
    corner: { x: CARD.x + 0.003, y: CARD.y + 0.005, width: side, height: side },
    base: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  }
  const frame = await measure(page, await savedFrameAt(page, 1, 'vignette in a circle'), regions)
  // The vignette writes no filter, so the overlay's element carries none.
  const preview = await measure(page, await previewAt(page, 1, 'none', 'vignette in a circle'), regions)
  console.log(`overlay vignette: ${JSON.stringify({ frame, preview })}`)

  for (const [label, measured] of [
    ['saved frame', frame],
    ['preview', preview],
  ] as const) {
    // The overlay's green centre is near its own colour; its rim is darker.
    expect(measured.centre.mean, `${label}: centre`).toBeGreaterThan(150)
    expect(measured.rim.mean, `${label}: rim`).toBeLessThan(measured.centre.mean - 40)
    // Outside the circle, inside the rectangle: the white base, undarkened.
    expect(measured.base.mean, `${label}: base`).toBeGreaterThan(250)
    expect(measured.corner.mean, `${label}: corner`).toBeGreaterThan(measured.base.mean - 3)
  }
  // The preview's vignette is the export's: the rim within 12 levels.
  expect(Math.abs(preview.rim.mean - frame.rim.mean)).toBeLessThan(12)
  // Geometry: the layers' box is the outline. This overlay's picture fills
  // its rectangle, so that is the card's box, within half a pixel.
  const look = await page.getByTestId('preview-overlay-picture-layers-0').boundingBox()
  const card = await page.getByTestId('preview-overlay-card-0').boundingBox()
  expect(look).not.toBeNull()
  expect(card).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(look![key] - card![key]), `layers box ${key}`).toBeLessThan(0.5)
  }
})
