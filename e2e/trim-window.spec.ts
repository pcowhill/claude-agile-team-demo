import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Trim window (#707, from the approved design #703 for #701), in a real
 * browser: the clamps dragged with a mouse and moving the preview, I and O
 * setting the clamps rather than the sequence's export marks, Play trim
 * stopping at Out and looping back to In, Apply as one undo step, and the
 * window's geometry at 1280×720 and 360px.
 *
 * The clip is `fixtures/trim-clip.webm`, made with FFmpeg: 6 s of 320×180
 * VP8 at 30 fps with an Opus 440 Hz tone that is silent for its first two
 * seconds, loud for two and quiet for the last two, so its waveform has a
 * shape to see.
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`
/** The fixture's duration as the browser reports it: FFmpeg reads 6.008 s. */
const DURATION_MIN = 5.9

async function addClip(page: Page) {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })).toBeVisible()
}

async function openTrim(page: Page) {
  await page.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${ENTRY}` })
  await expect(dialog).toBeVisible()
  // The preview has its first frame, so its clock is the clip's.
  await expect
    .poll(() => dialog.getByTestId('trim-video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

const videoTime = (dialog: Locator) =>
  dialog.getByTestId('trim-video').evaluate((video: HTMLVideoElement) => video.currentTime)
const clampValue = async (clamp: Locator) => Number(await clamp.getAttribute('aria-valuenow'))

/** Drags `handle` to the point `fraction` of the way along the strip. */
async function dragTo(page: Page, dialog: Locator, handle: Locator, fraction: number) {
  const strip = await dialog.getByTestId('trim-strip').boundingBox()
  const grip = await handle.boundingBox()
  expect(strip).not.toBeNull()
  expect(grip).not.toBeNull()
  const y = grip!.y + grip!.height / 2
  await page.mouse.move(grip!.x + grip!.width / 2, y)
  await page.mouse.down()
  const target = strip!.x + strip!.width * fraction
  await page.mouse.move(target - 10, y, { steps: 4 })
  await page.mouse.move(target, y, { steps: 2 })
  await page.mouse.up()
}

test('dragging the In clamp moves the preview to it; Apply changes the entry’s In only, and one Undo restores it (#707)', async ({
  page,
}) => {
  await addClip(page)
  const inField = page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })
  const outField = page.getByRole('spinbutton', { name: `Trim out point of ${ENTRY} in seconds` })
  const outBefore = await outField.inputValue()
  expect(Number(outBefore)).toBeGreaterThan(DURATION_MIN)

  const dialog = await openTrim(page)
  const inClamp = dialog.getByRole('slider', { name: 'In clamp' })
  await expect(inClamp).toHaveAttribute('aria-valuenow', '0')
  await dragTo(page, dialog, inClamp, 0.25)
  // The clamp sits a quarter of the way along, and the preview went with it.
  await expect.poll(() => clampValue(inClamp)).toBeGreaterThan(1.3)
  await expect.poll(() => clampValue(inClamp)).toBeLessThan(1.7)
  const inPoint = await clampValue(inClamp)
  await expect.poll(() => videoTime(dialog)).toBeCloseTo(inPoint, 2)

  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // The row's field shows a tenth of a second; the entry holds the clamp's
  // millisecond.
  await expect.poll(async () => Number(await inField.inputValue())).toBeCloseTo(inPoint, 1)
  await expect(inField).not.toHaveValue('0')
  await expect(outField).toHaveValue(outBefore)

  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(inField).toHaveValue('0')
  await expect(outField).toHaveValue(outBefore)
})

test('Set In here and Set Out here, by button and by I and O, move the clamps — and I never sets the export mark (#707)', async ({
  page,
}) => {
  await addClip(page)
  const dialog = await openTrim(page)
  const inClamp = dialog.getByRole('slider', { name: 'In clamp' })
  const outClamp = dialog.getByRole('slider', { name: 'Out clamp' })
  const playhead = dialog.getByRole('status', { name: 'Trim window playhead' })

  // A click on the bare strip moves the playhead without moving a clamp.
  const strip = (await dialog.getByTestId('trim-strip').boundingBox())!
  await page.mouse.click(strip.x + strip.width * 0.5, strip.y + strip.height / 2)
  await expect(playhead).not.toHaveText('0:00.00')
  await expect(inClamp).toHaveAttribute('aria-valuenow', '0')
  const middle = await videoTime(dialog)
  expect(middle).toBeGreaterThan(2.7)
  expect(middle).toBeLessThan(3.3)

  // The key, with the focus on the window.
  await page.keyboard.press('i')
  await expect.poll(() => clampValue(inClamp)).toBeCloseTo(middle, 2)

  // The button, four frames on: 0.13 s, past the window's 0.1 s minimum.
  const forward = dialog.getByRole('button', { name: 'Forward one frame' })
  for (let frame = 0; frame < 4; frame += 1) await forward.click()
  await expect.poll(() => videoTime(dialog)).toBeCloseTo(middle + 4 / 30, 2)
  await dialog.getByRole('button', { name: 'Set Out here (O)' }).click()
  await expect.poll(() => clampValue(outClamp)).toBeCloseTo(middle + 4 / 30, 2)
  await expect(inClamp).toHaveAttribute('aria-valuenow', String(await clampValue(inClamp)))

  // O by key, from further on.
  await page.mouse.click(strip.x + strip.width * 0.8, strip.y + strip.height / 2)
  const later = await videoTime(dialog)
  await page.keyboard.press('o')
  await expect.poll(() => clampValue(outClamp)).toBeCloseTo(later, 2)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Behind the window, I would have set the sequence's export mark: the
  // transport would then offer ✕ Marks. It does not.
  await expect(page.getByRole('button', { name: /Marks/ })).toHaveCount(0)
  // And Escape kept the entry as it was.
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })).toHaveValue('0')
})

test('Play trim plays from In and stops at Out; with Loop on it goes back to In (#707)', async ({ page }) => {
  await addClip(page)
  const dialog = await openTrim(page)
  const inField = dialog.getByRole('spinbutton', { name: 'In point to apply in seconds' })
  const outField = dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' })
  await inField.fill('1')
  await inField.press('Enter')
  await outField.fill('2')
  await outField.press('Enter')
  await expect(dialog.getByRole('slider', { name: 'In clamp' })).toHaveAttribute('aria-valuenow', '1')
  await expect(dialog.getByRole('slider', { name: 'Out clamp' })).toHaveAttribute('aria-valuenow', '2')

  await dialog.getByRole('button', { name: 'Play trim' }).click()
  // It starts from In…
  await expect.poll(() => videoTime(dialog)).toBeGreaterThan(1.05)
  // …and stops at Out, within a tenth of a second.
  await expect(dialog.getByRole('button', { name: 'Play trim' })).toBeVisible({ timeout: 5000 })
  const stopped = await dialog
    .getByTestId('trim-video')
    .evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime }))
  expect(stopped.paused).toBe(true)
  expect(Math.abs(stopped.time - 2)).toBeLessThanOrEqual(0.1)

  // With Loop on, reaching Out goes back to In and carries on playing.
  await dialog.getByRole('button', { name: '↻ Loop' }).click()
  await expect(dialog.getByRole('button', { name: '↻ Loop' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Play trim' }).click()
  // Seen near Out, then back near In, while still playing. Polled every
  // 50 ms: the loop is about a second long and spends only its last ~0.2 s
  // past 1.8, so the default back-off (1 s steps after the first second)
  // can fall into step with it and sample nothing but the seek back to In —
  // which Firefox did on every attempt in CI, with a PulseAudio sink
  // holding each play at In for ~1.5 s (#721's review has the event log).
  await expect.poll(() => videoTime(dialog), { timeout: 5000, intervals: [50] }).toBeGreaterThan(1.8)
  await expect
    .poll(
      () =>
        dialog
          .getByTestId('trim-video')
          .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime < 1.5),
      { timeout: 5000, intervals: [50] },
    )
    .toBe(true)
  await dialog.getByRole('button', { name: 'Pause' }).click()
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the Trim window fits a ${viewport.width}px window: strip, clamps and buttons inside it, no label wrapping (#707)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await addClip(page)
    // The row's Trim… button first: on its row, on one line, the page still.
    const row = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()
    const trim = row.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` })
    await expectWithin(trim, row, { what: `the row's Trim… at ${viewport.width}px` })
    await expectNoWrap(trim, `the row's Trim… at ${viewport.width}px`)
    await expectNoHorizontalScroll(page, `with Trim… on the row at ${viewport.width}px`)
    const dialog = await openTrim(page)
    // A trim set, so the clamps sit apart and the dim parts show.
    await dialog.getByRole('spinbutton', { name: 'In point to apply in seconds' }).fill('1.5')
    await dialog.getByRole('spinbutton', { name: 'In point to apply in seconds' }).press('Enter')
    await dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' }).fill('4.5')
    await dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' }).press('Enter')
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()

    const what = `at ${viewport.width}px`
    await expectWithin(dialog.getByTestId('trim-strip'), dialog, { what: `the strip ${what}` })
    for (const name of ['In clamp', 'Out clamp']) {
      await expectWithin(dialog.getByRole('slider', { name }), dialog, { what: `the ${name} ${what}` })
    }
    const buttons = dialog.getByRole('button')
    expect(await buttons.count()).toBeGreaterThanOrEqual(11)
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a Trim window button ${what}`)
    await expectNoHorizontalScroll(page, `with the Trim window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`trim-window-${viewport.width}.png`) })
  })
}
