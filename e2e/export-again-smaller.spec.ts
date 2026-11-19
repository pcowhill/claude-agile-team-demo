import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoWrap, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * Export again smaller (#727): a size-limited export whose file came out
 * over its limit offers to run the same export again at a rate scaled down
 * by the overshoot.
 *
 * A real recorder rarely overshoots on demand, so these tests make it: an
 * init script wraps `MediaRecorder` so every recording's data carries
 * `PAD_BYTES` of padding, which puts a small export over a 1 MB limit
 * every time. The wrapper also keeps the options each recorder was created
 * with, so the test reads the rates the app actually asked for. What is
 * under test is the dialog's response to an over-limit file and the rate
 * the second recorder is given, not the codec.
 */
const PAD_BYTES = 2_000_000
const LIMIT_MB = 1

async function padRecorder(page: Page) {
  await page.addInitScript((pad) => {
    const Native = window.MediaRecorder
    const created: (MediaRecorderOptions | null)[] = []
    ;(window as unknown as { __recorderOptions: typeof created }).__recorderOptions = created
    class Padded extends Native {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        created.push(options ?? null)
      }
      override set ondataavailable(handler: ((event: BlobEvent) => void) | null) {
        super.ondataavailable =
          handler === null
            ? null
            : (event: BlobEvent) =>
                handler(
                  new BlobEvent('dataavailable', {
                    data: new Blob([event.data, new Uint8Array(pad)], { type: event.data.type }),
                  }),
                )
      }
      override get ondataavailable() {
        return super.ondataavailable
      }
    }
    window.MediaRecorder = Padded
  }, PAD_BYTES)
}

const recorderOptions = (page: Page) =>
  page.evaluate(() => (window as unknown as { __recorderOptions: MediaRecorderOptions[] }).__recorderOptions)

/** Clicks `button` and returns the downloaded file's size. */
async function downloadSize(page: Page, click: () => Promise<void>): Promise<number> {
  const download = page.waitForEvent('download', { timeout: 120_000 })
  await click()
  return (await readFile(await (await download).path())).length
}

/**
 * The over-limit line, the button and its rate inside the dialog, the
 * button's label and the rate each on one line; at the desktop and phone
 * widths, on a populated project. Then the button: the second recorder is
 * asked for exactly the first one's picture rate × (limit / actual) × 0.9.
 */
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`an over-limit file offers Export again smaller, which fits the dialog and asks for the scaled rate, at ${viewport.width}px (#727)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await padRecorder(page)
    await page.setViewportSize(viewport)
    await page.goto('./')
    // Two slates: a populated project, and a short real-time export.
    for (let i = 0; i < 2; i++) await chooseFromAddMenu(page, ADD_SLATE)
    await page.getByRole('button', { name: 'Export Project…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export project' })
    await dialog.getByRole('combobox', { name: 'Export size limit' }).selectOption('custom')
    await dialog.getByRole('spinbutton', { name: 'Custom size limit in MB' }).fill(String(LIMIT_MB))

    const firstBytes = await downloadSize(page, () =>
      dialog.getByRole('button', { name: 'Export', exact: true }).click(),
    )
    expect(firstBytes).toBeGreaterThan(LIMIT_MB * 1_000_000)
    const result = dialog.getByTestId('export-size-result')
    await expect(result).toContainText('over the 1 MB limit')
    const again = dialog.getByRole('button', { name: 'Export again smaller' })
    await expect(again).toBeVisible()
    const note = dialog.locator('.export-again-smaller .export-format-note')
    for (const [element, what] of [
      [result, 'the over-limit line'],
      [again, 'Export again smaller'],
      [note, 'its rate note'],
    ] as const) {
      await expectWithin(element, dialog, { axis: 'x', what: `${what} at ${viewport.width}px` })
    }
    await expectNoWrap(again, `the Export again smaller label at ${viewport.width}px`)
    await expectNoWrap(note.locator('.export-limit-rate'), `the rate it will ask for at ${viewport.width}px`)
    // The dialog scrolls vertically; bring the new line into its view.
    await again.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`again-smaller-${viewport.width}.png`) })

    await downloadSize(page, () => again.click())
    const [first, second] = await recorderOptions(page)
    expect(first.videoBitsPerSecond, 'the first export is size-limited').toBeGreaterThan(0)
    // The app's own expression, so floating point agrees exactly.
    const expected = Math.floor(first.videoBitsPerSecond! * ((LIMIT_MB * 1_000_000) / firstBytes) * (1 - 0.1))
    expect(second.videoBitsPerSecond).toBe(expected)
    expect(second.videoBitsPerSecond!).toBeLessThan(first.videoBitsPerSecond!)
    // The sound keeps its reserve, when there is sound.
    expect(second.audioBitsPerSecond).toBe(first.audioBitsPerSecond)
  })
}
