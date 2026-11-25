import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { scanExportedFrames } from './decodedFrame'
import type { ScannedFrame } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { chooseEffect, openEffectMenu } from './timelineRowMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The Visual effects plugin's two picture effects (#862, step 3a): Vignette
 * and Blur on a still, through the real chain. There is no + Effect ▾ item
 * yet (step 3b), so the spec gets its effects the way a saved project
 * would bring them: it saves a project, writes two effects into the file,
 * and opens it. That open must prompt for the plugin and enable it.
 *
 * The still is a test pattern: white, with its right half black, so the
 * frame has a sharp vertical edge at its centre and white corners.
 * - **Vignette** (Strength 80 %, from 1.5 s to 3 s): a sample near the
 *   top-left corner is darker than one near the centre of the white half.
 * - **Blur** (Amount 3 %, from 4 s to 5.5 s): the contrast across the edge,
 *   1 to 2 % of the width either side of it, drops.
 *
 * The same samples are read from the preview (a screenshot of the composed
 * frame) and from the exported WebM (decoded frames), and compared.
 */

const STILL = 'pattern.png'
const POSITION = `${STILL} at position 1`
const DURATION = 7
const VIGNETTE = { start: 1.5, end: 3, strength: 80 }
const BLUR = { start: 4, end: 5.5, amount: 3 }

/**
 * Where the samples are taken, as fractions of the frame.
 * - `corner` is inset from the frame's edges by more than 2.5 blur radii,
 *   so the blur's own soft border (it fades towards the frame's edge, in
 *   both renderers) does not read as a vignette. The vignette there is
 *   about 0.61 of full brightness at Strength 80.
 * - `centre` is in the white half, inside the vignette's clear middle.
 * - `left` and `right` sit 1 to 2 % of the width either side of the edge.
 */
const BANDS = {
  corner: { x: 0.1, y: 0.14, width: 0.04, height: 0.04 },
  centre: { x: 0.23, y: 0.48, width: 0.04, height: 0.04 },
  left: { x: 0.48, y: 0.4, width: 0.01, height: 0.2 },
  right: { x: 0.51, y: 0.4, width: 0.01, height: 0.2 },
}
type Band = keyof typeof BANDS
type Samples = Record<Band, number>

/** The corner's brightness over the centre's: 1 with no vignette. */
const cornerRatio = (samples: Samples) => samples.corner / samples.centre
/** The brightness step across the edge: about 255 when sharp. */
const edgeContrast = (samples: Samples) => samples.left - samples.right

/**
 * Thresholds, stated once for both renderers. Untouched, the ratio is 1 and
 * the contrast about 255. With the effects: the vignette's ratio is about
 * 0.61 and the blur's contrast about 100 (a Gaussian of 3 % of the width,
 * read 1 to 2 % from the edge). The bounds sit well between, and leave
 * room for the WebM encoder's softening of the sharp edge.
 */
const NO_VIGNETTE = 0.92
const VIGNETTED = 0.8
const SHARP = 180
const BLURRED = 150
/** Preview and export agree on each measurement within these. */
const RATIO_TOLERANCE = 0.08
const CONTRAST_TOLERANCE = 40

/** The test pattern, 640×360: white, right half black. */
async function makePattern(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#000'
    ctx.fillRect(320, 0, 320, 360)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/** Opens the manager and toggles the Visual effects plugin. */
async function setVisualEffects(page: Page, enabled: boolean) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Visual effects` }).click()
  await expect(
    page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Visual effects` }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** A plain white still, 640×360. */
async function makeWhite(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 640, 360)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/**
 * Saves the current timeline as a references-only project and returns that
 * file with picture effects written into it: the timeline's
 * `pictureEffects` (built from the entries' ids), the plugin dependency a
 * save would record, and the schema version a file carrying them has (34).
 */
async function saveWithEffects(
  page: Page,
  effects: (entryIds: string[]) => object[],
): Promise<Buffer> {
  await chooseFromFileMenu(page, 'Save As…')
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const saved = await readFile((await (await downloadPromise).path())!)
  const document = JSON.parse(gunzipSync(saved).toString('utf8'))
  document.timeline.pictureEffects = effects(
    document.timeline.entries.map((entry: { id: string }) => entry.id),
  )
  document.plugins = ['visual-effects']
  document.schemaVersion = Math.max(document.schemaVersion, 34)
  return gzipSync(Buffer.from(JSON.stringify(document), 'utf8'))
}

/** Forces the anchor-download save path, as transitions-pack.spec.ts does. */
async function gotoForSaving(page: Page) {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
}

/** Builds the 7 s pattern still and returns its project with Vignette and Blur. */
async function projectWithEffects(page: Page): Promise<{ project: Buffer; pattern: Buffer }> {
  await gotoForSaving(page)
  const pattern = await makePattern(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: pattern }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
  await duration.fill(String(DURATION))
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:07')
  const project = await saveWithEffects(page, ([entryId]) => [
    {
      id: 'v1',
      entryId,
      type: 'vignette',
      start: VIGNETTE.start,
      end: VIGNETTE.end,
      params: { strength: VIGNETTE.strength },
    },
    { id: 'b1', entryId, type: 'blur', start: BLUR.start, end: BLUR.end, params: { amount: BLUR.amount } },
  ])
  return { project, pattern }
}

/** Opens the project: the plugin prompt, then the re-link of the still. */
async function openProject(page: Page, project: Buffer, pattern: Buffer, total = '0:07') {
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'effects.bvep', mimeType: 'application/gzip', buffer: project }])
  const prompt = page.getByRole('dialog', { name: 'Enable plugins to open?' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Visual effects')
  await prompt.getByRole('button', { name: 'Enable and open' }).click()
  const relink = page.getByRole('dialog', { name: 'Open effects.bvep' })
  await expect(relink).toBeVisible()
  await page
    .getByTestId('relink-file-input')
    .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: pattern }])
  const openButton = relink.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(page.getByTestId('timeline-total')).toHaveText(total)
}

/** Mean brightness (of R, G and B) of each band of a PNG of the composed frame. */
async function samplePng(page: Page, png: Buffer): Promise<Samples> {
  return await page.evaluate(
    async ({ base64, bands }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const mean = (rect: { x: number; y: number; width: number; height: number }) => {
        const x = Math.floor(rect.x * bitmap.width)
        const y = Math.floor(rect.y * bitmap.height)
        const width = Math.max(1, Math.round(rect.width * bitmap.width))
        const height = Math.max(1, Math.round(rect.height * bitmap.height))
        const data = ctx.getImageData(x, y, width, height).data
        let sum = 0
        for (let index = 0; index < data.length; index += 4) {
          sum += (data[index] + data[index + 1] + data[index + 2]) / 3
        }
        return sum / (data.length / 4)
      }
      return Object.fromEntries(
        Object.entries(bands).map(([name, rect]) => [name, mean(rect)]),
      ) as Record<string, number>
    },
    { base64: png.toString('base64'), bands: BANDS },
  ) as Samples
}

/** Seeks the preview to `seconds` and samples a screenshot of the composed frame. */
async function previewAt(page: Page, seconds: number, label: string, enabled = true): Promise<Samples> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  // The look is rendered from the published time: wait until the layers
  // element is present exactly when the vignette should be drawn.
  const inVignette = enabled && seconds > VIGNETTE.start && seconds < VIGNETTE.end
  await expect(page.getByTestId('preview-picture-layers')).toHaveCount(inVignette ? 1 : 0)
  // And the blur's own filter, so a seek between two samples that both lack
  // the vignette (3.5 s → 4.75 s) is waited out too, rather than read once
  // straight after the input (#924's review, `quality-and-ci.md`).
  const inBlur = enabled && seconds > BLUR.start && seconds < BLUR.end
  await expect(image).toHaveCSS('filter', inBlur ? /blur\(/ : 'none')
  const png = await page.getByTestId('preview-frame').screenshot()
  await test.info().attach(`preview at ${seconds} s (${label})`, { body: png, contentType: 'image/png' })
  return await samplePng(page, png)
}

/** The scanned frame's bands as brightness, like `samplePng`'s. */
const brightness = (frame: ScannedFrame): Samples =>
  Object.fromEntries(
    Object.entries(frame.bands).map(([name, { r, g, b }]) => [name, (r + g + b) / 3]),
  ) as Samples

const describe = (samples: Samples) =>
  `ratio ${cornerRatio(samples).toFixed(3)}, contrast ${edgeContrast(samples).toFixed(1)}`

/** The pattern still's row on the timeline. */
const ENTRY = POSITION
/** The expected + Effect ▾ items without the plugin: today's three (#419). */
const BUILT_IN_EFFECTS = ['Zoom', 'Speed segment', 'Pause']

/** + Effect ▾'s item labels on `position`, read from the open menu, which is then closed. */
async function effectItems(page: Page, position: string): Promise<string[]> {
  const menu = await openEffectMenu(page, position)
  const items = await menu.getByRole('menuitem').allTextContents()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  return items.map((item) => item.trim())
}

/**
 * A populated timeline for the row geometry (#862's UI criterion): the
 * pattern still with a zoom, a vignette, a blur and film grain, plus a slate and a
 * second still, so the effect rows sit among other rows as they will in use.
 */
async function populatedWithEffects(page: Page) {
  await page.goto('./')
  const pattern = await makePattern(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: STILL, mimeType: 'image/png', buffer: pattern },
    { name: 'white.png', mimeType: 'image/png', buffer: await makeWhite(page) },
  ])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  await page.getByRole('button', { name: 'Add white.png to timeline' }).click()
  await setVisualEffects(page, true)
  await chooseEffect(page, ENTRY, 'Zoom')
  await chooseEffect(page, ENTRY, 'Vignette')
  await chooseEffect(page, ENTRY, 'Blur')
  // Film grain's row (#870) has two parameter fields, the widest row.
  await chooseEffect(page, ENTRY, 'Film grain')
  await expect(page.getByTestId('picture-effect-row')).toHaveCount(3)
}

test.describe('Visual effects in + Effect ▾ and the entry row (#862)', () => {
  test('+ Effect ▾ on a still and a slate lists Zoom alone with the plugin disabled, and Vignette and Blur once it is enabled', async ({
    page,
  }) => {
    await page.goto('./')
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: await makePattern(page) }])
    await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
    // A still has no time remapping (#138), so its menu holds Zoom alone.
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom'])
    await chooseFromAddMenu(page, ADD_SLATE)
    expect(await effectItems(page, 'Color slate at position 2')).toEqual(['Zoom'])

    await setVisualEffects(page, true)
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain'])

    // Choosing one adds its row with the defaults, and the preview draws it
    // inside the window: a vignette from 0 s to 2 s at Strength 60 %.
    await chooseEffect(page, ENTRY, 'Vignette')
    await expect(page.getByRole('spinbutton', { name: `Vignette 1 end of ${ENTRY} in seconds` })).toHaveValue('2')
    await expect(page.getByRole('spinbutton', { name: `Vignette 1 strength of ${ENTRY} (percent)` })).toHaveValue('60')
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
    await expect(page.getByTestId('preview-picture-layers')).toHaveCount(1)

    // Disabled again: the items go, the row stays as "(unavailable)", and
    // nothing is drawn.
    await setVisualEffects(page, false)
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom'])
    await expect(page.getByTestId('picture-effect-row')).toContainText('vignette 1 (unavailable) from')
    await expect(page.getByTestId('preview-picture-layers')).toHaveCount(0)
  })

  test('+ Effect ▾ on a video clip lists the built-in three, then Vignette and Blur after them', async ({ page }) => {
    // The clip-kind counterpart of the still above: the remap items stay,
    // and the plugin's items follow them.
    await page.goto('./')
    await page.getByTestId('clip-file-input').setInputFiles(join('e2e', 'fixtures', 'trim-clip.webm'))
    await page.getByRole('button', { name: 'Add trim-clip.webm to timeline' }).click()
    expect(await effectItems(page, 'trim-clip.webm at position 1')).toEqual(BUILT_IN_EFFECTS)
    await setVisualEffects(page, true)
    expect(await effectItems(page, 'trim-clip.webm at position 1')).toEqual([
      ...BUILT_IN_EFFECTS,
      'Vignette',
      'Blur',
      'Film grain',
    ])
  })

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
  ]) {
    test(`the effect rows stay inside the entry's row, their labels and fields on one line, at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await populatedWithEffects(page)
      const rows = page.getByTestId('picture-effect-row')
      // The editor column, as field-labels.spec.ts measures: a row too wide
      // for the column would widen the timeline panel with it.
      const column = page.locator('main')
      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded()
        const entryRow = row.locator('xpath=ancestor::li[contains(@class, "timeline-entry")][1]')
        const name = ((await row.locator(':scope > span').first().textContent()) ?? 'row').replace(/ from$/, '')
        await expectWithin(row, entryRow, { axis: 'x', what: `the ${name} row at ${viewport.width}px` })
        await expectWithin(row, column, { axis: 'x', what: `the ${name} row at ${viewport.width}px` })
        // Each label ("Vignette 1 from", "to"), and each parameter field
        // with its label (a `.timeline-labelled` span, so also matched
        // here), is one line; the row itself may wrap between them, as the
        // remap rows do.
        await expectNoWrap(row.locator(':scope > span'), `${name}'s labels and labelled fields`)
      }
      await expectNoHorizontalScroll(page, `with two effect rows at ${viewport.width}px`)
      const entryRow = rows.first().locator('xpath=ancestor::li[contains(@class, "timeline-entry")][1]')
      const shot = await entryRow.screenshot({ path: testInfo.outputPath(`effect-rows-${viewport.width}.png`) })
      await testInfo.attach(`effect rows at ${viewport.width}px`, { body: shot, contentType: 'image/png' })
    })
  }
})

/**
 * Film grain (#870, step 1): a generated texture that must be the same
 * pattern for the same instant in the preview and the export (#66).
 *
 * The still is itself a fixed noise texture: 192 × 108 cells of grey
 * between 96 and 160, on the grain's own grid at Size 10 (a cell is 10 px
 * of a 1080p frame, so 192 across). That makes a frame *without* the
 * effect a measurement of how much the renderers, and the WebM encoder,
 * change cell-sized noise: the tolerances below are set from it, not
 * guessed. The samples are one pixel at the centre of every 12th cell
 * across and down, 16 × 9 of them.
 */
const GRAIN = { start: 1, end: 3, amount: 60, size: 10 }
const GRAIN_DURATION = 4
const GRAIN_STILL = 'pattern.png'
/** The grain's cells at Size 10 on a 16:9 frame (`grainTile`). */
const GRAIN_COLUMNS = 192
const GRAIN_ROWS = 108
const GRAIN_POINTS = Array.from({ length: 16 * 9 }, (_, index) => ({
  x: (12 * (index % 16) + 6.5) / GRAIN_COLUMNS,
  y: (12 * Math.floor(index / 16) + 6.5) / GRAIN_ROWS,
}))
/**
 * Grid distances (mean absolute brightness, 0 to 255), measured in local
 * Chromium on this spec before these were set:
 * - the preview and a saved frame on the still alone: 0;
 * - the same grain step, preview vs saved frame: 3.7 to 4.3, because the
 *   tile is stretched to about 1910 px in the screenshot and 960 px in the
 *   saved frame, so a cell's centre pixel mixes its neighbours a little
 *   differently;
 * - grain over the still, and two steps against each other: 23 to 37.
 * So a match is anything under 10 more than the still's own difference,
 * and grain is anything over 18: the two never meet.
 */
const GRAIN_RENDERER_TOLERANCE = 2
const GRAIN_MATCH_ALLOWANCE = 10
const GRAIN_VISIBLE = 18
/**
 * The WebM: the encoder's error on the plain still measured 3.6. On
 * grained frames it is larger, because the grain doubles the cells'
 * spread and the encoder spends least on the finest detail: the closest
 * exported frame to a preview step measured 10.3 to 15.4 over five runs,
 * and every other frame 22 or more. So an exported frame matches a step
 * within the still's error plus 16, and the still's error itself must stay
 * under 8, or the comparison says nothing.
 */
const GRAIN_ENCODING_LIMIT = 8
const GRAIN_WEBM_ALLOWANCE = 16
/** Two instants one texture step apart: steps 50 and 51 at 24 a second. */
const STEP_50 = 2.1
const STEP_51 = 2.15

/** The textured still, 960 × 540: each 5 px cell one seeded grey in [96, 160]. */
async function makeNoiseStill(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ columns, rows }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 960
      canvas.height = 540
      const ctx = canvas.getContext('2d')!
      let state = 12345
      const next = () => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0
        return state / 4294967296
      }
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const grey = Math.round(96 + 64 * next())
          ctx.fillStyle = `rgb(${grey}, ${grey}, ${grey})`
          ctx.fillRect(x * 5, y * 5, 5, 5)
        }
      }
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { columns: GRAIN_COLUMNS, rows: GRAIN_ROWS },
  )
  return Buffer.from(base64, 'base64')
}

/** Brightness at each grain point of a PNG: the one pixel holding the point. */
async function gridOfPng(page: Page, png: Buffer): Promise<number[]> {
  return await page.evaluate(
    async ({ base64, points }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      return points.map(({ x, y }) => {
        const index = (Math.floor(y * bitmap.height) * bitmap.width + Math.floor(x * bitmap.width)) * 4
        return (data[index] + data[index + 1] + data[index + 2]) / 3
      })
    },
    { base64: png.toString('base64'), points: GRAIN_POINTS },
  )
}

/** The mean absolute difference of two grids. */
const gridDistance = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length

/** Builds the 4 s noise still with Film grain from 1 s to 3 s, and opens that project. */
async function openGrainProject(page: Page): Promise<Buffer> {
  await gotoForSaving(page)
  const still = await makeNoiseStill(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: GRAIN_STILL, mimeType: 'image/png', buffer: still }])
  await page.getByRole('button', { name: `Add ${GRAIN_STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${GRAIN_STILL} at position 1 in seconds` })
  await duration.fill(String(GRAIN_DURATION))
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  const project = await saveWithEffects(page, ([entryId]) => [
    {
      id: 'g1',
      entryId,
      type: 'film-grain',
      start: GRAIN.start,
      end: GRAIN.end,
      params: { amount: GRAIN.amount, size: GRAIN.size },
    },
  ])
  await openProject(page, project, still, '0:04')
  return still
}

/**
 * Seeks the preview to `seconds`, waits for the grain step that instant
 * publishes (or for no grain), and returns the composed frame's grid and
 * the screenshot.
 */
async function previewGrainAt(page: Page, seconds: number, step: number | null, label: string) {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  const grain = page.getByTestId('preview-picture-grain')
  if (step === null) await expect(grain).toHaveCount(0)
  else await expect(grain).toHaveAttribute('data-seed', String(step))
  const png = await page
    .getByTestId('preview-frame')
    .screenshot({ path: test.info().outputPath(`grain-preview-${seconds}s.png`) })
  await test.info().attach(`preview at ${seconds} s (${label})`, { body: png, contentType: 'image/png' })
  return { grid: await gridOfPng(page, png), png }
}

/** Saves the playhead's frame through the export's composer (Save frame) and returns its grid. */
async function savedGrainFrame(page: Page, label: string): Promise<number[]> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const download = await downloadPromise
  const saved = await readFile((await download.path())!)
  await download.saveAs(test.info().outputPath(`grain-saved-${label.replaceAll(' ', '-')}.png`))
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return await gridOfPng(page, saved)
}

test.describe('Film grain (#870)', () => {
  // The preview's frame must resolve the grain's cells to compare them
  // pixel by pixel: at the default viewport it is about 315 px wide, under
  // 2 px a cell. A wide viewport at twice the pixel density draws it at
  // several device pixels a cell, which the screenshot keeps.
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
  test('+ Effect ▾ offers Film grain after Vignette and Blur, with Amount and Size at their defaults', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('./')
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: await makePattern(page) }])
    await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
    await setVisualEffects(page, true)
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain'])
    await chooseEffect(page, ENTRY, 'Film grain')
    await expect(page.getByRole('spinbutton', { name: `Film grain 1 amount of ${ENTRY} (percent)` })).toHaveValue('30')
    await expect(page.getByRole('spinbutton', { name: `Film grain 1 size of ${ENTRY}` })).toHaveValue('3')
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
    // At Size 3 a 16:9 frame has 640 × 360 cells: the canvas is one pixel each.
    const grain = page.getByTestId('preview-picture-grain')
    await expect(grain).toHaveAttribute('width', '640')
    await expect(grain).toHaveAttribute('height', '360')
    await expect(grain).toHaveAttribute('data-seed', '24')
    const image = page.getByTestId('preview-image')
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
    const shot = await page
      .getByTestId('preview-frame')
      .screenshot({ path: test.info().outputPath('film-grain-default.png') })
    await test.info().attach('Film grain at its defaults, on the pattern', { body: shot, contentType: 'image/png' })
  })

  test('the preview and a saved frame draw the same grain for the same instant, and none outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await openGrainProject(page)

    // Outside the window: no grain, in either renderer. The two grids
    // measure what the renderers alone do to cell-sized noise.
    const before = await previewGrainAt(page, 0.5, null, 'before the window')
    const savedBefore = await savedGrainFrame(page, 'before the window')
    const after = await previewGrainAt(page, 3.5, null, 'after the window')
    const savedAfter = await savedGrainFrame(page, 'after the window')
    const plain = gridDistance(before.grid, savedBefore)

    const step50 = await previewGrainAt(page, STEP_50, 50, 'step 50')
    await testInfo.attach('film grain in the preview', { body: step50.png, contentType: 'image/png' })
    const saved50 = await savedGrainFrame(page, 'step 50')
    const step51 = await previewGrainAt(page, STEP_51, 51, 'step 51')
    const saved51 = await savedGrainFrame(page, 'step 51')
    const report = {
      plain,
      plainAfter: gridDistance(after.grid, savedAfter),
      grainOverStill: gridDistance(step50.grid, before.grid),
      same50: gridDistance(step50.grid, saved50),
      same51: gridDistance(step51.grid, saved51),
      across: gridDistance(step50.grid, saved51),
      previewSteps: gridDistance(step50.grid, step51.grid),
    }
    console.log(`[${testInfo.project.name}] film grain grids: ${JSON.stringify(report)}`)
    // Outside the window both renderers show the still, alike, and the
    // same before and after.
    expect(gridDistance(before.grid, after.grid), 'before vs after, preview').toBeLessThan(1)
    expect(report.plainAfter).toBeLessThan(GRAIN_RENDERER_TOLERANCE)
    expect(plain).toBeLessThan(GRAIN_RENDERER_TOLERANCE)
    // Inside it the grain is there: the picture moved well away from the still.
    expect(report.grainOverStill, 'grain changes the picture').toBeGreaterThan(GRAIN_VISIBLE)
    // The same instant: the preview and the saved frame agree to within
    // what the renderers do to the still alone, plus the allowance below.
    expect(report.same50, 'step 50: preview vs saved frame').toBeLessThan(plain + GRAIN_MATCH_ALLOWANCE)
    expect(report.same51, 'step 51: preview vs saved frame').toBeLessThan(plain + GRAIN_MATCH_ALLOWANCE)
    // One step apart, the patterns are unrelated: far outside that.
    expect(report.across, 'step 50 preview vs step 51 saved frame').toBeGreaterThan(GRAIN_VISIBLE)
    expect(report.previewSteps, 'step 50 vs step 51, preview').toBeGreaterThan(GRAIN_VISIBLE)
  })

  test('the export draws the preview\'s grain, only inside the window, within the WebM encoding\'s own error', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const still = await openGrainProject(page)
    const stillGrid = await gridOfPng(page, still)
    const step50 = await previewGrainAt(page, STEP_50, 50, 'step 50')
    const step51 = await previewGrainAt(page, STEP_51, 51, 'step 51')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exported = await readFile((await (await downloadPromise).path())!)
    // Every frame of the file: the export is a real-time recording at
    // 30 frames a second, so a 1/60 s grid visits each one (#370).
    const bands = Object.fromEntries(
      GRAIN_POINTS.map((point, index) => [String(index), { x: point.x, y: point.y, width: 0.0001, height: 0.0001 }]),
    )
    const scan = await scanExportedFrames(page, exported, bands, 1 / 60)
    const grids = scan.frames.map((frame) =>
      GRAIN_POINTS.map((_, index) => {
        const { r, g, b } = frame.bands[String(index)]
        return (r + g + b) / 3
      }),
    )
    // The encoder's error on this content: the frames without grain, which
    // open and close the file, against the still itself.
    const fromStill = grids.map((grid) => gridDistance(grid, stillGrid))
    const encoding = Math.max(fromStill[0], fromStill.at(-1)!)
    // A frame carries grain when it is much further from the still than that.
    const grained = fromStill.map((distance) => distance > encoding + GRAIN_VISIBLE / 2)
    const first = grained.indexOf(true)
    const last = grained.lastIndexOf(true)
    const best = (grid: readonly number[]) =>
      Math.min(...grids.filter((_, index) => grained[index]).map((frame) => gridDistance(frame, grid)))
    const report = {
      size: `${scan.width}x${scan.height}`,
      duration: scan.duration,
      frames: grids.length,
      encoding,
      grainedFrames: grained.filter(Boolean).length,
      grainedSpan: [scan.frames[first]?.time, scan.frames[last]?.time],
      best50: best(step50.grid),
      best51: best(step51.grid),
      medianTo50: [...grids.filter((_, index) => grained[index]).map((grid) => gridDistance(grid, step50.grid))].sort(
        (a, b) => a - b,
      )[Math.floor(grained.filter(Boolean).length / 2)],
    }
    console.log(`[${testInfo.project.name}] film grain export: ${JSON.stringify(report)}`)

    // Outside the window the file shows the still: the first and last
    // frames are within the encoder's error, and grain occupies one
    // stretch: the window's 2 s less the faint first and last 0.2 s or so
    // of its 0.3 s eases, give or take the recording's stretching (#370).
    expect(encoding, 'the encoder\'s error on the still').toBeLessThan(GRAIN_ENCODING_LIMIT)
    expect(first, 'a grained frame').toBeGreaterThan(0)
    expect(last, 'the last frame plain').toBeLessThan(grids.length - 1)
    expect(grained.slice(first, last + 1).every(Boolean), 'grain in one unbroken stretch').toBe(true)
    const span = scan.frames[last].time - scan.frames[first].time
    expect(span).toBeGreaterThan(GRAIN.end - GRAIN.start - 1)
    expect(span).toBeLessThan(GRAIN.end - GRAIN.start + 0.3)
    // The preview's two steps are each in the file: some exported frame
    // matches each to within the encoder's error on the still plus the
    // allowance above, while a typical grained frame, a different step,
    // is far from it.
    expect(report.best50, 'step 50: the closest exported frame').toBeLessThan(encoding + GRAIN_WEBM_ALLOWANCE)
    expect(report.best51, 'step 51: the closest exported frame').toBeLessThan(encoding + GRAIN_WEBM_ALLOWANCE)
    expect(report.medianTo50, 'a typical grained frame vs step 50').toBeGreaterThan(report.best50 + GRAIN_VISIBLE / 2)
  })
})

test.describe('Visual effects plugin (#862)', () => {
  test('a project with a vignette and a blur prompts for the plugin, and the preview draws both in their windows', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const { project, pattern } = await projectWithEffects(page)
    await openProject(page, project, pattern)

    const before = await previewAt(page, 0.5, 'before both')
    const vignette = await previewAt(page, 2.25, 'vignette')
    const between = await previewAt(page, 3.5, 'between')
    const blur = await previewAt(page, 4.75, 'blur')
    // The blur is a CSS filter on the picture itself.
    await expect(page.getByTestId('preview-image')).toHaveCSS('filter', /blur\(/)
    const after = await previewAt(page, 6.5, 'after both')
    console.log(
      `[${test.info().project.name}] preview: before ${describe(before)}; vignette ${describe(vignette)}; ` +
        `between ${describe(between)}; blur ${describe(blur)}; after ${describe(after)}`,
    )
    for (const [samples, where] of [
      [before, 'before'],
      [between, 'between'],
      [after, 'after'],
    ] as const) {
      expect(cornerRatio(samples), `${where}: no vignette`).toBeGreaterThan(NO_VIGNETTE)
      expect(edgeContrast(samples), `${where}: sharp`).toBeGreaterThan(SHARP)
    }
    expect(cornerRatio(vignette), 'vignette: corner darker').toBeLessThan(VIGNETTED)
    expect(edgeContrast(vignette), 'vignette: still sharp').toBeGreaterThan(SHARP)
    expect(cornerRatio(blur), 'blur: no vignette').toBeGreaterThan(NO_VIGNETTE)
    expect(edgeContrast(blur), 'blur: edge softened').toBeLessThan(BLURRED)

    // With the plugin disabled the effects stay in the project and draw
    // nothing: the picture inside both windows is the untouched pattern.
    await setVisualEffects(page, false)
    const offVignette = await previewAt(page, 2.25, 'plugin disabled, in the vignette window', false)
    const offBlur = await previewAt(page, 4.75, 'plugin disabled, in the blur window', false)
    expect(cornerRatio(offVignette), 'disabled: no vignette').toBeGreaterThan(NO_VIGNETTE)
    expect(edgeContrast(offBlur), 'disabled: sharp').toBeGreaterThan(SHARP)
    await expect(page.getByTestId('preview-image')).toHaveCSS('filter', 'none')
  })

  test('the export draws the same vignette and blur, only inside their windows, matching the preview', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const { project, pattern } = await projectWithEffects(page)
    await openProject(page, project, pattern)
    const previewVignette = await previewAt(page, 2.25, 'vignette')
    const previewBlur = await previewAt(page, 4.75, 'blur')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exported = await readFile((await (await downloadPromise).path())!)
    expect(exported.byteLength).toBeGreaterThan(1000)

    // The export is a real-time recording whose phases can stretch under
    // load (#370), so each phase is found by its own signature in the
    // file, not at a nominal time.
    const scan = await scanExportedFrames(page, exported, BANDS, 0.1)
    const frames = scan.frames.map((frame) => ({ time: frame.time, samples: brightness(frame) }))
    const isPlain = (samples: Samples) =>
      cornerRatio(samples) > NO_VIGNETTE && edgeContrast(samples) > SHARP
    const isVignette = (samples: Samples) =>
      cornerRatio(samples) < VIGNETTED && edgeContrast(samples) > SHARP
    const isBlur = (samples: Samples) =>
      cornerRatio(samples) > NO_VIGNETTE && edgeContrast(samples) < BLURRED
    console.log(
      `[${test.info().project.name}] export ${scan.duration.toFixed(2)} s: ` +
        frames
          .map(({ time, samples }) => `${time.toFixed(1)} ${cornerRatio(samples).toFixed(2)}/${edgeContrast(samples).toFixed(0)}`)
          .join(', '),
    )

    // The file opens and closes on the untouched pattern: before Start and
    // after End, the effects are not drawn.
    expect(isPlain(frames[0].samples), `first frame plain: ${describe(frames[0].samples)}`).toBe(true)
    expect(isPlain(frames.at(-1)!.samples), `last frame plain: ${describe(frames.at(-1)!.samples)}`).toBe(true)
    // In order: plain, vignette, plain, blur, plain.
    const firstVignette = frames.findIndex(({ samples }) => isVignette(samples))
    expect(firstVignette, 'a vignetted frame').toBeGreaterThan(0)
    const plainBetween = frames.findIndex(({ samples }, index) => index > firstVignette && isPlain(samples))
    expect(plainBetween, 'a plain frame after the vignette').toBeGreaterThan(firstVignette)
    const firstBlur = frames.findIndex(({ samples }, index) => index > plainBetween && isBlur(samples))
    expect(firstBlur, 'a blurred frame after that').toBeGreaterThan(plainBetween)
    expect(
      frames.some(({ samples }, index) => index > firstBlur && isPlain(samples)),
      'a plain frame after the blur',
    ).toBe(true)
    // Neither effect leaks into the other's window.
    expect(frames.some(({ samples }) => cornerRatio(samples) < VIGNETTED && edgeContrast(samples) < BLURRED)).toBe(
      false,
    )

    // Preview and export agree, each at its effect's full strength: the
    // export's strongest vignetted and blurred frames against the preview's
    // samples from the middle of each window.
    const exportVignette = Math.min(...frames.map(({ samples }) => cornerRatio(samples)))
    const exportBlur = Math.min(...frames.map(({ samples }) => edgeContrast(samples)))
    expect(Math.abs(exportVignette - cornerRatio(previewVignette)), 'vignette ratio, export vs preview').toBeLessThan(
      RATIO_TOLERANCE,
    )
    expect(Math.abs(exportBlur - edgeContrast(previewBlur)), 'blur contrast, export vs preview').toBeLessThan(
      CONTRAST_TOLERANCE,
    )
  })

  test('during a crossfade the incoming clip\'s vignette darkens only that clip, in the preview and in a saved frame', async ({
    page,
  }) => {
    // Two white stills crossfading, the second with a vignette over its
    // whole length (no ease: both its edges lie on the entry's bounds). At
    // the crossfade's midpoint each clip is at half strength and the two
    // add up, so the corner reads 0.5 + 0.5 × (1 − v): about 0.8 where the
    // vignette alone reads 0.61. Drawing the vignette straight onto the
    // canvas under the crossfade's additive blend would add nothing (1.0),
    // and drawing it over both clips would darken the outgoing one too
    // (0.61). The export's renderer is read through Save frame, which draws
    // with it (frameSnapshot.ts).
    test.setTimeout(90_000)
    await gotoForSaving(page)
    const white = await makeWhite(page)
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: 'white.png', mimeType: 'image/png', buffer: white }])
    for (const position of [1, 2]) {
      await page.getByRole('button', { name: 'Add white.png to timeline' }).click()
      const duration = page.getByRole('spinbutton', {
        name: `Duration of white.png at position ${position} in seconds`,
      })
      await duration.fill('2')
      await duration.blur()
    }
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:03')
    const project = await saveWithEffects(page, ([, incoming]) => [
      { id: 'v1', entryId: incoming, type: 'vignette', start: 0, end: 2, params: { strength: VIGNETTE.strength } },
    ])
    await page.goto('./')
    await page
      .getByTestId('project-file-input')
      .setInputFiles([{ name: 'effects.bvep', mimeType: 'application/gzip', buffer: project }])
    const enable = page.getByRole('dialog', { name: 'Enable plugins to open?' })
    await enable.getByRole('button', { name: 'Enable and open' }).click()
    const relink = page.getByRole('dialog', { name: 'Open effects.bvep' })
    await page
      .getByTestId('relink-file-input')
      .setInputFiles([{ name: 'white.png', mimeType: 'image/png', buffer: white }])
    await relink.getByRole('button', { name: 'Open project' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:03')

    // The 1 s crossfade spans 1 s to 2 s; 1.5 s is its midpoint.
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1.5')
    await expect(page.getByTestId('preview-image-incoming')).toBeVisible()
    await expect(page.getByTestId('preview-picture-layers-incoming')).toHaveCount(1)
    for (const image of ['preview-image', 'preview-image-incoming']) {
      await expect
        .poll(() => page.getByTestId(image).evaluate((element) => (element as HTMLImageElement).complete))
        .toBe(true)
    }
    const shot = await page.getByTestId('preview-frame').screenshot()
    await test.info().attach('preview at the crossfade midpoint', { body: shot, contentType: 'image/png' })
    const preview = await samplePng(page, shot)

    const downloadPromise = page.waitForEvent('download')
    await chooseFromFrameMenu(page, 'preview-save-frame')
    const saved = await readFile((await (await downloadPromise).path())!)
    await test.info().attach('saved frame at the crossfade midpoint', { body: saved, contentType: 'image/png' })
    const exported = await samplePng(page, saved)
    console.log(
      `[${test.info().project.name}] crossfade midpoint: preview ${describe(preview)}, saved frame ${describe(exported)}`,
    )
    for (const [samples, where] of [
      [preview, 'preview'],
      [exported, 'saved frame'],
    ] as const) {
      expect(cornerRatio(samples), `${where}: the incoming half darkened`).toBeGreaterThan(0.72)
      expect(cornerRatio(samples), `${where}: the outgoing half not`).toBeLessThan(0.88)
    }
    expect(Math.abs(cornerRatio(preview) - cornerRatio(exported)), 'preview vs saved frame').toBeLessThan(
      RATIO_TOLERANCE,
    )
  })
})
