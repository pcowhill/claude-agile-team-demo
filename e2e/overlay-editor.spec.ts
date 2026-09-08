import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual overlay placement editor (#422, from #402's design D4 / #396)
 * in real Chromium. What only a real browser can show: a pointer drag over a
 * really laid-out frame committing the numbers the row's fields then read,
 * an edge handle changing one dimension and leaving the other alone, a drag
 * into the corner landing flush, and the rendered evidence for the new
 * surface — the panel inside the timeline at both widths with no sideways
 * page scroll, plus screenshots re-taken every run.
 */

/** A real 16:9 PNG (320×180) with distinct quadrants, so the still is not flat. */
async function makePng(page: Page, width = 320, height = 180): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#c33'
      ctx.fillRect(0, 0, width / 2, height / 2)
      ctx.fillStyle = '#3c3'
      ctx.fillRect(width / 2, 0, width / 2, height / 2)
      ctx.fillStyle = '#33c'
      ctx.fillRect(0, height / 2, width / 2, height / 2)
      ctx.fillStyle = '#cc3'
      ctx.fillRect(width / 2, height / 2, width / 2, height / 2)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { width, height },
  )
  return Buffer.from(base64, 'base64')
}

const position = 'overlay cam.png at position 1'

const field = (page: Page, name: string) => page.getByRole('spinbutton', { name })
const left = (page: Page) => field(page, `Left edge of ${position} (fraction of frame width)`)
const top = (page: Page) => field(page, `Top edge of ${position} (fraction of frame height)`)
const boxWidth = (page: Page) => field(page, `Width of ${position} (fraction of frame width)`)
const boxHeight = (page: Page) => field(page, `Height of ${position} (fraction of frame height)`)

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

/** A base entry with a square still overlaid on it, and the editor opened. */
async function openEditor(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add base.png to timeline' }).click()
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([
      { name: 'cam.png', mimeType: 'image/png', buffer: await makePng(page, 240, 240) },
    ])
  await chooseClipAction(page, 'cam.png', 'Add as overlay')
  await expect(left(page)).toHaveValue('0.62')

  await page.getByRole('button', { name: `Adjust the placement of ${position} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust the placement of ${position}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  // Two clips deep, the panel opens below the fold, and `page.mouse` works
  // in viewport coordinates: an un-scrolled drag lands on nothing at all and
  // commits nothing — which is exactly how this spec first failed.
  await editor.scrollIntoViewIfNeeded()
  return editor
}

test('a drag commits the placement the fields read, an edge changes one dimension, and a corner drag lands flush (#422)', async ({
  page,
}, testInfo) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!

  // The rectangle is drawn where the fields say — a real layout, not a
  // fraction the DOM merely records.
  const drawn = (await region.boundingBox())!
  expect((drawn.x - frameBox.x) / frameBox.width).toBeCloseTo(0.62, 2)
  expect(drawn.width / frameBox.width).toBeCloseTo(0.35, 2)

  // A drag by a known offset: 0.2 of the frame left and up, well clear of
  // any snap zone, commits within a hundredth — the precision a placement is
  // stored and shown at.
  const start = await centreOf(region)
  await dragPointer(page, start, {
    x: start.x - frameBox.width * 0.2,
    y: start.y - frameBox.height * 0.2,
  })
  expect(Math.abs(Number(await left(page).inputValue()) - 0.42)).toBeLessThan(0.005)
  expect(Math.abs(Number(await top(page).inputValue()) - 0.42)).toBeLessThan(0.005)
  // A move is not a resize.
  await expect(boxWidth(page)).toHaveValue('0.35')
  await expect(boxHeight(page)).toHaveValue('0.35')

  // One gesture, one undo step, though the drag fired eight moves.
  await page.keyboard.press('Control+z')
  await expect(left(page)).toHaveValue('0.62')

  // An edge handle changes its own dimension and nothing else — the thing a
  // centre-fixed resize (the zoom's) cannot express.
  await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-edge-w')), {
    x: frameBox.x + frameBox.width * 0.42,
    y: (await centreOf(region)).y,
  })
  expect(Math.abs(Number(await boxWidth(page).inputValue()) - 0.55)).toBeLessThan(0.02)
  await expect(boxHeight(page)).toHaveValue('0.35')
  await expect(top(page)).toHaveValue('0.62')

  await page.keyboard.press('Control+z')
  await expect(boxWidth(page)).toHaveValue('0.35')

  // Dragged towards the top-left corner, it snaps flush: exactly 0 on both
  // axes, which no hand-aimed drag would land on.
  const beforeSnap = await centreOf(region)
  await dragPointer(page, beforeSnap, { x: frameBox.x + 4, y: frameBox.y + 4 })
  await expect(left(page)).toHaveValue('0')
  await expect(top(page)).toHaveValue('0')

  // Paused mid-drag so the guides are on screen for the screenshot: they
  // belong to the gesture and vanish on release.
  const parked = await centreOf(region)
  await page.mouse.move(parked.x, parked.y)
  await page.mouse.down()
  await page.mouse.move(parked.x + frameBox.width * 0.315, parked.y + frameBox.height * 0.315, {
    steps: 6,
  })
  const guideX = editor.getByTestId('frame-editor-guide-x')
  // `toBeAttached`, not `toBeVisible`: an SVG line's box is one axis wide and
  // Playwright reads a zero-area box as hidden. Its coordinate is the real
  // assertion — the guide is drawn where the centre snapped to.
  await expect(guideX).toBeAttached()
  expect(
    Math.abs(
      (await guideX.evaluate((node) => Number(node.getAttribute('x1')))) - frameBox.width * 0.5,
    ),
  ).toBeLessThan(1)
  await editor.screenshot({ path: testInfo.outputPath('overlay-editor-snapped.png') })
  await page.mouse.up()
  await expect(guideX).toHaveCount(0)
  // The centre landed on the middle of the frame — as near as a 0.35-wide
  // box can, which is 0.505: `x = 0.325` is what an exact centring needs and
  // a placement is stored to the hundredth its own field can express
  // (`RECT_EPSILON`). The guide above is drawn for exactly this reason.
  await expect(left(page)).toHaveValue('0.33')
  expect(
    Math.abs(
      Number(await left(page).inputValue()) +
        Number(await boxWidth(page).inputValue()) / 2 -
        0.5,
    ),
  ).toBeLessThanOrEqual(0.005 + 1e-9)

  // Keyboard: one nudge, one undo step.
  await region.focus()
  await page.keyboard.press('ArrowRight')
  const nudged = Number(await left(page).inputValue())
  await page.keyboard.press('Control+z')
  expect(Number(await left(page).inputValue())).toBeCloseTo(nudged - 0.01, 2)
})

test('Shift on a corner keeps the proportions, and the mask silhouette is drawn (#422)', async ({
  page,
}, testInfo) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!

  // A small, plainly non-square box in the top-left, so the se corner has
  // room to be dragged *outwards* and a broken lock is unmistakable.
  for (const [box, value] of [
    [left(page), '0.2'],
    [top(page), '0.2'],
    [boxWidth(page), '0.3'],
    [boxHeight(page), '0.2'],
  ] as const) {
    await box.fill(value)
    await box.press('Enter')
    await expect(box).toHaveValue(value)
  }
  const ratio = 0.3 / 0.2

  // The south-east corner dragged out with Shift held: the height follows
  // the width through the ratio rather than following the pointer, which is
  // being dragged well below where the ratio would put it.
  const corner = await centreOf(editor.getByTestId('frame-editor-corner-se'))
  await dragPointer(
    page,
    corner,
    { x: frameBox.x + frameBox.width * 0.8, y: frameBox.y + frameBox.height * 0.95 },
    'Shift',
  )
  const width = Number(await boxWidth(page).inputValue())
  const height = Number(await boxHeight(page).inputValue())
  expect(width).toBeGreaterThan(0.3)
  // The pointer asked for a height of 0.75; the ratio gave it 0.4.
  expect(height).toBeLessThan(0.6)
  expect(
    width / height,
    `a Shift-held corner drag left a ${width} × ${height} box, ratio ${width / height}`,
  ).toBeCloseTo(ratio, 1)

  // The mask (#266) makes the placed silhouette an ellipse, and a plain
  // rectangle would say the wrong thing about where the picture lands.
  await openPicture(page, position)
  await editor.scrollIntoViewIfNeeded()
  expect(await editor.getByTestId('frame-editor-silhouette').count()).toBe(0)
  await page.getByRole('combobox', { name: `Shape mask of ${position}` }).selectOption('ellipse')
  const silhouette = editor.getByTestId('frame-editor-silhouette')
  await expect(silhouette).toHaveAttribute('data-shape', 'ellipse')
  // Inscribed in the rectangle the region draws, to a pixel. Both boxes are
  // re-measured after the disclosure opened and the panel was scrolled.
  const scrolledFrame = (await editor.getByTestId('frame-editor-frame').boundingBox())!
  const drawn = (await region.boundingBox())!
  const measured = await silhouette.evaluate((node) => ({
    cx: Number(node.getAttribute('cx')),
    rx: Number(node.getAttribute('rx')),
  }))
  expect(Math.abs(measured.rx - drawn.width / 2)).toBeLessThan(1)
  expect(Math.abs(measured.cx - (drawn.x - scrolledFrame.x + drawn.width / 2))).toBeLessThan(1)
  await editor.screenshot({ path: testInfo.outputPath('overlay-editor-ellipse.png') })
})

test('the placement editor fits the timeline panel at both widths (#422)', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const editor = await openEditor(page)
    const label = `the placement editor at ${viewport.width}px`

    await expectWithin(editor.getByTestId('frame-editor-frame'), editor, {
      what: `the frame in ${label}`,
    })
    await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
      axis: 'x',
      what: label,
    })
    await expectNoHorizontalScroll(page, label)

    // Every handle lies inside the frame it belongs to: an edge strip drawn
    // outside would be unreachable, and the corners are the primary targets.
    for (const handle of ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w']) {
      await expectWithin(
        editor.getByTestId(`frame-editor-${handle.length === 1 ? 'edge' : 'corner'}-${handle}`),
        editor.getByTestId('frame-editor-frame'),
        { what: `the ${handle} handle at ${viewport.width}px` },
      )
    }

    // The four readouts stay on one line rather than wrapping into the
    // frame above them.
    const readout = editor.locator('.effect-editor-readout')
    expect(
      await readout.evaluate((node) => node.scrollWidth <= node.clientWidth),
      `the placement readout overflows its own box at ${viewport.width}px`,
    ).toBe(true)
  }
})
