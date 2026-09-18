import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { scanExportedFrames } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectNoVerticalPageScroll, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page
type Download = import('@playwright/test').Download

/**
 * Each chapter as its own file (#529, from the approved suggestion #523) in
 * real Chromium: one download per chapter marker, named from the marker,
 * each carrying only its own span.
 *
 * Media-free, on four 2 s colour slates — green, red, blue, yellow — with a
 * marker on each boundary but none at zero, so the run is the
 * inserted-`Intro` case. **The colours are the evidence**: a file that
 * carried the wrong span, or the whole project, would show a channel it
 * should not, and no duration check alone could tell those apart from a
 * short file of the right length.
 *
 * Kept to 8 s of sequence because exports run in real time and this test
 * records the whole thing four times over, once per chapter.
 */

const FULL: Record<string, SampleRect> = { full: { x: 0, y: 0, width: 1, height: 1 } }
/** Strong presence of a slate's own colour channel in a frame average. */
const DOMINANT = 80
/** Channel level attributable to codec noise and chroma bleed alone. */
const ABSENT = 30

const CHAPTER_SECONDS = 2
/** The four spans, in order, with the colour each one must show. */
const CHAPTERS = [
  { file: '01 Intro.webm', name: 'Intro', channel: 'g' as const },
  { file: '02 Red.webm', name: 'Red', channel: 'r' as const },
  { file: '03 Blue.webm', name: 'Blue', channel: 'b' as const },
  { file: '04 Yellow.webm', name: 'Yellow', channel: 'r' as const },
]

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export project' })
const results = (page: Page) => page.getByTestId('export-chapter-results')

/** Seeks the transport to `time`, the retried block the range specs use. */
async function seekTo(page: Page, time: number) {
  const slider = page.getByRole('slider', { name: 'Seek within sequence' })
  await expect(async () => {
    const max = Number(await slider.getAttribute('max'))
    expect(max).toBeGreaterThanOrEqual(time)
    await slider.fill(String(time))
    expect(Number(await slider.inputValue())).toBeCloseTo(time, 3)
  }).toPass({ timeout: 15_000 })
}

/** Adds a named chapter marker at `time` (#487's Frame ▾ route). */
async function markerAt(page: Page, time: number, name: string) {
  await seekTo(page, time)
  await chooseFromFrameMenu(page, 'preview-add-marker')
  const field = page.getByRole('textbox', { name: /^Name of chapter marker at/ })
  await expect(field).toBeFocused()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(field).toHaveCount(0)
}

/**
 * Four 2 s slates — green, red, blue, yellow — with markers at 2, 4 and 6.
 * Nothing sits at zero, so the opening span is the inserted `Intro`.
 */
async function sequenceWithChapters(page: Page, names = ['Red', 'Blue', 'Yellow']) {
  await page.goto('./')
  const colors = ['#00cd00', '#cd0000', '#0000cd', '#cdcd00']
  for (const [index, color] of colors.entries()) {
    await chooseFromAddMenu(page, ADD_SLATE)
    const position = index + 1
    await page.getByLabel(`Color of Color slate at position ${position}`).fill(color)
    const duration = page.getByRole('spinbutton', {
      name: `Duration of Color slate at position ${position} in seconds`,
    })
    await duration.fill(String(CHAPTER_SECONDS))
    await duration.blur()
  }
  await expect(page.getByTestId('timeline-total')).toHaveText('0:08')
  await markerAt(page, 2, names[0])
  await markerAt(page, 4, names[1])
  await markerAt(page, 6, names[2])
}

/** Opens the dialog and selects Each chapter. */
async function chooseEachChapter(page: Page) {
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByTestId('export-scope-chapters').check()
  await expect(page.getByTestId('export-scope-chapters')).toBeChecked()
}

test('Each chapter writes one file per chapter, each carrying its own span (#529)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await sequenceWithChapters(page)

  // Collected as they arrive rather than awaited one at a time: the run
  // delivers them back to back and a missed event is exactly the failure
  // this feature's completion list exists to make visible.
  const downloads: Download[] = []
  page.on('download', (download) => void downloads.push(download))

  await chooseEachChapter(page)
  // The label says how many files the choice means before it is made.
  await expect(page.getByText('Each chapter (4 files)')).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Export', exact: true }).click()

  // The progress line names the chapter and the count. Auto-retrying, never
  // a single read after a click (`quality-and-ci.md`).
  await expect(page.getByTestId('export-chapter-progress')).toHaveText(/Chapter \d of 4: /)

  await expect.poll(() => downloads.length, { timeout: 150_000 }).toBe(CHAPTERS.length)
  expect(downloads.map((download) => download.suggestedFilename())).toEqual(
    CHAPTERS.map((chapter) => chapter.file),
  )

  // Each file holds its own span, and nothing else: its own colour dominant,
  // and — for Intro, Red and Blue — the neighbours' colours absent. Yellow
  // is red+green, so it is checked by its green rather than by absence.
  for (const [index, chapter] of CHAPTERS.entries()) {
    const bytes = await readFile((await downloads[index].path())!)
    expect(bytes.byteLength, `${chapter.file} is empty`).toBeGreaterThan(500)
    const scan = await scanExportedFrames(page, bytes, FULL)
    // The criterion's own tolerance (#529): 0.3 s. Measured here at
    // 1.964-1.973 s against the 2 s span, i.e. within 0.036 s, so the bound
    // is met with room rather than tuned to fit.
    expect(
      Math.abs(scan.duration - CHAPTER_SECONDS),
      `${chapter.file} is ${scan.duration.toFixed(3)}s, not ${CHAPTER_SECONDS}s`,
    ).toBeLessThan(0.3)
    const average = scan.frames[Math.floor(scan.frames.length / 2)].bands.full
    expect(average[chapter.channel], `${chapter.file} is not its own colour`).toBeGreaterThan(
      DOMINANT,
    )
    if (chapter.name === 'Intro') {
      expect(average.r, `${chapter.file} carries a later slate`).toBeLessThan(ABSENT)
    }
    if (chapter.name === 'Red' || chapter.name === 'Blue') {
      expect(average.g, `${chapter.file} carries the green slate`).toBeLessThan(ABSENT)
    }
    if (chapter.name === 'Yellow') {
      expect(average.g, `${chapter.file} is not yellow`).toBeGreaterThan(DOMINANT)
    }
  }

  // The completion list names every file the run produced, and the rows are
  // the downloads the browser actually delivered — the point of the list.
  await expect(results(page)).toBeVisible()
  await expect(results(page).getByRole('heading')).toHaveText('Exported 4 files')
  const rows = results(page).getByRole('listitem')
  await expect(rows).toHaveCount(CHAPTERS.length)
  for (const [index, chapter] of CHAPTERS.entries()) {
    await expect(rows.nth(index)).toContainText(`${index + 1}. ${chapter.name}`)
    await expect(rows.nth(index)).toContainText(chapter.file)
    await expect(rows.nth(index)).toContainText('0:02')
  }
  // And the dialog is still up holding it, rather than having closed on the
  // last download the way a single export does.
  await expect(dialog(page)).toBeVisible()
})

test('Cancel stops a per-chapter run and leaves the files already saved (#529)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await sequenceWithChapters(page)

  const downloads: Download[] = []
  page.on('download', (download) => void downloads.push(download))

  await chooseEachChapter(page)
  await dialog(page).getByRole('button', { name: 'Export', exact: true }).click()

  // Cancel once the first file has landed: the run is then between chapters
  // or inside the second, and either way must stop.
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(1)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toHaveCount(0)

  // Nothing more arrives. Waited out rather than asserted instantly: a run
  // that had not stopped would deliver chapter 2 within a chapter's length.
  await page.waitForTimeout((CHAPTER_SECONDS + 2) * 1000)
  expect(downloads).toHaveLength(1)
  expect(downloads[0].suggestedFilename()).toBe(CHAPTERS[0].file)
  // The file that did land is intact — cancelling a run is not a rollback.
  expect((await readFile((await downloads[0].path())!)).byteLength).toBeGreaterThan(500)

  // And a second export can start: the dialog reopens on Whole project with
  // no stale completion list, and Export is live.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByTestId('export-scope-whole')).toBeChecked()
  await expect(results(page)).toHaveCount(0)
  await expect(dialog(page).getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
})

test('the completion list lays out inside the dialog at both widths (#529)', async ({ page }) => {
  test.setTimeout(180_000)
  // Deliberately awkward names: one long enough to wrap and one carrying
  // characters the filename has to replace. Short names would have the list
  // fit its cap at every width and prove nothing about the stress case —
  // which is how a dialog in this very app overflowed under green CI (#268).
  await sequenceWithChapters(page, [
    'Installing the CLI',
    'A really rather long chapter name that has to wrap somewhere',
    'Wrap up: notes/links "and" <extras>',
  ])

  const downloads: Download[] = []
  page.on('download', (download) => void downloads.push(download))
  await chooseEachChapter(page)
  await dialog(page).getByRole('button', { name: 'Export', exact: true }).click()
  await expect.poll(() => downloads.length, { timeout: 150_000 }).toBe(CHAPTERS.length)
  await expect(results(page)).toBeVisible()

  const list = results(page).getByRole('list', { name: 'Exported chapters' })
  const rows = list.getByRole('listitem')

  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 720 })
    const where = `at ${width}px`
    await expect(rows).toHaveCount(CHAPTERS.length)

    // The block and its list stay inside the dialog. Rows are checked
    // against the *list* rather than the dialog because the list scrolls
    // internally past a few long names — a row below its fold is out of the
    // dialog's box by design, so asserting otherwise would be asserting the
    // cap away.
    await expectWithin(results(page), dialog(page), { what: `the completion block ${where}` })
    await expectWithin(list, dialog(page), { what: `the completion list ${where}` })
    for (let index = 0; index < CHAPTERS.length; index += 1) {
      await expectWithin(rows.nth(index), list, {
        axis: 'x',
        what: `completion row ${index + 1} ${where}`,
      })
    }

    // Nothing spills sideways: not the list, whose filenames are the one
    // string a user has no control over the length of, and not the page.
    const listOverflow = await list.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(listOverflow, `the completion list scrolls sideways ${where}`).toBeLessThanOrEqual(1)
    const headingFits = await results(page)
      .getByRole('heading')
      .evaluate((node) => node.scrollWidth <= node.clientWidth)
    expect(headingFits, `the completion heading wraps ${where}`).toBe(true)
    await expectNoHorizontalScroll(page, where)
    await expectNoVerticalPageScroll(page, where)

    // And the cap traps nothing: the last row is reachable by scrolling the
    // list, which is the whole point of a list you check a folder against.
    await rows.last().scrollIntoViewIfNeeded()
    await expect(rows.last()).toBeInViewport()
  }
})
