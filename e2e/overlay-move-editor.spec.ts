import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Overlay visual editor on an overlay with Moves (#835, from #829). The
 * project is populated: a 4 s red slate, a 16:9 still overlay at the default
 * placement (0.62, 0.62, 0.35 × 0.35), and two Moves keeping that size:
 *
 * - Move 1 glides 0.5 → 1.5 s to (0.05, 0.05);
 * - Move 2 glides 2.5 → 3.5 s to (0.6, 0.05).
 *
 * The editor opens at its window's middle and is scrubbed to 1 s, inside
 * Move 1's glide. There the editable box must be Move 1's destination, not
 * the in-flight placement, and a drag must change Move 1's fields.
 *
 * **Tolerance: 1 px on each edge** for the box. It is an SVG rect whose
 * geometry is the stored fraction times the frame's laid-out size, so the
 * honest error is sub-pixel rounding. One pixel is the tolerance
 * `overlay-move.spec.ts` uses for the same placement in the preview.
 */

const POSITION = 'overlay halves.png at position 1'
const SLATE_SECONDS = 4
const MOVE_1 = { x: 0.05, y: 0.05, width: 0.35, height: 0.35 }
const TOLERANCE_PX = 1

/** A 320×180 PNG: left half green, right half blue. */
async function makeHalvesPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(0, 205, 0)'
    ctx.fillRect(0, 0, 160, 180)
    ctx.fillStyle = 'rgb(0, 0, 230)'
    ctx.fillRect(160, 0, 160, 180)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

const moveField = (page: Page, n: number, what: 'start' | 'left edge' | 'top edge') =>
  page.getByRole('spinbutton', {
    name:
      what === 'start'
        ? `Move ${n} start of ${POSITION} in seconds`
        : `Move ${n} ${what} of ${POSITION} (percent of frame ${what === 'left edge' ? 'width' : 'height'})`,
  })

async function setField(field: Locator, value: string) {
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** The populated project above, with the editor open and in view. */
async function openEditorWithMoves(page: Page): Promise<Locator> {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(
    page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' }),
    String(SLATE_SECONDS),
  )
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'halves.png', mimeType: 'image/png', buffer: await makeHalvesPng(page) }])
  await chooseClipAction(page, 'halves.png', 'Add as overlay')
  await chooseEffect(page, POSITION, 'Move')
  await setField(moveField(page, 1, 'start'), '0.5')
  await setField(moveField(page, 1, 'left edge'), String(MOVE_1.x * 100))
  await setField(moveField(page, 1, 'top edge'), String(MOVE_1.y * 100))
  await chooseEffect(page, POSITION, 'Move')
  await setField(moveField(page, 2, 'start'), '2.5')
  await setField(moveField(page, 2, 'left edge'), '60')

  await page.getByRole('button', { name: `Adjust the placement of ${POSITION} visually` }).click()
  const editor = page.getByRole('dialog', { name: `Adjust the placement of ${POSITION}` })
  await expect(editor.getByTestId('frame-editor-image')).toBeVisible()
  await editor.scrollIntoViewIfNeeded()
  return editor
}

/** The editable box's largest edge error against `rect` on the frame, in px, from one page read. */
function boxErrorPx(editor: Locator, rect: typeof MOVE_1): Promise<number> {
  return editor.evaluate((node, want) => {
    const frame = node.querySelector('[data-testid="frame-editor-frame"]')!.getBoundingClientRect()
    const region = node.querySelector('[data-testid="frame-editor-rect"]')!
    // The rect's geometry, not its bounding box: no stroke, in any browser.
    const read = (name: string) => Number(region.getAttribute(name))
    return Math.max(
      Math.abs(read('x') - want.x * frame.width),
      Math.abs(read('y') - want.y * frame.height),
      Math.abs(read('width') - want.width * frame.width),
      Math.abs(read('height') - want.height * frame.height),
    )
  }, rect)
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  test(`at ${viewport.width}px, inside Move 1's glide the editor edits Move 1's destination and says so (#835)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const editor = await openEditorWithMoves(page)
    const what = `at ${viewport.width}px`
    const slider = editor.getByRole('slider', { name: `Preview time of ${POSITION} in seconds` })
    const line = editor.getByTestId('overlay-editor-editing')

    await slider.fill('1')
    await expect(line).toHaveText('Editing: after Move 1')
    // Polled: the box follows the slider's input on the next render.
    await expect
      .poll(() => boxErrorPx(editor, MOVE_1), { message: `Move 1's box ${what}, in px` })
      .toBeLessThanOrEqual(TOLERANCE_PX)

    // The line sits in the editor, on one line, and the page stays put.
    await expectWithin(line, editor, { what: `the Editing line in the editor ${what}` })
    await expectNoWrap(line, `Editing line ${what}`)
    await expectNoHorizontalScroll(page, `with the overlay editor scrubbed ${what}`)
    await editor.screenshot({ path: testInfo.outputPath(`move-editor-${viewport.width}.png`) })

    // A drag there, 0.2 of the frame right and down with Alt (no guides),
    // changes Move 1's destination and leaves its start alone.
    const frame = (await editor.getByTestId('frame-editor-frame').boundingBox())!
    const box = (await editor.getByTestId('frame-editor-rect').boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(from.x + (frame.width * 0.2 * step) / 8, from.y + (frame.height * 0.2 * step) / 8)
    }
    await page.mouse.up()
    await page.keyboard.up('Alt')
    // Polled: a release resolves on dispatch, not on React's commit (#449).
    for (const [field, want] of [
      [moveField(page, 1, 'left edge'), MOVE_1.x + 0.2],
      [moveField(page, 1, 'top edge'), MOVE_1.y + 0.2],
    ] as const) {
      // The fields read percent (#892). Within half a percent: a placement
      // is stored to a hundredth of the frame.
      await expect.poll(async () => Number(await field.inputValue())).toBeCloseTo(want * 100, 0)
    }
    await expect(moveField(page, 1, 'start')).toHaveValue('0.5')
    await expect(moveField(page, 2, 'left edge')).toHaveValue('60')
    await expect(
      page.getByRole('spinbutton', { name: `Left edge of ${POSITION} (percent of frame width)`, exact: true }),
    ).toHaveValue('62')
  })
}
