import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual redaction editor (#493, part 2 of #489; the model is #492's)
 * in real Chromium. What only a real browser can show: a pointer drag over
 * a really laid-out picture committing the percents the region's fields
 * then read, the guides drawn where a snap lands, the Show result still
 * really painted black where the region is, and the rendered evidence for
 * the new surface — the rectangle drawn at the region's own fraction of
 * the still at both widths, the panel inside its column with no sideways
 * page scroll, plus a screenshot re-taken every run.
 *
 * The fixture is a solid red still, 240 × 160: its pixels are exactly
 * known, so a black region in the result still is unambiguous, and a still
 * needs no recording to settle. The window scrub over a moving picture is
 * the zoom editor's pipeline (#421/#425) and is covered there; here the
 * slider's range and the loop's hold on it are what this editor adds.
 */

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
const REGION = 'Redaction region 1'

/**
 * How far a drawn rectangle's box may sit from the fraction it stands for:
 * the issue's 2 px, which is exactly the stroke — `.frame-editor-rect` is
 * stroked 2 px wide and a bounding box is stroke-inclusive, so a rectangle
 * dead on its fraction measures one pixel proud on each side, i.e. 2 in
 * total — plus a hundredth for the float tail a real layout carries
 * (measured 2.000009 at 1280 px on the first run).
 */
const STROKE = 2.01

const field = (page: Page, which: string, label: string) =>
  page.getByRole('spinbutton', { name: `${which} ${label} of ${IMAGE} (percent)`, exact: true })

const valueOf = async (locator: Locator) => Number(await locator.inputValue())

/**
 * A region field's value, polled rather than read once: a driver's release
 * resolves on dispatch, not on React's commit (`quality-and-ci.md`, #449).
 */
const expectField = (page: Page, label: string, which = REGION) =>
  expect.poll(async () => valueOf(field(page, which, label)), {
    message: `${which} ${label} of ${IMAGE}`,
  })

const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: 'Shift' | 'Alt',
) {
  await page.mouse.move(from.x, from.y)
  if (modifier !== undefined) await page.keyboard.down(modifier)
  await page.mouse.down()
  const steps = 8
  for (let index = 1; index <= steps; index++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * index) / steps,
      from.y + ((to.y - from.y) * index) / steps,
    )
  }
  await page.mouse.up()
  if (modifier !== undefined) await page.keyboard.up(modifier)
}

/** Types a value into a region field and commits it. */
async function setField(page: Page, label: string, value: string, which = REGION) {
  const input = field(page, which, label)
  await input.fill(value)
  await input.press('Enter')
  await expect(input).toHaveValue(value)
}

/** The red still with `regions` regions added, and the first one's editor open. */
async function openEditor(page: Page, regions = 1) {
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  for (let index = 0; index < regions; index++) {
    await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  }
  await page.getByRole('button', { name: `Adjust ${REGION} of ${IMAGE} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust ${REGION} of ${IMAGE}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  // `page.mouse` works in viewport coordinates, so the panel has to be on
  // screen before a drag can land on it.
  await editor.scrollIntoViewIfNeeded()
  return editor
}

/** The region's box against the frame's, as fractions, from a real layout. */
async function drawnFractions(editor: Locator) {
  const frame = (await editor.getByTestId('frame-editor-frame').boundingBox())!
  const rect = (await editor.getByTestId('frame-editor-rect').boundingBox())!
  return {
    left: (rect.x - frame.x) / frame.width,
    top: (rect.y - frame.y) / frame.height,
    width: rect.width / frame.width,
    height: rect.height / frame.height,
    frame,
    rect,
  }
}

test('a drag moves the region with the fields following, a corner and an edge resize it, Shift keeps the aspect — one undo step each (#493)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!

  // The still is the source's own shape — 3:2, not the 16:9 output frame a
  // composed still would letterbox it into — which is what makes a region
  // fraction a frame fraction here.
  expect(frameBox.width / frameBox.height).toBeCloseTo(1.5, 1)

  // The default region drawn where its fields say, within the tolerance the
  // issue names: the rectangle is stroked 2 px wide and a bounding box is
  // stroke-inclusive, so a rectangle exactly on its fraction measures a
  // pixel proud on each side — it reads exactly 2, plus a float's tail
  // (measured: 2.000009), which is what the hundredth is for.
  const drawn = (await region.boundingBox())!
  expect(Math.abs(drawn.x - (frameBox.x + frameBox.width * 0.35))).toBeLessThanOrEqual(STROKE)
  expect(Math.abs(drawn.y - (frameBox.y + frameBox.height * 0.4))).toBeLessThanOrEqual(STROKE)
  expect(Math.abs(drawn.width - frameBox.width * 0.3)).toBeLessThanOrEqual(STROKE)
  expect(Math.abs(drawn.height - frameBox.height * 0.2)).toBeLessThanOrEqual(STROKE)

  // A move by a fifth of the frame up and left, clear of every snap zone:
  // the fields read 15 and 20, and the live readout agrees with them — both
  // read inside one poll, so they come from the same render.
  const start = await centreOf(region)
  await dragPointer(page, start, {
    x: start.x - frameBox.width * 0.2,
    y: start.y - frameBox.height * 0.2,
  })
  await expect
    .poll(async () => ({
      left: await valueOf(field(page, REGION, 'left')),
      top: await valueOf(field(page, REGION, 'top')),
      readoutLeft: await editor.getByRole('status', { name: `${REGION} left (live)` }).textContent(),
      readoutTop: await editor.getByRole('status', { name: `${REGION} top (live)` }).textContent(),
    }))
    .toEqual({ left: 15, top: 20, readoutLeft: '15', readoutTop: '20' })
  // A move is not a resize.
  await expect(field(page, REGION, 'width')).toHaveValue('30')
  await expect(field(page, REGION, 'height')).toHaveValue('20')
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
  await expect(field(page, REGION, 'left')).toHaveValue('35')
  await page.keyboard.press('Control+z')
  await expectField(page, 'width').toBe(30)

  // Shift on the corner: the pointer asks for 45 wide and 50 tall; the 3:2
  // lock gives 45 × 30.
  await dragPointer(
    page,
    await centreOf(editor.getByTestId('frame-editor-corner-se')),
    { x: frameBox.x + frameBox.width * 0.8, y: frameBox.y + frameBox.height * 0.9 },
    'Shift',
  )
  await expect(field(page, REGION, 'width')).not.toHaveValue('30')
  const width = await valueOf(field(page, REGION, 'width'))
  const height = await valueOf(field(page, REGION, 'height'))
  expect(width / height, `${width} × ${height} is not the region's 3:2`).toBeCloseTo(1.5, 1)
  expect(height, `the lock let the height follow the pointer to ${height}`).toBeLessThan(40)
  await page.keyboard.press('Control+z')
  await expectField(page, 'width').toBe(30)

  // An edge handle changes its own dimension and nothing else.
  await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-edge-e')), {
    x: frameBox.x + frameBox.width * 0.8,
    y: (await centreOf(region)).y,
  })
  await expectField(page, 'width').toBeCloseTo(45, -0.5)
  await expect(field(page, REGION, 'height')).toHaveValue('20')
  await expect(field(page, REGION, 'top')).toHaveValue('40')
})

test('arrow keys nudge by the shared step and Shift by the large one, each its own undo step (#493)', async ({
  page,
}) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expectField(page, 'left').toBe(36)
  await page.keyboard.press('Shift+ArrowDown')
  await expectField(page, 'top').toBe(45)
  await page.keyboard.press('Control+z')
  await expectField(page, 'top').toBe(40)
  await expect(field(page, REGION, 'left')).toHaveValue('36')
  await page.keyboard.press('Control+z')
  await expectField(page, 'left').toBe(35)
})

test('snapping to the frame’s centre shows the guides and Alt bypasses it (#493)', async ({
  page,
}, testInfo) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!

  // Parked top-left, so there is somewhere to snap from: centre (0.25, 0.20).
  await setField(page, 'left', '10')
  await setField(page, 'top', '10')

  // A move landing within a hundredth of centred, paused mid-drag so the
  // guides are on screen: they belong to the gesture and vanish on release.
  const start = await centreOf(region)
  const target = { x: start.x + frameBox.width * 0.24, y: start.y + frameBox.height * 0.29 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  const guideX = editor.getByTestId('frame-editor-guide-x')
  const guideY = editor.getByTestId('frame-editor-guide-y')
  // `toBeAttached`, not `toBeVisible`: an SVG line's box is one axis wide
  // and Playwright reads a zero-area box as hidden. Its coordinate is the
  // real assertion — the guide is drawn where the centre snapped to.
  await expect(guideX).toBeAttached()
  await expect(guideY).toBeAttached()
  expect(
    Math.abs((await guideX.evaluate((node) => Number(node.getAttribute('x1')))) - frameBox.width * 0.5),
  ).toBeLessThan(1)
  expect(
    Math.abs((await guideY.evaluate((node) => Number(node.getAttribute('y1')))) - frameBox.height * 0.5),
  ).toBeLessThan(1)
  await editor.screenshot({ path: testInfo.outputPath('redaction-editor-snapped.png') })
  await page.mouse.up()
  // Snapped: the region is exactly centred, which no hand-aimed drag lands on.
  await expectField(page, 'left').toBe(35)
  await expectField(page, 'top').toBe(40)
  await expect(guideX).toHaveCount(0)

  // The same drag with Alt held commits where the pointer left it.
  await page.keyboard.press('Control+z')
  await expectField(page, 'left').toBe(10)
  const again = await centreOf(region)
  await dragPointer(
    page,
    again,
    { x: again.x + frameBox.width * 0.24, y: again.y + frameBox.height * 0.29 },
    'Alt',
  )
  await expectField(page, 'left').toBeCloseTo(34, -0.5)
  await expectField(page, 'top').toBeCloseTo(39, -0.5)
  const left = await valueOf(field(page, REGION, 'left'))
  expect(left, `Alt-held drag still snapped to the centre (${left})`).not.toBe(35)
})

test('the Preview slider spans the window, Loop drives it, and Show result paints the region’s style (#493)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  // A window of 1 → 3 s on the 5 s still, and a solid black region.
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
  await page.getByRole('combobox', { name: `${REGION} style of ${IMAGE}` }).selectOption('Solid')
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

  // Loop: the slider is read-only while the clock drives it, and the clock
  // does move it — from the window's first frame, after the opening rest.
  const loop = editor.getByRole('button', { name: `Loop the window of ${REGION} of ${IMAGE}` })
  await expect(loop).toHaveAttribute('aria-pressed', 'false')
  await loop.click()
  await expect(loop).toHaveAttribute('aria-pressed', 'true')
  await expect(slider).toBeDisabled()
  await expect(reading).toHaveText('1.00 s')
  await expect(reading).not.toHaveText('1.00 s', { timeout: 5_000 })
  await loop.click()
  await expect(slider).toBeEnabled()
  const parked = await reading.textContent()
  expect(parked).not.toBe('1.00 s')

  // Show result draws the region through the export's own painter: the
  // still really is black inside the region and still red outside it. Read
  // from the rendered image itself, polled until the result render lands.
  await editor.getByRole('checkbox', { name: 'Show result' }).check()
  await expect(editor.getByTestId('frame-editor-rect')).toHaveCount(0)
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
    .poll(async () => (await sample()).inside, { message: 'the result still inside the region' })
    .toEqual({ r: 0, g: 0, b: 0 })
  const { outside, width } = await sample()
  expect(width).toBeGreaterThan(0)
  expect(outside.r, `outside the region the still reads ${JSON.stringify(outside)}`).toBeGreaterThan(
    180,
  )
  expect(outside.g).toBeLessThan(60)
  await editor.screenshot({ path: testInfo.outputPath('redaction-editor-result.png') })
})

test('the redaction editor fits its column at both widths, draws the rectangle at the region’s fraction, and outlines its sibling (#493)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const editor = await openEditor(page, 2)
    const label = `the redaction editor at ${viewport.width}px`

    // Geometry a browser can measure: the panel inside the Redact group's
    // column and inside the timeline, the frame inside the panel, and the
    // page not scrolling sideways.
    const column = page.locator('.timeline-redaction').first()
    await expectWithin(editor, column, { axis: 'x', what: label })
    await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
      axis: 'x',
      what: label,
    })
    await expectWithin(editor.getByTestId('frame-editor-frame'), editor, {
      what: `the frame in ${label}`,
    })
    await expectNoHorizontalScroll(page, label)

    // The rectangle lies within 2 px of the region's own fraction of the
    // still (the stroke is 2 px and the box is stroke-inclusive; `STROKE`).
    const { frame, rect } = await drawnFractions(editor)
    expect(Math.abs(rect.x - (frame.x + frame.width * 0.35)), `left at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(rect.y - (frame.y + frame.height * 0.4)), `top at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(rect.width - frame.width * 0.3), `width at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(rect.height - frame.height * 0.2), `height at ${viewport.width}px`).toBeLessThanOrEqual(STROKE)

    // The sibling is outlined where its own fields put it, and it is not
    // shaded around: the picture outside the region keeps its colour.
    await setField(page, 'left', '5', 'Redaction region 2')
    await setField(page, 'top', '5', 'Redaction region 2')
    const outline = editor.getByTestId('frame-editor-outline')
    await expect(outline).toHaveCount(1)
    // Both boxes read after the fields were typed: focusing a field scrolls
    // the page, and a viewport-relative box measured before that scroll is
    // 12 px stale (measured on the first run).
    const shifted = (await editor.getByTestId('frame-editor-frame').boundingBox())!
    const outlineBox = (await outline.boundingBox())!
    expect(Math.abs(outlineBox.x - (shifted.x + shifted.width * 0.05))).toBeLessThanOrEqual(STROKE)
    expect(Math.abs(outlineBox.y - (shifted.y + shifted.height * 0.05))).toBeLessThanOrEqual(STROKE)
    await expect(editor.locator('.frame-editor-shade')).toHaveCount(0)

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

    // The screenshot the PR describes: one region with handles, one sibling
    // outlined, nothing dimmed.
    await editor.screenshot({
      path: testInfo.outputPath(`redaction-editor-${viewport.width}.png`),
    })
  }
})
