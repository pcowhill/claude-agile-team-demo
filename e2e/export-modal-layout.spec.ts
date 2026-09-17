import { expect, test } from '@playwright/test'
import { expectWithin } from './layout'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Locator = import('@playwright/test').Locator

/**
 * Export-modal format-picker layout (#268): the selected format's note must
 * render on its own line below the radio options, and the picker must stay
 * within the dialog's bounds however many formats are registered — the GIF
 * plugin (#198) adds a fourth radio plus the longest note the picker shows,
 * which is exactly the configuration the customer's screenshots broke in
 * (#264, #265). Real rendered geometry, so this runs in the browser.
 */

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test('the format note sits below the radios and the picker stays inside the dialog (#268)', async ({
  page,
}) => {
  await page.goto('./')

  // Enable the GIF plugin: the fullest picker the product can show.
  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  await chooseFromAddMenu(page, ADD_SLATE)
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  // The format fieldset's own options: the Range fieldset below it (#385,
  // #400) shares the option class and lies below the note by design.
  const options = dialog.locator(
    'fieldset.export-format-options:not(.export-range-options) .export-format-option',
  )
  expect(await options.count()).toBeGreaterThanOrEqual(3)

  // Both formats that state a note: the audio-only line (#264's screenshot)
  // and the GIF plugin's caps (#265's).
  const cases: { radio: string; note: RegExp }[] = [
    { radio: 'Audio only (WebM/Opus)', note: /Saves just the mixed soundtrack —/ },
    { radio: 'Audio only (MP3)', note: /as an MP3 file/ },
    { radio: 'Animated GIF', note: /soundless and sample at 10 fps/ },
  ]
  for (const { radio, note } of cases) {
    await dialog.getByRole('radio', { name: radio }).check()
    const noteText = dialog.getByText(note)
    await expect(noteText).toBeVisible()

    const noteBox = await boxOf(noteText)
    for (const [index, option] of (await options.all()).entries()) {
      const optionBox = await boxOf(option)
      // Below every radio option, not beside any of them…
      expect(noteBox.y).toBeGreaterThanOrEqual(optionBox.y + optionBox.height - 1)
      // …and every option inside the dialog's horizontal bounds. Horizontal
      // only: the dialog scrolls vertically on purpose when the settings
      // fieldset is long, so asserting the vertical edges would fail on
      // correct layout.
      await expectWithin(option, dialog, { axis: 'x', what: `format option ${index}` })
    }
    // The note itself stays inside the dialog too — the half #265's
    // screenshot showed hanging out of it.
    await expectWithin(noteText, dialog, { axis: 'x', what: `${radio} note` })
  }
})

test('the Copy chapter list row and its note stay inside the dialog at both viewports (#488)', async ({
  page,
}) => {
  // Reaching the widest state the row can be in: the button with the
  // confirmation beside it. Granted per-test rather than for the file, so
  // the other cases here keep the default permissions.
  await page.context().grantPermissions(['clipboard-write'])
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  // One marker, so the button is enabled and can be pressed.
  await chooseFromFrameMenu(page, 'preview-add-marker')
  await page.keyboard.press('Enter')

  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  const row = dialog.locator('.export-chapter-row')
  const button = dialog.getByRole('button', { name: 'Copy chapter list' })
  await expect(button).toBeEnabled()
  await button.click()
  const copied = dialog.getByText('Chapter list copied')
  await expect(copied).toBeVisible()
  const note = dialog.getByText(/A “mm:ss Name” list of the chapter markers/)

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const where = `at ${viewport.width}px`
    // Horizontal only, for the reason the Output case gives below: the
    // dialog scrolls vertically on purpose.
    await expectWithin(row, dialog, { axis: 'x', what: `chapter-list row ${where}` })
    await expectWithin(button, dialog, { axis: 'x', what: `Copy chapter list ${where}` })
    await expectWithin(copied, dialog, { axis: 'x', what: `the confirmation ${where}` })
    await expectWithin(note, dialog, { axis: 'x', what: `the chapter-list note ${where}` })

    // The note is a paragraph of its own below the row, never squeezed in
    // beside the button — #268's failure, in the group #400 built.
    const rowBox = await boxOf(row)
    const noteBox = await boxOf(note)
    expect(noteBox.y, `the note sits below the row ${where}`).toBeGreaterThanOrEqual(
      rowBox.y + rowBox.height - 1,
    )
    // And the confirmation stays on the button's line rather than pushing
    // the row into a second one, which is what the row's width is for.
    const buttonBox = await boxOf(button)
    expect(rowBox.height, `the row is one line ${where}`).toBeLessThanOrEqual(
      buttonBox.height + 2,
    )
  }
})

test('the Output row keeps Width, Height and Frame rate inside the dialog at both viewports (#407)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  const output = dialog.locator('fieldset.export-settings')
  await expect(output).toBeVisible()
  const fields = [
    'Export width in pixels',
    'Export height in pixels',
    'Export frame rate in frames per second',
  ]

  // The default viewport, where #407 was measured (the frame-rate input sat
  // entirely past the dialog's right edge), and the narrow viewport the
  // layout-width guard (#208) uses. The dialog is capped at 24rem at both,
  // so the row has the same width to fit into either way — measured at both
  // because the criterion names both.
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    for (const name of fields) {
      const input = dialog.getByRole('spinbutton', { name })
      await expect(input).toBeVisible()
      // Horizontal only: the dialog scrolls vertically on purpose when its
      // fieldsets are tall, so the vertical edges would fail on correct
      // layout.
      await expectWithin(input, dialog, { axis: 'x', what: `${name} at ${viewport.width}px` })
      // The label's text did not break onto a second line to make room:
      // a field that no longer fits wraps whole, label and input together.
      const label = input.locator('..')
      const labelBox = await boxOf(label)
      const inputBox = await boxOf(input)
      expect(labelBox.height, `${name} label at ${viewport.width}px`).toBeLessThanOrEqual(
        inputBox.height + 2,
      )
    }
    // Nothing in the dialog scrolls sideways — the measurement #407 reported
    // as 461px of scrollWidth against 382px of clientWidth.
    const overflow = await dialog.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }))
    expect(
      overflow.scrollWidth,
      `dialog scrollWidth at ${viewport.width}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth)
    // The human check for the PR's rendered evidence, re-taken every run.
    await output.screenshot({
      path: testInfo.outputPath(`export-output-fieldset-${viewport.width}.png`),
    })
  }
})

test('a dialog taller than the viewport can still be scrolled to its actions (#488)', async ({
  page,
}) => {
  // The defect this pins was latent until the export dialog grew: the
  // overlay centred its child with `align-items: center` and had no
  // `overflow`, so a dialog taller than the viewport was clipped off BOTH
  // ends with nothing to scroll — Cancel and Export simply unreachable.
  // Adding the Copy chapter list row and its note (#488) pushed the
  // dialog's tallest state past 720px and turned that into a real failure:
  // e2e/export-redaction.spec.ts's blur-refusal case timed out clicking
  // Cancel, deterministically, with "element is outside of the viewport".
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  // Short enough that the dialog cannot fit however its content changes
  // later, so this keeps testing the overflow case rather than quietly
  // becoming a test of a dialog that happens to fit.
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(dialog).toBeVisible()
  const box = await boxOf(dialog)
  expect(box.height, 'the dialog is taller than the viewport').toBeGreaterThan(400)

  // The top is REACHABLE, which is the half `align-items: center` took away:
  // it centred the overflow, putting the dialog's head above the viewport
  // with no scroll to bring it back. Measured on this page before the fix,
  // the top sat at −137px and scrolling the overlay did nothing; it now
  // lands at the overlay's padding. Opening the dialog focuses Export, which
  // scrolls the overlay to the bottom, so this scrolls back first.
  const top = await dialog.evaluate((node) => {
    const overlay = node.parentElement!
    overlay.scrollTop = 0
    return node.getBoundingClientRect().top
  })
  expect(top, 'the dialog top can be scrolled into view').toBeGreaterThanOrEqual(-1)

  // And the proof a user would recognise: the click lands. Reaching the
  // actions at all means the overlay scrolls rather than clipping them away.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
})

test('the Range fieldset keeps its typed fields and error line inside the dialog (#400)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  const custom = dialog.locator('.export-range-custom')
  await expect(custom).toBeVisible()

  // The custom option — radio label and both fields — lies within the
  // dialog's horizontal bounds (vertical scrolling is the dialog's own).
  await expectWithin(custom, dialog, { axis: 'x', what: 'custom range option' })
  for (const testId of ['export-range-start', 'export-range-end']) {
    await expectWithin(page.getByTestId(testId), dialog, { axis: 'x', what: testId })
  }
  // Fields do not overflow their own boxes (a typed value never clips).
  for (const testId of ['export-range-start', 'export-range-end']) {
    const overflow = await page.getByTestId(testId).evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  }

  // Provoke the longest message and check it sits on its own line below the
  // options, inside the dialog — the #268 shape of defect, on this fieldset.
  await page.getByTestId('export-range-end').fill('99:00')
  const error = page.getByTestId('export-range-error')
  await expect(error).toBeVisible()
  await expectWithin(error, dialog, { axis: 'x', what: 'range error line' })
  const customBox = await boxOf(custom)
  const errorBox = await boxOf(error)
  expect(errorBox.y).toBeGreaterThanOrEqual(customBox.y + customBox.height - 1)
  const overflow = await error.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  // The human check for the PR's rendered evidence, re-taken every run.
  await dialog.screenshot({ path: testInfo.outputPath('export-range-fieldset.png') })
})
