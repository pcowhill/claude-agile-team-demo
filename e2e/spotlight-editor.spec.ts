import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual spotlight editor and the soft edge (#533, part 2 of #531's
 * approved suggestion; the region itself is #532's) in real Chromium.
 *
 * Two fixtures, each for what only it can show. The **red still** (the
 * redaction editor's, #493) has exactly known pixels and needs no recording
 * to settle, so it carries the editor: a pointer drag over a really
 * laid-out picture committing the percents the fields then read, the oval
 * drawn as an ellipse inside its shaded box, the Show result still really
 * dimmed outside the region, and the rendered evidence for the new surface.
 * The **banded clip** (green left, blue right, every frame identical — the
 * spotlight spec's own) carries the soft edge, because that is a property
 * of the *export*: a dim is a pure multiplication of a flat channel, so a
 * ramp across the region's edge is readable as numbers, and the same
 * export at soften 0 is compared against #532's own numbers to show the
 * default path did not move.
 */

// ── The red still, for the editor ─────────────────────────────────────────

async function importRedImage(page: Page): Promise<void> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 160
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(220, 20, 20)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }])
  await page.getByRole('button', { name: 'Add red.png to timeline' }).click()
}

const IMAGE = 'red.png at position 1'
const REGION = 'Spotlight region 1'

/**
 * How far a drawn rectangle's box may sit from the fraction it stands for:
 * the redaction editor spec's 2 px — the stroke, since a bounding box is
 * stroke-inclusive — plus a hundredth for a real layout's float tail.
 */
const STROKE = 2.01

const field = (page: Page, position: string, which: string, label: string) =>
  page.getByRole('spinbutton', { name: `${which} ${label} of ${position} (percent)`, exact: true })

const valueOf = async (locator: Locator) => Number(await locator.inputValue())

/** A region field's value, polled: a release resolves on dispatch, not on React's commit. */
const expectField = (page: Page, label: string, which = REGION) =>
  expect.poll(async () => valueOf(field(page, IMAGE, which, label)), {
    message: `${which} ${label} of ${IMAGE}`,
  })

const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

async function dragPointer(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 8
  for (let index = 1; index <= steps; index++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * index) / steps,
      from.y + ((to.y - from.y) * index) / steps,
    )
  }
  await page.mouse.up()
}

/** Types a value into a percent field and commits it. */
async function setPercent(page: Page, position: string, which: string, label: string, value: number) {
  const input = field(page, position, which, label)
  await input.fill(String(value))
  await input.press('Enter')
  await expect(input).toHaveValue(String(value))
}

/** The red still with one spotlight region and its editor open. */
async function openEditor(page: Page) {
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a spotlight region on ${IMAGE}` }).click()
  await page.getByRole('button', { name: `Adjust ${REGION} of ${IMAGE} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust ${REGION} of ${IMAGE}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  // `page.mouse` works in viewport coordinates, so the panel has to be on
  // screen before a drag can land on it.
  await editor.scrollIntoViewIfNeeded()
  return editor
}

test('a drag moves the region with the fields following, and an oval is drawn as the ellipse in its shaded box (#533)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const editor = await openEditor(page)
    const label = `the spotlight editor at ${viewport.width}px`
    const region = editor.getByTestId('frame-editor-rect')
    const frame = editor.getByTestId('frame-editor-frame')
    const frameBox = (await frame.boundingBox())!

    // The still is the source's own shape — 3:2 — so a region fraction is a
    // frame fraction; and the rectangle is where the fields put it.
    expect(frameBox.width / frameBox.height).toBeCloseTo(1.5, 1)
    const drawn = (await region.boundingBox())!
    expect(Math.abs(drawn.x - (frameBox.x + frameBox.width * 0.35))).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(drawn.y - (frameBox.y + frameBox.height * 0.4))).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(drawn.width - frameBox.width * 0.3)).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(drawn.height - frameBox.height * 0.2)).toBeLessThanOrEqual(STROKE)
    // The outside is shaded here — the effect, not a metaphor — cut to the box.
    await expect(editor.getByTestId('frame-editor-shade')).toHaveAttribute('data-hole', 'rect')

    // Geometry a browser can measure: the panel inside the Spotlight group's
    // column and the timeline, the frame inside the panel, no sideways scroll.
    const column = page.locator('.timeline-spotlight').first()
    await expectWithin(editor, column, { axis: 'x', what: label })
    await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
      axis: 'x',
      what: label,
    })
    await expectWithin(frame, editor, { what: `the frame in ${label}` })
    await expectNoHorizontalScroll(page, label)

    // A move by a fifth of the frame up and left, clear of every snap zone:
    // the fields read 15 and 20, and the live readout agrees — both read
    // inside one poll, so they come from the same render.
    const start = await centreOf(region)
    await dragPointer(page, start, {
      x: start.x - frameBox.width * 0.2,
      y: start.y - frameBox.height * 0.2,
    })
    await expect
      .poll(async () => ({
        left: await valueOf(field(page, IMAGE, REGION, 'left')),
        top: await valueOf(field(page, IMAGE, REGION, 'top')),
        readoutLeft: await editor.getByRole('status', { name: `${REGION} left (live)` }).textContent(),
        readoutTop: await editor.getByRole('status', { name: `${REGION} top (live)` }).textContent(),
      }))
      .toEqual({ left: 15, top: 20, readoutLeft: '15', readoutTop: '20' })
    await expect(field(page, IMAGE, REGION, 'width')).toHaveValue('30')
    await expect(field(page, IMAGE, REGION, 'dim')).toHaveValue('55')
    // One gesture, one undo step, though the drag fired eight moves.
    await page.keyboard.press('Control+z')
    await expectField(page, 'left').toBe(35)
    await expectField(page, 'top').toBe(40)

    // The south-east corner dragged out: both dimensions grow, the origin stays.
    await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-corner-se')), {
      x: frameBox.x + frameBox.width * 0.75,
      y: frameBox.y + frameBox.height * 0.7,
    })
    await expectField(page, 'width').toBeCloseTo(40, -0.5)
    await expectField(page, 'height').toBeCloseTo(30, -0.5)
    await page.keyboard.press('Control+z')
    await expectField(page, 'width').toBe(30)

    // Oval: the handles stay on the box, the silhouette is the inscribed
    // ellipse, and the shade's hole follows it — the box's corners darken.
    await page.getByRole('combobox', { name: `${REGION} shape of ${IMAGE}` }).selectOption('Oval')
    const silhouette = editor.getByTestId('frame-editor-silhouette')
    await expect(silhouette).toHaveAttribute('data-shape', 'ellipse')
    await expect(editor.getByTestId('frame-editor-shade')).toHaveAttribute('data-hole', 'ellipse')
    // Both boxes read after the change: selecting scrolls nothing, but a
    // stale box is the failure mode the redaction spec recorded.
    const boxNow = (await region.boundingBox())!
    const ellipseBox = (await silhouette.boundingBox())!
    expect(Math.abs(ellipseBox.x - boxNow.x), `the ellipse's left at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(ellipseBox.width - boxNow.width), `the ellipse's width at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(ellipseBox.height - boxNow.height), `the ellipse's height at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    await expectWithin(silhouette, region, { tolerance: STROKE, what: `the ellipse in its box at ${viewport.width}px` })
    // Dragging the box's corner reshapes the oval with it.
    await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-corner-se')), {
      x: frameBox.x + frameBox.width * 0.75,
      y: frameBox.y + frameBox.height * 0.7,
    })
    await expectField(page, 'width').toBeCloseTo(40, -0.5)
    await expect
      .poll(async () => (await silhouette.boundingBox())!.width / frameBox.width)
      .toBeCloseTo(0.4, 1)
    await page.keyboard.press('Control+z')

    // No label wraps: the readout stays on its lines, and the Loop and Show
    // result labels inside their controls.
    for (const [locator, what] of [
      [editor.locator('.effect-editor-readout'), 'the readout'],
      [editor.getByRole('button', { name: `Loop the window of ${REGION} of ${IMAGE}` }), 'Loop'],
      [editor.locator('.effect-editor-result'), 'Show result'],
    ] as const) {
      expect(
        await locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        `${what} overflows its own box at ${viewport.width}px`,
      ).toBe(true)
    }

    // The screenshot the PR describes: an oval region with handles on its
    // box, the ellipse inscribed, the corners and the outside shaded.
    await editor.screenshot({ path: testInfo.outputPath(`spotlight-editor-${viewport.width}.png`) })
  }
})

test('the Preview slider spans the window, Loop drives it, and Show result dims outside the region (#533)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a spotlight region on ${IMAGE}` }).click()
  // A window of 1 → 3 s on the 5 s still, at a 60 % dim.
  for (const [label, value] of [
    ['start', '1'],
    ['end', '3'],
  ] as const) {
    const input = page.getByRole('spinbutton', {
      name: `${REGION} ${label} of ${IMAGE} in seconds`,
      exact: true,
    })
    await input.fill(value)
    await input.press('Enter')
    await expect(input).toHaveValue(value)
  }
  await setPercent(page, IMAGE, REGION, 'dim', 60)
  await page.getByRole('button', { name: `Adjust ${REGION} of ${IMAGE} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust ${REGION} of ${IMAGE}` })
  const image = editor.getByTestId('frame-editor-image')
  await expect(image).toBeVisible()
  await editor.scrollIntoViewIfNeeded()

  // The slider is the window, opened in its middle.
  const slider = editor.getByRole('slider', {
    name: `Preview time of ${REGION} of ${IMAGE} in seconds`,
  })
  const reading = editor.getByRole('status', { name: `${REGION} preview time (live)` })
  await expect(slider).toHaveAttribute('min', '1')
  await expect(slider).toHaveAttribute('max', '3')
  await expect(slider).toHaveValue('2')
  await expect(reading).toHaveText('2.00 s')
  await slider.fill('1.5')
  await expect(reading).toHaveText('1.50 s')

  // Loop: read-only slider while the clock drives it, and it does move.
  const loop = editor.getByRole('button', { name: `Loop the window of ${REGION} of ${IMAGE}` })
  await expect(loop).toHaveAttribute('aria-pressed', 'false')
  await loop.click()
  await expect(loop).toHaveAttribute('aria-pressed', 'true')
  await expect(slider).toBeDisabled()
  await expect(reading).toHaveText('1.00 s')
  await expect(reading).not.toHaveText('1.00 s', { timeout: 5_000 })
  await loop.click()
  await expect(slider).toBeEnabled()

  // Show result draws the dim through the export's own painter: outside the
  // region the still is 60 % of the way to black, inside it is the source's
  // own red. Read from the rendered image itself, polled until it lands.
  await editor.getByRole('checkbox', { name: 'Show result' }).check()
  await expect(editor.getByTestId('frame-editor-rect')).toHaveCount(0)
  await expect(editor.getByTestId('frame-editor-shade')).toHaveCount(0)
  const sample = () =>
    image.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = element.naturalWidth
      canvas.height = element.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(element, 0, 0)
      const at = (fx: number, fy: number) => {
        const [r, g, b] = ctx.getImageData(
          Math.floor(fx * canvas.width),
          Math.floor(fy * canvas.height),
          1,
          1,
        ).data
        return { r, g, b }
      }
      // The region covers 35–65 % across and 40–60 % down.
      return { inside: at(0.5, 0.5), outside: at(0.1, 0.1), width: canvas.width }
    })
  await expect
    .poll(async () => (await sample()).outside.r, { message: 'the result still outside the region' })
    .toBeLessThan(120)
  const { inside, outside, width } = await sample()
  expect(width).toBeGreaterThan(0)
  // 220 × 0.4 = 88, give or take the PNG round trip.
  expect(outside.r).toBeGreaterThan(70)
  expect(inside.r, `inside the region the still reads ${JSON.stringify(inside)}`).toBeGreaterThan(200)
  await editor.screenshot({ path: testInfo.outputPath('spotlight-editor-result.png') })
})

// ── The banded clip, for the soft edge ────────────────────────────────────

/** Records a WebM whose left half is green and right half blue. */
async function recordBandedWebm(page: Page, seconds = 6): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async (seconds) => {
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
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
        if (performance.now() - start > seconds * 1000) resolve()
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
  }, seconds)
  return Buffer.from(webmBase64, 'base64')
}

const POSITION = 'banded.webm at position 1'
/** The source's own green channel, before anything dims it. */
const SOURCE_GREEN = 205

async function exportProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

// The spotlight spec's region: the middle 40 % of each axis, at 60 % dim.
const BOX = { left: 30, top: 30, width: 40, height: 40 }
/** Inside the box, on the green side — the spotlight spec's own patch. */
const LIT: SampleRect = { x: 0.34, y: 0.45, width: 0.1, height: 0.1 }
/** Outside the box entirely, on the green side — the spotlight spec's own patch. */
const OUTSIDE: SampleRect = { x: 0.04, y: 0.45, width: 0.1, height: 0.1 }
/**
 * A line of patches crossing the region's left edge at x = 0.30, from well
 * outside to well inside, all on the green side. A 20 % soften on a 320×180
 * frame is a 36 px feather, a blur of 18 px, so the ramp spans about ±36 px
 * — ±0.11 of the width — which these seven cover with margin either side.
 */
const ACROSS: SampleRect[] = [0.18, 0.22, 0.26, 0.3, 0.34, 0.38, 0.42].map((x) => ({
  x: x - 0.015,
  y: 0.45,
  width: 0.03,
  height: 0.1,
}))

/** Well inside the box on the green side, clear of even the 20 % ramp. */
const INNER: SampleRect = { x: 0.4, y: 0.45, width: 0.08, height: 0.1 }

/**
 * The number of patches strictly between the line's own two ends — the
 * ramp's steps. Measured against the ends rather than against `LIT` and
 * `OUTSIDE`, because at 20 % soften the ramp reaches into the `LIT` patch
 * itself (it read 190 against 198 further in, on the first run).
 */
const intermediates = (values: number[]) => {
  const low = values[0] + 15
  const high = values[values.length - 1] - 15
  return values.slice(1, -1).filter((value) => value > low && value < high).length
}

test('soften ramps the exported edge instead of stepping it, the default stays #532’s hard edge, and the preview agrees (#533)', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('./')
  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: `Add banded.webm to timeline` }).click()
  const outField = page.getByRole('spinbutton', {
    name: `Trim out point of ${POSITION} in seconds`,
  })
  await outField.fill('4')
  await outField.blur()
  await openPicture(page, POSITION)
  await page.getByRole('button', { name: `Add a spotlight region on ${POSITION}` }).click()
  await expect(
    page.getByRole('combobox', { name: `${REGION} shape of ${POSITION}` }),
  ).toBeVisible()
  for (const [label, value] of Object.entries(BOX)) await setPercent(page, POSITION, REGION, label, value)
  await setPercent(page, POSITION, REGION, 'dim', 60)
  for (const [label, value] of [
    ['start', '0'],
    ['end', '4'],
  ] as const) {
    const input = page.getByRole('spinbutton', {
      name: `${REGION} ${label} of ${POSITION} in seconds`,
      exact: true,
    })
    await input.fill(value)
    await input.blur()
  }

  // ---- The default: soften 0, which is what every #532 region has ----
  await expect(field(page, POSITION, REGION, 'soften')).toHaveValue('0')
  const hard = await exportProject(page)
  const hardLit = await sampleExportedFrame(page, hard, 2, LIT)
  const hardOutside = await sampleExportedFrame(page, hard, 2, OUTSIDE)
  // #532's own numbers at #532's own tolerance: inside untouched, outside
  // 60 % of the way to black. A realtime VP9 encode is not byte-stable
  // between runs, so this is the decoded-frame form of "unchanged".
  expect(hardLit.g, 'inside the region is left alone').toBeGreaterThan(160)
  expect(hardOutside.g / SOURCE_GREEN).toBeCloseTo(0.4, 1)
  const hardAcross: number[] = []
  for (const patch of ACROSS) hardAcross.push((await sampleExportedFrame(page, hard, 2, patch)).g)
  // A hard edge steps: at most the one patch straddling x = 0.30 reads
  // between the two levels.
  expect(
    intermediates(hardAcross),
    `the hard edge reads ${hardAcross.map((v) => v.toFixed(0)).join(' ')} across x = 0.30`,
  ).toBeLessThanOrEqual(1)

  // ---- Soften 20 %: the same export, now ramped ----
  await setPercent(page, POSITION, REGION, 'soften', 20)
  const soft = await exportProject(page)
  const softInner = await sampleExportedFrame(page, soft, 2, INNER)
  const softOutside = await sampleExportedFrame(page, soft, 2, OUTSIDE)
  // Far from the edge nothing changed.
  expect(softInner.g).toBeGreaterThan(160)
  expect(softOutside.g / SOURCE_GREEN).toBeCloseTo(0.4, 1)
  const softAcross: number[] = []
  for (const patch of ACROSS) softAcross.push((await sampleExportedFrame(page, soft, 2, patch)).g)
  const describe = `the soft edge reads ${softAcross.map((v) => v.toFixed(0)).join(' ')} across x = 0.30`
  // Monotonic — brighter the further inside, never darker again — within
  // the codec's noise, and with real steps between the two levels.
  for (let index = 1; index < softAcross.length; index++) {
    expect(softAcross[index], describe).toBeGreaterThanOrEqual(softAcross[index - 1] - 4)
  }
  expect(intermediates(softAcross), describe).toBeGreaterThanOrEqual(3)
  expect(softAcross[0], describe).toBeLessThan(softOutside.g + 25)
  expect(softAcross.at(-1)!, describe).toBeGreaterThan(softInner.g - 25)

  // ---- The preview agrees along the same line ----
  // The preview paints its dim into the overlay canvas in front of the
  // video, so its contribution is the alpha there; over a source known to
  // be flat green, that predicts the exported green at each patch.
  const canvas = page.getByTestId('preview-redactions')
  await expect(canvas).toBeVisible()
  const alphaAt = (patches: SampleRect[]) =>
    canvas.evaluate((element, patches) => {
      const source = element as HTMLCanvasElement
      const context = source.getContext('2d')
      if (context === null || source.width === 0) return null
      const { width, height } = source
      const data = context.getImageData(0, 0, width, height).data
      return patches.map((patch) => {
        const x0 = Math.floor(patch.x * width)
        const x1 = Math.ceil((patch.x + patch.width) * width)
        const y0 = Math.floor(patch.y * height)
        const y1 = Math.ceil((patch.y + patch.height) * height)
        let total = 0
        let count = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            total += data[(y * width + x) * 4 + 3]
            count++
          }
        }
        return count === 0 ? 0 : total / count
      })
    }, patches)
  // Polled until the canvas has painted the dim (rAF, never read once).
  await expect
    .poll(async () => (await alphaAt([OUTSIDE]))?.[0] ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(100)
  const alphas = (await alphaAt(ACROSS))!
  for (let index = 0; index < ACROSS.length; index++) {
    const predicted = SOURCE_GREEN * (1 - alphas[index] / 255)
    // The tolerance the spotlight spec uses for a flat patch, widened by 5
    // for the ramp: the preview's mask is built at the card's resolution
    // and the export's at the frame's, and a blur sampled at two
    // resolutions lands a few levels apart mid-slope.
    expect(
      Math.abs(softAcross[index] - predicted),
      `at x = ${ACROSS[index].x + 0.015}: export ${softAcross[index].toFixed(1)}, preview predicts ${predicted.toFixed(1)}`,
    ).toBeLessThan(30)
  }
})
