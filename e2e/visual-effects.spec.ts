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
 * pattern still with a zoom, a vignette and a blur, plus a slate and a
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
  await expect(page.getByTestId('picture-effect-row')).toHaveCount(2)
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
    expect(await effectItems(page, ENTRY)).toEqual(['Zoom', 'Vignette', 'Blur'])

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
    expect(await effectItems(page, 'trim-clip.webm at position 1')).toEqual([...BUILT_IN_EFFECTS, 'Vignette', 'Blur'])
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
