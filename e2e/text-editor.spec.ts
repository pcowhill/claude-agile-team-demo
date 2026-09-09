import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual text overlay editor (#424, from #402's design D4 / #396) in
 * real Chromium. What only a real browser can show: the block's box drawn
 * around text that a real canvas measured and a real canvas drew, a pointer
 * drag over a really laid-out frame committing the centre the row's fields
 * then read, the still re-rendered with the text where the box now is, and
 * the rendered evidence for the new surface — the panel inside the timeline
 * at both widths with no sideways page scroll, plus a screenshot re-taken
 * every run.
 */

const position = 'text overlay at position 1'

const field = (page: Page, name: string) => page.getByRole('spinbutton', { name })
const centreX = (page: Page) => field(page, `Centre X of ${position} (0 to 1)`)
const centreY = (page: Page) => field(page, `Centre Y of ${position} (0 to 1)`)
const sizeField = (page: Page) => field(page, `Size of ${position} (fraction of frame height)`)

const valueOf = async (locator: Locator) => Number(await locator.inputValue())

/**
 * A field's value, polled rather than read once: a driver's press or release
 * resolves on dispatch, not on React's commit, so a bare read straight after
 * a gesture can see the previous render (#449).
 */
const expectField = (locator: Locator, what: string) =>
  expect.poll(async () => valueOf(locator), { message: what })

const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: 'Alt',
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

/** A 5 s red slate and the default white 'Title' over it, editor open. */
async function openEditor(page: Page, canvas?: '1:1') {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  if (canvas !== undefined) {
    await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption(canvas)
  }
  await chooseFromAddMenu(page, ADD_TEXT)
  await page.getByRole('button', { name: `Adjust the placement of ${position} visually` }).click()

  const editor = page.getByRole('dialog', { name: `Adjust the placement of ${position}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  // The still's own pixel size is what the block is measured at; wait for
  // that measurement rather than the fallback's, which the image's load
  // reports a tick after it appears.
  await expect(editor.getByTestId('frame-editor-updating')).toHaveCount(0)
  await editor.scrollIntoViewIfNeeded()
  return editor
}

/** The region's box as fractions of the frame's, from real layout. */
async function regionFraction(editor: Locator) {
  const frame = (await editor.getByTestId('frame-editor-frame').boundingBox())!
  const rect = (await editor.getByTestId('frame-editor-rect').boundingBox())!
  return {
    x: (rect.x - frame.x) / frame.width,
    y: (rect.y - frame.y) / frame.height,
    width: rect.width / frame.width,
    height: rect.height / frame.height,
    frame,
    rect,
  }
}

/**
 * How much of the still's bright ink lies inside a fractional box: the text
 * is white on a red slate, so "the box is on the text" is a countable
 * property of the picture rather than a trusted attribute. A one-percent
 * margin around the box absorbs the region's own 2px stroke and glyph
 * overhang beyond the advance width.
 */
async function brightInside(
  editor: Locator,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ inside: number; total: number }> {
  return editor.getByTestId('frame-editor-image').evaluate(async (node, box) => {
    const img = node as HTMLImageElement
    if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }))
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(img, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const margin = 0.01
    const left = (box.x - margin) * canvas.width
    const right = (box.x + box.width + margin) * canvas.width
    const top = (box.y - margin) * canvas.height
    const bottom = (box.y + box.height + margin) * canvas.height
    let inside = 0
    let total = 0
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4
        if (data[offset] > 200 && data[offset + 1] > 200 && data[offset + 2] > 200) {
          total++
          if (x >= left && x <= right && y >= top && y <= bottom) inside++
        }
      }
    }
    return { inside, total }
  }, box)
}

test('the box is on the drawn text, a drag commits the centre the fields read, the still follows, and one undo takes it back (#424)', async ({
  page,
}, testInfo) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')

  // The block is centred on the default (0.5, 0.5) and one line height tall
  // (0.08 × 1.2 of the frame). Its width is whatever Chromium's Arial makes
  // of 'Title' — measured, not assumed — so it is checked against the ink.
  const before = await regionFraction(editor)
  expect(before.x + before.width / 2).toBeCloseTo(0.5, 2)
  expect(before.y + before.height / 2).toBeCloseTo(0.5, 2)
  expect(Math.abs(before.rect.height - before.frame.height * 0.096)).toBeLessThanOrEqual(2)
  const ink = await brightInside(editor, before)
  expect(ink.total, 'the still has white text on it').toBeGreaterThan(50)
  expect(ink.inside / ink.total, `${ink.inside} of ${ink.total} bright pixels inside the box`).toBeGreaterThanOrEqual(0.98)
  // And the box is not merely huge: it is under a fifth of the frame wide.
  expect(before.width).toBeLessThan(0.2)

  // A drag by a known offset — 0.2 of the frame left and 0.1 up, to (0.3,
  // 0.4), which is more than the 0.02 tolerance from every third and from
  // the middle (0.35 would have snapped to the lower third, and did, in
  // this spec's first draft) — commits within 0.005, the precision a centre
  // is stored at.
  const start = await centreOf(region)
  await dragPointer(page, start, {
    x: start.x - before.frame.width * 0.2,
    y: start.y - before.frame.height * 0.1,
  })
  await expectField(centreX(page), 'centre X').toBeCloseTo(0.3, 2)
  await expectField(centreY(page), 'centre Y').toBeCloseTo(0.4, 2)
  expect(Math.abs((await valueOf(centreX(page))) - 0.3)).toBeLessThan(0.005)
  expect(Math.abs((await valueOf(centreY(page))) - 0.4)).toBeLessThan(0.005)
  // A move is not a resize.
  await expect(sizeField(page)).toHaveValue('0.08')

  // The box moved by the drag, and the still was re-rendered with the text
  // in its new place: the same ink test passes against the new box. The
  // re-render is awaited through the editor's own indicator.
  await expect(editor.getByTestId('frame-editor-updating')).toHaveCount(0)
  const after = await regionFraction(editor)
  expect(after.x - before.x).toBeCloseTo(-0.2, 2)
  expect(after.y - before.y).toBeCloseTo(-0.1, 2)
  await expect
    .poll(async () => {
      const moved = await brightInside(editor, after)
      return moved.total > 50 ? moved.inside / moved.total : 0
    }, { message: 'the re-rendered still has its text inside the moved box' })
    .toBeGreaterThanOrEqual(0.98)

  await editor.screenshot({ path: testInfo.outputPath('text-editor.png') })

  // One gesture, one undo step, though the drag fired eight moves.
  await page.keyboard.press('Control+z')
  await expect(centreX(page)).toHaveValue('0.5')
  await expect(centreY(page)).toHaveValue('0.5')

  // The corner handle scales the block about its centre: pulled to twice its
  // distance from the centre, the size doubles, and the centre stays.
  const corner = await centreOf(editor.getByTestId('frame-editor-corner-se'))
  const centre = await centreOf(region)
  await dragPointer(page, corner, {
    x: centre.x + (corner.x - centre.x) * 2,
    y: centre.y + (corner.y - centre.y) * 2,
  })
  await expectField(sizeField(page), 'size').toBeCloseTo(0.16, 2)
  await expect(centreX(page)).toHaveValue('0.5')
  const grown = await regionFraction(editor)
  expect(Math.abs(grown.rect.height - grown.frame.height * 0.192)).toBeLessThanOrEqual(2)
  await page.keyboard.press('Control+z')
  await expect(sizeField(page)).toHaveValue('0.08')

  // Keyboard: one nudge, one undo step.
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect(centreX(page)).toHaveValue('0.51')
  await page.keyboard.press('Control+z')
  await expect(centreX(page)).toHaveValue('0.5')
})

test('the text editor fits the timeline panel at both widths (#424)', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const editor = await openEditor(page)
    const label = `the text editor at ${viewport.width}px`
    const frame = editor.getByTestId('frame-editor-frame')

    await expectWithin(frame, editor, { what: `the frame in ${label}` })
    await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
      axis: 'x',
      what: label,
    })
    await expectNoHorizontalScroll(page, label)

    // The one handle, inside the frame; no edges and no other corners.
    await expectWithin(editor.getByTestId('frame-editor-corner-se'), frame, {
      what: `the corner handle in ${label}`,
    })
    await expect(editor.locator('[data-testid^="frame-editor-corner-"]')).toHaveCount(1)
    await expect(editor.locator('[data-testid^="frame-editor-edge-"]')).toHaveCount(0)

    // The readout stays on one line rather than wrapping into the frame.
    const readout = editor.locator('.effect-editor-readout')
    expect(
      await readout.evaluate((node) => node.scrollWidth <= node.clientWidth),
      `the text readout overflows its own box at ${viewport.width}px`,
    ).toBe(true)
  }
})

test('on a square canvas the box is measured at the still’s own size, not at the 16:9 fallback (#424)', async ({
  page,
}) => {
  // The block is measured at a 16:9 guess until the still has loaded and
  // reported its real size. On a square frame that guess is wrong by 9/16 —
  // the text's width is the same number of pixels over a frame that is
  // narrower for its height — so a box still measured at the fallback would
  // be barely half as wide as the ink. The ink test tells the two apart.
  const editor = await openEditor(page, '1:1')
  const box = await regionFraction(editor)
  expect(box.frame.width / box.frame.height, 'the still is square').toBeCloseTo(1, 1)
  const ink = await brightInside(editor, box)
  expect(ink.total, 'the still has white text on it').toBeGreaterThan(50)
  expect(ink.inside / ink.total, `${ink.inside} of ${ink.total} bright pixels inside the box`).toBeGreaterThanOrEqual(0.98)
  // Wider, as a fraction of a square frame, than the same title on a 16:9
  // one — the whole reason the real size has to be used.
  expect(box.width).toBeGreaterThan(0.1)
})
