import { expect, test } from '@playwright/test'
import {
  expectBottomWithinViewport,
  expectNoHorizontalScroll,
  expectNoVerticalPageScroll,
  expectWithin,
} from './layout'
import { sineWav } from './sineWav'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * The app fits the window (#524, from the customer's own report #519).
 *
 * Two symptoms, one cause. `.app` was `min-height: 100vh`, which left
 * `.app-body`'s height indefinite, so the guide panel could not size itself
 * against the room under the header and said `max-height: 100vh` instead —
 * a whole viewport, starting a header-height down the page, ending that far
 * below the window with the lower end of its own scrollbar off-screen. The
 * same indefiniteness sent a busy timeline's overflow to the page, putting
 * the timeline below the window too. Measured before the fix at 1280×720
 * with six slates on the timeline: guide panel bottom **812px** down a
 * 720px window, page overflow **743px**; and at 360×640, where the header
 * wraps to 146px, an *empty* project overflowed by **111px**.
 *
 * These are the assertions the shell did not have. `e2e/layout.ts` carried
 * `expectNoHorizontalScroll` and no vertical twin, so every recent UI PR
 * asserted the app did not overflow sideways and none asserted it fitted
 * down the page; both helpers this spec leans on are new there.
 *
 * 360×640 is deliberate: it is the width at which `.app-header` wraps to
 * three lines, so a fix that subtracted a constant header height would pass
 * every other case here and fail this one.
 *
 * The shell is measured on a **populated** project (#549): fourteen clips in
 * the library as well as rows on the timeline, because an empty panel cannot
 * overflow — #545's list painted 24px over the Timeline heading with 14
 * clips and 0 with 3, under reviews that had measured the shell on an empty
 * library. The empty-project cases stay for what they are about (the shell
 * on load, the header's wrap); each is followed by the populated one.
 */

const guidePanel = (page: Page) => page.getByRole('complementary', { name: 'User guide' })
const editorColumn = (page: Page) => page.getByRole('main')
const timelinePanel = (page: Page) => page.getByRole('region', { name: 'Timeline' })
const sequenceRows = (page: Page) =>
  page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')
const libraryPanel = (page: Page) => page.getByRole('region', { name: 'Media library' })
const libraryList = (page: Page) => page.getByRole('list', { name: 'Imported clips' })

/** Enough clips to make the library's list scroll at every size here (#545: 14 overflowed, 3 did not). */
const LIBRARY_CLIPS = 14

async function openGuide(page: Page) {
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page
    .getByRole('menu', { name: 'Help menu' })
    .getByRole('menuitem', { name: 'User guide…' })
    .click()
  await expect(guidePanel(page)).toBeVisible()
}

/** A timeline with more rows than the window has room for. */
async function fillTimeline(page: Page, rows: number) {
  for (let i = 0; i < rows; i += 1) await chooseFromAddMenu(page, ADD_SLATE)
  await expect(sequenceRows(page)).toHaveCount(rows)
}

/** A library with more clips than its list has room for — tiny WAVs, imported in one go. */
async function fillLibrary(page: Page, clips = LIBRARY_CLIPS) {
  await page.getByTestId('clip-file-input').setInputFiles(
    Array.from({ length: clips }, (_, i) => ({
      name: `clip-${String(i + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: sineWav(0.2),
    })),
  )
  await expect(libraryList(page).getByRole('listitem')).toHaveCount(clips)
}

/** Both panels that grow with content, grown (#549). */
async function populate(page: Page, rows: number) {
  await fillLibrary(page)
  await fillTimeline(page, rows)
}

/**
 * The shell's guard on the library (#545): its list stays inside its panel
 * however many clips it holds. The page-fit assertions cannot see this one —
 * the list painted over the Timeline heading while the page read zero.
 */
async function expectLibraryListInsidePanel(page: Page, where: string) {
  await expectWithin(libraryList(page), libraryPanel(page), {
    axis: 'y',
    what: `the clip list, ${where}`,
  })
}

test('the editor fits the window on load at every supported width, header wrapped or not (#524)', async ({
  page,
}) => {
  for (const size of [
    { width: 1280, height: 900 },
    { width: 1280, height: 720 },
    // Where the header wraps: 146px tall here against 92px at 1280.
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('./')
    const where = `empty project at ${size.width}×${size.height}`
    await expect(timelinePanel(page)).toBeVisible()
    await expectNoVerticalPageScroll(page, where)
    await expectNoHorizontalScroll(page, where)

    // Then populated (#549): fourteen clips and six rows, more than either
    // panel can show, because an empty panel cannot overflow and the two
    // defects this file guards against were both invisible on an empty app.
    await populate(page, 6)
    const populated = `populated project at ${size.width}×${size.height}`
    await expectNoVerticalPageScroll(page, populated)
    await expectNoHorizontalScroll(page, populated)
    await expectLibraryListInsidePanel(page, populated)

    await openGuide(page)
    await expectNoVerticalPageScroll(page, `${populated}, guide open`)
    await expectNoHorizontalScroll(page, `${populated}, guide open`)
    await expectBottomWithinViewport(guidePanel(page), page, `the guide panel, ${populated}`)
    await expectLibraryListInsidePanel(page, `${populated}, guide open`)
  }
})

test('the timeline is on screen on load, not below the window (#524)', async ({ page }) => {
  // The customer's second sentence: "the bottom of the timeline is also
  // about 4 lines of text or perhaps 50 pixels below the actual bottom of
  // the visible window" (#519). Asserted at the two desktop sizes, where an
  // empty project has room for the whole panel; at 360×640 the editor
  // column scrolls, and what holds there is the page-fit assertion above.
  for (const size of [
    { width: 1280, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('./')
    await expect(timelinePanel(page)).toBeVisible()
    await expectBottomWithinViewport(
      timelinePanel(page),
      page,
      `the timeline panel at ${size.width}×${size.height}`,
    )
  }
})

test('the guide panel ends at the bottom of the window and scrolls on its own (#524)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  // A timeline tall enough that the old shell sent the overflow to the page,
  // which is the state the panel over-ran in: unscrolled, the panel began
  // under the header and was still allowed a whole viewport.
  await page.goto('./')
  await populate(page, 6)
  await openGuide(page)

  // The panel's own edge first: it is the defect the customer reported, and
  // it read 812px down a 720px window before the fix, so a failure here
  // should say so rather than be pre-empted by the page-scroll assertion.
  await expectBottomWithinViewport(guidePanel(page), page, 'the guide panel over a tall project')
  await expectNoVerticalPageScroll(page, 'fourteen clips, six slates, guide open')
  await expectLibraryListInsidePanel(page, 'fourteen clips, six slates, guide open')

  // On a long section, so the panel really has more than it can show: the
  // Feature Index is hundreds of entries at any window size, while the
  // section it opens on depends on screenshots having loaded.
  await page.goto('./#guide/feature-index')
  await expect(guidePanel(page)).toBeVisible()
  await expect(guidePanel(page).getByRole('heading', { name: 'Feature Index' })).toBeVisible()
  await expectBottomWithinViewport(guidePanel(page), page, 'the guide panel on the Feature Index')

  const panel = guidePanel(page)
  await expect
    .poll(
      () => panel.evaluate((node) => node.scrollHeight - node.clientHeight),
      { message: 'the guide panel has more content than it can show' },
    )
    .toBeGreaterThan(0)

  // Its own scrollbar reaches the bottom without the page moving — the
  // customer had to "scroll slightly down in the main section" first.
  await panel.evaluate((node) => node.scrollTo(0, node.scrollHeight))
  await expect
    .poll(
      () => panel.evaluate((node) => Math.round(node.scrollTop + node.clientHeight - node.scrollHeight)),
      { message: 'the guide panel scrolled to its own end' },
    )
    .toBeGreaterThanOrEqual(-1)
  expect(await page.evaluate(() => window.scrollY), 'the page moved with the panel').toBe(0)
  await expectBottomWithinViewport(guidePanel(page), page, 'the guide panel scrolled to its end')
})

test('a menu in the scrolling column survives the scroll that revealed its trigger, and still closes on a real one (#524)', async ({
  page,
}) => {
  // The editor column scrolling makes it a clipping ancestor, so a menu
  // inside it is now *lifted* to `position: fixed` (#416) and closes when
  // the box under it scrolls. A scroll event is dispatched asynchronously,
  // so the scroll a browser performs to bring a trigger into view before
  // clicking it can land after the menu that click opened — closing it at
  // once. Both halves are asserted here: the stale event is ignored, a real
  // scroll still closes.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await fillTimeline(page, 6)

  const last = 'Color slate at position 6'
  const trigger = page.getByRole('button', { name: `More actions for ${last}`, exact: true })
  const menu = page.getByRole('menu', { name: `More actions for ${last}`, exact: true })
  const column = editorColumn(page)

  // Opened from the column's far end, where the browser has to scroll to
  // reach the trigger at all.
  await column.evaluate((node) => node.scrollTo(0, node.scrollHeight))
  await trigger.click()
  await expect(menu).toBeVisible()
  expect(await menu.evaluate((node) => getComputedStyle(node).position), 'the panel is lifted').toBe(
    'fixed',
  )

  // A scroll event that moves nothing — the shape of the stale one — leaves
  // it open, and its items are still there to be used.
  await column.evaluate((node) => node.dispatchEvent(new Event('scroll', { bubbles: false })))
  await expect(menu).toBeVisible()
  expect(await menu.getByRole('menuitem').count(), 'the menu kept its items').toBeGreaterThan(0)

  // A scroll that moves the row out from under the panel still closes it.
  await column.evaluate((node) => node.scrollTo(0, 0))
  await expect(menu).toHaveCount(0)
})

test('a project taller than the window stays reachable — in the editor column, not the page (#524)', async ({
  page,
}) => {
  // The fix must not trap content in a clipped box. The overflow moved from
  // the page to the editor column, so this asserts the column scrolls and
  // every row can be brought on screen — the same guarantee the page scroll
  // gave, measured where it now lives.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await populate(page, 8)

  await expectNoVerticalPageScroll(page, 'fourteen clips, eight slates')
  await expectLibraryListInsidePanel(page, 'fourteen clips, eight slates')
  const column = editorColumn(page)
  const overflow = await column.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }))
  expect(
    overflow.scrollHeight,
    `the editor column holds ${overflow.scrollHeight}px in ${overflow.clientHeight}px but does not scroll`,
  ).toBeGreaterThan(overflow.clientHeight)

  for (const row of await sequenceRows(page).all()) {
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeInViewport()
  }
  // Scrolling the column never scrolls the page, whatever it reached.
  expect(await page.evaluate(() => window.scrollY), 'the page scrolled').toBe(0)
})

test('the preview panel keeps its picture inside it, expanded and at narrow widths (#524)', async ({
  page,
}) => {
  // The shell's definite height changed how the editor's grid sizes a row
  // whose item takes its height from an `aspect-ratio` — which the preview
  // stage does, expanded and below 700px. An `auto` implicit row credited
  // it with nothing: the row resolved to the panel's padding and border,
  // 34px with a zero-height content box, while the stage still laid out at
  // full size and painted over the media library and the timeline. Every
  // assertion in this file and in `preview-layout.spec.ts` stayed green
  // through it, because the stage's own box was never wrong — only the
  // panel's, and nothing measured whether one was inside the other.
  const previewPanel = page.getByRole('region', { name: 'Preview' })
  const picture = page.getByTestId('preview-frame')

  // Expanded, at a desktop size (#128 option B, customer-approved in #126).
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await populate(page, 6)
  await page.getByRole('button', { name: 'Expand preview' }).click()
  await expect(page.getByRole('button', { name: 'Restore preview size' })).toBeVisible()
  await expectWithin(picture, previewPanel, {
    axis: 'y',
    what: 'the expanded preview picture',
  })

  // And it is not merely drawn inside — a control below it still takes the
  // click. The spilled stage covered the timeline's own buttons, so this
  // click was refused with "preview-slate intercepts pointer events".
  await page.getByRole('button', { name: 'Expand all timeline elements' }).click()
  await page.getByRole('button', { name: 'Restore preview size' }).click()

  // The single-column layout below 700px, where the stage takes its height
  // from its width too — no expanding needed, just a clip on the timeline.
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')
  await populate(page, 3)
  await expectWithin(picture, previewPanel, {
    axis: 'y',
    what: 'the preview picture in the single-column layout',
  })
  await expectLibraryListInsidePanel(page, 'the single-column layout')
})
