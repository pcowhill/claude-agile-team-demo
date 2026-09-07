import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { appliedPictureGroups, openPicture, pictureToggle } from './pictureDisclosure'

type Page = import('@playwright/test').Page

/**
 * The Picture disclosure (#420, from the approved redesign #401 option R1 /
 * feedback #395 "So Many Buttons"), in real Chromium: what an expanded row
 * costs with it closed against with it open, the summary line's own
 * geometry, and both states as screenshots.
 *
 * jsdom carries the behaviour (which groups render, what the summary names,
 * how the state survives a collapse); none of it can say how tall a row is
 * or whether a summary wraps, which is the whole point of the change and
 * the reason `development.md` asks for rendered evidence.
 *
 * Media-free apart from one canvas-drawn PNG: an image entry is a still
 * (#140) but not a slate, so it carries every picture treatment a video
 * entry does — Color, Orientation, Crop, Background — while needing no
 * recorded video and no decode.
 */

/** A four-quadrant PNG, enough for a real image entry. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c33'
    ctx.fillRect(0, 0, 160, 90)
    ctx.fillStyle = '#3c3'
    ctx.fillRect(160, 0, 160, 90)
    ctx.fillStyle = '#33c'
    ctx.fillRect(0, 90, 160, 90)
    ctx.fillStyle = '#cc3'
    ctx.fillRect(160, 90, 160, 90)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

const POSITION = 'logo.png at position 1'

async function placeImage(page: Page): Promise<void> {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add logo.png to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)
}

const row = (page: Page) =>
  page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()

/** One field from each of the entry's four groups. */
const groupFields = (page: Page) => [
  page.getByRole('spinbutton', { name: `Saturation of ${POSITION} (percent)` }),
  page.getByRole('checkbox', { name: `Flip ${POSITION} horizontally` }),
  page.getByRole('spinbutton', { name: `Crop left of ${POSITION} (percent)` }),
  page.getByRole('combobox', { name: `Background fill of ${POSITION}` }),
]

test('a closed Picture disclosure is one line, and costs far less row than the groups it holds (#420)', async ({
  page,
}, testInfo) => {
  await placeImage(page)

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const toggle = pictureToggle(page, POSITION)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // The criterion's own claim: the closed disclosure is a single line
    // inside the row. One line is measured against the toggle's own height
    // — a summary that wrapped would be at least twice it.
    const summary = row(page).locator('.timeline-picture-summary')
    await expectWithin(summary, row(page), { what: 'the closed Picture summary' })
    const summaryBox = (await summary.boundingBox())!
    const toggleBox = (await toggle.boundingBox())!
    expect(
      summaryBox.height,
      `the closed summary is ${summaryBox.height.toFixed(0)}px tall against a ` +
        `${toggleBox.height.toFixed(0)}px toggle at ${viewport.width}px — it wrapped`,
    ).toBeLessThan(toggleBox.height * 1.5)
    await expectNoHorizontalScroll(page, `closed Picture at ${viewport.width}px`)

    const closedHeight = (await row(page).boundingBox())!.height
    for (const field of groupFields(page)) await expect(field).toHaveCount(0)

    // Open: every group's fields are there and lie inside the row, and the
    // row grows by more than the four rows of fields are worth — which is
    // what the closed state is saving. Four groups replaced by one line
    // must be a large difference, not a rounding one, so the assertion
    // names a floor rather than "greater than".
    await openPicture(page, POSITION)
    for (const field of groupFields(page)) {
      await expect(field).toBeVisible()
      await expectWithin(field, row(page), { what: 'a picture field' })
    }
    const openHeight = (await row(page).boundingBox())!.height
    expect(
      openHeight - closedHeight,
      `the row grew only ${(openHeight - closedHeight).toFixed(0)}px on opening at ` +
        `${viewport.width}px (closed ${closedHeight.toFixed(0)}px, open ` +
        `${openHeight.toFixed(0)}px) — the disclosure is saving nothing`,
    ).toBeGreaterThan(3 * toggleBox.height)
    await expectNoHorizontalScroll(page, `open Picture at ${viewport.width}px`)

    // The row itself, not a page region: the timeline sits below the fold
    // at these viewports, and an element screenshot frames what changed.
    if (viewport.width === 1280) {
      await row(page).scrollIntoViewIfNeeded()
      await row(page).screenshot({ path: testInfo.outputPath('timeline-picture-open-1280.png') })
    }
    await pictureToggle(page, POSITION).click()
    await expect(pictureToggle(page, POSITION)).toHaveAttribute('aria-expanded', 'false')
    if (viewport.width === 1280) {
      await row(page).scrollIntoViewIfNeeded()
      await row(page).screenshot({ path: testInfo.outputPath('timeline-picture-closed-1280.png') })
    }
  }
})

test('the summary names the applied groups and still costs one line at 800px (#420)', async ({
  page,
}, testInfo) => {
  await placeImage(page)
  await page.setViewportSize({ width: 800, height: 1100 })

  expect(await appliedPictureGroups(page, POSITION)).toEqual([])

  // Every group applied — the widest the hint can get on an entry row.
  await openPicture(page, POSITION)
  const saturation = page.getByRole('spinbutton', { name: `Saturation of ${POSITION} (percent)` })
  await saturation.fill('0')
  await saturation.blur()
  await page.getByRole('checkbox', { name: `Flip ${POSITION} horizontally` }).check()
  const crop = page.getByRole('spinbutton', { name: `Crop left of ${POSITION} (percent)` })
  await crop.fill('20')
  await crop.blur()
  await page
    .getByRole('combobox', { name: `Background fill of ${POSITION}` })
    .selectOption('blur')
  expect(await appliedPictureGroups(page, POSITION)).toEqual([
    'Color',
    'Orientation',
    'Crop',
    'Background',
  ])

  // Closed again, the summary still reads on one line: the hint ellipsizes
  // rather than wrapping, so a fully treated row costs no more than an
  // untreated one. `scrollWidth <= clientWidth` is the no-wrap check
  // #416's `expectMenuUsable` uses on a menu item.
  await pictureToggle(page, POSITION).click()
  const toggle = pictureToggle(page, POSITION)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const summary = row(page).locator('.timeline-picture-summary')
  const summaryBox = (await summary.boundingBox())!
  const toggleBox = (await toggle.boundingBox())!
  expect(
    summaryBox.height,
    `the summary wrapped with every group applied: ${summaryBox.height.toFixed(0)}px ` +
      `against a ${toggleBox.height.toFixed(0)}px toggle`,
  ).toBeLessThan(toggleBox.height * 1.5)
  const hint = row(page).locator('.timeline-picture-applied')
  expect(
    await hint.evaluate((node) => node.scrollWidth <= node.clientWidth),
    'the applied-groups hint overflows its own box instead of ellipsizing',
  ).toBe(true)
  await expectNoHorizontalScroll(page, 'every picture group applied at 800px')
  // The hint is a new visible surface, so it is looked at as well as
  // measured (`development.md`): what a closed, fully treated row says.
  await row(page).scrollIntoViewIfNeeded()
  await row(page).screenshot({ path: testInfo.outputPath('timeline-picture-applied-800.png') })

  // And it survives the round trip a screen reader takes: the toggle points
  // at the hint, which is where the names live.
  await expect(toggle).toHaveAttribute('aria-describedby', await hint.getAttribute('id') ?? '')
})
