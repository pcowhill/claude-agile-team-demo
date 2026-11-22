import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'
import { ADD_TEXT, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Settings › Time fields on Minutes and seconds (#848, from #847), in a real
 * browser: every seconds box on the timeline, and the Trim window's, shows
 * its whole `m:ss.mmm` text, at 1280×720 and at 360px.
 *
 * An `<input>`'s text does not wrap — a value wider than the box scrolls
 * inside it — so here `scrollWidth <= clientWidth` *is* the right check,
 * unlike for a label (`development.md`, #605). Tolerance 1px: `scrollWidth`
 * is an integer rounded up from a fractional content edge, as in
 * `field-units.spec.ts`.
 *
 * Measured on a populated project (`development.md`): a clip with a zoom, a
 * speed segment and a redaction region, and a text overlay whose duration is
 * over a minute, so at least one box holds `1:15.000`. Each box is also
 * measured with an hour-long `1:02:05.250` typed into it, the widest value
 * the format produces; it is typed, never committed.
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`
const TEXT = 'text overlay at position 1'
const SETTINGS_KEY = 'browser-video-editor.settings'
const WIDEST = '1:02:05.250'

/** The setting is stored before the app loads, as a returning user's would be. */
async function minutesMode(page: Page) {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, JSON.stringify({ timeFormat: 'minutes' })),
    [SETTINGS_KEY],
  )
}

async function populatedProject(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseEffect(page, ENTRY, 'Zoom')
  await chooseEffect(page, ENTRY, 'Speed segment')
  await openPicture(page, ENTRY)
  await page.getByRole('button', { name: `Add a redaction region on ${ENTRY}` }).click()
  const duration = page.getByRole('textbox', { name: `Duration of ${TEXT} in seconds`, exact: true })
  await duration.fill('1:15')
  await duration.press('Enter')
  await expect(duration).toHaveValue('1:15.000')
}

interface Reading {
  name: string
  input: DOMRect
  box: DOMRect
  scrollWidth: number
  clientWidth: number
}

async function read(input: Locator): Promise<Reading> {
  await input.scrollIntoViewIfNeeded()
  return input.evaluate((element) => {
    const field = element as HTMLInputElement
    const plain = (rect: DOMRect) => rect.toJSON() as DOMRect
    return {
      name: field.getAttribute('aria-label') ?? '?',
      input: plain(field.getBoundingClientRect()),
      box: plain(field.parentElement!.getBoundingClientRect()),
      scrollWidth: field.scrollWidth,
      clientWidth: field.clientWidth,
    }
  })
}

/** What is wrong with one reading, as strings, so a run reports every box at fault. */
function faults(reading: Reading, holding: string): string[] {
  const out: string[] = []
  if (reading.scrollWidth > reading.clientWidth + 1) {
    out.push(
      `${reading.name} holding ${holding}: its text needs ${reading.scrollWidth}px, the box shows ${reading.clientWidth}px`,
    )
  }
  const { input, box } = reading
  if (input.left < box.left - 0.5 || input.right > box.right + 0.5) {
    out.push(`${reading.name} holding ${holding}: the input ${input.left}–${input.right} leaves its box ${box.left}–${box.right}`)
  }
  return out
}

/** Measures one box at its own value and with the widest value typed in, then puts it back. */
async function measure(input: Locator): Promise<string[]> {
  const value = await input.inputValue()
  expect(value, 'a minutes box shows m:ss.mmm').toMatch(/^(\d+:)?\d+:\d\d\.\d\d\d$/)
  const wrong = faults(await read(input), value)
  await input.fill(WIDEST)
  wrong.push(...faults(await read(input), WIDEST))
  // The same text back commits nothing (#848's criterion 4).
  await input.fill(value)
  await input.blur()
  await expect(input).toHaveValue(value)
  return wrong
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`every minutes-and-seconds box shows its whole text at ${viewport.width}px (#848)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await minutesMode(page)
    await populatedProject(page)
    const column = page.locator('main')

    const boxes = page.locator('.timeline-unit-box > input.timeline-time-input')
    const count = await boxes.count()
    // Clip: start-less entry's in, out, fades, zoom ×4, speed ×2, redaction ×2;
    // text: start, duration, fades. Fewer means the setting missed a row.
    expect(count, 'minutes boxes on the populated timeline').toBeGreaterThanOrEqual(15)
    // And no seconds box was left behind as a number box with an s.
    await expect(page.locator('.timeline-unit-box > input[type="number"] + .timeline-unit', { hasText: /^s$/ })).toHaveCount(0)

    const wrong: string[] = []
    for (let index = 0; index < count; index++) {
      const input = boxes.nth(index)
      wrong.push(...(await measure(input)))
      await expectWithin(input.locator('xpath=ancestor::div[1]'), column, {
        axis: 'x',
        what: `the row of ${await input.getAttribute('aria-label')}`,
      })
    }
    expect(wrong, 'minutes boxes whose text is clipped or that leave their box').toEqual([])
    await expectNoHorizontalScroll(page, `at ${viewport.width}px`)

    await page.getByRole('textbox', { name: `Trim in point of ${ENTRY} in seconds`, exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`time-fields-timeline-${viewport.width}.png`) })

    // ---- The Trim window ----
    await page.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` }).click()
    const dialog = page.getByRole('dialog', { name: `Trim ${ENTRY}` })
    await expect(dialog).toBeVisible()
    const inPoint = dialog.getByRole('textbox', { name: 'In point to apply in seconds' })
    await expect(inPoint).toHaveValue('0:00.000')
    await inPoint.fill('0:01.5')
    await inPoint.press('Enter')
    await expect(inPoint).toHaveValue('0:01.500')
    const dialogWrong: string[] = []
    for (const name of ['In point to apply in seconds', 'Out point to apply in seconds']) {
      const input = dialog.getByRole('textbox', { name })
      dialogWrong.push(...(await measure(input)))
      await expectWithin(input.locator('xpath=..'), dialog, { axis: 'x', what: `the box of ${name}` })
    }
    expect(dialogWrong, 'Trim window boxes whose text is clipped').toEqual([])
    await expectNoHorizontalScroll(page, `with the Trim window open at ${viewport.width}px`)
    await dialog.screenshot({ path: testInfo.outputPath(`time-fields-trim-${viewport.width}.png`) })
  })
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the Time fields row sits inside the Settings dialog and switches the boxes at once, at ${viewport.width}px (#848)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    const buffer = await readFile(join('e2e', 'fixtures', CLIP))
    await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
    await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
    const out = `Trim out point of ${ENTRY} in seconds`
    await expect(page.getByRole('spinbutton', { name: out })).toBeVisible()

    await chooseFromFileMenu(page, 'Settings…')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const select = dialog.getByRole('combobox', { name: 'Time fields' })
    await expect(select).toHaveValue('seconds')
    await expectWithin(select, dialog, { axis: 'x', what: `the Time fields choice at ${viewport.width}px` })
    await select.scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: testInfo.outputPath(`time-fields-settings-${viewport.width}.png`) })

    await select.selectOption('minutes')
    await dialog.getByRole('button', { name: 'Close' }).click()
    // No reload: the box behind the dialog is a minutes box now.
    await expect(page.getByRole('textbox', { name: out })).toHaveValue(/^0:06\.\d\d\d$/)
  })
}
