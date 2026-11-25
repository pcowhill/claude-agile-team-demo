import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * Tall dialogs fit the window (#948, from the customer's #944): a dialog
 * taller than the window is capped at it, its heading and its buttons stay
 * on screen, and the content between them scrolls inside the dialog's own
 * `.dialog-body`. A dialog that fits is left exactly as tall as its
 * content.
 *
 * Measured on a populated state, as `development.md` asks of a layout
 * measurement: the Plugins dialog lists every plugin in the catalog, the
 * Keyboard shortcuts every scope, Settings every row, and the Export dialog
 * opens on a timeline with a slate on it, so each holds all it ever does
 * when nothing is in progress.
 */

/** The overlay's padding above and below a capped dialog (dialog.css: `padding: 1rem 0`). */
const MARGIN = 16
/**
 * Slack on each edge comparison. Sub-pixel layout and the dialog's 1px
 * border put an edge a fraction past the line it visibly sits on, as
 * `expectWithin` in `e2e/layout.ts` explains for its 1px default.
 */
const TOLERANCE = 1

interface Box {
  top: number
  bottom: number
}

interface Fit {
  window: number
  dialog: Box
  heading: Box
  lastButton: Box
  body: Box & { scrollHeight: number; clientHeight: number }
  overlay: { scrollHeight: number; clientHeight: number }
  page: { scrollHeight: number; clientHeight: number }
}

/**
 * One page read of everything the fit depends on, so every number comes
 * from the same render (`quality-and-ci.md`). The heading is the dialog's
 * first child (an `h3`, or the Trim-family header), and the last button is
 * the last one in its button row.
 */
async function measure(dialog: Locator): Promise<Fit> {
  return dialog.evaluate((element) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }
    const body = element.querySelector(':scope > .dialog-body')
    const buttons = element.querySelectorAll(':scope > :last-child button')
    const overlay = element.parentElement!
    if (body === null) throw new Error('the dialog has no .dialog-body')
    if (buttons.length === 0) throw new Error('the dialog has no button row')
    return {
      window: window.innerHeight,
      dialog: box(element),
      heading: box(element.firstElementChild!),
      lastButton: box(buttons[buttons.length - 1]),
      body: { ...box(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight },
      overlay: { scrollHeight: overlay.scrollHeight, clientHeight: overlay.clientHeight },
      page: {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
    }
  })
}

/**
 * The cap: the dialog inside the window with the overlay's margin, its
 * heading and last button inside the window without any scrolling, the
 * body overflowing (so the cap is what binds), and neither the overlay nor
 * the page scrolling.
 */
async function expectCapped(dialog: Locator, what: string): Promise<Fit> {
  const fit = await measure(dialog)
  const where = `${what}: ${JSON.stringify(fit)}`
  expect(fit.dialog.top, `${where}: the dialog's top margin`).toBeGreaterThanOrEqual(MARGIN - TOLERANCE)
  expect(fit.dialog.bottom, `${where}: the dialog's bottom margin`).toBeLessThanOrEqual(
    fit.window - MARGIN + TOLERANCE,
  )
  expect(fit.heading.top, `${where}: the heading in the window`).toBeGreaterThanOrEqual(fit.dialog.top)
  expect(fit.lastButton.bottom, `${where}: the last button in the window`).toBeLessThanOrEqual(
    fit.dialog.bottom + TOLERANCE,
  )
  expect(fit.body.scrollHeight, `${where}: the body overflows, so it scrolls`).toBeGreaterThan(
    fit.body.clientHeight,
  )
  expect(fit.overlay.scrollHeight, `${where}: the overlay does not scroll`).toBeLessThanOrEqual(
    fit.overlay.clientHeight + TOLERANCE,
  )
  expect(fit.page.scrollHeight, `${where}: the page does not scroll`).toBeLessThanOrEqual(
    fit.page.clientHeight + TOLERANCE,
  )
  return fit
}

/**
 * The inner scroll reaches everything: scrolled to its end, the body shows
 * `last`, and the heading and the last button have not moved.
 */
async function expectScrollsTo(dialog: Locator, last: Locator, what: string, before: Fit) {
  const body = dialog.locator(':scope > .dialog-body')
  await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect
    .poll(
      () =>
        last.evaluate((element) => {
          const body = element.closest('.dialog-body')!.getBoundingClientRect()
          const item = element.getBoundingClientRect()
          return item.top >= body.top - 1 && item.bottom <= body.bottom + 1
        }),
      { message: `${what}: the last item in view once the body is scrolled to its end` },
    )
    .toBe(true)
  const after = await measure(dialog)
  expect(after.heading.top, `${what}: the heading stays put`).toBeCloseTo(before.heading.top, 0)
  expect(after.lastButton.bottom, `${what}: the buttons stay put`).toBeCloseTo(before.lastButton.bottom, 0)
}

async function openShortcuts(page: Page): Promise<Locator> {
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openFromFileMenu(page: Page, item: string, name: string): Promise<Locator> {
  await chooseFromFileMenu(page, item)
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Tall dialogs fit the window (#948)', () => {
  test('at 1280×600, Plugins, Keyboard shortcuts, Settings and Export each cap at the window and scroll their body', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto('./')
    await chooseFromAddMenu(page, ADD_SLATE)

    const plugins = await openFromFileMenu(page, 'Plugins…', 'Plugins')
    const pluginsFit = await expectCapped(plugins, 'Plugins')
    await testInfo.attach('plugins-1280x600.png', { body: await page.screenshot(), contentType: 'image/png' })
    await expectScrollsTo(plugins, plugins.locator('.plugin-row').last(), 'Plugins', pluginsFit)
    await plugins.getByRole('button', { name: 'Close' }).click()

    const shortcuts = await openShortcuts(page)
    const shortcutsFit = await expectCapped(shortcuts, 'Keyboard shortcuts')
    await expectScrollsTo(shortcuts, shortcuts.locator('.shortcut-row').last(), 'Keyboard shortcuts', shortcutsFit)
    await shortcuts.getByRole('button', { name: 'Close' }).click()

    const settings = await openFromFileMenu(page, 'Settings…', 'Settings')
    const settingsFit = await expectCapped(settings, 'Settings')
    await expectScrollsTo(settings, settings.locator('.settings-row').last(), 'Settings', settingsFit)
    await settings.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Export Project…' }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export project' })
    await expect(exportDialog).toBeVisible()
    const exportFit = await expectCapped(exportDialog, 'Export')
    await expectScrollsTo(
      exportDialog,
      exportDialog.locator(':scope > .dialog-body > *').last(),
      'Export',
      exportFit,
    )
    await exportDialog.getByRole('button', { name: 'Cancel' }).click()
  })

  test('a dialog that fits keeps its height and shows no scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('./')
    await chooseFromAddMenu(page, ADD_SLATE)

    // Save As… opens the save-mode dialog: two options and two buttons.
    const save = await openFromFileMenu(page, 'Save As…', 'Save project')
    const fit = await measure(save)
    const where = `Save project: ${JSON.stringify(fit)}`
    // Not capped: the body is exactly as tall as its content, and the
    // dialog sits clear of both margins with room to spare.
    expect(fit.body.scrollHeight, `${where}: no overflow in the body`).toBeLessThanOrEqual(
      fit.body.clientHeight + TOLERANCE,
    )
    expect(fit.dialog.bottom - fit.dialog.top, `${where}: well short of the cap`).toBeLessThan(
      fit.window - 2 * MARGIN - 100,
    )
  })
})
