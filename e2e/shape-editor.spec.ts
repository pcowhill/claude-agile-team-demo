import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SHAPES, ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The shape editor, part 1 (#685, from the approved design #681 §3): draw,
 * select, move and resize a shape group's shapes on a still of the frame.
 * Every result is read back from the row's own fields, because the fields
 * and the editor are two views of one value.
 *
 * **Runs in Chromium and Firefox** (#685's criterion). Two habits keep it
 * honest in both:
 * - Every point a drag aims at is computed from the **frame's** box and a
 *   fraction, never from an SVG element's box. Firefox's SVG boxes include
 *   the stroke and round to its layout grid (#598), so a handle's box is
 *   not where it is drawn.
 * - Every read-back allows a hundredth, because Firefox drags in whole
 *   pixels (#648) and the editor stores hundredths. The frame is at least
 *   about 400 px wide here, so one pixel is under 0.003 of it.
 */

const group = (index = 1) => `shape group at position ${index}`
const shapeName = (kind: string, index: number, groupIndex = 1) =>
  `${kind} ${index} of ${group(groupIndex)}`

const field = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })

async function setField(page: Page, name: string, value: string): Promise<void> {
  const box = field(page, name)
  await box.fill(value)
  await box.blur()
  await expect(box).toHaveValue(value)
}

/** A box shape's four fields, read in one go so they come from one render. */
async function boxOf(page: Page, name: string) {
  const read = async (label: string) => Number(await field(page, `${label} of ${name}${label === 'Width' ? ' (fraction of frame width)' : label === 'Height' ? ' (fraction of frame height)' : ' (0 to 1)'}`).inputValue())
  return {
    x: await read('Left edge'),
    y: await read('Top edge'),
    width: await read('Width'),
    height: await read('Height'),
  }
}

async function arrowOf(page: Page, name: string) {
  const read = async (label: string) => Number(await field(page, `${label} of ${name} (0 to 1)`).inputValue())
  return {
    tailX: await read('Tail x'),
    tailY: await read('Tail y'),
    tipX: await read('Tip x'),
    tipY: await read('Tip y'),
  }
}

/** Every number in `actual` within `tolerance` of `expected`'s. */
function near(actual: Record<string, number>, expected: Record<string, number>, tolerance = 0.011) {
  return Object.entries(expected).every(([key, value]) => Math.abs(actual[key] - value) <= tolerance)
}

/**
 * Polls `read` until `ok` holds of what it returns, all fields from one read
 * (quality-and-ci.md). On failure the message is the last value read.
 */
async function expectRead<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<void> {
  await expect
    .poll(async () => {
      const value = await read()
      return ok(value) ? 'ok' : JSON.stringify(value)
    })
    .toBe('ok')
}

async function drag(
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

/**
 * A populated project (development.md): a 3 s blue slate, a text overlay,
 * and one shape group whose default ellipse is moved off the centre so the
 * centre is free to draw on. The editor is opened and scrolled into view,
 * since `page.mouse` works in viewport coordinates.
 */
async function openEditor(page: Page) {
  await buildProject(page)
  return openFor(page, 1)
}

async function buildProject(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', '3')
  await page.getByLabel('Color of Color slate at position 1').fill('#0000cc')
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseFromAddMenu(page, ADD_SHAPES)
  const ellipse = shapeName('Ellipse', 1)
  await setField(page, `Left edge of ${ellipse} (0 to 1)`, '0.75')
  await setField(page, `Top edge of ${ellipse} (0 to 1)`, '0.6')
  await setField(page, `Width of ${ellipse} (fraction of frame width)`, '0.15')
  await setField(page, `Height of ${ellipse} (fraction of frame height)`, '0.2')
}

async function openFor(page: Page, groupIndex: number) {
  await page.getByRole('button', { name: `Draw the shapes of ${group(groupIndex)} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Draw the shapes of ${group(groupIndex)}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  await editor.scrollIntoViewIfNeeded()
  /**
   * A frame fraction as a viewport point, measured afresh: each drawn shape
   * adds its fields to the row above the editor, which can move the frame.
   */
  const at = async (x: number, y: number) => {
    await editor.getByTestId('frame-editor-frame').scrollIntoViewIfNeeded()
    const frame = (await editor.getByTestId('frame-editor-frame').boundingBox())!
    return { x: frame.x + frame.width * x, y: frame.y + frame.height * y }
  }
  return { editor, at }
}

const tool = (editor: Locator, name: string) =>
  editor.getByRole('toolbar').getByRole('button', { name: `${name} tool`, exact: true })

test('drawing a rectangle, a Shift-square ellipse and an arrow, then moving a shape, each reads back in the row (#685)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)

  // A rectangle, corner to corner, clear of every guide.
  await tool(editor, 'Rectangle').click()
  await drag(page, await at(0.1, 0.1), await at(0.28, 0.42))
  const rectangle = shapeName('Rectangle', 2)
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.1, y: 0.1, width: 0.18, height: 0.32 }))
  // The tool went back to Select after one shape.
  await expect(tool(editor, 'Select')).toHaveAttribute('aria-pressed', 'true')

  // An ellipse with Shift: as wide as it is tall in output pixels. The
  // still is the output frame, so its natural size is that frame.
  const output = await editor
    .getByTestId('frame-editor-image')
    .evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  await tool(editor, 'Ellipse').click()
  await drag(page, await at(0.45, 0.12), await at(0.58, 0.5), 'Shift')
  const circle = shapeName('Ellipse', 3)
  await expect(field(page, `Width of ${circle} (fraction of frame width)`)).toBeVisible()
  const drawn = await boxOf(page, circle)
  // The editor stores hundredths, so a square is exact to half a hundredth
  // of the frame's width (`squareError` in shapeEditor.ts), plus the
  // field's own rounding of each side: one hundredth of the width in all.
  expect(
    Math.abs(drawn.width * output.width - drawn.height * output.height),
    `${JSON.stringify(drawn)} at ${output.width}×${output.height}`,
  ).toBeLessThanOrEqual(0.01 * output.width)
  expect(drawn.height).toBeGreaterThan(0.3)

  // An arrow, tail to tip.
  await tool(editor, 'Arrow').click()
  await drag(page, await at(0.1, 0.7), await at(0.4, 0.86), 'Alt')
  const arrow = shapeName('Arrow', 4)
  await expectRead(() => arrowOf(page, arrow), (ends) => near(ends, { tailX: 0.1, tailY: 0.7, tipX: 0.4, tipY: 0.86 }))

  // Move the rectangle by dragging its body: 0.1 right and 0.05 down.
  await drag(page, await at(0.19, 0.26), await at(0.29, 0.31), 'Alt')
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.2, y: 0.15, width: 0.18, height: 0.32 }))
})

test('a corner handle moves two edges, an edge handle one, an arrow end handle only that end, and each drag is one undo step (#685)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  await tool(editor, 'Rectangle').click()
  await drag(page, await at(0.1, 0.1), await at(0.28, 0.42))
  const rectangle = shapeName('Rectangle', 2)
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.1, y: 0.1, width: 0.18, height: 0.32 }))
  // Drawn shapes are selected, so their handles are up.
  await expect(editor.getByTestId('shape-editor-corner-se')).toBeVisible()

  // The south-east corner: right and bottom edges only.
  await drag(page, await at(0.28, 0.42), await at(0.38, 0.5), 'Alt')
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.1, y: 0.1, width: 0.28, height: 0.4 }))

  // One undo takes the whole drag back, though it fired eight moves.
  await page.keyboard.press('Control+z')
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.1, y: 0.1, width: 0.18, height: 0.32 }))
  // And the next undo removes the rectangle itself: the draw was one step.
  await page.keyboard.press('Control+z')
  await expect(field(page, `Width of ${rectangle} (fraction of frame width)`)).toHaveCount(0)
  await page.keyboard.press('Control+y')
  await expect(field(page, `Width of ${rectangle} (fraction of frame width)`)).toBeVisible()

  // Select it again and pull the west edge: only the left edge moves.
  await drag(page, await at(0.19, 0.26), await at(0.19, 0.26))
  await expect(editor.getByTestId('shape-editor-edge-w')).toBeVisible()
  await drag(page, await at(0.1, 0.26), await at(0.05, 0.4), 'Alt')
  await expectRead(() => boxOf(page, rectangle), (box) => near(box, { x: 0.05, y: 0.1, width: 0.23, height: 0.32 }))

  // An arrow, then its tip handle dragged: the tail stays put.
  await tool(editor, 'Arrow').click()
  await drag(page, await at(0.45, 0.75), await at(0.7, 0.75), 'Alt')
  const arrow = shapeName('Arrow', 3)
  await expectRead(() => arrowOf(page, arrow), (ends) => near(ends, { tailX: 0.45, tailY: 0.75, tipX: 0.7, tipY: 0.75 }))
  await drag(page, await at(0.7, 0.75), await at(0.62, 0.9), 'Alt')
  await expectRead(() => arrowOf(page, arrow), (ends) => near(ends, { tailX: 0.45, tailY: 0.75, tipX: 0.62, tipY: 0.9 }))
})

test('a moved shape snaps its centre to the middle of the frame, Alt bypasses it, and keys act on the selection (#685)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  const ellipse = shapeName('Ellipse', 1)
  // The ellipse spans x 0.75–0.9: its centre is at 0.825. Dragged left by
  // 0.315 it would centre on 0.51, inside the 0.02 snap of the middle.
  await drag(page, await at(0.825, 0.7), await at(0.51, 0.7))
  await expectRead(() => boxOf(page, ellipse), (box) =>
    Math.abs(box.x + box.width / 2 - 0.5) <= 0.005 + 1e-9,
  )
  await page.keyboard.press('Control+z')
  await expect(field(page, `Left edge of ${ellipse} (0 to 1)`)).toHaveValue('0.75')
  // The same drag with Alt lands where the pointer let go.
  await drag(page, await at(0.825, 0.7), await at(0.51, 0.7), 'Alt')
  await expectRead(() => boxOf(page, ellipse), (box) =>
    Math.abs(box.x + box.width / 2 - 0.51) <= 0.006,
  )

  // The press focused the layer, so keys reach the selected shape (#662).
  const before = await boxOf(page, ellipse)
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await boxOf(page, ellipse)).x)
    .toBeCloseTo(before.x + 0.01, 5)
  await page.keyboard.press('+')
  await expect
    .poll(async () => (await boxOf(page, ellipse)).width)
    .toBeCloseTo(before.width + 0.02, 5)
  await expect(editor.getByTestId('shape-editor-layer')).toBeFocused()
})

test('another group showing at the same instant is drawn dashed and cannot be selected (#685)', async ({
  page,
}) => {
  await buildProject(page)
  // A second group over the same window, its ellipse left at the centre.
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group(2)} in seconds`, '0')
  const { editor, at } = await openFor(page, 1)
  await expect(editor.getByTestId('shape-editor-other')).toHaveCount(1)
  await expect(editor.getByTestId('shape-editor-shape-0')).toHaveAttribute('aria-label', shapeName('Ellipse', 1))
  // A click on the other group's ellipse selects nothing.
  await drag(page, await at(0.5, 0.5), await at(0.5, 0.5))
  await expect(editor.getByTestId('shape-editor-selection')).toHaveCount(0)
  // A click on this group's own ellipse does.
  await drag(page, await at(0.825, 0.7), await at(0.825, 0.7))
  await expect(editor.getByTestId('shape-editor-selection')).toHaveCount(1)
})

for (const width of [1280, 360]) {
  test(`the open shape editor stays inside its row at ${width}px (#685)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const { editor, at } = await openEditor(page)
    // Three shapes, as the screenshot criterion asks: the ellipse, a
    // rectangle and an arrow.
    await tool(editor, 'Rectangle').click()
    await drag(page, await at(0.1, 0.1), await at(0.3, 0.4), 'Alt')
    await tool(editor, 'Arrow').click()
    await drag(page, await at(0.35, 0.8), await at(0.72, 0.68), 'Alt')
    const row = page.getByRole('list', { name: 'Shape groups' }).locator('> li').first()
    await expectWithin(editor, row, { axis: 'x', what: 'the shape editor' })
    await expectWithin(editor.getByTestId('frame-editor-frame'), row, { axis: 'x', what: 'the picture' })
    // Each tool, not the strip: a strip whose buttons overflow it keeps its
    // own box (measured, with the strip forced not to wrap).
    for (const name of ['Select', 'Rectangle', 'Ellipse', 'Arrow']) {
      await expectWithin(tool(editor, name), editor, { axis: 'x', what: `the ${name} tool` })
    }
    // The canvas the shapes are drawn on covers the picture exactly.
    await expectWithin(editor.getByTestId('shape-editor-canvas'), editor.getByTestId('frame-editor-frame'), {
      what: 'the shape canvas',
    })
    await expectNoHorizontalScroll(page, 'with the shape editor open')
    if (width === 1280) {
      await editor.screenshot({ path: testInfo.outputPath(`shape-editor-${width}.png`) })
    }
  })
}
