import { readFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'

/**
 * Picture effects on overlays (#872): a saved frame (the export's own frame
 * composer, step 2) and the preview (step 3a) draw an overlay's effects on
 * the overlay's own picture and nowhere else.
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

/** Registers the two test effects: a blur of 0.03 of the card's width, and a strong vignette. */
async function registerTestEffects(page: Page) {
  await page.evaluate(
    async ({ blurName, vignetteName }) => {
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
    },
    { blurName: BLUR_NAME, vignetteName: VIGNETTE_NAME },
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
