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
 * is lifted. `continued` is what the "why not a Retry" test reads.
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
  // than wrapping — `.effect-editor-failed` gives the text `min-width: 0`
  // for exactly this, which is the shape that overflowed in #268.
  for (const name of ['Reload the page', 'Close the crop editor']) {
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

  // The remedy the dialog offers, taken end to end: the block lifts (the
  // connection came back, or the deploy settled), the button reloads, and
  // the editor opens — the module map the reload discards is the whole
  // difference from the "no Retry" test below.
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

test('a second attempt without reloading never reaches the network — why there is no Retry (#568)', async ({
  page,
}) => {
  const state = await blockCropEditorModule(page)
  await projectWithAnImage(page)
  await adjustButton(page).click()
  await expect(failedDialog(page)).toBeVisible()
  const abortedOnce = state.aborted

  // This is the measurement the loader's comment cites. A browser caches a
  // module whose fetch failed, so importing the same specifier again
  // re-rejects without issuing a request — which is why the loader clearing
  // its own promise cache cannot produce a working Retry, and why the
  // dialog offers a reload instead.
  state.failing = false
  await failedDialog(page).getByRole('button', { name: 'Close the crop editor' }).click()
  await adjustButton(page).click()

  await expect(failedDialog(page)).toBeVisible()
  await expect(realDialog(page)).toHaveCount(0)
  expect(state.aborted, 'no further request was even attempted').toBe(abortedOnce)
  expect(state.continued, 'the module map answered from cache, not the network').toBe(0)

  // If this test ever fails because the editor opened, the browser has
  // stopped caching failed module fetches and a Retry button becomes
  // possible: revisit the dialog in src/components/visualEditors.tsx.
})
