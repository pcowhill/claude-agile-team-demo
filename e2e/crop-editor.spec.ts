import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The visual crop editor (#423, from #402's design D4 / #396) in real
 * Chromium. What only a real browser can show: a pointer drag over a really
 * laid-out picture committing the percent the row's fields then read, the
 * dimmed margins actually covering the fractions the crop names, and the
 * rendered evidence for the new surface — the panel inside the timeline at
 * both widths with no sideways page scroll, plus a screenshot re-taken every
 * run.
 */

/** A real PNG with distinct quadrants, so the still is not flat. */
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

const position = 'base.png at position 1'

const cropField = (page: Page, edge: string) =>
  page.getByRole('spinbutton', { name: `Crop ${edge} of ${position} (percent)` })

const valueOf = async (locator: Locator) => Number(await locator.inputValue())

/**
 * A crop field's value, polled rather than read once.
 *
 * `page.keyboard.press` and `page.mouse.up` resolve when the event is
 * dispatched, not when React has committed the render it causes, so a bare
 * `inputValue()` immediately afterwards can read the pre-edit DOM. That is a
 * race the machine wins about half the time under a parallel suite and
 * almost never alone, which is exactly the shape of flake this suite must
 * not ship — measured at 2 failures in 5 repeats with `--workers=2` before
 * this, and 0 in 20 after.
 */
const expectField = (page: Page, edge: string) =>
  expect.poll(async () => valueOf(cropField(page, edge)), {
    message: `crop ${edge} of ${position}`,
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

/** A single image entry with its Picture disclosure open and the editor showing. */
async function openEditor(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add base.png to timeline' }).click()
  await openPicture(page, position)
  await page.getByRole('button', { name: `Adjust the crop of ${position} visually` }).click()

  const editor = page.getByRole('dialog', { name: `Adjust the crop of ${position}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  // `page.mouse` works in viewport coordinates, so the panel has to be on
  // screen before a drag can land on it — the overlay editor's spec (#422)
  // learned this the hard way.
  await editor.scrollIntoViewIfNeeded()
  return editor
}

test('a drag commits the percent the fields read, Shift trims both edges, and one undo takes it back (#423)', async ({
  page,
}, testInfo) => {
  const editor = await openEditor(page)
  const region = editor.getByTestId('frame-editor-rect')
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!

  // Nothing trimmed: the kept region is the whole picture, which is what
  // says the still shows the source rather than the composed frame — a
  // composed frame would letterbox this 16:9 source into whatever shape the
  // project's own frame has.
  // Two pixels of tolerance, and the reason is the region's own outline:
  // `.frame-editor-rect` is stroked 2px wide and a bounding box is
  // stroke-inclusive, so a rectangle exactly on the frame measures one pixel
  // proud on each side. Measured, not guessed — it reads exactly 2.
  const whole = (await region.boundingBox())!
  expect(Math.abs(whole.width - frameBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(whole.height - frameBox.height)).toBeLessThanOrEqual(2)

  // The west edge dragged in by a known fraction of the frame: 25 % of the
  // laid-out width has to arrive as 25 in the field, within the one percent
  // the issue allows for a real pointer.
  await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-edge-w')), {
    x: frameBox.x + frameBox.width * 0.25,
    y: frameBox.y + frameBox.height / 2,
  })
  await expectField(page, 'left').toBeCloseTo(25, -0.5)
  // Only that edge: an edge handle holds the opposite one fixed.
  await expect(cropField(page, 'right')).toHaveValue('0')
  await expect(cropField(page, 'top')).toHaveValue('0')
  await expect(cropField(page, 'bottom')).toHaveValue('0')

  // One gesture, one undo step, though the drag fired eight moves.
  await page.keyboard.press('Control+z')
  await expect(cropField(page, 'left')).toHaveValue('0')

  // Shift trims the opposite edge as far, so the kept region stays centred.
  await dragPointer(
    page,
    await centreOf(editor.getByTestId('frame-editor-edge-w')),
    { x: frameBox.x + frameBox.width * 0.2, y: frameBox.y + frameBox.height / 2 },
    'Shift',
  )
  // Both edges in one poll, so the two are read from the same render.
  await expect
    .poll(async () => ({
      left: await valueOf(cropField(page, 'left')),
      right: await valueOf(cropField(page, 'right')),
    }))
    .toEqual({ left: 20, right: 20 })
  await page.keyboard.press('Control+z')
  await expect(cropField(page, 'left')).toHaveValue('0')

  // The dimmed margins are the crop: whatever the fields say is trimmed is
  // what the shade covers, which no jsdom test can see. A quarter off the
  // left and a fifth off the bottom, then measured against the frame.
  await cropField(page, 'left').fill('25')
  await cropField(page, 'left').press('Enter')
  await cropField(page, 'bottom').fill('20')
  await cropField(page, 'bottom').press('Enter')
  const kept = (await region.boundingBox())!
  expect(Math.abs(kept.x - (frameBox.x + frameBox.width * 0.25))).toBeLessThanOrEqual(2)
  expect(Math.abs(kept.width - frameBox.width * 0.75)).toBeLessThanOrEqual(2)
  expect(Math.abs(kept.height - frameBox.height * 0.8)).toBeLessThanOrEqual(2)
  expect(Math.abs(kept.y - frameBox.y)).toBeLessThanOrEqual(2)

  await editor.screenshot({ path: testInfo.outputPath('crop-editor.png') })

  // Keyboard: one nudge, one undo step, and the region pans rather than
  // resizing — the two edges of an axis move together. It needs somewhere to
  // pan to: with nothing trimmed off the right the region is already flush
  // there and the nudge is correctly a no-op, which is how this first read.
  await cropField(page, 'right').fill('15')
  await cropField(page, 'right').press('Enter')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expectField(page, 'left').toBe(26)
  await expectField(page, 'right').toBe(14)
  await page.keyboard.press('Control+z')
  await expectField(page, 'left').toBe(25)
  await expectField(page, 'right').toBe(15)

  // And held against the border it commits nothing rather than an empty
  // undo step: the region above, panned right until it is flush.
  await cropField(page, 'right').fill('0')
  await cropField(page, 'right').press('Enter')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expectField(page, 'left').toBe(25)
  await page.keyboard.press('Control+z')
  await expectField(page, 'right').toBe(15)
})

test('Alt gives finer values than the whole-percent snap, and Reset clears the crop (#423)', async ({
  page,
}) => {
  const editor = await openEditor(page)
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!
  const edge = editor.getByTestId('frame-editor-edge-w')

  // A pointer landing between two whole percents: snapped it reads a whole
  // number, and Alt keeps the fraction the field can still show.
  const target = { x: frameBox.x + frameBox.width * 0.303, y: frameBox.y + frameBox.height / 2 }
  await dragPointer(page, await centreOf(edge), target)
  await expect.poll(async () => valueOf(cropField(page, 'left'))).toBeGreaterThan(0)
  const snapped = await valueOf(cropField(page, 'left'))
  expect(snapped, `snapped to ${snapped}%`).toBe(Math.round(snapped))
  await page.keyboard.press('Control+z')

  await dragPointer(page, await centreOf(edge), target, 'Alt')
  await expect.poll(async () => valueOf(cropField(page, 'left'))).toBeGreaterThan(0)
  const fine = await valueOf(cropField(page, 'left'))
  expect(Math.abs(fine - snapped)).toBeLessThan(1)
  expect(fine, `Alt-held drag still landed on the whole percent ${fine}%`).not.toBe(
    Math.round(fine),
  )

  // Reset in the panel does what the row's own Reset does.
  const reset = editor.getByRole('button', { name: `Reset crop of ${position} in the editor` })
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(cropField(page, 'left')).toHaveValue('0')
  await expect(reset).toBeDisabled()
})

test("an overlay is cropped on its own source, not inside its placement rectangle (#423)", async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add base.png to timeline' }).click()
  // A **square** source, deliberately: it is what makes this measurable.
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([
      { name: 'cam.png', mimeType: 'image/png', buffer: await makePng(page, 240, 240) },
    ])
  await chooseClipAction(page, 'cam.png', 'Add as overlay')

  const overlay = 'overlay cam.png at position 1'
  await openPicture(page, overlay)
  await page.getByRole('button', { name: `Adjust the crop of ${overlay} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust the crop of ${overlay}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  await editor.scrollIntoViewIfNeeded()

  // The frame is square, so the picture being trimmed is the overlay's own
  // 240×240 source rather than the 16:9 composition it sits in. This is the
  // whole of the decision the module header argues for, and it is the one
  // assertion that can tell the two apart: composed, this overlay would be a
  // third of a 16:9 frame with its own picture letterboxed inside even that.
  const frameBox = (await editor.getByTestId('frame-editor-frame').boundingBox())!
  expect(
    frameBox.width / frameBox.height,
    `the crop frame is ${frameBox.width}×${frameBox.height}, not the square source's shape`,
  ).toBeCloseTo(1, 1)

  // And it crops: the west edge dragged to a fifth across.
  await dragPointer(page, await centreOf(editor.getByTestId('frame-editor-edge-w')), {
    x: frameBox.x + frameBox.width * 0.2,
    y: frameBox.y + frameBox.height / 2,
  })
  await expect
    .poll(
      async () =>
        Number(
          await page
            .getByRole('spinbutton', { name: `Crop left of ${overlay} (percent)` })
            .inputValue(),
        ),
      { message: `crop left of ${overlay}` },
    )
    .toBeCloseTo(20, -0.5)
  await editor.screenshot({ path: testInfo.outputPath('crop-editor-overlay.png') })
})

test('the crop editor fits the timeline panel at both widths (#423)', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const editor = await openEditor(page)
    const label = `the crop editor at ${viewport.width}px`

    await expectWithin(editor.getByTestId('frame-editor-frame'), editor, {
      what: `the frame in ${label}`,
    })
    await expectWithin(editor, page.getByRole('region', { name: 'Timeline' }), {
      axis: 'x',
      what: label,
    })
    await expectNoHorizontalScroll(page, label)

    // An uncropped element's kept region *is* the whole frame, so its
    // handles start centred on the frame's own border and half of each
    // strip falls outside the SVG box — the property #413 has had for
    // corners and #422 recorded for edges, except that here it is the
    // opening state rather than an edge case. So both halves are measured:
    // enough of each handle survives to be grabbable at the flush default,
    // and once anything is trimmed they lie inside entirely.
    const frame = editor.getByTestId('frame-editor-frame')
    const frameBox = (await frame.boundingBox())!
    for (const edge of ['n', 'e', 's', 'w']) {
      const box = (await editor.getByTestId(`frame-editor-edge-${edge}`).boundingBox())!
      const inside =
        edge === 'n'
          ? box.y + box.height - frameBox.y
          : edge === 's'
            ? frameBox.y + frameBox.height - box.y
            : edge === 'w'
              ? box.x + box.width - frameBox.x
              : frameBox.x + frameBox.width - box.x
      expect(
        inside,
        `only ${inside}px of the flush ${edge} handle is inside the frame at ${viewport.width}px`,
      ).toBeGreaterThanOrEqual(3)
    }

    await cropField(page, 'left').fill('10')
    await cropField(page, 'left').press('Enter')
    await cropField(page, 'right').fill('10')
    await cropField(page, 'right').press('Enter')
    await cropField(page, 'top').fill('10')
    await cropField(page, 'top').press('Enter')
    await cropField(page, 'bottom').fill('10')
    await cropField(page, 'bottom').press('Enter')
    for (const edge of ['n', 'e', 's', 'w']) {
      await expectWithin(editor.getByTestId(`frame-editor-edge-${edge}`), frame, {
        what: `the ${edge} handle on a trimmed region at ${viewport.width}px`,
      })
    }
    // No corner handles: a crop offers one control per stored value.
    await expect(editor.getByTestId('frame-editor-corner-nw')).toHaveCount(0)

    // The four readouts stay on one line rather than wrapping into the
    // frame above them.
    const readout = editor.locator('.effect-editor-readout')
    expect(
      await readout.evaluate((node) => node.scrollWidth <= node.clientWidth),
      `the crop readout overflows its own box at ${viewport.width}px`,
    ).toBe(true)
  }
})
