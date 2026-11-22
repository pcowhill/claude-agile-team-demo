import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectAlignedRow, expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Cut… on a video overlay and an audio track (#828), in a real browser, on
 * a populated project: `fixtures/trim-clip.webm` (6.008 s, #707's fixture)
 * in the sequence and again as a video overlay starting at 1 s, a 6 s tone
 * as an audio track starting at 0.5 s, and a subtitle imported at 5 s.
 * - Each is cut in its own Cut window: the overlay's with its picture, the
 *   track's with none. Each leaves two rows, the later starting where the
 *   earlier now ends, shorter by the part removed. Nothing else moves: no
 *   confirmation, the subtitle stays at 5 s and the total at 0:06. One
 *   Undo per cut restores it.
 * - At 1280×720 and 360px, each row's Trim… Cut… Split… sit side by side on
 *   one line, and the track's Cut window fits the viewport.
 *
 * The sequence entry's Cut window is `cut-window.spec.ts`'s.
 */

const CLIP = 'trim-clip.webm'
const TONE = 'tone.wav'
const OVERLAY = `overlay ${CLIP} at position 1`
const OVERLAY_2 = `overlay ${CLIP} at position 2`
const TRACK = `audio track ${TONE} at position 1`
const TRACK_2 = `audio track ${TONE} at position 2`

const SRT = ['1', '00:00:05,000 --> 00:00:05,800', 'After the cut', ''].join('\n')

const subtitleStart = (page: Page) =>
  page.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' })

async function fill(field: Locator, value: string) {
  await field.fill(value)
  await field.press('Enter')
  await expect(field).toHaveValue(value)
}

async function populate(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: CLIP, mimeType: 'video/webm', buffer },
    { name: TONE, mimeType: 'audio/wav', buffer: sineWav(6) },
  ])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await chooseClipAction(page, CLIP, 'Add as overlay')
  await page.getByRole('button', { name: `Add ${TONE} to timeline` }).click()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${TRACK} in seconds` })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${OVERLAY} in seconds` })).toBeVisible()
  await fill(page.getByRole('spinbutton', { name: `Start time of ${OVERLAY} in seconds` }), '1')
  await fill(page.getByRole('spinbutton', { name: `Start time of ${TRACK} in seconds` }), '0.5')
  await page.getByTestId('subtitle-file-input').setInputFiles({
    name: 'captions.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(SRT, 'utf-8'),
  })
  await expect(subtitleStart(page)).toHaveValue('5')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
}

async function openCut(page: Page, element: string, player: 'cut-video' | 'cut-audio') {
  await page.getByRole('button', { name: `Cut a part out of ${element} in the Cut window` }).click()
  const dialog = page.getByRole('dialog', { name: `Cut ${element}` })
  await expect(dialog).toBeVisible()
  // The source is loaded, so the window's clock is the clip's.
  await expect
    .poll(() => dialog.getByTestId(player).evaluate((media: HTMLMediaElement) => media.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

/** The two parts' start, In and Out, from one page read. */
const parts = (page: Page, first: string, second: string) =>
  page.evaluate(
    ([a, b]) => {
      const value = (name: string) =>
        Number((document.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement | null)?.value ?? NaN)
      const of = (element: string) => ({
        start: value(`Start time of ${element} in seconds`),
        in: value(`Trim in point of ${element} in seconds`),
        out: value(`Trim out point of ${element} in seconds`),
      })
      return { first: of(a), second: of(b) }
    },
    [first, second],
  )

/**
 * Two rows with the part [from, to) gone: the earlier keeps its start and
 * In and ends at `from`; the later begins at `to` and starts where the
 * earlier now ends, running on to the source's end.
 */
async function expectClosedUp(page: Page, first: string, second: string, start: number, from: number, to: number) {
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${second} in seconds` })).toBeVisible()
  await expect
    .poll(async () => {
      const { first: a, second: b } = await parts(page, first, second)
      return {
        start: a.start,
        firstIn: a.in,
        firstOut: a.out,
        secondIn: b.in,
        secondStart: b.start,
        // No gap: the later part starts where the earlier one's window ends.
        closedUp: Math.abs(a.start + (a.out - a.in) - b.start) < 0.0005,
        toTheEnd: b.out > 5.9,
      }
    })
    .toEqual({
      start,
      firstIn: 0,
      firstOut: from,
      secondIn: to,
      secondStart: start + from,
      closedUp: true,
      toTheEnd: true,
    })
}

async function cutWith(dialog: Locator, from: string, to: string) {
  await fill(dialog.getByRole('spinbutton', { name: 'Cut from in seconds' }), from)
  await fill(dialog.getByRole('spinbutton', { name: 'Cut to in seconds' }), to)
  await expect(dialog.getByTestId('cut-removed-length')).toHaveText(
    `removes 0:0${Number(to) - Number(from)}.00`,
  )
  await dialog.getByRole('button', { name: 'Apply' }).click()
}

test('Cut… on a video overlay and on an audio track leaves two rows each, closed up, and moves nothing else; one Undo each restores them (#828)', async ({
  page,
}) => {
  await populate(page)

  // The overlay: its window has the picture. Cut 2 → 4 out of it.
  let dialog = await openCut(page, OVERLAY, 'cut-video')
  await cutWith(dialog, '2', '4')
  // Nothing besides the overlay changes, so there is no confirmation.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectClosedUp(page, OVERLAY, OVERLAY_2, 1, 2, 4)

  // The track: no picture, and no frames to step by. Cut 1 → 3 out of it.
  dialog = await openCut(page, TRACK, 'cut-audio')
  await expect(dialog.locator('video')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Back one frame' })).toHaveCount(0)
  await cutWith(dialog, '1', '3')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectClosedUp(page, TRACK, TRACK_2, 0.5, 1, 3)

  // The new lengths: the overlay plays 2 + 2.008 s, from 1 s to 5.008 s,
  // and the track 1 + 3 s, from 0.5 s to 4.5 s.
  const overlay = await parts(page, OVERLAY, OVERLAY_2)
  // The Out field shows two decimals (6.01 for 6.008), so to within 0.005.
  expect(overlay.second.start + (overlay.second.out - overlay.second.in)).toBeCloseTo(5.008, 2)
  const track = await parts(page, TRACK, TRACK_2)
  expect(track.second.start + (track.second.out - track.second.in)).toBeCloseTo(4.5, 3)

  // Nothing else moved: the subtitle and the sequence are as they were.
  await expect(subtitleStart(page)).toHaveValue('5')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')

  // One undo per cut, the later first.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${TRACK_2} in seconds` })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: `Trim out point of ${TRACK} in seconds` })).toHaveValue('6')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${OVERLAY_2} in seconds` })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${OVERLAY_2} in seconds` })).toHaveCount(0)
  await expect
    .poll(async () => (await parts(page, OVERLAY, OVERLAY_2)).first.out)
    .toBeGreaterThan(5.9)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`at ${viewport.width}px, the overlay's and the track's Trim… Cut… Split… sit on one line, and the track's Cut window fits (#828)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populate(page)
    const what = `at ${viewport.width}px`
    for (const [list, element] of [
      ['Overlay layers', OVERLAY],
      ['Audio tracks', TRACK],
    ] as const) {
      const row = page.getByRole('list', { name: list }).getByRole('listitem').first()
      const three = row.locator('.timeline-trim-open')
      await expect(three).toHaveText(['Trim…', 'Cut…', 'Split…'])
      await expect(three.nth(1)).toHaveAccessibleName(`Cut a part out of ${element} in the Cut window`)
      await expectWithin(three.nth(2), row, { what: `the ${list} row's Split… ${what}` })
      await expectNoWrap(three, `the ${list} row's Trim… / Cut… / Split… ${what}`)
      await expectAlignedRow(three, `the ${list} row's Trim…, Cut… and Split… ${what}`)
    }
    await expectNoHorizontalScroll(page, `with Cut… on the overlay and track rows ${what}`)

    // The track's window, with no picture: inside the viewport on all four
    // edges, its parts inside it, its buttons each on one line.
    const dialog = await openCut(page, TRACK, 'cut-audio')
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
    const box = (await dialog.boundingBox())!
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    expect(box.x, `the track's Cut window's left ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `the track's Cut window's right ${what}`).toBeLessThanOrEqual(view.width)
    expect(box.y, `the track's Cut window's top ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `the track's Cut window's bottom ${what}`).toBeLessThanOrEqual(view.height)
    await expectWithin(dialog.getByTestId('cut-strip'), dialog, { what: `the strip ${what}` })
    await expectWithin(dialog.getByTestId('cut-removed'), dialog.getByTestId('cut-strip'), {
      what: `the removed part ${what}`,
    })
    const buttons = dialog.getByRole('button')
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a track Cut window button ${what}`)
    await expectNoHorizontalScroll(page, `with the track's Cut window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`cut-track-${viewport.width}.png`) })
    await page.keyboard.press('Escape')
    await page.getByRole('list', { name: 'Audio tracks' }).screenshot({
      path: testInfo.outputPath(`cut-track-row-${viewport.width}.png`),
    })
    await page.getByRole('list', { name: 'Overlay layers' }).screenshot({
      path: testInfo.outputPath(`cut-overlay-row-${viewport.width}.png`),
    })
  })
}
