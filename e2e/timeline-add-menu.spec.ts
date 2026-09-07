import { expect, test } from '@playwright/test'
import {
  ADD_SLATE,
  ADD_TEXT,
  IMPORT_SUBTITLES,
  addMenu,
  addMenuTrigger,
  chooseFromAddMenu,
  openAddMenu,
  subtitleStyleToggle,
} from './timelineMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * The timeline header after #418 (from the approved redesign #401 option T1
 * / feedback #395 "So Many Buttons"), in real Chromium: Add ▾ driven by the
 * keyboard, the "Subtitle style ▸" disclosure that replaced the
 * always-visible eight-control style row, and the rendered evidence jsdom
 * cannot give — the header's controls on one line at the default width,
 * inside the panel at the 800 px guard width with no sideways scroll, the
 * open panel inside the viewport at both, and the collapsed disclosure
 * costing one short line rather than the row it replaced.
 *
 * Media-free: colour slates carry the sequence, as the text and slate specs
 * do (#139/#143), and the subtitle import needs only a .srt buffer.
 */

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nFirst caption\n'

const srtFile = () => ({
  name: 'captions.srt',
  mimeType: 'application/x-subrip',
  buffer: Buffer.from(SRT, 'utf-8'),
})

/** The header's own row, for containment checks. */
const header = (page: Page) => page.locator('.timeline-header')

test('Add ▾ adds a slate by keyboard alone, and offers exactly the three former buttons (#418)', async ({
  page,
}) => {
  await page.goto('./')
  const sequence = page.getByRole('list', { name: 'Sequence' })

  // The buttons the menu replaced are gone from the header — the point of
  // the change, asserted in the browser as well as in jsdom.
  for (const name of [
    'Add color slate to timeline',
    'Add text overlay to timeline',
    'Import subtitles from an SRT file',
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  }

  const menu = await openAddMenu(page)
  await expect(menu.getByRole('menuitem')).toHaveText([ADD_SLATE, ADD_TEXT, IMPORT_SUBTITLES])
  // Escape returns focus to the trigger — the menu-button contract (#412).
  await page.keyboard.press('Escape')
  await expect(addMenu(page)).toHaveCount(0)
  await expect(addMenuTrigger(page)).toBeFocused()

  // Keyboard only, from the trigger: ArrowDown opens on Color slate, Enter
  // adds it. Nothing below touches the mouse — the acceptance criterion —
  // which means parking the pointer somewhere harmless first. The click
  // that opened the menu above leaves it on the trigger, and adding the
  // slate then lifts the whole header 68px (the sequence lane replaces the
  // taller empty-sequence placeholder: measured, the trigger goes from
  // y 563–584 to y 495–516). The pointer, still at the old centre y≈574,
  // is then inside "Subtitles from .srt file…" at y 568–589, and `Menu`'s
  // hover-follows-focus (#412) moves focus onto it — correct behaviour for
  // a mouse that is over an item, and not keyboard-only operation at all.
  await page.mouse.move(2, 2)
  await addMenuTrigger(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(addMenu(page)).toBeVisible()
  await expect(addMenu(page).getByRole('menuitem', { name: ADD_SLATE, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(addMenu(page)).toHaveCount(0)
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  await expect(addMenuTrigger(page)).toBeFocused()

  // One item further down is the text overlay, on the same keyboard path.
  // The two presses are separated by waiting for the first item to hold
  // focus: the panel focuses it in an effect after paint, so a second
  // ArrowDown sent before that reaches the *trigger* again and merely
  // re-opens the menu on Color slate.
  await page.keyboard.press('ArrowDown')
  await expect(addMenu(page)).toBeVisible()
  await expect(addMenu(page).getByRole('menuitem', { name: ADD_SLATE, exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(addMenu(page).getByRole('menuitem', { name: ADD_TEXT, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('list', { name: 'Text overlays' }).getByRole('listitem'),
  ).toHaveCount(1)
  // And the slate is still the only sequence entry: the item that ran is
  // the one the arrow was on, not the one the menu opened on.
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
})

test('the Subtitle style disclosure appears with cues, opens on import, and toggles (#418)', async ({
  page,
}) => {
  await page.goto('./')
  const styleField = page.getByRole('combobox', { name: 'Default subtitle font' })

  // Nothing to restyle: neither the disclosure nor the row behind it.
  await expect(subtitleStyleToggle(page)).toHaveCount(0)
  await expect(styleField).toHaveCount(0)

  // A hand-made overlay is a cue to restyle, so the disclosure appears —
  // collapsed, because nothing has been imported.
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await expect(subtitleStyleToggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(styleField).toHaveCount(0)

  // Click opens, click closes.
  await subtitleStyleToggle(page).click()
  await expect(subtitleStyleToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(styleField).toBeVisible()
  await subtitleStyleToggle(page).click()
  await expect(styleField).toHaveCount(0)

  // An import opens it, and the style it reveals really drives the cues:
  // recolouring the default recolours the imported caption in the preview,
  // which is #250's own claim reached through the new surface.
  await chooseFromAddMenu(page, IMPORT_SUBTITLES)
  await page.getByTestId('subtitle-file-input').setInputFiles(srtFile())
  await expect(
    page.getByRole('textbox', { name: 'Content of text overlay at position 2' }),
  ).toHaveValue('First caption')
  await expect(subtitleStyleToggle(page)).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1.5')
  const caption = page.getByTestId('preview-text-1')
  await expect(caption).toHaveText('First caption')
  await expect(caption).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.getByLabel('Default subtitle color').fill('#ffff00')
  await expect(caption).toHaveCSS('color', 'rgb(255, 255, 0)')
})

test('the header fits one line at the default width, stays inside the panel at 800 px, and Add ▾ opens inside the viewport (#418)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')

  const timeline = page.getByRole('region', { name: 'Timeline' })
  const controls = [
    page.getByRole('button', { name: 'Undo last timeline edit' }),
    page.getByRole('button', { name: 'Redo timeline edit' }),
    page.getByRole('button', { name: 'Collapse all timeline elements' }),
    page.getByRole('button', { name: 'Expand all timeline elements' }),
    addMenuTrigger(page),
    page.locator('.timeline-total'),
    // The Canvas select #415 moved onto this row; the criterion names it.
    page.getByRole('combobox', { name: 'Canvas aspect' }),
  ]
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)

    // Every control inside the header row, the row inside the timeline
    // panel, and no sideways page scroll — #208's standing guard.
    for (const [index, locator] of controls.entries()) {
      await expectWithin(locator, header(page), { what: `header control ${index}` })
    }
    await expectWithin(header(page), timeline, { what: 'timeline header' })
    await expectNoHorizontalScroll(page, `timeline header at ${viewport.width}px`)

    if (viewport.width === 1280) {
      // The plan's stated goal: at the default width the whole header is one
      // line. Centres within half of Undo's height, the same discriminator
      // the transport row uses (#417) — a control pushed onto a second line
      // is a full row height away, far outside it.
      const undoBox = (await controls[0].boundingBox())!
      for (const locator of controls.slice(1)) {
        const box = (await locator.boundingBox())!
        expect(
          Math.abs(centre(box) - centre(undoBox)),
          `header control shares Undo's line at 1280px`,
        ).toBeLessThan(undoBox.height / 2)
      }
    }

    // ▲ and ▼ are "one compact pair" (#418's words), not two glyphs the
    // header's `space-between` has spread to opposite ends of the row. The
    // gap is the group's own 0.25rem, so 8px covers it with rounding; the
    // ungrouped version measured 119px at 1280 and looked like two
    // unrelated buttons, which no containment or one-line check caught.
    const collapseBox = (await controls[2].boundingBox())!
    const expandBox = (await controls[3].boundingBox())!
    expect(
      expandBox.x - (collapseBox.x + collapseBox.width),
      `▲ and ▼ are ${(expandBox.x - collapseBox.x - collapseBox.width).toFixed(0)}px apart ` +
        `at ${viewport.width}px, so they do not read as one control`,
    ).toBeLessThanOrEqual(8)

    // The open Add ▾ panel lies inside the viewport on all four edges, with
    // every item on one line.
    await addMenuTrigger(page).click()
    const menu = addMenu(page)
    await expect(menu).toBeVisible()
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    const box = (await menu.boundingBox())!
    expect(box.x, `panel left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `panel right at ${viewport.width}px`).toBeLessThanOrEqual(view.width)
    expect(box.y, `panel top at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `panel bottom at ${viewport.width}px`).toBeLessThanOrEqual(
      view.height,
    )
    for (const item of await menu.getByRole('menuitem').all()) {
      const text = await item.textContent()
      const overflow = await item.evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }))
      expect(
        overflow.scrollWidth,
        `"${text}" wraps inside its item at ${viewport.width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth)
    }

    if (viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath('timeline-add-menu-1280.png'),
        // The full width: the first cut clipped Total and the Canvas
        // select out of frame, so the shot could not show the header line
        // the assertions above measure.
        clip: { x: 0, y: 380, width: 1280, height: 340 },
      })
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  // The collapsed disclosure costs one short line: its row is no taller
  // than the toggle plus the flex gap, where the row it replaced carried
  // eight controls. Measured rather than asserted by eye, because "one
  // line" is exactly the claim #395 was about.
  await page.setViewportSize({ width: 1280, height: 720 })
  const row = page.locator('.timeline-subtitle-style')
  const toggle = subtitleStyleToggle(page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const closedRow = (await row.boundingBox())!
  const toggleBox = (await toggle.boundingBox())!
  expect(
    closedRow.height,
    `the closed disclosure's row is ${closedRow.height}px against a ${toggleBox.height}px toggle`,
  ).toBeLessThanOrEqual(toggleBox.height + 2)

  // Open, the fields are inside that row and the page still does not
  // scroll sideways — the style row's own width was never the problem, but
  // it is now inside a container that could have made it one.
  await toggle.click()
  const openRow = (await row.boundingBox())!
  expect(openRow.height, 'opening the disclosure adds the fields').toBeGreaterThan(
    closedRow.height,
  )
  await expectWithin(page.getByRole('combobox', { name: 'Default subtitle font' }), row, {
    what: 'the subtitle font select',
  })
  await expectWithin(page.getByRole('button', { name: 'Reset default subtitle style' }), row, {
    what: 'Reset',
  })
  await expectNoHorizontalScroll(page, 'subtitle style disclosure open at 1280px')
  await page.screenshot({
    path: testInfo.outputPath('timeline-subtitle-style-1280.png'),
    clip: { x: 0, y: 380, width: 1280, height: 340 },
  })
})
