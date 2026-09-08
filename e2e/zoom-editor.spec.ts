import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { chooseFromFileMenu } from './fileMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual Zoom editor (#413, from #402 / #396) in real Chromium: the
 * editor renders a real still of the frame (the export's own draw, on a
 * real canvas) at the output aspect, draws the zoom's region on it at the
 * right place, and a pointer drag commits the numbers the row's fields then
 * show — values a state load cannot fake. Plus the rendered evidence for
 * the new surface: the editor inside the timeline panel with no sideways
 * page scroll at both widths, and a screenshot re-taken every run.
 */

/** A real 16:9 PNG (320×180) with distinct quadrants, so the still is not flat. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c33'
    ctx.fillRect(0, 0, 160, 90)
    ctx.fillStyle = '#3c3'
    ctx.fillRect(160, 0, 160, 90)
    ctx.fillStyle = '#33c'
    ctx.fillRect(0, 90, 160, 90)
    ctx.fillStyle = '#cc3'
    ctx.fillRect(160, 90, 160, 90)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

const position = 'logo.png at position 1'

async function fillField(page: Page, name: string, value: string) {
  const input = page.getByRole('spinbutton', { name })
  await input.fill(value)
  await input.press('Enter')
  await expect(input).toHaveValue(value)
}

const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

async function dragPointer(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  }
  await page.mouse.up()
}

test('the zoom editor shows the real frame at the output aspect, and drags commit the zoom in one step (#413)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await chooseEffect(page, position, 'Zoom')
  await fillField(page, `Zoom 1 scale of ${position}`, '2')
  await fillField(page, `Zoom 1 centre X of ${position} (0 to 1)`, '0.5')
  await fillField(page, `Zoom 1 centre Y of ${position} (0 to 1)`, '0.5')

  await page.getByRole('button', { name: `Adjust Zoom 1 of ${position} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust Zoom 1 of ${position}` })
  await expect(editor).toBeVisible()
  // The still is the export's own draw of a 16:9 source: it arrives with
  // the output frame's dimensions, and the frame box takes that aspect.
  const image = editor.getByTestId('frame-editor-image')
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0)
  const frame = editor.getByTestId('frame-editor-frame')
  const frameBox = (await frame.boundingBox())!
  expect(frameBox.width / frameBox.height).toBeGreaterThan((16 / 9) * 0.99)
  expect(frameBox.width / frameBox.height).toBeLessThan((16 / 9) * 1.01)

  // The region for scale 2 centred is the middle half of the frame. Read
  // off the rectangle's own geometry (frame-relative px), since a bounding
  // box would add the 2 px stroke on each side.
  const region = editor.getByTestId('frame-editor-rect')
  const regionRect = () =>
    region.evaluate((node) => ({
      x: Number(node.getAttribute('x')),
      y: Number(node.getAttribute('y')),
      width: Number(node.getAttribute('width')),
      height: Number(node.getAttribute('height')),
    }))
  const regionAtRest = await regionRect()
  expect(Math.abs(regionAtRest.x - frameBox.width * 0.25)).toBeLessThan(1)
  expect(Math.abs(regionAtRest.y - frameBox.height * 0.25)).toBeLessThan(1)
  expect(Math.abs(regionAtRest.width - frameBox.width * 0.5)).toBeLessThan(1)
  expect(Math.abs(regionAtRest.height - frameBox.height * 0.5)).toBeLessThan(1)
  // …and it is drawn inside the frame (stroke included, hence 2 px).
  await expectWithin(region, frame, { what: 'zoom region', tolerance: 2 })

  // Geometry (new visible surface): the editor inside the timeline panel,
  // no sideways page scroll; the screenshot for the human check.
  const panel = page.getByRole('region', { name: 'Timeline' })
  await expectWithin(editor, panel, { axis: 'x', what: 'zoom editor' })
  await expectNoHorizontalScroll(page, 'zoom editor open')
  await editor.screenshot({ path: testInfo.outputPath('zoom-editor.png') })

  // Drag the region right by a tenth of the frame: centre X 0.5 → 0.6.
  const start = await centreOf(region)
  await dragPointer(page, start, { x: start.x + frameBox.width * 0.1, y: start.y })
  const centreX = page.getByRole('spinbutton', { name: `Zoom 1 centre X of ${position} (0 to 1)` })
  const centreY = page.getByRole('spinbutton', { name: `Zoom 1 centre Y of ${position} (0 to 1)` })
  const scale = page.getByRole('spinbutton', { name: `Zoom 1 scale of ${position}` })
  await expect(centreX).toHaveValue('0.6')
  await expect(centreY).toHaveValue('0.5')
  await expect(scale).toHaveValue('2')
  // The region followed the committed value.
  expect(Math.abs((await regionRect()).x - frameBox.width * 0.35)).toBeLessThan(1)

  // Drag the SE corner inward to 0.8 / 0.7 of the frame: half-size 0.2
  // about the centre (0.6, 0.5) → scale 2.5. The frame is re-measured
  // first: the target is a point on it, wherever it lies now.
  const corner = await centreOf(editor.getByTestId('frame-editor-corner-se'))
  const frameNow = (await frame.boundingBox())!
  await dragPointer(page, corner, {
    x: frameNow.x + frameNow.width * 0.8,
    y: frameNow.y + frameNow.height * 0.7,
  })
  await expect(scale).toHaveValue('2.5')
  await expect(centreX).toHaveValue('0.6')

  // Each gesture was one undo step.
  await page.keyboard.press('Control+z')
  await expect(scale).toHaveValue('2')
  await expect(centreX).toHaveValue('0.6')
  await page.keyboard.press('Control+z')
  await expect(centreX).toHaveValue('0.5')

  // Escape closes the editor.
  await editor.getByRole('button', { name: 'Close the Zoom 1 editor' }).focus()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
})

test('scrubbing shows the motion, snapping and the keys commit exact numbers, and Show result draws the zoom (#421)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await chooseEffect(page, position, 'Zoom')
  await fillField(page, `Zoom 1 scale of ${position}`, '2')
  await fillField(page, `Zoom 1 centre X of ${position} (0 to 1)`, '0.6')
  await fillField(page, `Zoom 1 centre Y of ${position} (0 to 1)`, '0.6')

  await page.getByRole('button', { name: `Adjust Zoom 1 of ${position} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust Zoom 1 of ${position}` })
  const frame = editor.getByTestId('frame-editor-frame')
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  const region = editor.getByTestId('frame-editor-rect')
  const regionWidth = () => region.evaluate((node) => Number(node.getAttribute('width')))
  const frameBox = (await frame.boundingBox())!

  // The new controls lie inside the panel that holds them, at the default
  // width — the rendered evidence the criteria ask for.
  const slider = editor.getByRole('slider', {
    name: `Preview time of Zoom 1 of ${position} in seconds`,
  })
  const showResult = editor.getByRole('checkbox', { name: 'Show result' })
  await expectWithin(slider, editor, { what: 'the scrub slider' })
  await expectWithin(showResult, editor, { what: 'the Show result toggle' })
  await expectNoHorizontalScroll(page, 'the zoom editor with its scrub row')

  // Scrub: the default zoom's envelope is 0 → 2 s, holding from 0.5 to 1.5.
  await expect(slider).toHaveValue('1')
  const heldWidth = await regionWidth()
  expect(Math.abs(heldWidth - frameBox.width * 0.5)).toBeLessThan(1)

  // Half way through the ramp-in the region is strictly between the whole
  // frame and what it holds — the motion, without playing anything.
  await slider.fill('0.25')
  await expect(editor.getByText(/part-way through a ramp/)).toBeVisible()
  const rampWidth = await regionWidth()
  expect(
    rampWidth,
    `mid-ramp region ${rampWidth}px is not wider than the held ${heldWidth}px`,
  ).toBeGreaterThan(heldWidth + 1)
  expect(
    rampWidth,
    `mid-ramp region ${rampWidth}px is not narrower than the whole ${frameBox.width}px frame`,
  ).toBeLessThan(frameBox.width - 1)
  // A still really was drawn for the new instant, not the old one reused.
  await expect(editor.getByTestId('frame-editor-updating')).toHaveCount(0)
  await region.scrollIntoViewIfNeeded()
  await editor.screenshot({ path: testInfo.outputPath('zoom-editor-mid-ramp.png') })

  // Back into the hold, where the region takes drags again.
  await slider.fill('1')
  expect(Math.abs((await regionWidth()) - heldWidth)).toBeLessThan(1)

  // A drag landing near the frame centre snaps onto it exactly. From (0.6,
  // 0.6) a nine-hundredths move lands on 0.51 — inside the 0.02 snap zone.
  const centreX = page.getByRole('spinbutton', { name: `Zoom 1 centre X of ${position} (0 to 1)` })
  const centreY = page.getByRole('spinbutton', { name: `Zoom 1 centre Y of ${position} (0 to 1)` })
  const start = await centreOf(region)
  const target = { x: start.x - frameBox.width * 0.09, y: start.y - frameBox.height * 0.09 }
  // Paused mid-drag, so the guides are on screen for the screenshot: they
  // belong to the gesture and vanish on release.
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  // `toBeAttached`, not `toBeVisible`: a guide is an SVG line, so its box is
  // one axis wide and Playwright reads a zero-area box as hidden. Its
  // coordinate is the real assertion — the guide is drawn where the centre
  // snapped to, half way across the frame.
  const guideX = editor.getByTestId('frame-editor-guide-x')
  const guideY = editor.getByTestId('frame-editor-guide-y')
  await expect(guideX).toBeAttached()
  await expect(guideY).toBeAttached()
  expect(
    Math.abs((await guideX.evaluate((node) => Number(node.getAttribute('x1')))) - frameBox.width * 0.5),
  ).toBeLessThan(1)
  expect(
    Math.abs(
      (await guideY.evaluate((node) => Number(node.getAttribute('y1')))) - frameBox.height * 0.5,
    ),
  ).toBeLessThan(1)
  await editor.screenshot({ path: testInfo.outputPath('zoom-editor-snapped.png') })
  await page.mouse.up()
  await expect(centreX).toHaveValue('0.5')
  await expect(centreY).toHaveValue('0.5')
  await expect(guideX).toHaveCount(0)

  // The same drag with Alt held is left where it was dragged to.
  await fillField(page, `Zoom 1 centre X of ${position} (0 to 1)`, '0.6')
  await fillField(page, `Zoom 1 centre Y of ${position} (0 to 1)`, '0.6')
  const startAgain = await centreOf(region)
  await page.keyboard.down('Alt')
  await dragPointer(page, startAgain, {
    x: startAgain.x - frameBox.width * 0.09,
    y: startAgain.y - frameBox.height * 0.09,
  })
  await page.keyboard.up('Alt')
  await expect(centreX).toHaveValue('0.51')
  await expect(centreY).toHaveValue('0.51')

  // One arrow key, one hundredth of the frame, one undo step.
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect(centreX).toHaveValue('0.52')
  await page.keyboard.press('Control+z')
  await expect(centreX).toHaveValue('0.51')

  // Show result draws the frame the viewer gets: the zoom is applied, so
  // there is no region to draw over it and nothing to drag.
  await showResult.check()
  await expect(region).toHaveCount(0)
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  await expect
    .poll(() =>
      editor.getByTestId('frame-editor-image').evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBeGreaterThan(0)
  await editor.screenshot({ path: testInfo.outputPath('zoom-editor-result.png') })
  await showResult.uncheck()
  await expect(region).toBeVisible()
})

test('the scrub row and result toggle fit the editor at 800px too (#421)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1100 })
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await chooseEffect(page, position, 'Zoom')
  await page.getByRole('button', { name: `Adjust Zoom 1 of ${position} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust Zoom 1 of ${position}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()

  const slider = editor.getByRole('slider', {
    name: `Preview time of Zoom 1 of ${position} in seconds`,
  })
  const showResult = editor.getByRole('checkbox', { name: 'Show result' })
  await expectWithin(slider, editor, { what: 'the scrub slider at 800px' })
  await expectWithin(showResult, editor, { what: 'the Show result toggle at 800px' })
  await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
    axis: 'x',
    what: 'the zoom editor at 800px',
  })
  await expectNoHorizontalScroll(page, 'the zoom editor scrub row at 800px')
  // The reading beside the slider is fixed-width so the toggle does not
  // step sideways as the slider moves; it must not wrap to do that.
  const reading = editor.getByRole('status', { name: 'Zoom 1 preview time (live)' })
  expect(
    await reading.evaluate((node) => node.scrollWidth <= node.clientWidth),
    'the scrub reading overflows its own box',
  ).toBe(true)
})

test('the editor fits the timeline panel at the narrow width too, and the setting hides it (#413)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 1100 })
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await chooseEffect(page, position, 'Zoom')
  const adjust = page.getByRole('button', { name: `Adjust Zoom 1 of ${position} visually` })
  await adjust.click()
  const editor = page.getByRole('dialog', { name: `Adjust Zoom 1 of ${position}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
    axis: 'x',
    what: 'zoom editor at 800px',
  })
  await expectNoHorizontalScroll(page, 'zoom editor open at 800px')

  // Visual editors Off: the button is gone, the open editor with it.
  await chooseFromFileMenu(page, 'Settings…')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByLabel('Visual editors').selectOption('off')
  await settings.getByRole('button', { name: 'Close' }).click()
  await expect(adjust).toHaveCount(0)
  await expect(editor).toHaveCount(0)
})
