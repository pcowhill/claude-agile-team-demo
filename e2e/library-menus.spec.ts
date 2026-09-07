import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'
import {
  chooseView,
  clipMenu,
  clipMenuTrigger,
  expectViewChecked,
  openClipMenu,
  openViewMenu,
  viewMenu,
  viewMenuTrigger,
} from './clipMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The media library after #416 (from the approved redesign #401 option L1 /
 * feedback #395 "So Many Buttons"), in real Chromium: the header's View ▾
 * and each row's ⋯, driven by keyboard, and the rendered evidence jsdom
 * cannot give — the row keeping its three actions together on one line and
 * itself to two, the card's cluster inside its card, and, the reason this
 * spec exists at all, **the open ⋯ panels not being clipped by the library
 * list's own scrolling box**. `.clip-list` is `max-height: 50vh; overflow-y: auto`
 * (#308), and a menu panel inside a row is a descendant of that box. Left
 * there, a short list — one only as tall as its rows — cut the panel off
 * below its last row and grew a scrollbar to hold it, and a long list did
 * the same to any row near its bottom edge, with every containment
 * assertion against the viewport still passing. `Menu.tsx` lifts such a
 * panel out of the box, and what is asserted here is the property that
 * matters to the customer: the list's scroll box unchanged by opening a
 * menu, and every item hittable where it is drawn (`expectMenuUsable`).
 *
 * Media-free apart from one recorded WebM, which the Extract audio item
 * needs a real video for.
 */

/** Records a short real WebM in-browser as decodable video source material. */
async function recordWebm(page: Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1200) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

/** Imports `count` audio clips plus one video, and waits for all of them. */
async function importClips(page: Page, count: number): Promise<void> {
  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')
  const webm = await recordWebm(page)
  await input.setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(rows).toHaveCount(1)
  for (let index = 0; index < count; index++) {
    await input.setInputFiles([
      { name: `tone-${index}.wav`, mimeType: 'audio/wav', buffer: sineWav(2) },
    ])
    await expect(rows).toHaveCount(index + 2)
  }
}

/** The list's scroll box, for reading before and after a menu opens. */
const scrollBox = (list: Locator) =>
  list.evaluate((node) => ({ scrollHeight: node.scrollHeight, scrollTop: node.scrollTop }))

/**
 * The open panel is usable where it is drawn: anchored to its trigger;
 * inside the viewport; every item hit-testable at its own centre
 * (`elementFromPoint` resolves to the item, not to what a clipped panel
 * would leave showing through), with its label on one line; and the list's
 * scroll box exactly as it was before the menu opened — no scrollbar grown
 * to hold the panel, no jump to reveal it. Measured on the first cut of this
 * PR with two clips at 1280×720: the panel ran 17px past the list's box, the
 * list's `scrollHeight` went 77 → 94, and the centre of Remove hit the
 * section behind the menu.
 *
 * "Anchored" is not decoration: the panel is lifted out of the list with
 * `position: fixed` and placed by measurement, and a mis-measured panel
 * lands at the viewport's corner — inside the viewport, every item hittable,
 * nowhere near the row that opened it. It caught exactly that once.
 */
async function expectMenuUsable(
  page: Page,
  list: Locator,
  trigger: Locator,
  menu: Locator,
  before: { scrollHeight: number; scrollTop: number },
  label: string,
): Promise<void> {
  expect(await scrollBox(list), `opening ⋯ changed the list's scroll box (${label})`).toEqual(
    before,
  )
  const view = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }))
  const box = (await menu.boundingBox())!
  expect(box.x, `panel left (${label})`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `panel right (${label})`).toBeLessThanOrEqual(view.width)
  expect(box.y, `panel top (${label})`).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, `panel bottom (${label})`).toBeLessThanOrEqual(view.height)
  // Anchored: the panel opens directly below its trigger, or directly above
  // it when flipped, and shares the trigger's left edge, or its right edge
  // when flipped. The panel's own 0.25rem gap plus a pixel of rounding is
  // the tolerance, so 8px.
  const anchor = (await trigger.boundingBox())!
  const belowGap = box.y - (anchor.y + anchor.height)
  const aboveGap = anchor.y - (box.y + box.height)
  expect(
    Math.min(Math.abs(belowGap), Math.abs(aboveGap)),
    `panel is not against its trigger: panel y ${box.y}–${box.y + box.height}, ` +
      `trigger y ${anchor.y}–${anchor.y + anchor.height} (${label})`,
  ).toBeLessThanOrEqual(8)
  expect(
    Math.min(Math.abs(box.x - anchor.x), Math.abs(box.x + box.width - (anchor.x + anchor.width))),
    `panel shares neither edge with its trigger: panel x ${box.x}–${box.x + box.width}, ` +
      `trigger x ${anchor.x}–${anchor.x + anchor.width} (${label})`,
  ).toBeLessThanOrEqual(1)
  for (const item of await menu.getByRole('menuitem').all()) {
    const text = await item.textContent()
    const hit = await item.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        ok: at !== null && node.contains(at),
        found: at === null ? 'nothing' : `${at.tagName.toLowerCase()}.${at.className}`,
        oneLine: node.scrollWidth <= node.clientWidth,
      }
    })
    expect(hit.ok, `"${text}" is not hittable at its centre — found ${hit.found} (${label})`).toBe(
      true,
    )
    expect(hit.oneLine, `"${text}" overflows its item (${label})`).toBe(true)
  }
}

test('⋯ offers what its buttons did, per kind, and removes a clip by keyboard alone (#416)', async ({
  page,
}) => {
  await page.goto('./')
  await importClips(page, 1)
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')

  // A video's ⋯ carries all four; an audio clip's carries only the two that
  // apply — the per-kind exclusions the buttons expressed by not rendering.
  // And each is usable in a **two-clip** list, the common state of a library
  // and the one a panel kept inside the list's box can never fit: two rows
  // have room for a four-item panel neither below nor above.
  const shortList = await scrollBox(list)
  const video = await openClipMenu(page, 'clip.webm')
  await expect(video.getByRole('menuitem')).toHaveText([
    'Add as overlay',
    'Extract audio',
    'Rename…',
    'Remove',
  ])
  await expectMenuUsable(
    page,
    list,
    clipMenuTrigger(page, 'clip.webm'),
    video,
    shortList,
    'a video in a two-clip list',
  )
  await page.keyboard.press('Escape')
  const audio = await openClipMenu(page, 'tone-0.wav')
  await expect(audio.getByRole('menuitem')).toHaveText(['Rename…', 'Remove'])
  await expectMenuUsable(
    page,
    list,
    clipMenuTrigger(page, 'tone-0.wav'),
    audio,
    shortList,
    'an audio clip in a two-clip list',
  )
  await page.keyboard.press('Escape')
  await expect(clipMenu(page, 'tone-0.wav')).toHaveCount(0)
  await expect(clipMenuTrigger(page, 'tone-0.wav')).toBeFocused()

  // Keyboard only, from the trigger: ArrowDown opens on the first item,
  // ArrowDown again lands on Remove, Enter selects it, and the confirmation
  // takes over. Nothing here touches the mouse.
  await clipMenuTrigger(page, 'tone-0.wav').focus()
  await page.keyboard.press('ArrowDown')
  const opened = clipMenu(page, 'tone-0.wav')
  await expect(opened).toBeVisible()
  await expect(opened.getByRole('menuitem', { name: 'Rename…' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(opened.getByRole('menuitem', { name: 'Remove', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  const confirmation = page.getByRole('dialog', { name: 'Remove tone-0.wav?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(clipMenuTrigger(page, 'tone-0.wav')).toHaveCount(0)
})

test('View ▾ switches layout and sorts, and remembers the layout across a reload (#416)', async ({
  page,
}) => {
  await page.goto('./')
  await importClips(page, 2)
  const list = page.getByRole('list', { name: 'Imported clips' })
  const names = () => list.getByRole('listitem').locator('.clip-name').allTextContents()

  // Import order, then the sort key checked with its direction arrow.
  expect(await names()).toEqual(['clip.webm', 'tone-0.wav', 'tone-1.wav'])
  const menu = await openViewMenu(page)
  const byName = menu.getByRole('menuitemradio', { name: 'Name', exact: true })
  await expect(byName).toHaveAttribute('aria-checked', 'false')
  await byName.click()
  await expect(menu).toHaveCount(0)
  expect(await names()).toEqual(['clip.webm', 'tone-0.wav', 'tone-1.wav'])
  await openViewMenu(page)
  await expect(byName).toHaveAttribute('aria-checked', 'true')
  await expect(byName.locator('.menu-item-label')).toHaveText('Name ↑')

  // The same key again reverses, and the arrow follows — what re-clicking
  // the pressed button did (#123).
  await byName.click()
  expect(await names()).toEqual(['tone-1.wav', 'tone-0.wav', 'clip.webm'])
  await openViewMenu(page)
  await expect(byName.locator('.menu-item-label')).toHaveText('Name ↓')
  await page.keyboard.press('Escape')

  // The layout choice, both ways.
  await expectViewChecked(page, 'List')
  await chooseView(page, 'Thumbnails')
  await expect(list).toHaveClass(/clip-list-thumbnails/)
  await chooseView(page, 'List')
  await expect(list).not.toHaveClass(/clip-list-thumbnails/)
  await chooseView(page, 'Thumbnails')

  // And it is remembered per browser (#311). A reload empties the library —
  // the clips are object URLs — so what is asserted here is the menu's own
  // state, which is exactly the preference; `library-thumbnails.spec.ts`
  // covers the restored layout itself.
  await page.reload()
  await expectViewChecked(page, 'Thumbnails')
})

test('the row keeps its actions together, and neither panel is clipped by the list or the viewport (#416)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  // Enough clips that the list is scrolling at both widths, so the last
  // row's ⋯ opens near the bottom of `.clip-list`'s box — the case a
  // viewport-only containment check would pass while the panel is cut off.
  // Thirteen because a row is one line (36px) at 1280 now: the list bounds
  // at 50vh = 360px, which eight one-line rows no longer reach.
  await importClips(page, 12)
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')
  await expect(rows).toHaveCount(13)

  const library = page.getByRole('region', { name: 'Media library' })
  const lastClip = 'tone-11.wav'

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const label = `${viewport.width}px`

    // The list really is scrolling here, or the clipping check below proves
    // nothing.
    const scrolls = await list.evaluate((node) => node.scrollHeight > node.clientHeight + 1)
    expect(scrolls, `the clip list scrolls at ${label}`).toBe(true)

    // (a) The row's shape, which is the plan's stated goal for the library:
    //   - every control lies inside the row;
    //   - ▶ Preview, Add and ⋯ share one line *as a cluster* — what
    //     `.clip-actions` is for, since the row's own flex-wrap (#208)
    //     otherwise broke them wherever the width ran out and left ⋯ alone
    //     on a second line under the other two;
    //   - at the default width the whole row is **one line**, name
    //     included, which is what dropping from six controls to three buys
    //     (and it only fits because the name's floor went back to its own
    //     5rem when the ✎ left the slot — see MediaLibrary.css);
    //   - at the 800px guard width it wraps to two lines, not more.
    const row = rows.filter({ hasText: lastClip })
    const actions = [
      page.getByRole('button', { name: `Preview ${lastClip}` }),
      page.getByRole('button', { name: `Add ${lastClip} to timeline` }),
      clipMenuTrigger(page, lastClip),
    ]
    const name = row.locator('.clip-name')
    const centre = (box: { y: number; height: number }) => box.y + box.height / 2
    for (const [index, control] of [name, ...actions].entries()) {
      await expectWithin(control, row, { what: `row control ${index} at ${label}` })
    }
    const actionBoxes = await Promise.all(actions.map(async (a) => (await a.boundingBox())!))
    const actionCentres = actionBoxes.map(centre)
    expect(
      Math.max(...actionCentres) - Math.min(...actionCentres),
      `▶ Preview, Add and ⋯ share one line at ${label}`,
    ).toBeLessThan(actionBoxes[0].height / 2)

    // Lines counted rather than assumed: cluster every control's centre at
    // half a control's height, so a third line fails this outright.
    const nameBox = (await name.boundingBox())!
    const tolerance = actionBoxes[0].height / 2
    const lines: number[] = []
    for (const value of [centre(nameBox), ...actionCentres]) {
      if (!lines.some((line) => Math.abs(line - value) < tolerance)) lines.push(value)
    }
    if (viewport.width === 1280) {
      expect(lines.length, `the row is one line at ${label}`).toBe(1)
    } else {
      expect(lines.length, `the row is at most two lines at ${label}`).toBeLessThanOrEqual(2)
    }
    await expectNoHorizontalScroll(page, `library row at ${label}`)

    // (b) The open ⋯ is inside the viewport AND not cut off by the list's
    // own scrolling box — the second being the one that matters. Opened on
    // the last row that is *fully visible* without scrolling: the panel's
    // natural place is past the box's bottom edge, the case a viewport-only
    // containment check passes while the box clips the panel.
    await list.evaluate((node) => {
      node.scrollTop = 0
    })
    const listBoxBefore = (await list.boundingBox())!
    const rowNames = await rows.locator('.clip-name').allTextContents()
    let lastVisible = rowNames[0]
    for (const name of rowNames) {
      const trigger = await clipMenuTrigger(page, name).boundingBox()
      if (
        trigger !== null &&
        trigger.y >= listBoxBefore.y &&
        trigger.y + trigger.height <= listBoxBefore.y + listBoxBefore.height
      ) {
        lastVisible = name
      }
    }
    const scrollBefore = await scrollBox(list)
    const menu = await openClipMenu(page, lastVisible)
    // Opening a menu must neither move the list under the pointer that
    // opened it nor grow the list to hold the panel, and every item must be
    // hittable where it is drawn. Before the panel was lifted out of the
    // box, the browser scrolled the list to reveal a panel hanging past the
    // bottom edge — 198px at 1280×720, taking the clicked row with it — or,
    // once that scroll was prevented, simply clipped the panel there.
    await expectMenuUsable(
      page,
      list,
      clipMenuTrigger(page, lastVisible),
      menu,
      scrollBefore,
      `⋯ on ${lastVisible} at ${label}`,
    )
    const view = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }))
    if (viewport.width === 1280) {
      // The row's ⋯ open, for the PR's rendered evidence: the library plus
      // whatever of the panel hangs past it — over the timeline, since the
      // panel is lifted out of the list rather than kept inside its box.
      const libraryBox = (await library.boundingBox())!
      const menuBox = (await menu.boundingBox())!
      const bottom = Math.min(
        Math.max(libraryBox.y + libraryBox.height, menuBox.y + menuBox.height) + 8,
        view.height,
      )
      const right = Math.min(
        Math.max(libraryBox.x + libraryBox.width, menuBox.x + menuBox.width) + 8,
        view.width,
      )
      await page.screenshot({
        path: testInfo.outputPath('library-row-menu-1280.png'),
        clip: {
          x: libraryBox.x,
          y: libraryBox.y,
          width: right - libraryBox.x,
          height: bottom - libraryBox.y,
        },
      })
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // (c) The header's View ▾ opens inside the viewport and inside no
    // scrolling box — it is a sibling of the list, not a descendant.
    await expectWithin(viewMenuTrigger(page), library, { what: `View ▾ trigger at ${label}` })
    const opened = await openViewMenu(page)
    const viewBox = (await opened.boundingBox())!
    expect(viewBox.x, `View ▾ panel left at ${label}`).toBeGreaterThanOrEqual(0)
    expect(viewBox.x + viewBox.width, `View ▾ panel right at ${label}`).toBeLessThanOrEqual(
      view.width,
    )
    expect(viewBox.y + viewBox.height, `View ▾ panel bottom at ${label}`).toBeLessThanOrEqual(
      view.height,
    )
    await expectNoHorizontalScroll(page, `View ▾ open at ${label}`)

    // The human check for the PR's rendered evidence, re-taken every run.
    // Clipped to the library panel *plus* whatever of the open panel hangs
    // past it: a menu overlays its neighbours by design, and a region-shaped
    // clip cut the items' labels off mid-word — framing, not layout, since
    // the assertions above have the panel inside the viewport.
    const libraryBox = (await library.boundingBox())!
    const right = Math.min(Math.max(libraryBox.x + libraryBox.width, viewBox.x + viewBox.width) + 8, view.width)
    await page.screenshot({
      path: testInfo.outputPath(`library-view-menu-${viewport.width}.png`),
      clip: {
        x: libraryBox.x,
        y: libraryBox.y,
        width: right - libraryBox.x,
        height: Math.min(libraryBox.height, view.height - libraryBox.y),
      },
    })
    await page.keyboard.press('Escape')
    await expect(viewMenu(page)).toHaveCount(0)
  }

  // (d) The card's action cluster stays inside its card, and the row's ⋯
  // survives the switch — "identical controls in both views" (#311).
  await page.setViewportSize({ width: 1280, height: 720 })
  await chooseView(page, 'Thumbnails')
  const card = rows.filter({ hasText: lastClip })
  await expect(card).toHaveClass(/clip-item-card/)
  await expectWithin(card.locator('.clip-card-actions'), card, { what: 'card action cluster' })
  await expectWithin(clipMenuTrigger(page, lastClip), card, { what: "the card's ⋯" })
  // Scrolled into view first, so the scroll box read here is the one the
  // menu opens in — Playwright would otherwise scroll on the click itself.
  await clipMenuTrigger(page, lastClip).scrollIntoViewIfNeeded()
  const cardScroll = await scrollBox(list)
  const cardMenu = await openClipMenu(page, lastClip)
  await expect(cardMenu.getByRole('menuitem')).toHaveText(['Rename…', 'Remove'])
  await expectMenuUsable(
    page,
    list,
    clipMenuTrigger(page, lastClip),
    cardMenu,
    cardScroll,
    "the card's ⋯",
  )
  const cardLibraryBox = (await library.boundingBox())!
  const cardMenuBox = (await cardMenu.boundingBox())!
  const cardRight = Math.min(
    Math.max(cardLibraryBox.x + cardLibraryBox.width, cardMenuBox.x + cardMenuBox.width) + 8,
    1280,
  )
  // The panel may now hang below the library, over the timeline — that is
  // the lift working — so the frame follows it down too.
  const cardBottom = Math.min(
    Math.max(cardLibraryBox.y + cardLibraryBox.height, cardMenuBox.y + cardMenuBox.height) + 8,
    720,
  )
  await page.screenshot({
    path: testInfo.outputPath('library-card-menu-1280.png'),
    clip: {
      x: cardLibraryBox.x,
      y: cardLibraryBox.y,
      width: cardRight - cardLibraryBox.x,
      height: cardBottom - cardLibraryBox.y,
    },
  })
  await page.keyboard.press('Escape')
})
