import { expect, test } from '@playwright/test'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'
import {
  chooseRowAction,
  effectMenu,
  effectMenuTrigger,
  openEffectMenu,
  openRowMenu,
  rowMenu,
  rowMenuTrigger,
} from './timelineRowMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { expectMenuUsable, scrollBox } from './menuGeometry'
import { chooseClipAction } from './clipMenu'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page

/**
 * The timeline's rows after #419 (from the approved redesign #401 / feedback
 * #395 "So Many Buttons"), in real Chromium: each row's ⋯ and an expanded
 * entry's + Effect ▾ driven by the keyboard, and the rendered evidence jsdom
 * cannot give — a collapsed row's header on one line inside its row at the
 * default and guard widths, and both panels usable where they are drawn.
 *
 * "Usable where drawn" is `expectMenuUsable`, #416's check, which this PR
 * moved into `menuGeometry.ts`. It matters here for a different reason than
 * it did in the library: nothing above a timeline row scrolls, so no panel
 * is clipped — but a row's panel is drawn over the rows *below* it, and only
 * a browser can say whether the item under the pointer is the item that gets
 * the click.
 *
 * Media-free: colour slates carry the sequence (#143) and a text overlay
 * supplies a row that holds a settings group, so Copy settings has somewhere
 * to appear. The three-item + Effect ▾ of a video entry is covered in jsdom
 * and, with real media, by the zoom and remap specs that now reach their
 * effects through it.
 */

const sequenceRows = (page: Page) =>
  page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')

const SLATE_1 = 'Color slate at position 1'

test('a row is duplicated by keyboard alone, and the buttons the ⋯ replaced are gone (#419)', async ({
  page,
}) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await expect(sequenceRows(page)).toHaveCount(1)

  // The buttons the menus replaced are gone from the rows — the point of
  // the change, asserted in the browser as well as in jsdom.
  for (const name of [
    'Duplicate Color slate at position 1',
    'Copy settings of text overlay at position 1',
    'Rename Color slate at position 1',
    'Add zoom to Color slate at position 1',
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  }
  // …and what stayed inline stayed, under the names its own specs use.
  for (const name of [
    'Collapse Color slate at position 1',
    'Move Color slate at position 1 up',
    'Move Color slate at position 1 down',
    'Remove Color slate at position 1 from timeline',
  ]) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }

  const menu = await openRowMenu(page, SLATE_1)
  // A slate holds no settings group (#315), so its ⋯ is Duplicate + Rename,
  // between the main line's own moves and removal, which it repeats (#622).
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Move up',
    'Move down',
    'Duplicate',
    'Rename…',
    'Remove',
  ])
  // Escape returns focus to the trigger — the menu-button contract (#412).
  await page.keyboard.press('Escape')
  await expect(rowMenu(page, SLATE_1)).toHaveCount(0)
  await expect(rowMenuTrigger(page, SLATE_1)).toBeFocused()

  // Keyboard only: ArrowDown opens on Duplicate — the lone entry's Move up
  // and Move down are disabled, and the arrows skip them — and Enter runs
  // it. The pointer
  // is parked first, because `Menu`'s hover-follows-focus (#412) would move
  // focus if the layout shifted an item under the resting pointer.
  await page.mouse.move(2, 2)
  await rowMenuTrigger(page, SLATE_1).focus()
  await page.keyboard.press('ArrowDown')
  await expect(
    rowMenu(page, SLATE_1).getByRole('menuitem', { name: 'Duplicate', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(rowMenu(page, SLATE_1)).toHaveCount(0)
  await expect(sequenceRows(page)).toHaveCount(2)
  await expect(rowMenuTrigger(page, SLATE_1)).toBeFocused()
  // The copy is a second slate right after the original (#314).
  await expect(rowMenuTrigger(page, 'Color slate at position 2')).toBeVisible()
})

test('+ Effect ▾ adds a zoom by keyboard, and a still is offered Zoom alone (#419)', async ({
  page,
}) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  // Shortened to 2s, so one default zoom window fills it and the item that
  // added it goes disabled — the state that sat on + Zoom, read in a real
  // browser rather than only in jsdom.
  const duration = page.getByRole('spinbutton', { name: `Duration of ${SLATE_1} in seconds` })
  await duration.fill('2')
  await duration.blur()

  // A slate is a still: its one duration is its timing (#138), so the two
  // remap items are absent rather than permanently disabled — as their
  // buttons were.
  const menu = await openEffectMenu(page, SLATE_1)
  await expect(menu.getByRole('menuitem')).toHaveText(['Zoom'])
  await page.keyboard.press('Escape')
  await expect(effectMenu(page, SLATE_1)).toHaveCount(0)
  await expect(effectMenuTrigger(page, SLATE_1)).toBeFocused()

  await page.mouse.move(2, 2)
  await effectMenuTrigger(page, SLATE_1).focus()
  await page.keyboard.press('ArrowDown')
  await expect(
    effectMenu(page, SLATE_1).getByRole('menuitem', { name: 'Zoom', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('spinbutton', { name: `Zoom 1 scale of ${SLATE_1}` }),
  ).toHaveValue('2')
  await expect(effectMenuTrigger(page, SLATE_1)).toBeFocused()

  // The default window [0, 2] covers the whole shortened slate: there is no
  // room for another zoom (#129), so the item is disabled where the button
  // was.
  const again = await openEffectMenu(page, SLATE_1)
  await expect(again.getByRole('menuitem', { name: 'Zoom', exact: true })).toBeDisabled()
})

/** A small opaque PNG, drawn in the page, for an image overlay. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 36
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(0, 120, 200)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

test("every row's ⋯ repeats its ↑ ↓ ✕, and the longer menus stay usable on a populated timeline at 1280 and 360 px (#622)", async ({
  page,
}, testInfo) => {
  // Populated (development.md): three sequence entries, an audio track, an
  // image overlay and a text overlay — a row of every kind, with rows below
  // each panel for it to be drawn over.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await chooseClipAction(page, 'logo.png', 'Add as overlay')
  await expect(sequenceRows(page)).toHaveCount(3)

  const rows = [
    {
      position: 'Color slate at position 2',
      lane: 'Sequence',
      // The middle entry can move both ways, so neither move is disabled.
      items: ['Move up', 'Move down', 'Duplicate', 'Rename…', 'Remove'],
    },
    {
      position: 'audio track tone.wav at position 1',
      lane: 'Audio tracks',
      items: ['Duplicate', 'Copy settings', 'Rename…', 'Remove'],
    },
    {
      position: 'overlay logo.png at position 1',
      lane: 'Overlay layers',
      items: ['Duplicate', 'Copy settings', 'Rename…', 'Remove'],
    },
    {
      position: 'text overlay at position 1',
      lane: 'Text overlays',
      items: ['Duplicate', 'Copy settings', 'Remove'],
    },
  ]

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport)
    for (const { position, lane, items } of rows) {
      const label = `${position} ⋯ at ${viewport.width}px`
      const list = page.getByRole('list', { name: lane })
      await rowMenuTrigger(page, position).scrollIntoViewIfNeeded()
      const before = await scrollBox(list)
      const menu = await openRowMenu(page, position)
      await expect(menu.getByRole('menuitem')).toHaveText(items)
      await expectMenuUsable(page, list, rowMenuTrigger(page, position), menu, before, label)
      await expectNoHorizontalScroll(page, label)
      if (viewport.width === 360 && lane === 'Sequence') {
        // The rendered evidence for #622's PR, re-taken every run.
        await page.screenshot({ path: testInfo.outputPath('timeline-entry-menu-360.png') })
      }
      await page.keyboard.press('Escape')
      await expect(rowMenu(page, position)).toHaveCount(0)
    }
  }

  // The first and last entries' moves are disabled where their arrows are.
  const first = await openRowMenu(page, SLATE_1)
  await expect(first.getByRole('menuitem', { name: 'Move up', exact: true })).toBeDisabled()
  await expect(first.getByRole('menuitem', { name: 'Move down', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  const last = await openRowMenu(page, 'Color slate at position 3')
  await expect(last.getByRole('menuitem', { name: 'Move down', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')

  // And the items act, in a real browser: Remove asks the ✕'s question and
  // removes the track once confirmed.
  await chooseRowAction(page, 'audio track tone.wav at position 1', 'Remove')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Remove audio track tone.wav at position 1?')
  await expect(dialog).toContainText('The clip itself stays in the media library.')
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toHaveCount(0)
})

test('a collapsed row keeps its header on one line, and both panels are usable where drawn (#419)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_TEXT)
  await expect(sequenceRows(page)).toHaveCount(2)

  const list = page.getByRole('list', { name: 'Sequence' })
  const row = sequenceRows(page).first()
  // The toggle by class, not by name: its accessible name flips between
  // Collapse and Expand with the state this test changes (#299).
  const controls = [
    row.locator('.timeline-collapse-toggle'),
    row.locator('.clip-name'),
    row.locator('.clip-duration'),
    page.getByRole('button', { name: `Move ${SLATE_1} up` }),
    page.getByRole('button', { name: `Move ${SLATE_1} down` }),
    rowMenuTrigger(page, SLATE_1),
    page.getByRole('button', { name: `Remove ${SLATE_1} from timeline` }),
  ]
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    // Collapsed (#299), which is the shape the criterion names: nothing but
    // the header line is left to hold the row's width open.
    await page.getByRole('button', { name: `Collapse ${SLATE_1}` }).click()
    await expect(rowMenuTrigger(page, SLATE_1)).toBeVisible()

    for (const [index, locator] of controls.entries()) {
      await expectWithin(locator, row, { what: `row control ${index}` })
    }
    await expectNoHorizontalScroll(page, `collapsed row at ${viewport.width}px`)

    // One line: every control's centre within half the ⋯'s height of it. A
    // control pushed onto a second line is a full row height away, far
    // outside that — the discriminator #417 and #418 both used.
    const menuBox = (await rowMenuTrigger(page, SLATE_1).boundingBox())!
    for (const locator of controls) {
      const box = (await locator.boundingBox())!
      expect(
        Math.abs(centre(box) - centre(menuBox)),
        `a collapsed row's control left its header line at ${viewport.width}px`,
      ).toBeLessThan(menuBox.height / 2)
    }
    // The actions are one cluster at the row's right edge, not spread out:
    // ⋯ and ✕ are adjacent, and the whole cluster sits after the duration.
    const removeBox = (await controls[6].boundingBox())!
    const durationBox = (await controls[2].boundingBox())!
    expect(
      removeBox.x - (menuBox.x + menuBox.width),
      `⋯ and ✕ are ${(removeBox.x - menuBox.x - menuBox.width).toFixed(0)}px apart at ` +
        `${viewport.width}px, so they do not read as one cluster`,
    ).toBeLessThanOrEqual(8)
    expect(menuBox.x, 'the cluster follows the row body').toBeGreaterThan(
      durationBox.x + durationBox.width,
    )

    // The ⋯ panel, over the rows below it.
    const before = await scrollBox(list)
    await rowMenuTrigger(page, SLATE_1).click()
    await expect(rowMenu(page, SLATE_1)).toBeVisible()
    await expectMenuUsable(
      page,
      list,
      rowMenuTrigger(page, SLATE_1),
      rowMenu(page, SLATE_1),
      before,
      `row ⋯ at ${viewport.width}px`,
    )
    if (viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath('timeline-row-menu-1280.png'),
        clip: { x: 0, y: 380, width: 1280, height: 340 },
      })
    }
    await page.keyboard.press('Escape')
    await expect(rowMenu(page, SLATE_1)).toHaveCount(0)

    // Expanded again, + Effect ▾'s own panel under the fields it adds to.
    await page.getByRole('button', { name: `Expand ${SLATE_1}` }).click()
    const beforeEffect = await scrollBox(list)
    await effectMenuTrigger(page, SLATE_1).click()
    await expect(effectMenu(page, SLATE_1)).toBeVisible()
    await expectMenuUsable(
      page,
      list,
      effectMenuTrigger(page, SLATE_1),
      effectMenu(page, SLATE_1),
      beforeEffect,
      `+ Effect ▾ at ${viewport.width}px`,
    )
    if (viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath('timeline-effect-menu-1280.png'),
        clip: { x: 0, y: 380, width: 1280, height: 340 },
      })
    }
    await page.keyboard.press('Escape')
    await expect(effectMenu(page, SLATE_1)).toHaveCount(0)
  }

  // The header line survives a name long enough to need the ellipsis its
  // own CSS gives it: the cluster does not shrink and the row does not wrap.
  await page.setViewportSize({ width: 800, height: 1100 })
  await chooseRowAction(page, SLATE_1, 'Rename…')
  const field = page.getByRole('textbox', { name: `New name for ${SLATE_1}` })
  await field.fill('A slate with a deliberately very long name indeed, to squeeze the row')
  await field.press('Enter')
  const renamed = 'A slate with a deliberately very long name indeed, to squeeze the row at position 1'
  const longMenu = (await rowMenuTrigger(page, renamed).boundingBox())!
  const longRemove = (await page
    .getByRole('button', { name: `Remove ${renamed} from timeline` })
    .boundingBox())!
  expect(
    Math.abs(centre(longRemove) - centre(longMenu)),
    'a long name pushed the row onto a second line at 800px',
  ).toBeLessThan(longMenu.height / 2)
  await expectNoHorizontalScroll(page, 'a long row name at 800px')
})
