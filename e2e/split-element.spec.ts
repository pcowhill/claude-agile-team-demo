import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectAlignedRow, expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Split… on an audio track and a video overlay (#826), in a real browser,
 * on a populated project: a sequence entry, the same clip as a video
 * overlay, and a tone as an audio track.
 * - Each is split in its own Split window: the overlay's with its picture,
 *   the track's with none. Each leaves two rows whose In and Out meet and
 *   whose start times are contiguous.
 * - At 1280×720 and 360px, each row's Trim… and Split… sit side by side
 *   with neither label wrapping. The track's window fits the viewport.
 *
 * The entry's Split window is `split-window.spec.ts`'s. The clip is
 * `fixtures/trim-clip.webm` (6.008 s of 320×180 VP8, #707's fixture). The
 * track is a 6 s, 440 Hz WAV built in Node (`sineWav`).
 */

const CLIP = 'trim-clip.webm'
const TONE = 'tone.wav'
const OVERLAY = `overlay ${CLIP} at position 1`
const OVERLAY_2 = `overlay ${CLIP} at position 2`
const TRACK = `audio track ${TONE} at position 1`
const TRACK_2 = `audio track ${TONE} at position 2`

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
}

async function openSplit(page: Page, element: string, player: 'split-video' | 'split-audio') {
  await page.getByRole('button', { name: `Split ${element} in the Split window` }).click()
  const dialog = page.getByRole('dialog', { name: `Split ${element}` })
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

/** Two rows whose In and Out meet at `at`, the second starting where the first ends. */
async function expectMeeting(page: Page, first: string, second: string, start: number, at: number) {
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
        contiguous: Math.abs(a.start + (a.out - a.in) - b.start) < 0.0005,
        toTheEnd: b.out > 5.9,
      }
    })
    .toEqual({
      start,
      firstIn: 0,
      firstOut: at,
      secondIn: at,
      secondStart: start + at,
      contiguous: true,
      toTheEnd: true,
    })
}

test('Split… on a video overlay and on an audio track leaves two rows each, meeting at the point and contiguous; one Undo each restores them (#826)', async ({
  page,
}) => {
  await populate(page)

  // The overlay: its window has the picture.
  let dialog = await openSplit(page, OVERLAY, 'split-video')
  await fill(dialog.getByRole('spinbutton', { name: 'Split point in seconds' }), '2.5')
  await expect(dialog.getByRole('slider', { name: 'Split point' })).toHaveAttribute('aria-valuenow', '2.5')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  await expectMeeting(page, OVERLAY, OVERLAY_2, 1, 2.5)

  // The track: no picture, and no frames to step by.
  dialog = await openSplit(page, TRACK, 'split-audio')
  await expect(dialog.locator('video')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Back one frame' })).toHaveCount(0)
  await fill(dialog.getByRole('spinbutton', { name: 'Split point in seconds' }), '4')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  await expectMeeting(page, TRACK, TRACK_2, 0.5, 4)
  // The sequence itself is untouched.
  await expect(page.getByTestId('timeline-total')).toHaveText('0:06')

  // One undo per split, the later first.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${TRACK_2} in seconds` })).toHaveCount(0)
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
  test(`at ${viewport.width}px, the overlay's and the track's Trim… / Split… sit on one line, and the track's Split window fits (#826)`, async ({
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
      const pair = row.locator('.timeline-trim-open')
      await expect(pair).toHaveCount(2)
      await expect(pair.nth(1)).toHaveAccessibleName(`Split ${element} in the Split window`)
      await expectWithin(pair.nth(1), row, { what: `the ${list} row's Split… ${what}` })
      await expectNoWrap(pair, `the ${list} row's Trim… / Split… ${what}`)
      await expectAlignedRow(pair, `the ${list} row's Trim… and Split… ${what}`)
    }
    await expectNoHorizontalScroll(page, `with Split… on the overlay and track rows ${what}`)

    // The track's window, with no picture: inside the viewport on all four
    // edges, its parts inside it, its buttons each on one line.
    const dialog = await openSplit(page, TRACK, 'split-audio')
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
    const box = (await dialog.boundingBox())!
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    expect(box.x, `the track's Split window's left ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `the track's Split window's right ${what}`).toBeLessThanOrEqual(view.width)
    expect(box.y, `the track's Split window's top ${what}`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `the track's Split window's bottom ${what}`).toBeLessThanOrEqual(view.height)
    await expectWithin(dialog.getByTestId('split-strip'), dialog, { what: `the strip ${what}` })
    const buttons = dialog.getByRole('button')
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a track Split window button ${what}`)
    await expectNoWrap(dialog.getByTestId('split-parts'), `the parts line ${what}`)
    await expectNoHorizontalScroll(page, `with the track's Split window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`split-track-${viewport.width}.png`) })
    await page.keyboard.press('Escape')
    await page.getByRole('list', { name: 'Audio tracks' }).screenshot({
      path: testInfo.outputPath(`split-track-row-${viewport.width}.png`),
    })
    await page.getByRole('list', { name: 'Overlay layers' }).screenshot({
      path: testInfo.outputPath(`split-overlay-row-${viewport.width}.png`),
    })
  })
}
