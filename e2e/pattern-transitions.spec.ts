import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { presentedExportedFrame } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'
import { confirmDisableIfAsked } from './pluginConfirm'

type Page = import('@playwright/test').Page

/**
 * The Pattern transitions plugin (#857): the polygon reveal it adds to the
 * transition layer rule, exercised through the real chain — the manager
 * enables the lazy chunk, the pattern transitions join the type picker, a
 * pattern renders in the preview (an SVG mask on the incoming card) and in
 * an exported file (a canvas clip), and a saved project records the plugin
 * dependency and prompt-and-enables on open.
 *
 * Preview and export are judged by the same pixels: two solid clips, green
 * then blue, and sample points chosen so each must show one clip or the
 * other. The preview is read from a screenshot of the composed frame, the
 * export from a decoded frame of the file, so both claims are about what is
 * actually drawn rather than about a style string.
 */

/** Records a real solid-color WebM so preview and export decode real video. */
async function recordWebm(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ color }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const ctx = canvas.getContext('2d')!
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.start()
      const start = performance.now()
      await new Promise<void>((resolve) => {
        const draw = () => {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > 1500) resolve()
          else requestAnimationFrame(draw)
        }
        draw()
      })
      recorder.stop()
      await stopped
      const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
      let binary = ''
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    { color },
  )
  return Buffer.from(base64, 'base64')
}

/** Two 1s-trimmed solid clips (green then blue) with a transition between
 * them: the 1s default overlap spans the whole sequence, so seek position
 * equals transition progress and every frame of an export is mid-overlap. */
async function buildOverlapSequence(page: Page) {
  const green = await recordWebm(page, 'rgb(0, 205, 0)')
  const blue = await recordWebm(page, 'rgb(0, 0, 205)')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'green.webm', mimeType: 'video/webm', buffer: green },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add green.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add blue.webm to timeline' }).click()
  for (const [position, name] of [
    [1, 'green'],
    [2, 'blue'],
  ] as const) {
    const out = page.getByRole('spinbutton', {
      name: `Trim out point of ${name}.webm at position ${position} in seconds`,
    })
    await out.fill('1')
    await out.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:01')
  return { green, blue }
}

/** Opens the manager and toggles the Pattern transitions plugin. */
async function setPatternTransitions(page: Page, enabled: boolean) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page
    .getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Pattern transitions` })
    .click()
  if (!enabled) await confirmDisableIfAsked(page, 'Pattern transitions')
  // The toggle flips only after the chunk loads and activate ran (or the
  // deactivate unregistered) — this wait is the real proof of the chain.
  await expect(
    page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Pattern transitions` }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** The core transition names, in registration (= picker) order. */
const CORE_NAMES = [
  'Crossfade',
  'Slide from above',
  'Slide from below',
  'Slide from left',
  'Slide from right',
  'Wipe from left',
  'Wipe from right',
  'Wipe from above',
  'Wipe from below',
  'Push from left',
  'Push from right',
  'Push from above',
  'Push from below',
  'Fade through black',
  'Fade through white',
  'Iris open',
  'Iris close',
  'Cross-zoom',
]

const PATTERN_NAMES = [
  'Blinds (horizontal)',
  'Blinds (vertical)',
  'Checkerboard',
  'Diamond iris',
  'Star iris',
  'Clock wipe',
  'Radial wipe',
  'Spiral',
  'Heart iris',
]

/** A sample point, as fractions of the frame. */
type Point = { x: number; y: number }

/**
 * Checkerboard sample points (8 × 6 cells). At progress 0.5 every "dark"
 * cell (column + row even) is full and every other cell empty. Points sit
 * inside a cell, away from its edges, so the claims hold for any progress
 * in roughly 0.2–0.8: the dark cell's point 30% across is revealed once its
 * fill passes 30% (progress 0.15), and the light cell's point 70% across
 * stays hidden until its fill reaches 70% (progress 0.85).
 */
const CHECKER_DARK: Point[] = [
  { x: (0 + 0.3) / 8, y: (0 + 0.5) / 6 },
  { x: (3 + 0.3) / 8, y: (3 + 0.5) / 6 },
  { x: (6 + 0.3) / 8, y: (4 + 0.5) / 6 },
]
const CHECKER_LIGHT: Point[] = [
  { x: (1 + 0.7) / 8, y: (0 + 0.5) / 6 },
  { x: (4 + 0.7) / 8, y: (3 + 0.5) / 6 },
  { x: (7 + 0.7) / 8, y: (4 + 0.5) / 6 },
]

/** Reads RGB at frame-fraction points from a PNG of the composed frame. */
async function samplePng(page: Page, png: Buffer, points: Point[]) {
  return await page.evaluate(
    async ({ base64, points }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      return points.map(({ x, y }) => {
        const data = ctx.getImageData(
          Math.floor(bitmap.width * x),
          Math.floor(bitmap.height * y),
          1,
          1,
        ).data
        return { r: data[0], g: data[1], b: data[2] }
      })
    },
    { base64: png.toString('base64'), points },
  )
}

/** The incoming blue clip, clearly, and not the outgoing green. */
function expectIncoming(sample: { r: number; g: number; b: number }, where: string) {
  expect(sample.b, `${where}: blue`).toBeGreaterThan(120)
  expect(sample.g, `${where}: green`).toBeLessThan(80)
}

/** The outgoing green clip at full strength, and not the incoming blue. */
function expectOutgoing(sample: { r: number; g: number; b: number }, where: string) {
  expect(sample.g, `${where}: green`).toBeGreaterThan(120)
  expect(sample.b, `${where}: blue`).toBeLessThan(80)
}

/** Seeks to the overlap's midpoint and screenshots the composed frame. */
async function previewAtMidpoint(page: Page): Promise<Buffer> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
  const card = page.getByTestId('preview-video-incoming-card')
  await expect(card).toBeVisible()
  // The pattern reaches the card as an SVG mask — the polygon reveal.
  await expect
    .poll(() => card.evaluate((element) => element.style.maskImage))
    .toContain('data:image/svg+xml')
  // Both videos must have a frame decoded before the pixels mean anything.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="preview-frame"] video')].every(
          (video) => (video as HTMLVideoElement).readyState >= 2,
        ),
      ),
    )
    .toBe(true)
  return await page.getByTestId('preview-frame').screenshot()
}

/** Exports, then decodes the file's middle frame and samples it. */
async function exportMidpoint(page: Page, points: Point[]) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile((await download.path())!)
  expect(exported.byteLength).toBeGreaterThan(1000)
  // The whole 1s export is the overlap, so the file's own midpoint sits
  // near progress 0.5 even if load stretched the real-time recording
  // uniformly (#370: sample by the file's own timeline, not nominal
  // seconds). Every claim below holds well either side of 0.5.
  // Read once presented (`presentedExportedFrame`, #276): drawing straight
  // after `seeked` read blue 0 at the centre once in CI (#961).
  const frame = await presentedExportedFrame(page, exported, { fractionOfDuration: 0.5 })
  return { duration: frame.duration, samples: await samplePng(page, frame.png, points) }
}

test('the pattern transitions join the type picker when enabled and leave it stock when disabled', async ({
  page,
}) => {
  await page.goto('./')
  await buildOverlapSequence(page)
  const select = page.getByRole('combobox', { name: 'Transition type between position 1 and 2' })

  // Disabled (the default): exactly the core options, in order.
  await expect(select.locator('option')).toHaveText(CORE_NAMES)

  // Enable → the five join the picker, after the core set, live.
  await setPatternTransitions(page, true)
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, ...PATTERN_NAMES])

  // Disable → the picker is stock again, and the stored type survives as a
  // named unavailable option (the registry's fallback, pinned for a
  // pattern id).
  await select.selectOption('checkerboard')
  await setPatternTransitions(page, false)
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, 'checkerboard (unavailable)'])
  await expect(select).toHaveValue('checkerboard')
})

test('checkerboard: the preview and the export reveal the same cells', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await buildOverlapSequence(page)
  await setPatternTransitions(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('checkerboard')

  const preview = await samplePng(page, await previewAtMidpoint(page), [
    ...CHECKER_DARK,
    ...CHECKER_LIGHT,
  ])
  preview.slice(0, 3).forEach((sample, index) => expectIncoming(sample, `preview dark cell ${index}`))
  preview.slice(3).forEach((sample, index) => expectOutgoing(sample, `preview light cell ${index}`))

  const exported = await exportMidpoint(page, [...CHECKER_DARK, ...CHECKER_LIGHT])
  expect(exported.duration).toBeGreaterThan(0.6)
  expect(exported.duration).toBeLessThan(2.5)
  exported.samples
    .slice(0, 3)
    .forEach((sample, index) => expectIncoming(sample, `export dark cell ${index}`))
  exported.samples
    .slice(3)
    .forEach((sample, index) => expectOutgoing(sample, `export light cell ${index}`))
})

test('star iris: the preview and the export show the star over the outgoing frame', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await buildOverlapSequence(page)
  await setPatternTransitions(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('star-iris')

  // At progress 0.5 on this 16:9 frame the star's inner radius is about
  // 0.51 frame heights and its outer radius twice that: the centre and the
  // run up to the top point are inside, the corners are not. Two samples
  // on the line through the notch between the top point and the upper-right
  // one (36° clockwise from up, where the inner vertex sits at 0.51) pin
  // the outline itself: 0.4 heights out is inside the star, 0.6 is in the
  // notch, outside it — a disc, a diamond or a star stretched by the frame
  // would get at least one of the two wrong.
  const along = (heights: number) => ({
    x: 0.5 + (heights * Math.sin((36 * Math.PI) / 180)) / (16 / 9),
    y: 0.5 - heights * Math.cos((36 * Math.PI) / 180),
  })
  const points: Point[] = [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.08 },
    { x: 0.03, y: 0.03 },
    { x: 0.97, y: 0.97 },
    { x: 0.03, y: 0.97 },
    along(0.4),
    along(0.6),
  ]
  const preview = await samplePng(page, await previewAtMidpoint(page), points)
  expectIncoming(preview[0], 'preview centre')
  expectIncoming(preview[1], 'preview top point')
  expectOutgoing(preview[2], 'preview top-left corner')
  expectOutgoing(preview[3], 'preview bottom-right corner')
  expectOutgoing(preview[4], 'preview bottom-left corner')
  expectIncoming(preview[5], 'preview inside the notch')
  expectOutgoing(preview[6], 'preview in the notch')

  // The export's midpoint is near 0.5 but not exactly there; only claims
  // that hold across the middle of the transition are checked — the
  // centre inside, the corners outside.
  const exported = await exportMidpoint(page, [points[0], points[2], points[3], points[4]])
  expectIncoming(exported.samples[0], 'export centre')
  expectOutgoing(exported.samples[1], 'export top-left corner')
  expectOutgoing(exported.samples[2], 'export bottom-right corner')
  expectOutgoing(exported.samples[3], 'export bottom-left corner')
})

test('clock wipe (#863): the preview and the export show the hand half-way round, clockwise from 12', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await buildOverlapSequence(page)
  await setPatternTransitions(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('clock-wipe')

  // At progress 0.5 the hand points straight down: the right half is the
  // incoming clip and the left half the outgoing one. Angles are clockwise
  // from 12 on this 16:9 frame. (0.8, 0.3) and (0.8, 0.7) sit at 70° and
  // 110°, so they are revealed from progress 0.20 and 0.31. (0.2, 0.7) and
  // (0.2, 0.3) sit at 250° and 290°, so they stay hidden until 0.69 and
  // 0.81. Those four hold across the middle of the transition. Four more,
  // 12.5° either side of 12 and of 6, pin where the hand starts and which
  // way it turns.
  const points: Point[] = [
    { x: 0.8, y: 0.3 },
    { x: 0.8, y: 0.7 },
    { x: 0.2, y: 0.7 },
    { x: 0.2, y: 0.3 },
    { x: 0.55, y: 0.1 },
    { x: 0.45, y: 0.1 },
    { x: 0.55, y: 0.9 },
    { x: 0.45, y: 0.9 },
  ]
  // Kept beside the results for a reader to look at, as #863 asks.
  const frame = await previewAtMidpoint(page)
  await writeFile(testInfo.outputPath('clock-wipe-midpoint.png'), frame)
  const preview = await samplePng(page, frame, points)
  expectIncoming(preview[0], 'preview upper right')
  expectIncoming(preview[1], 'preview lower right')
  expectOutgoing(preview[2], 'preview lower left')
  expectOutgoing(preview[3], 'preview upper left')
  expectIncoming(preview[4], 'preview just after 12')
  expectOutgoing(preview[5], 'preview just before 12')
  expectIncoming(preview[6], 'preview just before 6')
  expectOutgoing(preview[7], 'preview just after 6')

  const exported = await exportMidpoint(page, points.slice(0, 4))
  expectIncoming(exported.samples[0], 'export upper right')
  expectIncoming(exported.samples[1], 'export lower right')
  expectOutgoing(exported.samples[2], 'export lower left')
  expectOutgoing(exported.samples[3], 'export upper left')
})

test('heart iris (#863): the preview and the export show the heart over the outgoing frame', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await buildOverlapSequence(page)
  await setPatternTransitions(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('heart-iris')

  // At progress 0.5 on this 16:9 frame the heart is about 1.5 frame heights
  // tall. Its lobes reach past the top edge and its point past the bottom,
  // with the dip between the lobes at y ≈ 0.10. So, 5% down the frame, the
  // vertical axis is in the dip (outgoing) while points 0.25 heights either
  // side are in the lobes (incoming). A disc, a diamond or a star has no
  // dip, and a heart standing on its lobes would put its point at the top.
  // The bottom corners are outside, beside the point. These were computed
  // from the rule, and the unit tests pin it. The centre, the lobes, the
  // bottom corners and the axis near the bottom hold from progress 0.35 to
  // 0.65, so those are what the export is checked on.
  const points: Point[] = [
    { x: 0.5, y: 0.5 },
    { x: 0.5 - 0.25 / (16 / 9), y: 0.05 },
    { x: 0.5 + 0.25 / (16 / 9), y: 0.05 },
    { x: 0.03, y: 0.97 },
    { x: 0.97, y: 0.97 },
    { x: 0.5, y: 0.97 },
    { x: 0.5, y: 0.05 },
  ]
  const frame = await previewAtMidpoint(page)
  await writeFile(testInfo.outputPath('heart-iris-midpoint.png'), frame)
  const preview = await samplePng(page, frame, points)
  expectIncoming(preview[0], 'preview centre')
  expectIncoming(preview[1], 'preview left lobe')
  expectIncoming(preview[2], 'preview right lobe')
  expectOutgoing(preview[3], 'preview bottom-left corner')
  expectOutgoing(preview[4], 'preview bottom-right corner')
  expectIncoming(preview[5], 'preview above the point')
  expectOutgoing(preview[6], 'preview in the dip between the lobes')

  const exported = await exportMidpoint(page, points.slice(0, 6))
  expectIncoming(exported.samples[0], 'export centre')
  expectIncoming(exported.samples[1], 'export left lobe')
  expectIncoming(exported.samples[2], 'export right lobe')
  expectOutgoing(exported.samples[3], 'export bottom-left corner')
  expectOutgoing(exported.samples[4], 'export bottom-right corner')
  expectIncoming(exported.samples[5], 'export above the point')
})

test('a saved project records the pattern dependency; opening prompt-and-enables', async ({
  page,
}) => {
  // Force the anchor-download save path (as save.spec.ts does): with the
  // File System Access picker present, no 'download' event would fire.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  const { green, blue } = await buildOverlapSequence(page)
  await setPatternTransitions(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('diamond-iris')

  await chooseFromFileMenu(page, 'Save As…')
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const projectBytes = await readFile((await (await downloadPromise).path())!)

  await setPatternTransitions(page, false)

  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'diamond.bvep', mimeType: 'application/gzip', buffer: projectBytes }])
  const prompt = page.getByRole('dialog', { name: 'Enable plugins to open?' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Pattern transitions')
  await prompt.getByRole('button', { name: 'Enable and open' }).click()

  const relink = page.getByRole('dialog', { name: 'Open diamond.bvep' })
  await expect(relink).toBeVisible()
  await page.getByTestId('relink-file-input').setInputFiles([
    { name: 'green.webm', mimeType: 'video/webm', buffer: green },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  const openButton = relink.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeEnabled()
  await openButton.click()

  const select = page.getByRole('combobox', { name: 'Transition type between position 1 and 2' })
  await expect(select).toHaveValue('diamond-iris')
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, ...PATTERN_NAMES])
})
