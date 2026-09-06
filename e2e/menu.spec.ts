import { chromium, expect, test } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'
import { expectNoHorizontalScroll } from './layout'

/**
 * The shared Menu component (#412) in real Chromium, on the Record ▾ menu
 * that now renders through it: keyboard-only operation end to end (open,
 * arrow, Enter starts that source; Escape closes with focus back on the
 * trigger), and what jsdom cannot measure — the open panel lying inside the
 * viewport at the default and the narrow (#208) widths with no sideways
 * page scroll. The fake-device flags stand in a camera so Enter on Webcam
 * really opens the recording dialog. The executable resolution mirrors
 * playwright.config.ts, which per-file launch options would otherwise drop.
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

test('the Record menu is keyboard-operable end to end: ArrowDown opens, arrows move, Enter starts, Escape closes (#412)', async ({
  page,
}) => {
  await page.goto('./')
  const trigger = page.getByRole('button', { name: 'Record' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Recording sources' })
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menuitem', { name: 'Microphone' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Screen', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Webcam' })).toBeFocused()
  await page.keyboard.press('Enter')
  // Enter started that source: the recording dialog is up and the menu gone.
  const dialog = page.getByRole('dialog', { name: 'Recording webcam' })
  await expect(dialog).toBeVisible()
  await expect(menu).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)

  // Escape closes without selecting, and focus returns to the trigger.
  await trigger.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('the open menu panel lies inside the viewport at both widths, with no sideways scroll (#412)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  const trigger = page.getByRole('button', { name: 'Record' })
  const menu = page.getByRole('menu', { name: 'Recording sources' })
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    await trigger.click()
    await expect(menu).toBeVisible()
    const box = (await menu.boundingBox())!
    const { clientWidth, innerHeight } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      innerHeight: window.innerHeight,
    }))
    expect(box.x, `panel left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `panel right at ${viewport.width}px`).toBeLessThanOrEqual(clientWidth)
    expect(box.y, `panel top at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `panel bottom at ${viewport.width}px`).toBeLessThanOrEqual(
      innerHeight,
    )
    // The panel opens below its trigger and overlaps nothing of it.
    const triggerBox = (await trigger.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1)
    // Every item is one line tall: no label wrapped inside the panel.
    for (const item of await menu.getByRole('menuitem').all()) {
      const itemBox = (await item.boundingBox())!
      expect(itemBox.height).toBeLessThan(2 * 24)
      const overflow = await item.evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    }
    await expectNoHorizontalScroll(page, `Record menu open at ${viewport.width}px`)
    // The human check for the PR's rendered evidence, re-taken every run.
    await page
      .getByRole('region', { name: 'Media library' })
      .screenshot({ path: testInfo.outputPath(`record-menu-open-${viewport.width}.png`) })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
})
