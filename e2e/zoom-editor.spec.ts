import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { chooseFromFileMenu } from './fileMenu'

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
  await page.getByRole('button', { name: `Add zoom to ${position}` }).click()
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

test('the editor fits the timeline panel at the narrow width too, and the setting hides it (#413)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 1100 })
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await page.getByRole('button', { name: `Add zoom to ${position}` }).click()
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
