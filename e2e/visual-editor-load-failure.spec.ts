import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'

type Page = import('@playwright/test').Page

declare global {
  interface Window {
    __unhandledRejections?: string[]
  }
}

/**
 * What happens when a visual editor's chunk does not arrive (#568).
 *
 * Only a real browser can produce this. The six editors became `import()`
 * edges in #537, and in jsdom a dynamic import always resolves, so the unit
 * suite (`visualEditors.test.tsx`) can only drive the loader with a fake
 * loader. Here the request itself is aborted, which is the real failure — a
 * chunk lost to a dropped connection, or 404'd because a deploy replaced
 * the content-hashed files under an open tab.
 *
 * **The route matches the dev server's URL, not a built chunk's.**
 * `playwright.config.ts` runs this suite against `npm run dev`, so the
 * editor is served as `/src/components/CropEditor.tsx`, not
 * `assets/CropEditor-<hash>.js`. A pattern written against the built name
 * would match nothing, the editor would open normally, and the test would
 * pass while proving the opposite of what it claims. So every test here
 * asserts the block actually fired, from the route's own counters.
 */

/** A real PNG, so the still is not flat. */
async function makePng(page: Page, width = 320, height = 180): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#c33'
      ctx.fillRect(0, 0, width / 2, height)
      ctx.fillStyle = '#3c3'
      ctx.fillRect(width / 2, 0, width / 2, height)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { width, height },
  )
  return Buffer.from(base64, 'base64')
}

const position = 'base.png at position 1'
const adjustButton = (page: Page) =>
  page.getByRole('button', { name: `Adjust the crop of ${position} visually` })
const failedDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'The crop editor could not load' })
const realDialog = (page: Page) =>
  page.getByRole('dialog', { name: `Adjust the crop of ${position}` })

/**
 * Blocks the crop editor's own module, counting what the route sees: how
 * many requests were aborted, and how many were let through once `failing`
 * is lifted. `continued` is what the Try again test reads.
 */
async function blockCropEditorModule(page: Page) {
  // Unhandled rejections are collected in the page rather than through
  // `pageerror`, which only fires for uncaught exceptions: the #568 shape
  // left a rejected promise with no handler as its only trace, so that is
  // the thing to watch. Installed before any navigation.
  await page.addInitScript(() => {
    window.__unhandledRejections = []
    window.addEventListener('unhandledrejection', (event) => {
      window.__unhandledRejections?.push(String(event.reason))
    })
  })
  const state = { failing: true, aborted: 0, continued: 0 }
  await page.route('**/CropEditor.tsx**', async (route) => {
    if (state.failing) {
      state.aborted += 1
      await route.abort('failed')
    } else {
      state.continued += 1
      await route.continue()
    }
  })
  return state
}

/** One image on the timeline with its Picture disclosure open. */
async function projectWithAnImage(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.png', mimeType: 'image/png', buffer: await makePng(page) }])
  await page.getByRole('button', { name: 'Add base.png to timeline' }).click()
  await openPicture(page, position)
}

test('a visual editor whose chunk fails to load says so, instead of nothing (#568)', async ({
  page,
}, testInfo) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()

  // Before #568 this rendered nothing at all — the button reported itself
  // expanded and no dialog appeared — so the dialog's presence is the
  // assertion a regression breaks.
  const failed = failedDialog(page)
  await expect(failed).toBeVisible()
  await expect(failed).toContainText('The crop editor could not load')
  await expect(realDialog(page)).toHaveCount(0)
  expect(state.aborted, 'the route actually blocked the editor module').toBeGreaterThan(0)

  // Rendered evidence for a new visible surface (`development.md`),
  // measured on a populated project — a clip in the library, a row on the
  // timeline, the disclosure open — because an empty panel cannot overflow
  // (#549).
  await failed.scrollIntoViewIfNeeded()
  await expectWithin(failed, page.getByRole('region', { name: 'Timeline' }), {
    axis: 'x',
    what: 'the failure dialog',
  })
  await expectNoHorizontalScroll(page, 'the crop editor failed to load')

  // The message is the wide part and the buttons are fixed-width, so the
  // regression to guard is the sentence forcing them out of the box rather
  // than wrapping — `.visual-editor-failed-message` gives the text `min-width: 0`
  // for exactly this, which is the shape that overflowed in #268.
  for (const name of ['Try again', 'Reload the page', 'Close the crop editor']) {
    await expectWithin(failed.getByRole('button', { name }), failed, {
      what: `${name} in the failure dialog`,
    })
  }

  // The box is otherwise the same grey strip as an editor that opened, so
  // the message carries the only visual cue that this is a failure. Asserted
  // as "not the header default" rather than as an exact colour, so a palette
  // change is free but losing the cue is not.
  const messageColour = await failed
    .getByRole('alert')
    .evaluate((node) => getComputedStyle(node).color)
  expect(messageColour, 'the failure message is tinted, not header grey').not.toBe(
    'rgb(204, 204, 204)',
  )

  await failed.screenshot({ path: testInfo.outputPath('visual-editor-load-failed.png') })

  // Three buttons (#993) leave the message little room on a phone. At 360px
  // with `min-width: 0` alone the sentence shrank to a column one word wide
  // whose words ran under Try again; the body now wraps the buttons onto a
  // line of their own instead. Measured on the text's own line boxes, since
  // the span's box can stay clear of a button while its words overflow it.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await failed.scrollIntoViewIfNeeded()
    const overlaps = await failed.evaluate((dialog) => {
      const message = dialog.querySelector('[role="alert"]')!
      const range = document.createRange()
      range.selectNodeContents(message)
      const lines = [...range.getClientRects()]
      const buttons = [...dialog.querySelectorAll('button')].map((button) => ({
        name: button.getAttribute('aria-label') ?? button.textContent,
        box: button.getBoundingClientRect(),
      }))
      // 0.5px either way: line boxes and buttons that only touch are fine.
      return buttons.flatMap(({ name, box }) =>
        lines.some(
          (line) =>
            line.left < box.right - 0.5 &&
            line.right > box.left + 0.5 &&
            line.top < box.bottom - 0.5 &&
            line.bottom > box.top + 0.5,
        )
          ? [name]
          : [],
      )
    })
    expect(overlaps, `buttons the message's text runs under at ${width}px`).toEqual([])
    for (const name of ['Try again', 'Reload the page', 'Close the crop editor']) {
      await expectWithin(failed.getByRole('button', { name }), failed, {
        what: `${name} in the failure dialog at ${width}px`,
      })
    }
    await expectNoHorizontalScroll(page, `the crop editor failed to load, ${width}px`)
    await failed.screenshot({ path: testInfo.outputPath(`visual-editor-load-failed-${width}.png`) })
  }

  // A failed chunk is handled, not thrown at the page: the #568 shape left
  // an unhandled rejection as the only trace of itself.
  expect(
    await page.evaluate(() => window.__unhandledRejections ?? []),
    'the failed import is handled, not left unhandled',
  ).toEqual([])
})

test('the failure dialog can be dismissed, leaving the row as it was (#568)', async ({ page }) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()

  const failed = failedDialog(page)
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Close the crop editor' }).click()

  // ✕ runs the editor's own onClose, so the row is back to what it was
  // before the button was pressed rather than holding a dead dialog.
  await expect(failed).toHaveCount(0)
  await expect(adjustButton(page)).toBeVisible()
  expect(state.aborted).toBeGreaterThan(0)
})

test('reloading after a failed chunk is what brings the editor back (#568)', async ({ page }) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()
  await expect(failedDialog(page)).toBeVisible()

  // Reload the page, the remedy that works in every browser, taken end to
  // end: the block lifts (the connection came back, or the deploy settled),
  // the button reloads, and the editor opens — the module map the reload
  // discards is the whole difference from the Try again test below, in a
  // browser that caches the failure.
  state.failing = false
  await failedDialog(page).getByRole('button', { name: 'Reload the page' }).click()

  // A fresh page, so the project is built again rather than restored: what
  // is under test is the module loading, and autosave's restore offer has
  // its own spec.
  await projectWithAnImage(page)
  await adjustButton(page).click()

  await expect(realDialog(page)).toBeVisible()
  await expect(realDialog(page).getByTestId('frame-editor-image')).toBeVisible()
  await expect(failedDialog(page)).toHaveCount(0)
  expect(state.continued, 'the reload refetched the module').toBeGreaterThan(0)
})

test('Escape dismisses the failure panel, and ✕ holds focus — as the tooltip says (#568)', async ({
  page,
}) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()

  const failed = failedDialog(page)
  await expect(failed).toBeVisible()

  // The ✕ reads `Close (Esc)`, copied from the six editors this panel stands
  // in for — whose own Escape handlers ship inside the chunk that just failed
  // to arrive. Found in review of #570, where the tooltip named a key nothing
  // listened for. Focus on the ✕ is the other half: the handler is on the
  // dialog, so the key only reaches it from inside, and ✕ rather than Reload
  // the page because the reload is what discards unsaved work.
  await expect(failed.getByRole('button', { name: 'Close the crop editor' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(failed).toHaveCount(0)
  await expect(adjustButton(page)).toBeVisible()
  expect(state.aborted, 'the route actually blocked the editor module').toBeGreaterThan(0)
})

test('Try again opens the editor where the browser fetches the module again, and points at Reload where it does not (#993)', async ({
  page,
}, testInfo) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()
  const failed = failedDialog(page)
  await expect(failed).toBeVisible()
  const abortedOnce = state.aborted

  // The block lifts, as a connection coming back would, and Try again
  // imports the same specifier a second time. Whether that import reaches
  // the network is the browser's call, which is why the dialog offers both
  // remedies rather than either one (#568, #886, #993).
  state.failing = false
  await failed.getByRole('button', { name: 'Try again' }).click()
  const stillFailed = failed.getByRole('alert').filter({ hasText: 'still could not load' })
  await expect(realDialog(page).or(stillFailed)).toBeVisible()

  // **Which browser runs this decides what it can assert (#886).** The
  // caching is measured in the browsers CI runs: Playwright's pinned
  // Chromium (151 at the time of #886) and Firefox 153 both answer the
  // second import from the failed entry, with no request. Chromium 158 does
  // not: it requests the module again, and the editor opens. Session
  // containers ship such a newer Chromium and not the pinned one, so
  // `tools/chromiumExecutable.ts` launches it, and `launchOptions
  // .executablePath` is set only then. On that browser this test asserts
  // Try again's other outcome, the editor opening, and notes the browser.
  // `npx playwright install chromium-headless-shell` installs the pinned
  // build, which the resolver then prefers, and the strict assertions below
  // run locally too.
  const substitute = testInfo.project.use.launchOptions?.executablePath !== undefined
  if (substitute && state.continued > 0) {
    await expect(realDialog(page)).toBeVisible()
    await expect(realDialog(page).getByTestId('frame-editor-image')).toBeVisible()
    await expect(failedDialog(page)).toHaveCount(0)
    expect(state.aborted, 'the second attempt was let through, not blocked again').toBe(abortedOnce)
    testInfo.annotations.push({
      type: 'browser',
      description: `${page.context().browser()?.version()} re-requested a module whose fetch had failed, and Try again opened the editor (#886, #993)`,
    })
    return
  }

  // A browser that caches the failure: the attempt never reaches the
  // network, the dialog stays, and its sentence now points at the remedy
  // that does work here.
  await expect(stillFailed).toHaveText('The crop editor still could not load. Reloading the page fetches it again.')
  await expect(realDialog(page)).toHaveCount(0)
  expect(state.aborted, 'no further request was even attempted').toBe(abortedOnce)
  expect(state.continued, 'the module map answered from cache, not the network').toBe(0)
  // Focus is back on ✕, so Escape still reaches the panel.
  await expect(failed.getByRole('button', { name: 'Close the crop editor' })).toBeFocused()
  await failed.screenshot({ path: testInfo.outputPath('visual-editor-try-again-failed.png') })

  // If this test ever fails in CI because the editor opened, Playwright's
  // pinned browser has stopped caching failed module fetches, as Chromium
  // 158 already has (#886): Try again then works there, and the branch
  // above becomes the one to assert in that browser.
})
