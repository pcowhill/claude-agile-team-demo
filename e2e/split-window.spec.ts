import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectAlignedRow, expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Split… on a sequence entry (#825), in a real browser: the point dragged on
 * the strip with a mouse and the picture following it, Apply leaving two
 * rows that meet at the point (Split at playhead's razor, #190) as one undo
 * step, Play carrying the point along, and the window's geometry at
 * 1280×720 and 360px.
 *
 * The clip is `fixtures/trim-clip.webm` (6.008 s of 320×180 VP8 at 30 fps
 * with an Opus tone), the Trim window's own fixture.
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`
const SECOND = `${CLIP} at position 2`

async function addClip(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })).toBeVisible()
}

async function openSplit(page: Page) {
  await page.getByRole('button', { name: `Split ${ENTRY} in the Split window` }).click()
  const dialog = page.getByRole('dialog', { name: `Split ${ENTRY}` })
  await expect(dialog).toBeVisible()
  // The preview has its first frame, so its clock is the clip's.
  await expect
    .poll(() => dialog.getByTestId('split-video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

/** The split point and the picture's clock, read together: one page read. */
const pointAndPicture = (dialog: Locator) =>
  dialog.evaluate((node) => ({
    point: Number(node.querySelector('[data-testid="split-point"]')!.getAttribute('aria-valuenow')),
    picture: (node.querySelector('[data-testid="split-video"]') as HTMLVideoElement).currentTime,
  }))

/** The four trim fields of the two halves, from one page read. */
const halves = (page: Page) =>
  page.evaluate(
    ([first, second]) => {
      const value = (name: string) =>
        Number((document.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement | null)?.value ?? NaN)
      return {
        firstIn: value(`Trim in point of ${first} in seconds`),
        firstOut: value(`Trim out point of ${first} in seconds`),
        secondIn: value(`Trim in point of ${second} in seconds`),
        secondOut: value(`Trim out point of ${second} in seconds`),
      }
    },
    [ENTRY, SECOND],
  )

test('a drag on the strip moves the split point and the picture; Apply leaves two rows that meet there, and one Undo restores the clip (#825)', async ({
  page,
}) => {
  await addClip(page)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
  const dialog = await openSplit(page)
  // Opens at the middle of the clip.
  await expect.poll(async () => (await pointAndPicture(dialog)).point).toBeCloseTo(3.004, 2)

  // Press a quarter of the way along the strip and drag to a third.
  const strip = (await dialog.getByTestId('split-strip').boundingBox())!
  const y = strip.y + strip.height / 2
  await page.mouse.move(strip.x + strip.width * 0.25, y)
  await page.mouse.down()
  await page.mouse.move(strip.x + strip.width / 3, y, { steps: 4 })
  await page.mouse.up()
  // The point is near 2 s, and the picture shows the frame it falls at.
  await expect
    .poll(async () => {
      const { point, picture } = await pointAndPicture(dialog)
      return Math.abs(point - 2) < 0.1 && Math.abs(picture - point) < 0.05
    })
    .toBe(true)
  const { point } = await pointAndPicture(dialog)

  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${SECOND} in seconds` })).toBeVisible()
  // The halves meet at the point (the fields show it to the hundredth),
  // the first from the clip's start, the second to its end.
  await expect
    .poll(async () => {
      const fields = await halves(page)
      return (
        fields.firstIn === 0 &&
        fields.firstOut === fields.secondIn &&
        Math.abs(fields.firstOut - point) <= 0.005 &&
        fields.secondOut > 5.9
      )
    })
    .toBe(true)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${SECOND} in seconds` })).toHaveCount(0)
  await expect
    .poll(async () => (await halves(page)).firstOut)
    .toBeGreaterThan(5.9)
})

test('the arrows move the split point; Space plays on from it and pauses; Escape closes without splitting (#825)', async ({
  page,
}) => {
  await addClip(page)
  const dialog = await openSplit(page)
  const start = (await pointAndPicture(dialog)).point
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await pointAndPicture(dialog)).point).toBeCloseTo(start - 1, 3)

  await page.keyboard.press('Space')
  await expect(dialog.getByRole('button', { name: 'Pause' })).toBeVisible()
  // The point follows the picture while it plays.
  await expect.poll(async () => (await pointAndPicture(dialog)).point).toBeGreaterThan(start - 1 + 0.3)
  await page.keyboard.press('Space')
  await expect(dialog.getByRole('button', { name: 'Play from the split point' })).toBeVisible()
  // Paused, the point is where the picture stopped.
  await expect
    .poll(async () => {
      const { point, picture } = await pointAndPicture(dialog)
      return Math.abs(point - picture) < 0.05
    })
    .toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${SECOND} in seconds` })).toHaveCount(0)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the Split window fits a ${viewport.width}px window, and Split… sits on one line beside Trim… (#825)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await addClip(page)
    const what = `at ${viewport.width}px`
    // The row's buttons: inside the row, each on one line, Trim… and Split…
    // side by side at one height.
    const row = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()
    const split = row.getByRole('button', { name: `Split ${ENTRY} in the Split window` })
    await expectWithin(split, row, { what: `the row's Split… ${what}` })
    const pair = row.locator('.timeline-trim-open')
    await expect(pair).toHaveCount(2)
    await expectNoWrap(pair, `the row's Trim… / Split… ${what}`)
    await expectAlignedRow(pair, `Trim… and Split… ${what}`)
    await expectNoHorizontalScroll(page, `with Split… on the row ${what}`)

    const dialog = await openSplit(page)
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
    // The window inside the viewport, on all four edges.
    const box = (await dialog.boundingBox())!
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    expect(box.x, `the Split window's left ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `the Split window's right ${what}`).toBeLessThanOrEqual(view.width)
    expect(box.y, `the Split window's top ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `the Split window's bottom ${what}`).toBeLessThanOrEqual(view.height)
    // Its parts inside it.
    await expectWithin(dialog.getByTestId('split-strip'), dialog, { what: `the strip ${what}` })
    await expectWithin(dialog.getByRole('slider', { name: 'Split point' }), dialog, {
      what: `the split point ${what}`,
    })
    const buttons = dialog.getByRole('button')
    expect(await buttons.count()).toBeGreaterThanOrEqual(6)
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a Split window button ${what}`)
    await expectNoWrap(dialog.getByTestId('split-parts'), `the parts line ${what}`)
    await expectNoHorizontalScroll(page, `with the Split window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`split-window-${viewport.width}.png`) })
  })
}
