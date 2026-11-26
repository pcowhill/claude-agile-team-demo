import { readFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'

/**
 * Picture effects on overlays in the export (#872, step 2): a saved frame
 * (the export's own frame composer) draws an overlay's effects on the
 * overlay's own picture and nowhere else.
 *
 * Nothing in the app can put an effect on an overlay yet: step 4 adds the
 * + Effect ▾ entry. So this spec saves the project, writes the effects
 * into the saved file's overlay (the `pictureEffects` key step 1 added,
 * schema 35), and opens that file, as a hand-made project would arrive.
 * The effect types are test-only definitions registered into the running
 * app's registry through the dev server's module URL, as
 * `channel-offset.spec.ts` does, so the spec does not depend on the
 * Visual effects plugin's own numbers.
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
 * vignette, and a pixelate in blocks of 0.05 of the card's width.
 */
async function registerTestEffects(page: Page) {
  await page.evaluate(
    async ({ blurName, vignetteName, pixelateName }) => {
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
    },
    { blurName: BLUR_NAME, vignetteName: VIGNETTE_NAME, pixelateName: PIXELATE_NAME },
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
    // A 6 px strip of the base ending 1 px short of the overlay's left edge,
    // where an unclipped blur's spread would land.
    edge: { x: CARD.x - 7 / FRAME.width, y: CARD.y + 0.05, width: 6 / FRAME.width, height: CARD.height - 0.1 },
  }
  const blurred = await measure(page, await savedFrameAt(page, 1, 'blur on'), regions)
  // At 3 s the window (0–2 s) is over: the same overlay, unblurred.
  const sharp = await measure(page, await savedFrameAt(page, 3, 'blur over'), regions)
  console.log(`overlay blur: ${JSON.stringify({ blurred, sharp })}`)

  expect(blurred.width).toBe(FRAME.width)
  // The overlay's checkerboard loses most of its edge contrast.
  expect(sharp.inside.contrast).toBeGreaterThan(10)
  expect(blurred.inside.contrast).toBeLessThan(sharp.inside.contrast * 0.5)
  // The base's does not move, far from the overlay or right beside it: the
  // blur is clipped to the overlay's picture.
  expect(Math.abs(blurred.outside.contrast - sharp.outside.contrast)).toBeLessThan(sharp.outside.contrast * 0.02)
  expect(Math.abs(blurred.beside.contrast - sharp.beside.contrast)).toBeLessThan(sharp.beside.contrast * 0.02)
  expect(Math.abs(blurred.beside.mean - sharp.beside.mean)).toBeLessThan(2)
  expect(Math.abs(blurred.edge.contrast - sharp.edge.contrast)).toBeLessThan(sharp.edge.contrast * 0.02 + 0.5)
  expect(Math.abs(blurred.edge.mean - sharp.edge.mean)).toBeLessThan(2)
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
  console.log(`overlay vignette: ${JSON.stringify(frame)}`)

  // The overlay's green centre is near its own colour; its rim is darker.
  expect(frame.centre.mean).toBeGreaterThan(150)
  expect(frame.rim.mean).toBeLessThan(frame.centre.mean - 40)
  // Outside the circle, inside the rectangle: the white base, undarkened.
  expect(frame.base.mean).toBeGreaterThan(250)
  expect(frame.corner.mean).toBeGreaterThan(frame.base.mean - 3)
})
