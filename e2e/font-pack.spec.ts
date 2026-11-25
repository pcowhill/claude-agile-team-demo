import { readFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { scanExportedFrames } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu, openSubtitleStyle } from './timelineMenu'

/**
 * The Font pack plugin (#867), in a real browser.
 *
 * - The Font menus with the plugin off and on, and which files download.
 * - Each pack face rendered in the preview, for the inspected screenshots.
 * - **The export waits for the font.** A project whose text is set in a
 *   pack face is opened, so the face has never been shown, and exported
 *   at once. The face is still `unloaded` when the export starts. The
 *   text's width in the exported frames, read as the brightness of a band
 *   that only one of the two widths covers, must be the pack face's, never
 *   the fallback stack's: from the first frame the text is in.
 * - The Font select's geometry with the longest name, Cormorant Garamond.
 * - **A failed download is tried again (#928).** The file fails throughout
 *   one export, which draws the fallback; the next export downloads it
 *   again and draws the pack face.
 */

const CORE_FONTS = ['Sans-serif', 'Serif', 'Monospace', 'Display']
const PACK_FONTS = [
  'Nunito',
  'Montserrat',
  'Oswald',
  'Bebas Neue',
  'Zilla Slab',
  'Cormorant Garamond',
  'Courier Prime',
  'Caveat',
  'Comic Neue',
  'Silkscreen',
]
const TEXT = 'text overlay at position 1'

/** Opens the manager and toggles the Font pack plugin. */
async function setFontPack(page: Page, enabled: boolean) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Font pack` }).click()
  await expect(page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Font pack` })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** A slate with a text overlay over it, the text row's Font menu returned. */
async function slateWithText(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  const font = page.getByRole('combobox', { name: `Font of ${TEXT}` })
  await expect(font).toBeVisible()
  return font
}

/** The labels a `<select>` offers, in order. */
const optionLabels = async (page: Page, name: string) =>
  (await page.getByRole('combobox', { name }).locator('option').allTextContents()).map((label) => label.trim())

/**
 * The font files the page has downloaded as fonts so far. By resource type,
 * not by name: the dev server also serves each file's `?url` import as a
 * small JavaScript module, which is the URL, not the font.
 */
function trackFontRequests(page: Page): string[] {
  const requested: string[] = []
  page.on('request', (request: Request) => {
    if (request.resourceType() !== 'font') return
    const url = request.url()
    requested.push(url.slice(url.lastIndexOf('/') + 1).replace(/\?.*$/, ''))
  })
  return requested
}

/** The statuses of a pack family's faces in `document.fonts`. */
const faceStatuses = (page: Page, family: string) =>
  page.evaluate(
    (family) =>
      [...document.fonts].filter((face) => face.family.replace(/"/g, '') === family).map((face) => face.status),
    family,
  )

test.describe('Font pack plugin (#867)', () => {
  test('the Font menus list the four core fonts with the plugin off, and the ten pack faces after them once it is on; a face downloads only when used', async ({
    page,
  }) => {
    const requested = trackFontRequests(page)
    await slateWithText(page)
    await openSubtitleStyle(page)
    expect(await optionLabels(page, `Font of ${TEXT}`)).toEqual(CORE_FONTS)
    expect(await optionLabels(page, 'Default subtitle font')).toEqual(CORE_FONTS)

    await setFontPack(page, true)
    expect(await optionLabels(page, `Font of ${TEXT}`)).toEqual([...CORE_FONTS, ...PACK_FONTS])
    expect(await optionLabels(page, 'Default subtitle font')).toEqual([...CORE_FONTS, ...PACK_FONTS])
    // Enabling downloads the list, not the fonts.
    expect(await faceStatuses(page, 'Font Pack Caveat')).toEqual(['unloaded', 'unloaded'])
    expect(requested).toEqual([])

    // Choosing Caveat for the text that the preview shows downloads
    // Caveat's regular face, and nothing else.
    await page.getByRole('combobox', { name: `Font of ${TEXT}` }).selectOption({ label: 'Caveat' })
    await expect.poll(() => faceStatuses(page, 'Font Pack Caveat')).toEqual(['loaded', 'unloaded'])
    const text = page.getByTestId('preview-text-0')
    await expect(text).toHaveCSS('font-family', /^"Font Pack Caveat"/)
    expect(requested).toEqual([expect.stringMatching(/^caveat-latin-400-normal/)])
    // How long the face took to arrive, which is how long the preview shows
    // the text in nothing (the font's block period) rather than a fallback.
    const loadMs = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('caveat-latin-400-normal'))
        .map((entry) => Math.round((entry as PerformanceResourceTiming).responseEnd - entry.startTime)),
    )
    console.log(`[${test.info().project.name}] Caveat 400 download: ${loadMs.join(', ')} ms`)

    // Disabled again: the menus go back to the core four, the text keeps its
    // font as "(unavailable)", and it draws in the core sans-serif.
    await setFontPack(page, false)
    expect(await optionLabels(page, 'Default subtitle font')).toEqual(CORE_FONTS)
    expect(await optionLabels(page, `Font of ${TEXT}`)).toEqual([...CORE_FONTS, 'pack-caveat (unavailable)'])
    await expect(page.getByRole('combobox', { name: `Font of ${TEXT}` })).toHaveValue('pack-caveat')
    await expect(text).toHaveCSS('font-family', /^Arial/)
  })

  test('each pack face draws in the preview', async ({ page }, testInfo) => {
    const font = await slateWithText(page)
    await page.getByRole('textbox', { name: `Content of ${TEXT}` }).fill('Quick brown fox 123')
    await page.getByRole('textbox', { name: `Content of ${TEXT}` }).blur()
    await setFontPack(page, true)
    const text = page.getByTestId('preview-text-0')
    for (const label of PACK_FONTS) {
      await font.selectOption({ label })
      const family = `Font Pack ${label}`
      await expect(text).toHaveCSS('font-family', new RegExp(`^"${family}"`))
      await expect.poll(() => page.evaluate((family) => document.fonts.check(`40px "${family}"`), family)).toBe(true)
      // One frame for the loaded face to paint.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const shot = await page.getByTestId('preview-frame').screenshot({
        path: testInfo.outputPath(`font-${label.toLowerCase().replace(/ /g, '-')}.png`),
      })
      await testInfo.attach(`preview in ${label}`, { body: shot, contentType: 'image/png' })
    }
  })

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
  ]) {
    test(`a Font menu set to the longest name stays inside its row at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      const font = await slateWithText(page)
      await setFontPack(page, true)
      await font.selectOption({ label: 'Cormorant Garamond' })
      await openSubtitleStyle(page)
      const subtitleFont = page.getByRole('combobox', { name: 'Default subtitle font' })
      await subtitleFont.selectOption({ label: 'Cormorant Garamond' })
      const column = page.locator('main')
      for (const [select, what] of [
        [font, 'the text row'],
        [subtitleFont, 'the Subtitle style row'],
      ] as const) {
        await select.scrollIntoViewIfNeeded()
        // The select is as wide as its longest option; it must still fit
        // the row it sits in, and the editor column.
        const row = select.locator('xpath=..')
        await expectWithin(select, row, { axis: 'x', what: `the Font menu in ${what} at ${viewport.width}px` })
        await expectWithin(select, column, { axis: 'x', what: `the Font menu in ${what} at ${viewport.width}px` })
        // And it shows the whole name: the box is wider than the name's text.
        const fits = await select.evaluate((element: HTMLSelectElement) => {
          const canvas = document.createElement('canvas').getContext('2d')!
          const style = getComputedStyle(element)
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const text = canvas.measureText(element.selectedOptions[0].text).width
          const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
          return { text, inner: element.clientWidth - padding }
        })
        expect(fits.text, `the Font menu in ${what} at ${viewport.width}px cuts its name: ${JSON.stringify(fits)}`).toBeLessThan(
          fits.inner,
        )
      }
      await expectNoHorizontalScroll(page, `with Cormorant Garamond chosen at ${viewport.width}px`)
    })
  }
})

/** The pack face the export test sets its text in, and the text. */
const EXPORT_FONT = { id: 'pack-silkscreen', family: 'Font Pack Silkscreen' }
const EXPORT_TEXT = { content: 'HHHHHHH', offset: 1, duration: 1.5, size: 0.25 }

/** Forces the anchor-download save path, as transitions-pack.spec.ts does. */
async function gotoForSaving(page: Page) {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
}

/** A 3 s red slate with white text in `EXPORT_FONT`, as a saved project that records the plugin. */
async function projectWithPackText(page: Page): Promise<Buffer> {
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseFromFileMenu(page, 'Save As…')
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const saved = await readFile((await (await downloadPromise).path())!)
  const document = JSON.parse(gunzipSync(saved).toString('utf8'))
  const [text] = document.timeline.texts
  Object.assign(text, {
    ...EXPORT_TEXT,
    font: EXPORT_FONT.id,
    x: 0.5,
    y: 0.5,
    color: '#ffffff',
    bold: false,
    italic: false,
  })
  document.plugins = ['font-pack']
  return gzipSync(Buffer.from(JSON.stringify(document), 'utf8'))
}

/**
 * Where a band must sit so that one of the two widths covers it and the
 * other does not: to the right of the narrower one's end and left of the
 * wider one's, with a margin either side for side bearings and the
 * encoder. Widths are fractions of the frame width, measured with the
 * canvas, the export's own text path, at the frame's height.
 */
async function measuredWidths(page: Page, frame: { width: number; height: number }) {
  return await page.evaluate(
    async ({ family, content, size, frame }) => {
      await document.fonts.load(`${size * frame.height}px "${family}"`)
      const context = document.createElement('canvas').getContext('2d')!
      const width = (stack: string) => {
        context.font = `400 ${size * frame.height}px ${stack}`
        return context.measureText(content).width / frame.width
      }
      return { pack: width(`"${family}", "Courier New", monospace`), fallback: width('"Courier New", monospace') }
    },
    { family: EXPORT_FONT.family, content: EXPORT_TEXT.content, size: EXPORT_TEXT.size, frame },
  )
}

test('an export waits for a pack font it has never shown, and draws its glyphs from the first frame the text is in', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await gotoForSaving(page)
  const project = await projectWithPackText(page)
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'font-pack.bvep', mimeType: 'application/gzip', buffer: project }])
  const prompt = page.getByRole('dialog', { name: 'Enable plugins to open?' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Font pack')
  await prompt.getByRole('button', { name: 'Enable and open' }).click()
  await expect(page.getByRole('combobox', { name: `Font of ${TEXT}` })).toHaveValue(EXPORT_FONT.id)

  // The playhead is at 0 s and the text starts at 1 s, so nothing has drawn
  // it: the face is registered but has not been downloaded.
  expect(await faceStatuses(page, EXPORT_FONT.family)).toEqual(['unloaded', 'unloaded'])

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const webm = await readFile((await (await downloadPromise).path())!)
  expect(await faceStatuses(page, EXPORT_FONT.family)).toContain('loaded')

  // Probe the file's frame size with an empty scan band, then place the band.
  const probe = await scanExportedFrames(page, webm, {}, 1)
  const widths = await measuredWidths(page, probe)
  const narrow = Math.min(widths.pack, widths.fallback)
  const wide = Math.max(widths.pack, widths.fallback)
  const margin = 0.015
  const band = { x: 0.5 + narrow / 2 + margin, y: 0.47, width: (wide - narrow) / 2 - 2 * margin, height: 0.06 }
  console.log(
    `[${testInfo.project.name}] widths: pack ${widths.pack.toFixed(3)}, fallback ${widths.fallback.toFixed(3)} of the frame; band x ${band.x.toFixed(3)} + ${band.width.toFixed(3)}`,
  )
  // The two faces must differ enough for the band to tell them apart.
  expect(band.width).toBeGreaterThan(0.02)
  const packIsWider = widths.pack > widths.fallback

  // The centre band is inside both widths: it says when the text is in the
  // frame. White text on the red slate lifts green, which the slate has none of.
  const scan = await scanExportedFrames(page, webm, {
    centre: { x: 0.5 - narrow / 4, y: 0.47, width: narrow / 2, height: 0.06 },
    flank: band,
  })
  const withText = scan.frames.filter((frame) => frame.bands.centre.g > 40)
  expect(withText.length, 'frames with the text in them').toBeGreaterThan(10)
  const flanks = withText.map((frame) => `${frame.time.toFixed(2)} ${frame.bands.flank.g.toFixed(0)}`)
  console.log(`[${testInfo.project.name}] export: flank green from the text's first frame: ${flanks.slice(0, 6).join(', ')}`)
  for (const frame of withText) {
    const flank = frame.bands.flank.g
    expect(
      packIsWider ? flank > 40 : flank < 15,
      `at ${frame.time.toFixed(2)} s the text is ${packIsWider ? 'narrower' : 'wider'} than ${EXPORT_FONT.family}'s: flank green ${flank.toFixed(1)}`,
    ).toBe(true)
  }

  // The preview draws the same glyphs: the same band, on its screenshot.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1.75')
  await expect(page.getByTestId('preview-text-0')).toBeVisible()
  const png = await page.getByTestId('preview-frame').screenshot()
  await testInfo.attach('preview at 1.75 s', { body: png, contentType: 'image/png' })
  const preview = await page.evaluate(
    async ({ base64, rect }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(
        Math.floor(rect.x * bitmap.width),
        Math.floor(rect.y * bitmap.height),
        Math.max(1, Math.round(rect.width * bitmap.width)),
        Math.max(1, Math.round(rect.height * bitmap.height)),
      ).data
      let green = 0
      for (let index = 1; index < data.length; index += 4) green += data[index]
      return green / (data.length / 4)
    },
    { base64: png.toString('base64'), rect: band },
  )
  console.log(`[${testInfo.project.name}] preview: flank green ${preview.toFixed(1)}`)
  expect(packIsWider ? preview > 40 : preview < 15, `preview flank green ${preview.toFixed(1)}`).toBe(true)
})

/** Exports the open project and returns the file. */
async function exportWebm(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile((await (await downloadPromise).path())!)
}

/**
 * For every frame of `webm` the text is in, whether its width is the pack
 * face's or the fallback's: the flank band of the test above, which only
 * the wider of the two widths covers. Measuring the widths loads the pack
 * face, so call it only once the face may load.
 */
async function textFaces(page: Page, webm: Buffer) {
  const probe = await scanExportedFrames(page, webm, {}, 1)
  const widths = await measuredWidths(page, probe)
  const narrow = Math.min(widths.pack, widths.fallback)
  const wide = Math.max(widths.pack, widths.fallback)
  const margin = 0.015
  const band = { x: 0.5 + narrow / 2 + margin, y: 0.47, width: (wide - narrow) / 2 - 2 * margin, height: 0.06 }
  expect(band.width).toBeGreaterThan(0.02)
  const packIsWider = widths.pack > widths.fallback
  const scan = await scanExportedFrames(page, webm, {
    centre: { x: 0.5 - narrow / 4, y: 0.47, width: narrow / 2, height: 0.06 },
    flank: band,
  })
  const withText = scan.frames.filter((frame) => frame.bands.centre.g > 40)
  expect(withText.length, 'frames with the text in them').toBeGreaterThan(10)
  return withText.map((frame) => {
    const flank = frame.bands.flank.g
    const pack = packIsWider ? flank > 40 : flank < 15
    const fallback = packIsWider ? flank < 15 : flank > 40
    return { time: frame.time, flank, face: pack ? 'pack' : fallback ? 'fallback' : 'unclear' }
  })
}

test('after a pack font fails to download, the next export downloads it again and draws it (#928)', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  // The regular Silkscreen file is unavailable for the whole first export,
  // as during a dropped connection, then served normally. The bold file is
  // untouched. Every font request for it is recorded with what it got.
  let failing = true
  const requests: string[] = []
  await page.route(/silkscreen-latin-400-normal\.woff2(\?|$)/, async (route) => {
    if (route.request().resourceType() !== 'font') return route.continue()
    requests.push(failing ? '503' : 'served')
    if (failing) return route.fulfill({ status: 503, body: 'unavailable' })
    return route.continue()
  })
  await gotoForSaving(page)
  const project = await projectWithPackText(page)
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'font-pack.bvep', mimeType: 'application/gzip', buffer: project }])
  const prompt = page.getByRole('dialog', { name: 'Enable plugins to open?' })
  await prompt.getByRole('button', { name: 'Enable and open' }).click()
  await expect(page.getByRole('combobox', { name: `Font of ${TEXT}` })).toHaveValue(EXPORT_FONT.id)
  expect(await faceStatuses(page, EXPORT_FONT.family)).toEqual(['unloaded', 'unloaded'])

  // The first export, while every download of the file fails.
  const firstWebm = await exportWebm(page)
  const firstRequests = [...requests]
  expect(firstRequests.length).toBeGreaterThan(0)
  expect(firstRequests.every((request) => request === '503')).toBe(true)

  // The file is back. The next export downloads it again: one request,
  // served, made by the export rather than by the measurement below.
  failing = false
  const secondWebm = await exportWebm(page)
  expect(requests.slice(firstRequests.length)).toEqual(['served'])
  expect(await faceStatuses(page, EXPORT_FONT.family)).toEqual(['loaded', 'loaded'])

  // The first export drew the fallback stack throughout, and the second
  // the pack face from the first frame the text is in.
  const first = await textFaces(page, firstWebm)
  const second = await textFaces(page, secondWebm)
  const summary = (frames: typeof first) =>
    frames
      .slice(0, 6)
      .map((frame) => `${frame.time.toFixed(2)} ${frame.face} ${frame.flank.toFixed(0)}`)
      .join(', ')
  console.log(
    `[${testInfo.project.name}] requests: ${requests.join(' ')}; first export: ${summary(first)}; second export: ${summary(second)}`,
  )
  expect(first.every((frame) => frame.face === 'fallback'), `first export: ${summary(first)}`).toBe(true)
  expect(second.every((frame) => frame.face === 'pack'), `second export: ${summary(second)}`).toBe(true)
})
