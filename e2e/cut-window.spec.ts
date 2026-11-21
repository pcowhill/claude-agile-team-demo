import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectAlignedRow, expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Cut… on a sequence entry (#827), in a real browser, on a populated
 * project: `fixtures/trim-clip.webm` (6.008 s of 320×180 VP8 at 30 fps,
 * the Trim window's fixture) in the sequence, and a subtitle imported at
 * 5 s, after the part cut out.
 * - A clamp dragged on the strip moves the picture with it.
 * - Apply asks first (the subtitle would move), then leaves two entries
 *   meeting at the cut, a shorter total and the subtitle earlier by the cut's
 *   length, all as one undo step.
 * - At 1280×720 and 360px the window lies inside the viewport, and the
 *   row's Trim… Cut… Split… sit side by side on one line.
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`
const SECOND = `${CLIP} at position 2`

const SRT = ['1', '00:00:05,000 --> 00:00:05,800', 'After the cut', ''].join('\n')

const subtitleStart = (page: Page) =>
  page.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' })

async function populated(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })).toBeVisible()
  await page.getByTestId('subtitle-file-input').setInputFiles({
    name: 'captions.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(SRT, 'utf-8'),
  })
  await expect(subtitleStart(page)).toHaveValue('5')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
}

async function openCut(page: Page) {
  await page.getByRole('button', { name: `Cut a part out of ${ENTRY} in the Cut window` }).click()
  const dialog = page.getByRole('dialog', { name: `Cut ${ENTRY}` })
  await expect(dialog).toBeVisible()
  // The preview has its first frame, so its clock is the clip's.
  await expect
    .poll(() => dialog.getByTestId('cut-video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

/** A clamp's value and the picture's clock, read together: one page read. */
const clampAndPicture = (dialog: Locator, which: 'from' | 'to') =>
  dialog.evaluate(
    (node, testId) => ({
      clamp: Number(node.querySelector(`[data-testid="${testId}"]`)!.getAttribute('aria-valuenow')),
      picture: (node.querySelector('[data-testid="cut-video"]') as HTMLVideoElement).currentTime,
    }),
    `cut-clamp-${which}`,
  )

/** Both entries' trim fields, from one page read. */
const parts = (page: Page) =>
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

async function fill(field: Locator, value: string) {
  await field.fill(value)
  await field.press('Enter')
  await expect(field).toHaveValue(value)
}

test('a clamp dragged on the strip moves the picture; Apply asks, then cuts the part out and moves the subtitle earlier, in one undo step (#827)', async ({
  page,
}) => {
  await populated(page)
  const dialog = await openCut(page)

  // Drag Cut from to a quarter of the strip: the picture follows the clamp.
  const strip = (await dialog.getByTestId('cut-strip').boundingBox())!
  const grip = (await dialog.getByTestId('cut-clamp-from').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(strip.x + strip.width * 0.25, grip.y + grip.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(async () => {
      const { clamp, picture } = await clampAndPicture(dialog, 'from')
      return Math.abs(clamp - 1.502) < 0.05 && Math.abs(picture - clamp) < 0.05
    })
    .toBe(true)

  // The exact part, by the fields: source 2 to 4 comes out.
  await fill(dialog.getByRole('spinbutton', { name: 'Cut from in seconds' }), '2')
  await fill(dialog.getByRole('spinbutton', { name: 'Cut to in seconds' }), '4')
  await expect(dialog.getByTestId('cut-removed-length')).toHaveText('removes 0:02.00')
  await dialog.getByRole('button', { name: 'Apply' }).click()

  const confirm = page.getByRole('dialog', { name: 'Cut out this part?' })
  await expect(confirm).toContainText('Removes 2 s. 1 subtitle after it moves earlier.')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
  await confirm.getByRole('button', { name: 'Cut out' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The fields show hundredths, so the clip's 6.008 s Out reads 6.01.
  await expect
    .poll(async () => {
      const { firstIn, firstOut, secondIn, secondOut } = await parts(page)
      return firstIn === 0 && firstOut === 2 && secondIn === 4 && Math.abs(secondOut - 6.008) < 0.005
    })
    .toBe(true)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  await expect(subtitleStart(page)).toHaveValue('3')

  // One undo step puts the clip and the subtitle back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${SECOND} in seconds` })).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
  await expect(subtitleStart(page)).toHaveValue('5')
})

test('▶ Play cut plays up to Cut from and on from Cut to, never showing the part between (#827)', async ({ page }) => {
  await populated(page)
  const dialog = await openCut(page)
  await fill(dialog.getByRole('spinbutton', { name: 'Cut from in seconds' }), '2.5')
  await fill(dialog.getByRole('spinbutton', { name: 'Cut to in seconds' }), '4.5')
  // Record every clock value the picture reaches while it plays.
  await dialog.getByTestId('cut-video').evaluate((video: HTMLVideoElement) => {
    const seen: number[] = []
    ;(window as unknown as { cutSeen: number[] }).cutSeen = seen
    video.addEventListener('timeupdate', () => seen.push(video.currentTime))
  })
  await dialog.getByRole('button', { name: 'Play cut' }).click()
  // It reaches the part after the cut, then stops at Out.
  await expect(dialog.getByRole('button', { name: 'Play cut' })).toBeVisible({ timeout: 10_000 })
  const seen = await page.evaluate(() => (window as unknown as { cutSeen: number[] }).cutSeen)
  expect(seen.some((time) => time >= 4.5), `reached Cut to: ${seen.join(', ')}`).toBe(true)
  expect(seen.some((time) => time < 2.5), `played the lead-in: ${seen.join(', ')}`).toBe(true)
  // Never more than a frame or so into the removed part: the jump is made
  // on the first animation frame past Cut from.
  const inside = seen.filter((time) => time > 2.5 + 0.1 && time < 4.5 - 0.01)
  expect(inside, `inside the removed part: ${inside.join(', ')}`).toEqual([])
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the Cut window fits a ${viewport.width}px window, and Trim… Cut… Split… sit on one line (#827)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populated(page)
    const what = `at ${viewport.width}px`
    // The row's three buttons: inside the row, each on one line, side by
    // side at one height.
    const row = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()
    const cut = row.getByRole('button', { name: `Cut a part out of ${ENTRY} in the Cut window` })
    await expectWithin(cut, row, { what: `the row's Cut… ${what}` })
    const trio = row.locator('.timeline-trim-open')
    await expect(trio).toHaveCount(3)
    await expect(trio).toHaveText(['Trim…', 'Cut…', 'Split…'])
    await expectNoWrap(trio, `the row's Trim… / Cut… / Split… ${what}`)
    await expectAlignedRow(trio, `Trim…, Cut… and Split… ${what}`)
    await expectNoHorizontalScroll(page, `with Cut… on the row ${what}`)
    await row.screenshot({ path: testInfo.outputPath(`cut-row-${viewport.width}.png`) })

    const dialog = await openCut(page)
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
    // The window inside the viewport, on all four edges.
    const box = (await dialog.boundingBox())!
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    expect(box.x, `the Cut window's left ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `the Cut window's right ${what}`).toBeLessThanOrEqual(view.width)
    expect(box.y, `the Cut window's top ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `the Cut window's bottom ${what}`).toBeLessThanOrEqual(view.height)
    // Its parts inside it: the strip, the removed part on the strip, both
    // clamps, and every button, each on one line.
    await expectWithin(dialog.getByTestId('cut-strip'), dialog, { what: `the strip ${what}` })
    await expectWithin(dialog.getByTestId('cut-removed'), dialog.getByTestId('cut-strip'), {
      what: `the removed part ${what}`,
    })
    for (const which of ['from', 'to'] as const) {
      await expectWithin(dialog.getByTestId(`cut-clamp-${which}`), dialog, { what: `the ${which} clamp ${what}` })
    }
    const buttons = dialog.getByRole('button')
    expect(await buttons.count()).toBeGreaterThanOrEqual(8)
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a Cut window button ${what}`)
    await expectNoHorizontalScroll(page, `with the Cut window open ${what}`)

    // A refusal's reason, the longest line the window shows, stays inside it.
    await fill(dialog.getByRole('spinbutton', { name: 'Cut from in seconds' }), '0')
    await expect(dialog.getByTestId('cut-status')).toContainText('use Trim…')
    await expectWithin(dialog.getByTestId('cut-status'), dialog, { what: `the reason line ${what}` })
    await fill(dialog.getByRole('spinbutton', { name: 'Cut from in seconds' }), '2')

    await dialog.screenshot({ path: testInfo.outputPath(`cut-window-${viewport.width}.png`) })
  })
}
