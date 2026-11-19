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

// Part 2 (#686): the selection, the style bar, order, keys and the result.
const SELECTION = `the selected shapes of ${group()}`
const selectedShapes = (editor: Locator) => editor.locator('[data-selected="true"]')
const shapeRows = (page: Page) =>
  page.getByRole('list', { name: `Shapes in ${group()}` }).getByRole('listitem')

async function click(page: Page, point: { x: number; y: number }, shift = false) {
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(point.x, point.y)
  if (shift) await page.keyboard.up('Shift')
}

/**
 * The editor's still, sampled at frame fractions, as the export composed it
 * (the still is `snapshotTimelineFrame`, the export's own composer). Read in
 * one evaluate, so every sample comes from one image. `dx` is a further
 * offset in the still's own pixels, applied in that same evaluate, so a
 * point "10 px inside" needs no second read of the width — which could be a
 * different image (#733).
 *
 * A still the Preview slider is replacing has no pixels yet: its
 * `naturalWidth` is 0, and sampling it threw `getImageData … Value is
 * infinite` straight out of the caller's `expect.poll` (#733). It reports
 * width 0 and colours of -1 instead, which no caller's condition accepts,
 * so the poll reads again once the new still has loaded.
 */
async function sampleStill(editor: Locator, points: { x: number; y: number; dx?: number }[]) {
  return editor.getByTestId('frame-editor-image').evaluate((element: HTMLImageElement, at) => {
    if (!element.complete || element.naturalWidth === 0 || element.naturalHeight === 0) {
      return { width: 0, height: 0, colours: at.map(() => ({ r: -1, g: -1, b: -1 })) }
    }
    const canvas = document.createElement('canvas')
    canvas.width = element.naturalWidth
    canvas.height = element.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(element, 0, 0)
    return {
      width: canvas.width,
      height: canvas.height,
      colours: at.map(({ x, y, dx = 0 }) => {
        const [r, g, b] = ctx.getImageData(
          Math.floor(x * canvas.width + dx),
          Math.floor(y * canvas.height),
          1,
          1,
        ).data
        return { r, g, b }
      }),
    }
  }, points)
}

test('three ellipses restyled together from the style bar, and one undo restores all three (#686)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  await tool(editor, 'Ellipse').dblclick()
  await drag(page, await at(0.1, 0.1), await at(0.25, 0.35), 'Alt')
  await expect(field(page, `Width of ${shapeName('Ellipse', 2)} (fraction of frame width)`)).toBeVisible()
  await drag(page, await at(0.35, 0.1), await at(0.5, 0.35), 'Alt')
  await expect(field(page, `Width of ${shapeName('Ellipse', 3)} (fraction of frame width)`)).toBeVisible()
  await tool(editor, 'Select').click()

  // A click, then two Shift-clicks: three selected.
  await click(page, await at(0.825, 0.7))
  await click(page, await at(0.175, 0.225), true)
  await click(page, await at(0.425, 0.225), true)
  await expect(selectedShapes(editor)).toHaveCount(3)

  await editor.getByLabel(`Border colour of ${SELECTION}`).fill('#00ff00')
  for (const index of [1, 2, 3]) {
    await expect(page.getByLabel(`Border colour of ${shapeName('Ellipse', index)}`)).toHaveValue('#00ff00')
  }
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  for (const index of [1, 2, 3]) {
    await expect(page.getByLabel(`Border colour of ${shapeName('Ellipse', index)}`)).toHaveValue('#e53935')
  }
})

test('the Highlighter preset gives a selected rectangle no border and a 35 % yellow fill (#686)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  await tool(editor, 'Rectangle').click()
  await drag(page, await at(0.1, 0.1), await at(0.4, 0.2), 'Alt')
  const rectangle = shapeName('Rectangle', 2)
  await expect(selectedShapes(editor)).toHaveCount(1)
  await editor.getByRole('button', { name: 'Highlighter' }).click()
  await expect(field(page, `Border thickness of ${rectangle} in pixels`)).toHaveValue('0')
  await expect(page.getByLabel(`Fill colour of ${rectangle}`)).toHaveValue('#ffff00')
  await expect(field(page, `Fill opacity of ${rectangle} (percent)`)).toHaveValue('35')
})

test('Send backward and Bring forward change which filled shape a composed pixel shows where two overlap (#686)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  await tool(editor, 'Rectangle').dblclick()
  await drag(page, await at(0.1, 0.1), await at(0.4, 0.4), 'Alt')
  await expect(field(page, `Width of ${shapeName('Rectangle', 2)} (fraction of frame width)`)).toBeVisible()
  await drag(page, await at(0.25, 0.25), await at(0.55, 0.55), 'Alt')
  await expect(field(page, `Width of ${shapeName('Rectangle', 3)} (fraction of frame width)`)).toBeVisible()
  await tool(editor, 'Select').click()
  // The earlier one red, the later (on top) one green, both opaque.
  for (const [index, colour] of [
    [2, '#ff0000'],
    [3, '#00ff00'],
  ] as const) {
    await page.getByLabel(`Fill colour of ${shapeName('Rectangle', index)}`).fill(colour)
    await setField(page, `Fill opacity of ${shapeName('Rectangle', index)} (percent)`, '100')
  }
  const overlap = { x: 0.33, y: 0.33 }
  const result = editor.getByRole('checkbox', { name: 'Show result' })
  const overlapColour = () => sampleStill(editor, [overlap]).then((read) => read.colours[0])
  const isRed = (c: { r: number; g: number; b: number }) => c.r > 200 && c.g < 60
  const isGreen = (c: { r: number; g: number; b: number }) => c.g > 200 && c.r < 60

  await result.check()
  await expect.poll(async () => isGreen(await overlapColour()), { message: 'the later rectangle on top' }).toBe(true)

  // Select the green one alone (its own corner) and send it backward.
  await result.uncheck()
  await click(page, await at(0.5, 0.5))
  await expect(selectedShapes(editor)).toHaveCount(1)
  await editor.getByRole('button', { name: 'Send backward' }).click()
  await expect(page.getByLabel(`Fill colour of ${shapeName('Rectangle', 2)}`)).toHaveValue('#00ff00')
  await result.check()
  await expect.poll(async () => isRed(await overlapColour()), { message: 'red on top after Send backward' }).toBe(true)

  // And forward again.
  await result.uncheck()
  await editor.getByRole('button', { name: 'Bring forward' }).click()
  await expect(page.getByLabel(`Fill colour of ${shapeName('Rectangle', 3)}`)).toHaveValue('#00ff00')
  await result.check()
  await expect.poll(async () => isGreen(await overlapColour()), { message: 'green on top after Bring forward' }).toBe(true)
})

test('Delete and Ctrl+D act only while the picture has the focus, and Ctrl+D is never the browser’s (#686)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  // Whether the last D key-down was claimed, read after React has had it.
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'd') (window as unknown as { claimed: boolean }).claimed = event.defaultPrevented
    })
  })
  const claimed = () => page.evaluate(() => (window as unknown as { claimed?: boolean }).claimed)

  await click(page, await at(0.825, 0.7))
  await expect(editor.getByTestId('shape-editor-layer')).toBeFocused()
  await page.keyboard.press('Control+d')
  await expect(shapeRows(page)).toHaveCount(2)
  expect(await claimed()).toBe(true)
  // The copy is selected, 0.02 down and right of the original.
  await expectRead(() => boxOf(page, shapeName('Ellipse', 2)), (box) => near(box, { x: 0.77, y: 0.62 }, 0.001))
  await page.keyboard.press('Delete')
  await expect(shapeRows(page)).toHaveCount(1)

  // With a text field focused, neither key is the editor's.
  const left = field(page, `Left edge of ${shapeName('Ellipse', 1)} (0 to 1)`)
  await left.focus()
  await page.keyboard.press('Control+d')
  expect(await claimed()).toBe(false)
  await page.keyboard.press('Delete')
  await left.blur()
  await expect(shapeRows(page)).toHaveCount(1)
})

test('the Preview slider moves the picture under the shapes, and Show result inside the fade-in draws the group faded (#686)', async ({
  page,
}) => {
  await page.goto('./')
  // A blue slate then a green one, and one group across both, fading in
  // over its first 2 s.
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', '3')
  await page.getByLabel('Color of Color slate at position 1').fill('#0000cc')
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 2 in seconds', '3')
  await page.getByLabel('Color of Color slate at position 2').fill('#00cc00')
  await chooseFromAddMenu(page, ADD_SHAPES)
  await setField(page, `Start time of ${group()} in seconds`, '0')
  await setField(page, `Duration of ${group()} in seconds`, '6')
  await setField(page, `Fade-in of ${group()} in seconds`, '2')
  const ellipse = shapeName('Ellipse', 1)
  await setField(page, `Left edge of ${ellipse} (0 to 1)`, '0.1')
  await setField(page, `Top edge of ${ellipse} (0 to 1)`, '0.2')
  await setField(page, `Width of ${ellipse} (fraction of frame width)`, '0.4')
  await setField(page, `Height of ${ellipse} (fraction of frame height)`, '0.4')
  await setField(page, `Border thickness of ${ellipse} in pixels`, '30')
  const { editor } = await openFor(page, 1)

  const slider = editor.getByRole('slider', { name: `Preview time of ${group()} in seconds` })
  await expect(slider).toHaveAttribute('min', '0')
  await expect(slider).toHaveAttribute('max', '6')
  const background = { x: 0.8, y: 0.15 }
  const backgroundAt = async (time: string) => {
    await slider.fill(time)
    await expect(editor.getByRole('status', { name: `${group()} preview time (live)` })).toHaveText(
      `${Number(time).toFixed(2)} s`,
    )
  }
  await backgroundAt('1')
  await expect.poll(async () => (await sampleStill(editor, [background])).colours[0].b).toBeGreaterThan(150)
  await backgroundAt('4.5')
  await expect.poll(async () => (await sampleStill(editor, [background])).colours[0].g).toBeGreaterThan(150)

  // Show result at 1 s, half way through the 2 s fade-in: a point on the
  // ellipse's left border, 10 px inside its box, lies between the slate's
  // blue (0, 0, 204) and the border's red (229, 57, 53).
  await backgroundAt('1')
  await editor.getByRole('checkbox', { name: 'Show result' }).check()
  const onBorder = async () =>
    (await sampleStill(editor, [{ x: 0.1, y: 0.4, dx: 10 }])).colours[0]
  await expect
    .poll(async () => {
      const c = await onBorder()
      return c.r > 60 && c.r < 190 && c.b > 50 && c.b < 180 ? 'between' : JSON.stringify(c)
    }, { message: 'the faded border at 1 s' })
    .toBe('between')
  // At 2.5 s the fade is over: the same point is the border's own red.
  await backgroundAt('2.5')
  await expect
    .poll(async () => {
      const c = await onBorder()
      return c.r > 200 && c.b < 90 ? 'red' : JSON.stringify(c)
    }, { message: 'the full border at 2.5 s' })
    .toBe('red')
})

test('the Badge tool places a numbered badge where clicked, and a placed badge moves by dragging (#689)', async ({
  page,
}) => {
  const { editor, at } = await openEditor(page)
  const centreOf = async (name: string) => ({
    x: Number(await field(page, `Centre X of ${name} (0 to 1)`).inputValue()),
    y: Number(await field(page, `Centre Y of ${name} (0 to 1)`).inputValue()),
  })
  // Two clicks, with the tool kept by a double-click, away from every guide
  // (the thirds, the middle and the edges) so nothing snaps. The stated
  // tolerance is `near`'s hundredth of the frame: Firefox clicks in whole
  // pixels and the editor stores hundredths.
  await tool(editor, 'Badge').dblclick()
  const first = await at(0.22, 0.42)
  await page.mouse.click(first.x, first.y)
  const second = await at(0.6, 0.15)
  await page.mouse.click(second.x, second.y)
  const one = shapeName('Badge', 2)
  const two = shapeName('Badge', 3)
  await expectRead(() => centreOf(one), (centre) => near(centre, { x: 0.22, y: 0.42 }))
  await expectRead(() => centreOf(two), (centre) => near(centre, { x: 0.6, y: 0.15 }))
  await expect(field(page, `Number of ${one}`)).toHaveValue('1')
  await expect(field(page, `Number of ${two}`)).toHaveValue('2')

  // With Select, dragging the first badge by its body moves its centre.
  await tool(editor, 'Select').click()
  await drag(page, await at(0.22, 0.42), await at(0.12, 0.55), 'Alt')
  await expectRead(() => centreOf(one), (centre) => near(centre, { x: 0.12, y: 0.55 }))
  // One undo puts it back: the move was one edit.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expectRead(() => centreOf(one), (centre) => near(centre, { x: 0.22, y: 0.42 }))
})

for (const width of [1280, 360]) {
  test(`the open shape editor, its style bar and Preview row stay inside its row at ${width}px (#685, #686)`, async ({ page }, testInfo) => {
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
    for (const name of ['Select', 'Rectangle', 'Ellipse', 'Arrow', 'Badge']) {
      await expectWithin(tool(editor, name), editor, { axis: 'x', what: `the ${name} tool` })
    }
    // The canvas the shapes are drawn on covers the picture exactly.
    await expectWithin(editor.getByTestId('shape-editor-canvas'), editor.getByTestId('frame-editor-frame'), {
      what: 'the shape canvas',
    })
    // A mixed selection (#686): the rectangle in another border colour,
    // with the ellipse added by Shift-click, so the bar reads "mixed".
    await page.getByLabel(`Border colour of ${shapeName('Rectangle', 2)}`).fill('#00aaff')
    await click(page, await at(0.2, 0.25))
    await click(page, await at(0.825, 0.7), true)
    await expect(selectedShapes(editor)).toHaveCount(2)
    await expect(editor.getByLabel(`Border colour of ${SELECTION}`)).toHaveAttribute('data-mixed', 'true')
    // Every control of the style bar and the Preview row, each on its own:
    // a wrapping row whose items overflow it keeps its own box.
    const controls = editor.locator(
      '[data-testid="shape-editor-style"] :is(input, select, button), .effect-editor-scrub :is(input, output, label, button)',
    )
    expect(await controls.count()).toBeGreaterThan(15)
    for (const [index, control] of (await controls.all()).entries()) {
      await expectWithin(control, editor, { axis: 'x', what: `style or preview control ${index}` })
    }
    await expectNoHorizontalScroll(page, 'with the shape editor open')
    await editor.screenshot({ path: testInfo.outputPath(`shape-editor-${width}.png`) })
  })
}
