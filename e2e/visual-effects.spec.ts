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
import { confirmDisableIfAsked } from './pluginConfirm'

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
  if (!enabled) await confirmDisableIfAsked(page, 'Visual effects')
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
  // VHS's row (#870) has one field, as Old film's does; its name is the
  // one initialism among the rows' labels.
  await chooseEffect(page, ENTRY, 'VHS')
  await expect(page.getByTestId('picture-effect-row')).toHaveCount(4)
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
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain', 'Old film', 'VHS'])

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
      'Old film',
      'VHS',
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
      await expectNoHorizontalScroll(page, `with the effect rows at ${viewport.width}px`)
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
 * and the next closest 22 or more in the two runs that listed them. Nine
 * later local Chromium runs of six steps each read 6.1 to 16.8 for a
 * matched step, against 23.2 and 23.9 for the two steps the file skipped
 * and 24.2 to 26.3 when the export drew other steps' patterns (a mutation).
 * So an exported frame matches a step within the still's error plus 16,
 * and the still's error itself must stay under 8, or the comparison says
 * nothing.
 */
const GRAIN_ENCODING_LIMIT = 8
const GRAIN_WEBM_ALLOWANCE = 16
/** Two instants one texture step apart: steps 50 and 51 at 24 a second. */
const STEP_50 = 2.1
const STEP_51 = 2.15
/**
 * The WebM test's preview steps: six in a row, 2.0 to 2.25 s, inside the
 * window's full-weight middle (1.3 to 2.7 s), each previewed at its
 * midpoint. The export is a real-time recording at 30 frames a second, and
 * a step lasts 1/24 s, 41.7 ms. One recorded frame late or dropped leaves a
 * 67 ms gap that can skip a step entirely, so no single step is certain to
 * be in the file. #933's CI measured it: in Firefox the closest exported
 * frame to step 51 read 21.70, in the 22-or-more range of unrelated frames,
 * while step 50 read 9.03; the retry read 12.03 and 7.94. So the test asks
 * for most of the six, not each of two.
 */
const WEBM_STEPS = [48, 49, 50, 51, 52, 53]
const WEBM_STEPS_MATCHED = 4

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

/**
 * Mean brightness, preview vs saved frame, that the outgoing-grain
 * crossfade test allows (0 to 255). Measured in local Chromium: 0.1 apart
 * before the crossfade and 0.06 at its midpoint, against 21 when the
 * export drew the grain undimmed.
 */
const GRAIN_OUTGOING_TOLERANCE = 3

/** A plain black still, 640×360. */
async function makeBlack(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 640, 360)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/** The mean brightness of every pixel of a PNG, 0 to 255. */
async function meanOfPng(page: Page, png: Buffer): Promise<number> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    let sum = 0
    for (let index = 0; index < data.length; index += 4) sum += (data[index] + data[index + 1] + data[index + 2]) / 3
    return sum / (data.length / 4)
  }, png.toString('base64'))
}

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
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain', 'Old film', 'VHS'])
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
    const steps: { step: number; grid: number[] }[] = []
    for (const step of WEBM_STEPS) {
      // The seek slider's step is 0.01 s, and each midpoint rounds to an
      // instant well inside its step.
      const { grid } = await previewGrainAt(page, Math.round(((step + 0.5) / 24) * 100) / 100, step, `step ${step}`)
      steps.push({ step, grid })
    }

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
    const grainedGrids = grids.filter((_, index) => grained[index])
    // For each preview step: its closest grained frame, and a typical one.
    const matches = steps.map(({ step, grid }) => {
      const distances = grainedGrids.map((frame) => gridDistance(frame, grid)).sort((a, b) => a - b)
      return { step, best: distances[0], median: distances[Math.floor(distances.length / 2)] }
    })
    const bound = encoding + GRAIN_WEBM_ALLOWANCE
    const matched = matches.filter((match) => match.best < bound)
    const report = {
      size: `${scan.width}x${scan.height}`,
      duration: scan.duration,
      frames: grids.length,
      encoding,
      bound,
      grainedFrames: grainedGrids.length,
      grainedSpan: [scan.frames[first]?.time, scan.frames[last]?.time],
      steps: matches.map(({ step, best, median }) => `${step}: best ${best.toFixed(2)}, median ${median.toFixed(2)}`),
      matched: matched.length,
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
    // Most of the preview's six steps are in the file: some exported frame
    // matches each to within the encoder's error on the still plus the
    // allowance above (see WEBM_STEPS for why not every one). For each
    // matched step a typical grained frame, a different step, is far from
    // it, so a match is that step's pattern and not any grain at all.
    expect(matched.length, `steps with a matching exported frame: ${report.steps.join('; ')}`).toBeGreaterThanOrEqual(
      WEBM_STEPS_MATCHED,
    )
    for (const match of matched) {
      expect(match.median, `step ${match.step}: a typical grained frame vs its closest`).toBeGreaterThan(
        match.best + GRAIN_VISIBLE / 2,
      )
    }
  })
  test('on the outgoing clip of a crossfade, the grain fades with its clip in the preview and in a saved frame', async ({
    page,
  }, testInfo) => {
    // Two black stills crossfading, the first with Film grain over its whole
    // length (no ease: both edges lie on the entry's bounds). On black the
    // frame's mean brightness is the grain's white cells alone. At the
    // crossfade's midpoint the outgoing card is at half opacity, and the
    // preview fades the grain with it, so the mean halves. Drawing the
    // grain at full brightness over the faded card, as the export did before
    // #933's review, kept it whole: 42 against the preview's 21 (Chromium).
    test.setTimeout(90_000)
    await gotoForSaving(page)
    const black = await makeBlack(page)
    // Named as the still `openProject` re-links.
    await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: black }])
    for (const position of [1, 2]) {
      await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
      const duration = page.getByRole('spinbutton', {
        name: `Duration of ${STILL} at position ${position} in seconds`,
      })
      await duration.fill('2')
      await duration.blur()
    }
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:03')
    const project = await saveWithEffects(page, ([outgoing]) => [
      { id: 'g1', entryId: outgoing, type: 'film-grain', start: 0, end: 2, params: { amount: 100, size: 10 } },
    ])
    await openProject(page, project, black, '0:03')

    const means: Record<string, { preview: number; saved: number }> = {}
    // 0.5 s is before the 1 s crossfade (1 s to 2 s); 1.5 s is its midpoint.
    for (const [seconds, label] of [
      [0.5, 'before'],
      [1.5, 'midpoint'],
    ] as const) {
      await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
      await expect(page.getByTestId('preview-picture-grain')).toHaveAttribute('data-seed', String(seconds * 24))
      for (const image of seconds > 1 ? ['preview-image', 'preview-image-incoming'] : ['preview-image']) {
        await expect
          .poll(() => page.getByTestId(image).evaluate((element) => (element as HTMLImageElement).complete))
          .toBe(true)
      }
      const shot = await page.getByTestId('preview-frame').screenshot()
      await testInfo.attach(`preview, ${label}`, { body: shot, contentType: 'image/png' })
      const downloadPromise = page.waitForEvent('download')
      await chooseFromFrameMenu(page, 'preview-save-frame')
      const saved = await readFile((await (await downloadPromise).path())!)
      await testInfo.attach(`saved frame, ${label}`, { body: saved, contentType: 'image/png' })
      means[label] = { preview: await meanOfPng(page, shot), saved: await meanOfPng(page, saved) }
    }
    console.log(`[${testInfo.project.name}] outgoing grain over black, mean brightness: ${JSON.stringify(means)}`)
    // The grain is there, and the crossfade halves it in the preview.
    expect(means.before.preview, 'grain over black, before the crossfade').toBeGreaterThan(GRAIN_VISIBLE)
    const faded = means.midpoint.preview / means.before.preview
    expect(faded, 'the preview fades the grain with its clip').toBeGreaterThan(0.35)
    expect(faded, 'the preview fades the grain with its clip').toBeLessThan(0.65)
    // Save frame draws through the export's composer, and agrees each time.
    for (const label of ['before', 'midpoint']) {
      expect(Math.abs(means[label].saved - means[label].preview), `${label}: saved frame vs preview`).toBeLessThan(
        GRAIN_OUTGOING_TOLERANCE,
      )
    }
  })
})

/**
 * Old film (#870, step 2a): a sepia tone and a brightness flicker, both
 * filter functions, over a fine grain. The flicker is a pure function of
 * the entry's time, like the grain, so the preview and the export must
 * flicker alike.
 *
 * The still is four colour bars, so the tone shows as a change of hue
 * (blue turns brown: its red rises above its blue) and the flicker as a
 * change of brightness on the grey bar. Each band is the mean of a patch
 * of its bar, which averages the grain (its mean effect is close to none)
 * and leaves the tone and the flicker.
 */
const OLD_FILM = { start: 1, end: 3, amount: 100 }
const OLD_FILM_DURATION = 4
// The re-link step matches the still by name, as the grain's does.
const OLD_FILM_STILL = STILL
/** The bars, left to right, 160 px each of the 640 × 360 still. */
const BARS = {
  blue: [40, 80, 200],
  red: [200, 60, 40],
  grey: [128, 128, 128],
  green: [60, 180, 80],
} as const
type Bar = keyof typeof BARS
const BAR_BANDS: Record<Bar, { x: number; y: number; width: number; height: number }> = {
  blue: { x: 0.05, y: 0.3, width: 0.15, height: 0.4 },
  red: { x: 0.3, y: 0.3, width: 0.15, height: 0.4 },
  grey: { x: 0.55, y: 0.3, width: 0.15, height: 0.4 },
  green: { x: 0.8, y: 0.3, width: 0.15, height: 0.4 },
}
type Rgb = { r: number; g: number; b: number }
type BarSamples = Record<Bar, Rgb>
/**
 * Two instants one texture step apart, at Amount 100, chosen for their
 * flicker: step 49 is about 1.056 times the toned picture's brightness and
 * step 50 about 0.946 (`oldFilmBrightness`), so the grey bar is about
 * 12 % brighter at the first. Both lie in the window's full-weight middle.
 */
const OLD_FILM_STEP_49 = 2.06
const OLD_FILM_STEP_50 = 2.1
/**
 * Preview vs saved frame, per channel of each bar's mean (0 to 255).
 * Measured in local Chromium on this spec before it was set: 0 outside the
 * window, and at most 1.7 on either step inside it, against 15 to 17
 * between the grey bar's two steps.
 */
const OLD_FILM_CHANNEL_TOLERANCE = 5
/**
 * How far the blue bar's blue must fall for an exported frame to count as
 * toned: well above the WebM encoder's error on the bars (3 at most on
 * the plain frames, measured), well below the full tone's fall of 100.
 */
const OLD_FILM_TONED = 30
/**
 * How far the blue bar's blue must fall, and its red rise, at the window's
 * full weight in the WebM: the full tone moves them by about 100 and 64
 * (sepia 0.85, times a brightness within 8 % of 1), and the encoder's error
 * is a few levels. Firefox measured 109.5 for both (#942's CI, run
 * 45623302293).
 */
const OLD_FILM_TONED_FULL = 40
/** The grey bar's brightness ratio between the two steps must show the flicker: about 1.12. */
const OLD_FILM_FLICKER_SEEN = 1.06

/** The four colour bars, 640 × 360. */
async function makeBars(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((bars) => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')!
    Object.values(bars).forEach(([r, g, b], index) => {
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(index * 160, 0, 160, 360)
    })
    return canvas.toDataURL('image/png').split(',')[1]
  }, BARS)
  return Buffer.from(base64, 'base64')
}

/** Each bar's mean colour in a PNG of the composed frame. */
async function barsOfPng(page: Page, png: Buffer): Promise<BarSamples> {
  return (await page.evaluate(
    async ({ base64, bands }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      return Object.fromEntries(
        Object.entries(bands).map(([name, rect]) => {
          const x = Math.floor(rect.x * bitmap.width)
          const y = Math.floor(rect.y * bitmap.height)
          const width = Math.max(1, Math.round(rect.width * bitmap.width))
          const height = Math.max(1, Math.round(rect.height * bitmap.height))
          const data = ctx.getImageData(x, y, width, height).data
          let r = 0
          let g = 0
          let b = 0
          for (let index = 0; index < data.length; index += 4) {
            r += data[index]
            g += data[index + 1]
            b += data[index + 2]
          }
          const count = data.length / 4
          return [name, { r: r / count, g: g / count, b: b / count }]
        }),
      )
    },
    { base64: png.toString('base64'), bands: BAR_BANDS },
  )) as BarSamples
}

/** The largest per-channel difference between two samplings of the bars. */
const barsDistance = (a: BarSamples, b: BarSamples) =>
  Math.max(
    ...(Object.keys(BARS) as Bar[]).flatMap((bar) => [
      Math.abs(a[bar].r - b[bar].r),
      Math.abs(a[bar].g - b[bar].g),
      Math.abs(a[bar].b - b[bar].b),
    ]),
  )
const lightness = ({ r, g, b }: Rgb) => (r + g + b) / 3

/** Builds the 4 s bars still with Old film from 1 s to 3 s at Amount 100, and opens that project. */
async function openOldFilmProject(page: Page): Promise<Buffer> {
  await gotoForSaving(page)
  const still = await makeBars(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: OLD_FILM_STILL, mimeType: 'image/png', buffer: still }])
  await page.getByRole('button', { name: `Add ${OLD_FILM_STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${OLD_FILM_STILL} at position 1 in seconds` })
  await duration.fill(String(OLD_FILM_DURATION))
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  const project = await saveWithEffects(page, ([entryId]) => [
    {
      id: 'o1',
      entryId,
      type: 'old-film',
      start: OLD_FILM.start,
      end: OLD_FILM.end,
      params: { amount: OLD_FILM.amount },
    },
  ])
  await openProject(page, project, still, '0:04')
  return still
}

/**
 * Seeks the preview to `seconds`, waits for the grain step that instant
 * publishes (or for no effect), and returns the bars, the screenshot and
 * the brightness the media element's filter carries (1 outside the window).
 */
async function previewOldFilmAt(page: Page, seconds: number, step: number | null, label: string) {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  const grain = page.getByTestId('preview-picture-grain')
  if (step === null) {
    await expect(grain).toHaveCount(0)
    await expect(image).toHaveCSS('filter', 'none')
  } else {
    await expect(grain).toHaveAttribute('data-seed', String(step))
    await expect(image).toHaveCSS('filter', /sepia\(.*brightness\(/)
  }
  const filter = await image.evaluate((element) => getComputedStyle(element).filter)
  const brightness = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? 1)
  const png = await page
    .getByTestId('preview-frame')
    .screenshot({ path: test.info().outputPath(`old-film-preview-${seconds}s.png`) })
  await test.info().attach(`preview at ${seconds} s (${label})`, { body: png, contentType: 'image/png' })
  return { bars: await barsOfPng(page, png), png, brightness }
}

/** Saves the playhead's frame through the export's composer (Save frame) and returns its bars. */
async function savedOldFilmFrame(page: Page, label: string): Promise<BarSamples> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const download = await downloadPromise
  const saved = await readFile((await download.path())!)
  await download.saveAs(test.info().outputPath(`old-film-saved-${label.replaceAll(' ', '-')}.png`))
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return await barsOfPng(page, saved)
}

const describeBars = (bars: BarSamples) =>
  (Object.keys(BARS) as Bar[])
    .map((bar) => `${bar} ${[bars[bar].r, bars[bar].g, bars[bar].b].map((value) => value.toFixed(1)).join('/')}`)
    .join(', ')

test.describe('Old film (#870)', () => {
  test('+ Effect ▾ offers Old film after Film grain, with Amount at its default', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('./')
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: OLD_FILM_STILL, mimeType: 'image/png', buffer: await makeBars(page) }])
    await page.getByRole('button', { name: `Add ${OLD_FILM_STILL} to timeline` }).click()
    await setVisualEffects(page, true)
    const entry = `${OLD_FILM_STILL} at position 1`
    expect(await effectItems(page, entry)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain', 'Old film', 'VHS'])
    await chooseEffect(page, entry, 'Old film')
    await expect(page.getByRole('spinbutton', { name: `Old film 1 amount of ${entry} (percent)` })).toHaveValue('70')
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
    // At the default 70 %: sepia 0.85 × 0.7 on the picture, and the grain's
    // 640 × 360 cells (size 3) over it.
    const image = page.getByTestId('preview-image')
    await expect(image).toHaveCSS('filter', /sepia\(0\.595\) brightness\(/)
    const grain = page.getByTestId('preview-picture-grain')
    await expect(grain).toHaveAttribute('width', '640')
    await expect(grain).toHaveAttribute('data-seed', '24')
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
    const shot = await page
      .getByTestId('preview-frame')
      .screenshot({ path: test.info().outputPath('old-film-default.png') })
    await test.info().attach('Old film at its default, on the colour bars', { body: shot, contentType: 'image/png' })
  })

  test('the preview and a saved frame tone and flicker alike for the same instant, and not outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await openOldFilmProject(page)

    const before = await previewOldFilmAt(page, 0.5, null, 'before the window')
    const savedBefore = await savedOldFilmFrame(page, 'before the window')
    const after = await previewOldFilmAt(page, 3.5, null, 'after the window')
    const savedAfter = await savedOldFilmFrame(page, 'after the window')
    const step49 = await previewOldFilmAt(page, OLD_FILM_STEP_49, 49, 'step 49')
    const saved49 = await savedOldFilmFrame(page, 'step 49')
    const step50 = await previewOldFilmAt(page, OLD_FILM_STEP_50, 50, 'step 50')
    const saved50 = await savedOldFilmFrame(page, 'step 50')
    const report = {
      before: describeBars(before.bars),
      step49: describeBars(step49.bars),
      step50: describeBars(step50.bars),
      plain: barsDistance(before.bars, savedBefore),
      plainAfter: barsDistance(after.bars, savedAfter),
      same49: barsDistance(step49.bars, saved49),
      same50: barsDistance(step50.bars, saved50),
      brightness: [step49.brightness, step50.brightness],
      previewFlicker: lightness(step49.bars.grey) / lightness(step50.bars.grey),
      savedFlicker: lightness(saved49.grey) / lightness(saved50.grey),
    }
    console.log(`[${testInfo.project.name}] old film bars: ${JSON.stringify(report)}`)

    // Outside the window both renderers show the bars untouched, alike.
    expect(barsDistance(before.bars, after.bars), 'before vs after, preview').toBeLessThan(1)
    expect(report.plain, 'before the window: preview vs saved frame').toBeLessThan(OLD_FILM_CHANNEL_TOLERANCE)
    expect(report.plainAfter, 'after the window: preview vs saved frame').toBeLessThan(OLD_FILM_CHANNEL_TOLERANCE)
    expect(before.bars.blue.b - before.bars.blue.r, 'the blue bar is blue').toBeGreaterThan(100)
    // Inside it, the tone: the blue bar's red has risen above its blue, in both renderers.
    for (const [name, bars] of [
      ['preview 49', step49.bars],
      ['saved 49', saved49],
      ['preview 50', step50.bars],
      ['saved 50', saved50],
    ] as const) {
      expect(bars.blue.r - bars.blue.b, `${name}: the blue bar toned brown`).toBeGreaterThan(0)
    }
    // The same instant: the preview and the saved frame agree on every bar.
    expect(report.same49, 'step 49: preview vs saved frame').toBeLessThan(OLD_FILM_CHANNEL_TOLERANCE)
    expect(report.same50, 'step 50: preview vs saved frame').toBeLessThan(OLD_FILM_CHANNEL_TOLERANCE)
    // The flicker: the two steps carry different brightness filters, the
    // grey bar shows it, and both renderers show it alike.
    expect(step49.brightness).toBeGreaterThan(step50.brightness)
    expect(report.previewFlicker, 'step 49 vs 50, preview').toBeGreaterThan(OLD_FILM_FLICKER_SEEN)
    expect(report.savedFlicker, 'step 49 vs 50, saved frame').toBeGreaterThan(OLD_FILM_FLICKER_SEEN)
    expect(Math.abs(report.previewFlicker - report.savedFlicker)).toBeLessThan(0.02)
  })

  test('the export tones only inside the window, and flickers there', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await openOldFilmProject(page)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exported = await readFile((await (await downloadPromise).path())!)
    const scan = await scanExportedFrames(page, exported, BAR_BANDS, 1 / 30)
    const frames = scan.frames.map((frame) => ({ time: frame.time, bars: frame.bands as unknown as BarSamples }))
    // A frame is toned when the blue bar has lost well over the encoder's
    // error of its blue: at full weight it falls from 200 to about 100, and
    // through the eases it falls steadily, so the toned frames are one run.
    const toned = frames.map(({ bars }) => bars.blue.b < BARS.blue[2] - OLD_FILM_TONED)
    const first = toned.indexOf(true)
    const last = toned.lastIndexOf(true)
    const tonedFrames = frames.slice(first, last + 1)
    const greys = tonedFrames.map(({ bars }) => lightness(bars.grey))
    const full = frames.find(({ time }) => time > OLD_FILM.start + 0.8 && time < OLD_FILM.end - 0.8)!
    const report = {
      size: `${scan.width}x${scan.height}`,
      duration: scan.duration,
      frames: frames.length,
      firstFrame: describeBars(frames[0].bars),
      lastFrame: describeBars(frames.at(-1)!.bars),
      tonedSpan: [frames[first]?.time, frames[last]?.time],
      grey: [Math.min(...greys), Math.max(...greys)].map((value) => Number(value.toFixed(1))),
      full: `${full.time.toFixed(3)} s: ${describeBars(full.bars)}`,
    }
    console.log(`[${testInfo.project.name}] old film export: ${JSON.stringify(report)}`)

    // Outside the window the file shows the bars as they are: the first and
    // last frames are within the encoder's error of the still's colours.
    for (const frame of [frames[0], frames.at(-1)!]) {
      for (const bar of Object.keys(BARS) as Bar[]) {
        const [r, g, b] = BARS[bar]
        expect(Math.abs(frame.bars[bar].r - r), `${bar} red at ${frame.time} s`).toBeLessThan(12)
        expect(Math.abs(frame.bars[bar].g - g), `${bar} green at ${frame.time} s`).toBeLessThan(12)
        expect(Math.abs(frame.bars[bar].b - b), `${bar} blue at ${frame.time} s`).toBeLessThan(12)
      }
    }
    // Toned in one unbroken stretch, the window's 2 s less the faint ends
    // of its eases, give or take the recording's stretching (#370). At full
    // weight the blue bar is toned brown: its blue has fallen from 200 and
    // its red risen from 40, each by far more than the encoder's error. Not
    // "its red above its blue": the full tone puts red only about 6 above
    // blue (sepia 0.85 of rgb(40, 80, 200) is about 104 against 98), and
    // Firefox's WebM measured them equal at 1.8 s on three attempts.
    expect(full.bars.blue.b, `the blue bar's blue fallen at ${full.time} s`).toBeLessThan(
      BARS.blue[2] - OLD_FILM_TONED_FULL,
    )
    expect(full.bars.blue.r, `the blue bar's red risen at ${full.time} s`).toBeGreaterThan(
      BARS.blue[0] + OLD_FILM_TONED_FULL,
    )
    expect(first, 'a toned frame').toBeGreaterThan(0)
    expect(last, 'the last frame untoned').toBeLessThan(frames.length - 1)
    expect(toned.slice(first, last + 1).every(Boolean), 'toned in one unbroken stretch').toBe(true)
    const span = frames[last].time - frames[first].time
    expect(span).toBeGreaterThan(OLD_FILM.end - OLD_FILM.start - 1)
    expect(span).toBeLessThan(OLD_FILM.end - OLD_FILM.start + 0.3)
    // The flicker is in the file: across the toned frames' full-weight
    // middle, the grey bar's brightness moves by more than the encoder's
    // own wobble on a flat grey.
    const middle = tonedFrames
      .filter(({ time }) => time > frames[first].time + 0.4 && time < frames[last].time - 0.4)
      .map(({ bars }) => lightness(bars.grey))
    expect(Math.max(...middle) / Math.min(...middle), 'the grey bar flickers').toBeGreaterThan(OLD_FILM_FLICKER_SEEN)
  })
})

/**
 * Old film's scratches and dust (#870, step 2a(ii)): two more generated
 * textures, which must land in the same places in the preview and in the
 * export's composer at the same instant.
 *
 * The test reads where they are from the preview's own texture canvases (a
 * scratch is a lit column of `preview-picture-scratches`, a speck a lit
 * cell of `preview-picture-dust`), then measures each one in both renderers
 * against its surroundings: a scratch as its column's mean brightness above
 * the median column, which averages out the grain, and a speck as its
 * cell's brightness against eight points three cells around it.
 */
const DUST_COLUMNS = 480
/**
 * A plain still of one grey `level`, 1920 × 1080 unless told otherwise, so
 * a 1080p frame holds a dust cell in 4 px and a scratch in 2.
 */
async function makePlain(page: Page, level: number, width = 1920, height = 1080): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ level, width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = `rgb(${level}, ${level}, ${level})`
      ctx.fillRect(0, 0, width, height)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { level, width, height },
  )
  return Buffer.from(base64, 'base64')
}

type Speck = { x: number; y: number; light: boolean }
/** Where a step's scratches (column centres, with each one's mean alpha down the frame) and specks lie, as fractions of the frame. */
type Damage = { scratches: number[]; scratchAlphas: number[]; specks: Speck[] }

/** Where the preview's texture canvases put scratches (column centres) and specks (cell centres), as fractions of the frame. */
async function previewDamage(page: Page): Promise<Damage> {
  const scratches = await page.getByTestId('preview-picture-scratches').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    // Each lit column's alpha, summed down its rows.
    const columns = new Map<number, number>()
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] === 0) continue
      const column = ((index - 3) / 4) % canvas.width
      columns.set(column, (columns.get(column) ?? 0) + data[index])
    }
    return [...columns.entries()]
      .sort(([a], [b]) => a - b)
      .map(([column, alpha]) => ({ x: (column + 0.5) / canvas.width, alpha: alpha / canvas.height / 255 }))
  })
  const specks = await page.getByTestId('preview-picture-dust').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const found: { x: number; y: number; light: boolean }[] = []
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue
      const cell = index / 4
      found.push({
        x: ((cell % canvas.width) + 0.5) / canvas.width,
        y: (Math.floor(cell / canvas.width) + 0.5) / canvas.height,
        light: data[index] === 255,
      })
    }
    return found
  })
  return { scratches: scratches.map(({ x }) => x), scratchAlphas: scratches.map(({ alpha }) => alpha), specks }
}

/**
 * Each scratch's column-mean brightness above the median column, and each
 * speck's brightness against its surroundings, in a PNG of the frame.
 */
async function damageOfPng(page: Page, png: Buffer, damage: Omit<Damage, 'scratchAlphas'>): Promise<{ scratches: number[]; specks: number[] }> {
  return await page.evaluate(
    async ({ base64, damage, dustColumns }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      // Both renderers' frames measured at one size, 1080p, so a point
      // falls on the same part of a speck in each: the preview's screenshot
      // is larger than the saved frame.
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, 1920, 1080)
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      const at = (x: number, y: number) => {
        const index = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
        return (data[index] + data[index + 1] + data[index + 2]) / 3
      }
      // The scratches are measured on the frame as rendered, not resampled:
      // a scratch is 2 px of a 1080p frame, smoothed, so its peak depends on
      // where it falls between pixels, and resampling a line that thin
      // gains or loses some of it. The light it adds does not depend on
      // either: the sum of its columns' excess over the median column, over
      // 3 px of a 1080p frame either side, scaled to 1080p pixels.
      const native = document.createElement('canvas')
      native.width = bitmap.width
      native.height = bitmap.height
      const nativeContext = native.getContext('2d')!
      nativeContext.drawImage(bitmap, 0, 0)
      const nativeData = nativeContext.getImageData(0, 0, native.width, native.height).data
      const profile = Array.from({ length: native.width }, (_, x) => {
        let sum = 0
        for (let y = 0; y < native.height; y++) {
          const index = (y * native.width + x) * 4
          sum += (nativeData[index] + nativeData[index + 1] + nativeData[index + 2]) / 3
        }
        return sum / native.height
      })
      const median = [...profile].sort((a, b) => a - b)[Math.floor(native.width / 2)]
      const perPixel = native.width / 1920
      const reachX = Math.ceil(3 * perPixel)
      const scratches = damage.scratches.map((fraction) => {
        const x = Math.floor(fraction * native.width)
        let excess = 0
        for (let dx = -reachX; dx <= reachX; dx++) excess += (profile[x + dx] ?? median) - median
        return excess / perPixel
      })
      const cell = width / dustColumns
      const specks = damage.specks.map(({ x: fx, y: fy, light }) => {
        const x = Math.floor(fx * width)
        const y = Math.floor(fy * height)
        let around = 0
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          around += at(Math.round(x + dx * 3 * cell), Math.round(y + dy * 3 * cell))
        }
        // The speck's darkest (or, for a light one, brightest) pixel within
        // half a cell of its centre: the extreme a smoothed cell reaches.
        const values: number[] = []
        const reach = Math.floor(cell / 2)
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) values.push(at(x + dx, y + dy))
        return (light ? Math.max(...values) : Math.min(...values)) - around / 8
      })
      return { scratches, specks }
    },
    { base64: png.toString('base64'), damage, dustColumns: DUST_COLUMNS },
  )
}

/** A scratch's columns must add this much over the median column (summed over 7 px, 0 to 255 each) to count as drawn. */
const SCRATCH_SEEN = 10
/** A dark speck must fall this far below its surroundings to count as drawn. */
const DUST_SEEN = 20
/** Preview vs saved frame, per speck (0 to 255). */
const DAMAGE_TOLERANCE = 12
/**
 * The same in Firefox. A speck's darkest pixel depends on the smoothing
 * that stretches its one tile cell over 4 px of a 1080p frame, and
 * Firefox's preview path smooths less: #952's CI read one dark speck
 * 14.9 deeper in its preview than in its saved frame (-90.6 against
 * -75.7), on all three attempts, while the saved frames of the two
 * browsers agree within 1 and Chromium's preview within 4.3. A summed
 * measure, which any smoothing keeps, was tried and is worse: the grain
 * crossing the sum's edges put Chromium's preview and saved frame up to
 * 21.7 apart. A missing speck still fails `DUST_SEEN` on its own (the
 * saved frame reads about -10 without dust).
 */
const FIREFOX_DAMAGE_TOLERANCE = 20
/** Preview vs saved frame, per scratch's summed excess. */
const SCRATCH_TOLERANCE = 10
/** Preview vs saved frame on the crossfade, as a share of the scratch's full strength: undimmed, the saved frame would be about 0.5 over. */
const SCRATCH_FADE_TOLERANCE = 0.15

/** Seeks to the middle of texture `step`, to the slider's hundredth, and waits for the preview to draw that step's textures. */
async function seekToStep(page: Page, step: number) {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(Number(((step + 0.5) / 24).toFixed(2))))
  await expect(page.getByTestId('preview-picture-scratches')).toHaveAttribute('data-seed', String(step))
  await expect(page.getByTestId('preview-picture-dust')).toHaveAttribute('data-seed', String(step))
}

async function savedFrame(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  return await readFile((await (await downloadPromise).path())!)
}

test.describe("Old film's scratches and dust (#870)", () => {
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })

  test('the preview and a saved frame put the same scratches and dust in the same places', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await gotoForSaving(page)
    const grey = await makePlain(page, 128)
    await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: grey }])
    await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
    const duration = page.getByRole('spinbutton', { name: `Duration of ${STILL} at position 1 in seconds` })
    await duration.fill('4')
    await duration.blur()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
    // Over the whole entry, so both ends lie on its bounds and nothing eases.
    const project = await saveWithEffects(page, ([entryId]) => [
      { id: 'o1', entryId, type: 'old-film', start: 0, end: 4, params: { amount: 100 } },
    ])
    await openProject(page, project, grey, '0:04')

    // The first two steps from 1 s on with a scratch and at least two dark specks.
    const chosen: { step: number; damage: Damage }[] = []
    for (let step = 24; step < 72 && chosen.length < 2; step++) {
      await seekToStep(page, step)
      const damage = await previewDamage(page)
      if (damage.scratches.length > 0 && damage.specks.filter(({ light }) => !light).length >= 2) {
        chosen.push({ step, damage })
      }
    }
    expect(chosen, 'two steps with a scratch and dark dust').toHaveLength(2)

    const reports = []
    for (const { step, damage } of chosen) {
      await seekToStep(page, step)
      await expect
        .poll(() => page.getByTestId('preview-image').evaluate((element) => (element as HTMLImageElement).complete))
        .toBe(true)
      const shot = await page
        .getByTestId('preview-frame')
        .screenshot({ path: testInfo.outputPath(`old-film-damage-preview-${step}.png`) })
      await testInfo.attach(`preview, step ${step}`, { body: shot, contentType: 'image/png' })
      const saved = await savedFrame(page)
      await testInfo.attach(`saved frame, step ${step}`, { body: saved, contentType: 'image/png' })
      const preview = await damageOfPng(page, shot, damage)
      const savedDamage = await damageOfPng(page, saved, damage)
      reports.push({ step, damage, preview, saved: savedDamage })
    }
    console.log(`[${testInfo.project.name}] old film scratches and dust: ${JSON.stringify(reports)}`)

    for (const { step, damage, preview, saved } of reports) {
      damage.scratches.forEach((x, index) => {
        const where = `step ${step}, scratch at ${x.toFixed(4)}`
        expect(preview.scratches[index], `${where}: preview`).toBeGreaterThan(SCRATCH_SEEN)
        expect(saved.scratches[index], `${where}: saved frame`).toBeGreaterThan(SCRATCH_SEEN)
        expect(Math.abs(preview.scratches[index] - saved.scratches[index]), `${where}: preview vs saved`).toBeLessThan(
          SCRATCH_TOLERANCE,
        )
      })
      damage.specks.forEach(({ x, y, light }, index) => {
        const where = `step ${step}, ${light ? 'light' : 'dark'} speck at ${x.toFixed(4)}, ${y.toFixed(4)}`
        if (!light) {
          expect(preview.specks[index], `${where}: preview`).toBeLessThan(-DUST_SEEN)
          expect(saved.specks[index], `${where}: saved frame`).toBeLessThan(-DUST_SEEN)
        }
        expect(Math.abs(preview.specks[index] - saved.specks[index]), `${where}: preview vs saved`).toBeLessThan(
          testInfo.project.name === 'firefox' ? FIREFOX_DAMAGE_TOLERANCE : DAMAGE_TOLERANCE,
        )
      })
    }
  })

  test("on the outgoing clip of a crossfade, a scratch fades with its clip in the preview and in a saved frame", async ({
    page,
  }, testInfo) => {
    // As the outgoing-grain test: two black stills crossfading from 1 s to
    // 2 s, the first with Old film over its whole length. On black the tone
    // and the flicker change nothing, so a scratch's column is the scratch
    // alone, and at the crossfade's middle the preview shows it at about
    // half its strength. An export drawing it undimmed would show it whole.
    test.setTimeout(120_000)
    await gotoForSaving(page)
    const black = await makePlain(page, 0)
    await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: black }])
    for (const position of [1, 2]) {
      await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
      const duration = page.getByRole('spinbutton', { name: `Duration of ${STILL} at position ${position} in seconds` })
      await duration.fill('2')
      await duration.blur()
    }
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:03')
    const project = await saveWithEffects(page, ([outgoing]) => [
      { id: 'o1', entryId: outgoing, type: 'old-film', start: 0, end: 2, params: { amount: 100 } },
    ])
    await openProject(page, project, black, '0:03')

    // The step nearest the crossfade's middle with a scratch, and one before the crossfade.
    const findStep = async (steps: number[]) => {
      for (const step of steps) {
        await seekToStep(page, step)
        const damage = await previewDamage(page)
        if (damage.scratches.length > 0) return { step, damage }
      }
      throw new Error(`no scratch in steps ${steps.join(', ')}`)
    }
    const measured: Record<string, { step: number; full: number[]; preview: number[]; saved: number[] }> = {}
    for (const [label, steps] of [
      ['before', [12, 13, 11, 14, 10, 15, 9, 16]],
      ['middle', [36, 35, 37, 34, 38, 33, 39]],
    ] as const) {
      const { step, damage } = await findStep([...steps])
      await seekToStep(page, step)
      for (const image of label === 'middle' ? ['preview-image', 'preview-image-incoming'] : ['preview-image']) {
        await expect
          .poll(() => page.getByTestId(image).evaluate((element) => (element as HTMLImageElement).complete))
          .toBe(true)
      }
      const shot = await page.getByTestId('preview-frame').screenshot()
      await testInfo.attach(`preview, ${label} (step ${step})`, { body: shot, contentType: 'image/png' })
      const saved = await savedFrame(page)
      await testInfo.attach(`saved frame, ${label} (step ${step})`, { body: saved, contentType: 'image/png' })
      measured[label] = {
        step,
        // What each scratch adds over black at full opacity: its mean alpha
        // of white, over its 2 px of a 1080p frame.
        full: damage.scratchAlphas.map((alpha) => alpha * 255 * 2),
        preview: (await damageOfPng(page, shot, damage)).scratches,
        saved: (await damageOfPng(page, saved, damage)).scratches,
      }
    }
    console.log(`[${testInfo.project.name}] outgoing old film scratches over black: ${JSON.stringify(measured)}`)

    // Before the crossfade a scratch shows whole; at its middle the
    // outgoing card is at about half opacity, and the scratch with it.
    for (const [label, low, high] of [
      ['before', 0.8, 1.2],
      ['middle', 0.3, 0.7],
    ] as const) {
      const { full, preview, saved } = measured[label]
      preview.forEach((value, index) => {
        expect(value / full[index], `${label}: the scratch's share in the preview`).toBeGreaterThan(low)
        expect(value / full[index], `${label}: the scratch's share in the preview`).toBeLessThan(high)
        expect(Math.abs(value - saved[index]) / full[index], `${label}: preview vs saved frame`).toBeLessThan(
          SCRATCH_FADE_TOLERANCE,
        )
      })
    }
  })
})

/**
 * VHS (#870, step 2b(i)): a soft blur and thin dark scanlines, whose
 * darkness shimmers 24 times a second of the entry's clock.
 *
 * The still is 1920 × 1080, so a 1080p frame holds a scanline period in
 * 4 px: its left half mid-grey, where the lines are measured, and its
 * right half white up to three quarters across and black after, a sharp
 * edge for the blur. Three measures, each read the same way from the
 * preview's screenshot and from a frame of the export's composer:
 * - `lines`: the strength of the scanlines, the amplitude of the grey
 *   half's row profile at the lines' period, 4 px of a 1080p frame,
 *   whatever size the frame is drawn at. Without the lines it is the
 *   still's own, near 0.
 * - `grey`: the grey half's mean brightness, which the lines darken.
 * - `edge`: the edge's width, from three quarters to one quarter of the
 *   way from white to black, in px of a 1080p frame: about 1 when sharp,
 *   and the blur widens it.
 *
 * VHS also draws a tracking band in some half-second bursts (step 2b(i)b,
 * tested in its own describe below). Steps 48 and 49 lie in burst 4,
 * which has none, so these measures read the lines and the blur alone.
 * Burst 2 has one, at 1 s to 1.5 s, inside the window's ease in. At full
 * weight it would lift the export test's grey half by about 1.6 (a band
 * 29 lighter over 48 of the half's 864 rows), against the lines' 22
 * darker, and the ease scales both alike, so its one darkened stretch is
 * unchanged.
 */
const VHS_STILL_GREY = 128
const VHS_EDGE = 0.75
const VHS_WINDOW = { start: 1, end: 3, amount: 100 }
/**
 * The bounds, from local Chromium measurements on this spec before they
 * were set. Outside the window both renderers read lines 0, grey 128 and
 * an edge of 0.5 px. At Amount 100 inside it, steps 48 and 49: lines 18.2
 * and 17.9 in the preview against 15.9 and 15.7 in the saved frame, grey
 * 105.4 and 105.7 in both (within 0.02), and an edge of 3.50 against 3.48.
 * - Grey: the lines' mean alpha is 0.4 × 0.875 / 2 = 0.175, so 128 falls
 *   to about 105.6. The renderers must agree within 1.5 of that.
 * - Lines: the amplitude depends on how each renderer smooths a 2 px line
 *   onto its own pixel grid (the preview's frame is 1910 px across, the
 *   saved frame 1920), so the bound is a share, 35 %, where Chromium
 *   differs by 14 %. Without the lines the amplitude is 0.
 * - Edge: Gaussian blur of 0.15 % of 1920 px, 2.9 px, widens a sharp edge
 *   to 3.9 px between its quarters; the renderers must agree within 0.6.
 */
const VHS_LINES_SEEN = 8
const VHS_LINES_TOLERANCE = 0.35
const VHS_GREY_DARKENED = 15
const VHS_GREY_TOLERANCE = 1.5
const VHS_SHARP = 1.5
const VHS_SOFT = 2.5
const VHS_EDGE_TOLERANCE = 0.6
/** The grey half, where an exported frame's mean is read: inside the window the lines darken it, outside it is the still's 128. */
const VHS_GREY_BAND = { grey: { x: 0.05, y: 0.1, width: 0.4, height: 0.8 } }

/** The VHS still: the left half grey, the right half white then black from `VHS_EDGE`. */
async function makeVhsStill(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ grey, edge }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = `rgb(${grey}, ${grey}, ${grey})`
      ctx.fillRect(0, 0, 960, 1080)
      ctx.fillStyle = '#fff'
      ctx.fillRect(960, 0, 1920 * edge - 960, 1080)
      ctx.fillStyle = '#000'
      ctx.fillRect(1920 * edge, 0, 1920 * (1 - edge), 1080)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { grey: VHS_STILL_GREY, edge: VHS_EDGE },
  )
  return Buffer.from(base64, 'base64')
}

type VhsMeasure = { lines: number; grey: number; edge: number }

/** `lines`, `grey` and `edge` (see above) of a PNG of the composed frame, at its own size. */
async function vhsOfPng(page: Page, png: Buffer): Promise<VhsMeasure> {
  return await page.evaluate(
    async ({ base64, edgeAt }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      const at = (x: number, y: number) => {
        const index = (y * width + x) * 4
        return (data[index] + data[index + 1] + data[index + 2]) / 3
      }
      // The grey half's row profile, inset from the frame's edges and the
      // half's own edge so the blur's soft borders stay out of it.
      const x0 = Math.round(0.05 * width)
      const x1 = Math.round(0.45 * width)
      const y0 = Math.round(0.1 * height)
      const y1 = Math.round(0.9 * height)
      const profile: number[] = []
      for (let y = y0; y < y1; y++) {
        let sum = 0
        for (let x = x0; x < x1; x++) sum += at(x, y)
        profile.push(sum / (x1 - x0))
      }
      const grey = profile.reduce((total, value) => total + value, 0) / profile.length
      // The amplitude of the profile's component at the lines' period: 4 px
      // of a 1080p frame, so `height / 270` px of this one.
      const period = height / 270
      let re = 0
      let im = 0
      profile.forEach((value, index) => {
        const phase = (2 * Math.PI * (y0 + index)) / period
        re += (value - grey) * Math.cos(phase)
        im += (value - grey) * Math.sin(phase)
      })
      const lines = (2 / profile.length) * Math.hypot(re, im)
      // The edge's width: the column profile across it, 2 % of the width
      // either side, and the distance between where it crosses three
      // quarters and one quarter of the way from black to white, in px of a
      // 1080p frame. Rows are averaged, so the scanlines do not move it.
      const from = Math.round((edgeAt - 0.02) * width)
      const to = Math.round((edgeAt + 0.02) * width)
      const columns: number[] = []
      for (let x = from; x <= to; x++) {
        let sum = 0
        for (let y = y0; y < y1; y++) sum += at(x, y)
        columns.push(sum / (y1 - y0))
      }
      const high = Math.max(...columns)
      const low = Math.min(...columns)
      // Where the falling profile first reaches `level`, between columns.
      const crossing = (level: number) => {
        const index = columns.findIndex((value) => value <= level)
        if (index <= 0) return index
        return index - 1 + (columns[index - 1] - level) / (columns[index - 1] - columns[index])
      }
      const edge = ((crossing(low + 0.25 * (high - low)) - crossing(low + 0.75 * (high - low))) * 1920) / width
      return { lines, grey, edge }
    },
    { base64: png.toString('base64'), edgeAt: VHS_EDGE },
  )
}

/** Builds the 4 s VHS still with VHS from 1 s to 3 s at Amount 100, and opens that project. */
async function openVhsProject(page: Page) {
  await gotoForSaving(page)
  const still = await makeVhsStill(page)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: still }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${STILL} at position 1 in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  const project = await saveWithEffects(page, ([entryId]) => [
    {
      id: 'h1',
      entryId,
      type: 'vhs',
      start: VHS_WINDOW.start,
      end: VHS_WINDOW.end,
      params: { amount: VHS_WINDOW.amount },
    },
  ])
  await openProject(page, project, still, '0:04')
}

/**
 * Seeks the preview to `seconds`, waits for the scanlines step that
 * instant publishes (or for no effect), and returns its measures.
 */
async function previewVhsAt(page: Page, seconds: number, step: number | null, label: string): Promise<VhsMeasure> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  const lines = page.getByTestId('preview-picture-scanlines')
  if (step === null) {
    await expect(lines).toHaveCount(0)
    await expect(image).toHaveCSS('filter', 'none')
  } else {
    await expect(lines).toHaveAttribute('data-seed', String(step))
    await expect(image).toHaveCSS('filter', /blur\(/)
  }
  const png = await page
    .getByTestId('preview-frame')
    .screenshot({ path: test.info().outputPath(`vhs-preview-${seconds}s.png`) })
  await test.info().attach(`preview at ${seconds} s (${label})`, { body: png, contentType: 'image/png' })
  return await vhsOfPng(page, png)
}

/** Saves the playhead's frame through the export's composer (Save frame) and returns its measures. */
async function savedVhsFrame(page: Page, label: string): Promise<VhsMeasure> {
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const download = await downloadPromise
  const saved = await readFile((await download.path())!)
  await download.saveAs(test.info().outputPath(`vhs-saved-${label.replaceAll(' ', '-')}.png`))
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return await vhsOfPng(page, saved)
}

test.describe('VHS (#870)', () => {
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })

  test('+ Effect ▾ offers VHS after Old film, with Amount at its default', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('./')
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: await makeBars(page) }])
    await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
    await setVisualEffects(page, true)
    const entry = `${STILL} at position 1`
    expect(await effectItems(page, entry)).toEqual(['Zoom', 'Vignette', 'Blur', 'Film grain', 'Old film', 'VHS'])
    await chooseEffect(page, entry, 'VHS')
    await expect(page.getByRole('spinbutton', { name: `VHS 1 amount of ${entry} (percent)` })).toHaveValue('70')
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
    // At the default 70 %: a blur of 0.105 % of the frame's width on the
    // picture, and the scanlines' one-column tile of 540 rows over it.
    const image = page.getByTestId('preview-image')
    await expect(image).toHaveCSS('filter', /blur\(/)
    const lines = page.getByTestId('preview-picture-scanlines')
    await expect(lines).toHaveAttribute('height', '540')
    await expect(lines).toHaveAttribute('data-seed', '24')
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
    const shot = await page.getByTestId('preview-frame').screenshot({ path: test.info().outputPath('vhs-default.png') })
    await test.info().attach('VHS at its default, on the colour bars', { body: shot, contentType: 'image/png' })
  })

  test('the preview and a saved frame draw the same scanlines and softening for the same instant, and none outside the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await openVhsProject(page)
    const before = await previewVhsAt(page, 0.5, null, 'before the window')
    const savedBefore = await savedVhsFrame(page, 'before the window')
    const after = await previewVhsAt(page, 3.5, null, 'after the window')
    const savedAfter = await savedVhsFrame(page, 'after the window')
    const step48 = await previewVhsAt(page, 2.02, 48, 'step 48')
    const saved48 = await savedVhsFrame(page, 'step 48')
    const step49 = await previewVhsAt(page, 2.06, 49, 'step 49')
    const saved49 = await savedVhsFrame(page, 'step 49')
    const report = { before, savedBefore, after, savedAfter, step48, saved48, step49, saved49 }
    console.log(`[${testInfo.project.name}] vhs: ${JSON.stringify(report)}`)

    // Outside the window both renderers show the still untouched: no
    // lines, its own grey, and a sharp edge.
    for (const [name, measure] of Object.entries({ before, savedBefore, after, savedAfter })) {
      expect(measure.lines, `${name}: no scanlines`).toBeLessThan(1)
      expect(Math.abs(measure.grey - VHS_STILL_GREY), `${name}: the still's grey`).toBeLessThan(1)
      expect(measure.edge, `${name}: a sharp edge`).toBeLessThan(VHS_SHARP)
    }
    // Inside it, at the same instant, the two renderers agree.
    for (const [step, preview, saved] of [
      [48, step48, saved48],
      [49, step49, saved49],
    ] as const) {
      for (const [name, measure] of [
        ['preview', preview],
        ['saved frame', saved],
      ] as const) {
        expect(measure.lines, `step ${step}, ${name}: scanlines`).toBeGreaterThan(VHS_LINES_SEEN)
        expect(VHS_STILL_GREY - measure.grey, `step ${step}, ${name}: darkened by the lines`).toBeGreaterThan(
          VHS_GREY_DARKENED,
        )
        expect(measure.edge, `step ${step}, ${name}: a softened edge`).toBeGreaterThan(VHS_SOFT)
      }
      expect(Math.abs(preview.lines - saved.lines) / saved.lines, `step ${step}: lines, preview vs saved`).toBeLessThan(
        VHS_LINES_TOLERANCE,
      )
      expect(Math.abs(preview.grey - saved.grey), `step ${step}: grey, preview vs saved`).toBeLessThan(
        VHS_GREY_TOLERANCE,
      )
      expect(Math.abs(preview.edge - saved.edge), `step ${step}: edge, preview vs saved`).toBeLessThan(
        VHS_EDGE_TOLERANCE,
      )
    }
  })

  test('the export darkens with scanlines only inside the window', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await openVhsProject(page)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exported = await readFile((await (await downloadPromise).path())!)
    const scan = await scanExportedFrames(page, exported, VHS_GREY_BAND, 1 / 30)
    const greys = scan.frames.map((frame) => ({ time: frame.time, grey: lightness(frame.bands.grey) }))
    // A frame is darkened when its grey has fallen by well over the
    // encoder's error: at full weight it falls by about 22, and through the
    // eases it falls steadily, so the darkened frames are one run.
    const darkened = greys.map(({ grey }) => VHS_STILL_GREY - grey > VHS_GREY_DARKENED / 3)
    const first = darkened.indexOf(true)
    const last = darkened.lastIndexOf(true)
    const full = greys.filter(({ time }) => time > VHS_WINDOW.start + 0.8 && time < VHS_WINDOW.end - 0.8)
    const report = {
      size: `${scan.width}x${scan.height}`,
      duration: scan.duration,
      frames: greys.length,
      ends: [greys[0].grey, greys.at(-1)!.grey],
      darkenedSpan: [greys[first]?.time, greys[last]?.time],
      full: [Math.min(...full.map(({ grey }) => grey)), Math.max(...full.map(({ grey }) => grey))],
    }
    console.log(`[${testInfo.project.name}] vhs export: ${JSON.stringify(report)}`)

    // Outside the window the file shows the still's grey, within the
    // encoder's error.
    for (const frame of [greys[0], greys.at(-1)!]) {
      expect(Math.abs(frame.grey - VHS_STILL_GREY), `grey at ${frame.time} s`).toBeLessThan(4)
    }
    // At full weight the grey is darkened as the saved frame is, and the
    // darkened frames are one unbroken stretch, the window's 2 s less the
    // faint ends of its eases, give or take the recording's stretching.
    for (const { time, grey } of full) {
      expect(VHS_STILL_GREY - grey, `darkened at ${time} s`).toBeGreaterThan(VHS_GREY_DARKENED)
    }
    expect(first, 'a darkened frame').toBeGreaterThan(0)
    expect(last, 'the last frame not darkened').toBeLessThan(greys.length - 1)
    expect(darkened.slice(first, last + 1).every(Boolean), 'darkened in one unbroken stretch').toBe(true)
    const span = greys[last].time - greys[first].time
    expect(span).toBeGreaterThan(VHS_WINDOW.end - VHS_WINDOW.start - 1)
    expect(span).toBeLessThan(VHS_WINDOW.end - VHS_WINDOW.start + 0.3)
  })
})

/**
 * VHS's tracking band (#870, step 2b(i)b): a light, noisy band 12 rows of
 * the tracking tile's 270 tall (48 px of a 1080p frame). It shows for a
 * whole half-second burst of 12 texture steps or not at all, and rolls
 * down 2 rows a step within one. In the first 4 s of an entry, bursts 2
 * (steps 24 to 35) and 7 (84 to 95) show one, and the others none
 * (`pictureEffect.test.ts` pins this).
 *
 * The preview's own `preview-picture-tracking` canvas says where the band
 * is: its first and last drawn rows, and their mean alpha. Each frame is
 * then read the same way from the preview's screenshot and from Save
 * frame's PNG, both drawn at 1080p: the row profile across the frame's
 * width, and from it
 * - `excess`: the band's rows' mean brightness over that of the rows 4 to
 *   20 tile rows above and below it, which the band does not reach. A
 *   48 px band spans 12 scanline periods, so the lines cancel out of it.
 * - `centre`: the middle of the band's extra brightness, in tile rows.
 */
const TRACKING_ROWS = 270
const TRACKING_ROLL = 2
const TRACKING_PX = 1080 / TRACKING_ROWS
/**
 * The bounds, from local Chromium measurements on this spec before they
 * were set.
 * - On grey 128 at Amount 100, steps 26 and 31: the band's cells average
 *   alpha 0.20 of white over a grey the scanlines have taken to about 106,
 *   so its rows rise by about 0.20 × 149 = 30. The preview read 28.84 and
 *   29.10, the saved frame 28.72 and 29.07. A band must add over 10, and
 *   the renderers agree within 3.
 * - Its middle: the preview and the saved frame read 136.78 and 136.82
 *   for a band on rows 131 to 142 (middle 137), and 146.96 and 146.92 for
 *   141 to 152. Within 1 tile row, where the next step's band is 2 rows on.
 * - Step 40, no band: 0.03 and 0.07 at step 31's rows. Below 1.5.
 * - The crossfade, over black: the band at full opacity adds 51.6 (its
 *   cells' mean alpha × 255). Before the crossfade the preview read 50.18
 *   and the saved frame 50.87; at its middle 23.13 and 24.28, a share of
 *   0.45 and 0.47. The renderers must agree within 15 % of the full band,
 *   where they agreed within 2.3 %; drawn undimmed, the saved frame would
 *   read about 0.5 more.
 */
const TRACKING_SEEN = 10
const TRACKING_CENTRE_TOLERANCE = 1
const TRACKING_TOLERANCE = 3
const TRACKING_QUIET = 1.5
const TRACKING_FADE_TOLERANCE = 0.15
/**
 * The WebM test's preview steps: burst 2's twelve, 1 s to 1.5 s, the
 * band's whole roll. As for the grain (WEBM_STEPS), a recorded frame late
 * or dropped can skip a step, so the test asks for half of them, each
 * within 1 row of the preview's band, where the neighbouring steps' bands
 * are 2 rows away. Measured at 960 × 540: run alone, every step had an
 * exported frame within 0.1 rows; run beside the other VHS tests on three
 * workers, 9 of 12 did in each of two runs, and the rest were 1.9 to 2.0
 * rows off, the neighbouring step's band, so no frame put a band anywhere
 * else.
 */
const TRACKING_WEBM_STEPS = Array.from({ length: 12 }, (_, index) => 24 + index)
const TRACKING_WEBM_STEPS_MATCHED = 6
/**
 * A frame shows a band when its brightest 2-row strip is this far over the
 * median strip. Frames without one peaked at 4.87, the encoder's error on
 * a plain grey, and frames with one at 40.8 or more.
 */
const TRACKING_WEBM_SEEN = 15
type TrackingBand = { top: number; bottom: number; alpha: number }
type TrackingMeasure = { excess: number; centre: number }

/** Where the preview's tracking canvas draws the band, in tile rows, and its cells' mean alpha in [0, 1]; null if it draws none. */
async function previewTrackingBand(page: Page): Promise<TrackingBand | null> {
  return await page.getByTestId('preview-picture-tracking').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let top = -1
    let bottom = -1
    let sum = 0
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] === 0) continue
      const row = Math.floor((index - 3) / 4 / canvas.width)
      if (top < 0) top = row
      bottom = row + 1
      sum += data[index]
    }
    return top < 0 ? null : { top, bottom, alpha: sum / ((bottom - top) * canvas.width) / 255 }
  })
}

/** Seeks to the middle of texture `step`, to the slider's hundredth, and waits for the preview to draw that step's band. */
async function seekToTrackingStep(page: Page, step: number) {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(Number(((step + 0.5) / 24).toFixed(2))))
  await expect(page.getByTestId('preview-picture-tracking')).toHaveAttribute('data-seed', String(step))
}

/** `excess` and `centre` (see above) of a PNG of the frame, for a band at `band`'s rows. */
async function trackingOfPng(page: Page, png: Buffer, band: Omit<TrackingBand, 'alpha'>): Promise<TrackingMeasure> {
  return await page.evaluate(
    async ({ base64, band, px }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, 1920, 1080)
      const data = ctx.getImageData(0, 0, 1920, 1080).data
      // Each row's mean, inset from the frame's sides.
      const profile = Array.from({ length: 1080 }, (_, y) => {
        let sum = 0
        for (let x = 96; x < 1824; x++) {
          const index = (y * 1920 + x) * 4
          sum += (data[index] + data[index + 1] + data[index + 2]) / 3
        }
        return sum / (1824 - 96)
      })
      const mean = (from: number, to: number) => {
        const rows = profile.slice(Math.max(0, Math.round(from)), Math.min(1080, Math.round(to)))
        return rows.reduce((total, value) => total + value, 0) / rows.length
      }
      const top = band.top * px
      const bottom = band.bottom * px
      const reference = (mean(top - 20 * px, top - 4 * px) + mean(bottom + 4 * px, bottom + 20 * px)) / 2
      let weight = 0
      let moment = 0
      for (let y = Math.round(top - 4 * px); y < Math.round(bottom + 4 * px); y++) {
        const extra = Math.max(0, profile[y] - reference)
        weight += extra
        moment += extra * (y + 0.5)
      }
      return { excess: mean(top, bottom) - reference, centre: weight > 0 ? moment / weight / px : NaN }
    },
    { base64: png.toString('base64'), band: { top: band.top, bottom: band.bottom }, px: TRACKING_PX },
  )
}

/**
 * Builds a 4 s still of grey `level`, 1920 × 1080 unless told otherwise,
 * with VHS over its whole length at Amount 100, so nothing eases, and
 * opens that project.
 */
async function openTrackingProject(page: Page, level: number, width = 1920, height = 1080): Promise<Buffer> {
  await gotoForSaving(page)
  const still = await makePlain(page, level, width, height)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: still }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${STILL} at position 1 in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  const project = await saveWithEffects(page, ([entryId]) => [
    { id: 'h1', entryId, type: 'vhs', start: 0, end: 4, params: { amount: 100 } },
  ])
  await openProject(page, project, still, '0:04')
  return still
}

test.describe("VHS's tracking band (#870)", () => {
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })

  test('the preview and a saved frame draw the band at the same rows and strength, rolling down its burst, and none in a burst without one', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await openTrackingProject(page, 128)
    const measured: { step: number; band: TrackingBand; preview: TrackingMeasure; saved: TrackingMeasure }[] = []
    for (const step of [26, 31]) {
      await seekToTrackingStep(page, step)
      const band = await previewTrackingBand(page)
      expect(band, `step ${step}: the preview's tile has a band`).not.toBeNull()
      await expect
        .poll(() => page.getByTestId('preview-image').evaluate((element) => (element as HTMLImageElement).complete))
        .toBe(true)
      const shot = await page
        .getByTestId('preview-frame')
        .screenshot({ path: testInfo.outputPath(`vhs-tracking-preview-${step}.png`) })
      await testInfo.attach(`preview, step ${step}`, { body: shot, contentType: 'image/png' })
      const saved = await savedFrame(page)
      await testInfo.attach(`saved frame, step ${step}`, { body: saved, contentType: 'image/png' })
      measured.push({
        step,
        band: band!,
        preview: await trackingOfPng(page, shot, band!),
        saved: await trackingOfPng(page, saved, band!),
      })
    }
    // Step 40 is in burst 3, which has no band: read where step 31's was.
    await seekToTrackingStep(page, 40)
    expect(await previewTrackingBand(page), "step 40: the preview's tile is clear").toBeNull()
    await expect
      .poll(() => page.getByTestId('preview-image').evaluate((element) => (element as HTMLImageElement).complete))
      .toBe(true)
    const quietShot = await page.getByTestId('preview-frame').screenshot()
    const quiet = {
      preview: await trackingOfPng(page, quietShot, measured[1].band),
      saved: await trackingOfPng(page, await savedFrame(page), measured[1].band),
    }
    console.log(`[${testInfo.project.name}] vhs tracking band: ${JSON.stringify({ measured, quiet })}`)

    // Five steps on, the band has rolled ten rows down.
    expect(measured[1].band.top - measured[0].band.top).toBe(5 * TRACKING_ROLL)
    for (const { step, band, preview, saved } of measured) {
      const centre = (band.top + band.bottom) / 2
      for (const [name, measure] of [
        ['preview', preview],
        ['saved frame', saved],
      ] as const) {
        expect(measure.excess, `step ${step}, ${name}: the band lightens its rows`).toBeGreaterThan(TRACKING_SEEN)
        expect(Math.abs(measure.centre - centre), `step ${step}, ${name}: the band's middle, in tile rows`).toBeLessThan(
          TRACKING_CENTRE_TOLERANCE,
        )
      }
      expect(Math.abs(preview.excess - saved.excess), `step ${step}: preview vs saved frame`).toBeLessThan(
        TRACKING_TOLERANCE,
      )
    }
    for (const [name, measure] of Object.entries(quiet)) {
      expect(Math.abs(measure.excess), `step 40, ${name}: no band`).toBeLessThan(TRACKING_QUIET)
    }
  })

  test('on the outgoing clip of a crossfade, the band fades with its clip in the preview and in a saved frame', async ({
    page,
  }, testInfo) => {
    // As the scratch test: two black stills, the first 4 s with VHS over
    // its whole length, crossfading from 3 s to 4 s. On black the lines
    // and the blur change nothing, so the band's rows are the band alone.
    // Step 26 is before the crossfade, and step 84 (3.52 s) at its middle,
    // where the preview shows the band at about half its strength.
    test.setTimeout(120_000)
    await gotoForSaving(page)
    const black = await makePlain(page, 0)
    await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: black }])
    for (const [position, seconds] of [
      [1, 4],
      [2, 2],
    ]) {
      await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
      const duration = page.getByRole('spinbutton', { name: `Duration of ${STILL} at position ${position} in seconds` })
      await duration.fill(String(seconds))
      await duration.blur()
    }
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
    const project = await saveWithEffects(page, ([outgoing]) => [
      { id: 'h1', entryId: outgoing, type: 'vhs', start: 0, end: 4, params: { amount: 100 } },
    ])
    await openProject(page, project, black, '0:05')

    const measured: Record<string, { step: number; full: number; preview: number; saved: number }> = {}
    for (const [label, step] of [
      ['before', 26],
      ['middle', 84],
    ] as const) {
      await seekToTrackingStep(page, step)
      const band = await previewTrackingBand(page)
      expect(band, `${label}: the preview's tile has a band`).not.toBeNull()
      for (const image of label === 'middle' ? ['preview-image', 'preview-image-incoming'] : ['preview-image']) {
        await expect
          .poll(() => page.getByTestId(image).evaluate((element) => (element as HTMLImageElement).complete))
          .toBe(true)
      }
      const shot = await page.getByTestId('preview-frame').screenshot()
      await testInfo.attach(`preview, ${label} (step ${step})`, { body: shot, contentType: 'image/png' })
      const saved = await savedFrame(page)
      await testInfo.attach(`saved frame, ${label} (step ${step})`, { body: saved, contentType: 'image/png' })
      measured[label] = {
        step,
        // What the band adds over black at full opacity: its cells' mean alpha of white.
        full: band!.alpha * 255,
        preview: (await trackingOfPng(page, shot, band!)).excess,
        saved: (await trackingOfPng(page, saved, band!)).excess,
      }
    }
    console.log(`[${testInfo.project.name}] outgoing vhs tracking band over black: ${JSON.stringify(measured)}`)

    for (const [label, low, high] of [
      ['before', 0.8, 1.2],
      ['middle', 0.3, 0.7],
    ] as const) {
      const { full, preview, saved } = measured[label]
      expect(preview / full, `${label}: the band's share in the preview`).toBeGreaterThan(low)
      expect(preview / full, `${label}: the band's share in the preview`).toBeLessThan(high)
      expect(Math.abs(preview - saved) / full, `${label}: preview vs saved frame`).toBeLessThan(TRACKING_FADE_TOLERANCE)
    }
  })

  test('the export rolls the preview\'s band down its burst, and shows it in no other burst', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    // A 960 × 540 still, so the export is 960 × 540, as the grain's WebM
    // test is: a 1080p recording in a session container held each band
    // position for about 0.15 s, four positions over the burst's twelve
    // steps, where 960 × 540 keeps up (see TRACKING_WEBM_STEPS).
    await openTrackingProject(page, 128, 960, 540)
    const steps: { step: number; centre: number }[] = []
    for (const step of TRACKING_WEBM_STEPS) {
      await seekToTrackingStep(page, step)
      const band = await previewTrackingBand(page)
      expect(band, `step ${step}: the preview's tile has a band`).not.toBeNull()
      steps.push({ step, centre: (band!.top + band!.bottom) / 2 })
    }
    // The band's centres over each burst that has one, from its first step to its last.
    const bursts: [number, number][] = []
    for (const first of [24, 84]) {
      await seekToTrackingStep(page, first)
      const start = await previewTrackingBand(page)
      expect(start, `step ${first}: a band`).not.toBeNull()
      const centre = (start!.top + start!.bottom) / 2
      bursts.push([centre, centre + 11 * TRACKING_ROLL])
    }

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exported = await readFile((await (await downloadPromise).path())!)
    // Strips 2 tile rows (8 px of a 1080p frame) tall across the frame's
    // width, from above the first burst's band to below the second's.
    const from = Math.floor(Math.min(...bursts.flat()) - 12)
    const to = Math.ceil(Math.max(...bursts.flat()) + 12)
    const strips: Record<string, { x: number; y: number; width: number; height: number }> = {}
    for (let row = from; row < to; row += 2) {
      strips[String(row)] = { x: 0.05, y: row / TRACKING_ROWS, width: 0.9, height: 2 / TRACKING_ROWS }
    }
    // Every frame of the file: the export is a real-time recording at 30
    // frames a second, so a 1/60 s grid visits each one (#370).
    const scan = await scanExportedFrames(page, exported, strips, 1 / 60)
    const frames = scan.frames.map((frame) => {
      const rows = Object.entries(frame.bands).map(([row, { r, g, b }]) => ({ row: Number(row) + 1, value: (r + g + b) / 3 }))
      const median = rows.map(({ value }) => value).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
      const peak = Math.max(...rows.map(({ value }) => value - median))
      let weight = 0
      let moment = 0
      for (const { row, value } of rows) {
        const extra = value - median
        if (extra < peak / 3) continue
        weight += extra
        moment += extra * row
      }
      return { time: frame.time, peak, centre: moment / weight }
    })
    const banded = frames.filter(({ peak }) => peak > TRACKING_WEBM_SEEN)
    const matches = steps.map(({ step, centre }) => ({
      step,
      centre,
      nearest: Math.min(...banded.map((frame) => Math.abs(frame.centre - centre))),
    }))
    const report = {
      size: `${scan.width}x${scan.height}`,
      frames: frames.length,
      banded: banded.length,
      quietPeak: Math.max(...frames.filter(({ peak }) => peak <= TRACKING_WEBM_SEEN).map(({ peak }) => peak)),
      bandedPeak: Math.min(...banded.map(({ peak }) => peak)),
      bursts,
      outside: banded
        .filter(({ centre }) => !bursts.some(([first, last]) => centre > first - 1 && centre < last + 1))
        .map(({ time, centre }) => `${time.toFixed(3)}: ${centre.toFixed(2)}`),
      steps: matches.map(({ step, centre, nearest }) => `${step} at ${centre}: nearest ${nearest.toFixed(2)}`),
    }
    console.log(`[${testInfo.project.name}] vhs tracking band export: ${JSON.stringify(report)}`)

    // The band shows, and only where a burst puts it: every banded frame's
    // band lies on one of the two bursts' rolls, and some frames between
    // the bursts show none.
    expect(banded.length, 'frames with a band').toBeGreaterThan(0)
    expect(report.outside, 'banded frames off both bursts\' rolls').toEqual([])
    const firstBurst = banded.filter(({ centre }) => centre < bursts[0][1] + 1)
    const secondBurst = banded.filter(({ centre }) => centre > bursts[1][0] - 1)
    expect(firstBurst.length, 'frames banded in the first burst').toBeGreaterThan(0)
    expect(secondBurst.length, 'frames banded in the second burst').toBeGreaterThan(0)
    const lastOfFirst = Math.max(...firstBurst.map(({ time }) => time))
    const firstOfSecond = Math.min(...secondBurst.map(({ time }) => time))
    expect(
      frames.filter(({ time, peak }) => time > lastOfFirst && time < firstOfSecond && peak <= TRACKING_WEBM_SEEN).length,
      'frames without a band between the bursts',
    ).toBeGreaterThan(30)
    // Most of the preview's six steps are in the file at their own rows:
    // a step's band is 2 rows from the next one's, so a match within one
    // row is that step and not its neighbour (see TRACKING_WEBM_STEPS).
    expect(
      matches.filter(({ nearest }) => nearest < 1).length,
      `steps with a banded frame at their rows: ${report.steps.join('; ')}`,
    ).toBeGreaterThanOrEqual(TRACKING_WEBM_STEPS_MATCHED)
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
