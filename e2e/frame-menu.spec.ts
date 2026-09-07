import { expect, test } from '@playwright/test'
import { closeFrameMenu, expectFrameItemEnabled, frameMenu, frameMenuTrigger } from './frameMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * The preview transport after #417 (from the approved redesign #401 /
 * feedback #395 — the customer named the preview as the busiest region and
 * asked for Split to live in its Frame menu), in real Chromium: the I / O
 * keys marking the export range, Frame ▾ driven by keyboard into Split, and
 * the rendered evidence jsdom cannot give — the transport's controls and
 * the seek bar sharing one line at the default width, everything inside the
 * panel at the narrow guard width with no sideways scroll, and the open
 * Frame ▾ panel inside the viewport at both.
 *
 * Media-free with colour slates (5 s each), like transport-keys.spec.ts.
 */

/** Clears button focus after a click, so the transport keys reach the window. */
const blurActive = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

test('I and O mark the range at the playhead; Frame ▾ opens by keyboard and Enter splits (#417)', async ({
  page,
}) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:10')
  await blurActive(page)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const sequence = page.getByRole('list', { name: 'Sequence' })

  // I at the cut (Down lands there exactly, #391), O at the end: the marked
  // range is the span between them — the #385 range spec's own readout.
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('5')
  await page.keyboard.press('i')
  await expect(page.getByTestId('preview-mark-in-marker')).toHaveAttribute('title', 'Mark in: 0:05')
  await expect(page.getByTestId('preview-marked-range')).toHaveCount(0)
  await page.keyboard.press('End')
  await expect(seek).toHaveValue('10')
  await page.keyboard.press('o')
  await expect(page.getByTestId('preview-mark-out-marker')).toHaveAttribute(
    'title',
    'Mark out: 0:10',
  )
  await expect(page.getByTestId('preview-marked-range')).toHaveAttribute(
    'title',
    'Marked range: 0:05 – 0:10',
  )
  // Re-marking from a different playhead moves the mark, as the button does.
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('5')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveValue('0')
  await page.keyboard.press('I')
  await expect(page.getByTestId('preview-marked-range')).toHaveAttribute(
    'title',
    'Marked range: 0:00 – 0:10',
  )

  // Frame ▾ → Split by keyboard. Exactly on the cut at 5 the razor has
  // nothing to split, so the item is disabled (the #391 discriminator); one
  // step away it enables, and Enter cuts there — after which the playhead
  // sits exactly on the new cut, so Split reads disabled again.
  await page.keyboard.press('ArrowDown')
  await expect(seek).toHaveValue('5')
  await expectFrameItemEnabled(page, 'preview-split', false)
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveValue('5.1')
  await frameMenuTrigger(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(frameMenu(page)).toBeVisible()
  await expect(frameMenuTrigger(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('preview-split')).toBeFocused()
  await expect(page.getByTestId('preview-split')).toBeEnabled()
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await page.keyboard.press('Enter')
  await expect(frameMenu(page)).toHaveCount(0)
  await expect(sequence.getByRole('listitem')).toHaveCount(3)
  await expect(seek).toHaveValue('5.1')
  await expectFrameItemEnabled(page, 'preview-split', false)

  // Escape on the reopened menu returns focus to Frame ▾ — the menu-button
  // contract (#412).
  await frameMenuTrigger(page).click()
  await expect(frameMenu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(frameMenu(page)).toHaveCount(0)
  await expect(frameMenuTrigger(page)).toBeFocused()
})

test('the transport fits one line at the default width, stays inside the panel at 800 px, and Frame ▾ opens inside the viewport (#417)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')
  await blurActive(page)
  // Marks set, so ✕ Marks is showing: the row at its widest.
  await page.keyboard.press('i')
  await page.keyboard.press('End')
  await page.keyboard.press('o')
  await expect(page.getByTestId('preview-clear-marks')).toBeVisible()

  const preview = page.getByRole('region', { name: 'Preview' })
  const controls = page.locator('.preview-controls')
  const seekBar = page.locator('.preview-seek')
  const controlButtons = [
    page.getByRole('button', { name: 'Play preview' }),
    page.getByRole('button', { name: 'Jump to previous cut' }),
    page.getByRole('button', { name: 'Jump to next cut' }),
    page.getByRole('button', { name: 'Mark in' }),
    page.getByRole('button', { name: 'Mark out' }),
    frameMenuTrigger(page),
    page.getByTestId('preview-clear-marks'),
  ]
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)

    // Every control inside the transport row, the row inside the preview
    // panel, no sideways page scroll.
    for (const [index, locator] of controlButtons.entries()) {
      await expectWithin(locator, controls, { what: `transport control ${index}` })
    }
    await expectWithin(seekBar, controls, { what: 'seek bar' })
    await expectWithin(controls, preview, { what: 'transport row' })
    await expectNoHorizontalScroll(page, `transport at ${viewport.width}px`)

    if (viewport.width === 1280) {
      // The plan's stated goal (#401): at the default width the seek bar
      // no longer wraps onto its own line — the controls and the slider
      // share one line. Centres within half the play button's height.
      const playBox = (await controlButtons[0].boundingBox())!
      for (const locator of [...controlButtons.slice(1), seekBar]) {
        const box = (await locator.boundingBox())!
        expect(
          Math.abs(centre(box) - centre(playBox)),
          'transport control shares the play button’s line at 1280px',
        ).toBeLessThan(playBox.height / 2)
      }
    }

    // The open Frame ▾ panel lies inside the viewport on all four edges, and
    // every item is one line.
    await frameMenuTrigger(page).click()
    const menu = frameMenu(page)
    await expect(menu).toBeVisible()
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x, `panel left at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width, `panel right at ${viewport.width}px`).toBeLessThanOrEqual(
      view.width,
    )
    expect(menuBox.y, `panel top at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(menuBox.y + menuBox.height, `panel bottom at ${viewport.width}px`).toBeLessThanOrEqual(
      view.height,
    )
    for (const item of await menu.getByRole('menuitem').all()) {
      const overflow = await item.evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    }
    await expectNoHorizontalScroll(page, `Frame menu open at ${viewport.width}px`)

    // The human check for the PR's rendered evidence, re-taken every run:
    // the preview panel plus whatever of the open panel hangs below it, so
    // the shot shows the whole menu rather than the region's bottom edge
    // cutting it off (a region screenshot did exactly that).
    const previewBox = (await preview.boundingBox())!
    const bottom = Math.min(
      Math.max(previewBox.y + previewBox.height, menuBox.y + menuBox.height) + 8,
      view.height,
    )
    await page.screenshot({
      path: testInfo.outputPath(`frame-menu-open-${viewport.width}.png`),
      clip: {
        x: previewBox.x,
        y: previewBox.y,
        width: previewBox.width,
        height: bottom - previewBox.y,
      },
    })
    await closeFrameMenu(page)
  }
})
