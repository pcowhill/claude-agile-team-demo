import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoVerticalPageScroll } from './layout'
import { sineWav } from './sineWav'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page

/**
 * The app fits the space its host page leaves it (#652, from the customer's
 * #651). The customer embeds the built app in another page, between that
 * page's own header and footer:
 *
 *     <body>
 *       <div class="header"></div>
 *       <div id="root"><div class="app">…</div></div>
 *       <div class="footer"></div>
 *     </body>
 *
 * There the shell claimed `100dvh` for itself, so the page was a window
 * plus a header plus a footer tall, and scrolled by exactly their height on
 * an empty project. Each test below builds that structure by inserting the
 * two siblings around `#root`, which is all the host page does — no CSS of
 * the host's is involved, because the point is that it needs none.
 *
 * Measured on `main` at `7858571` (before the fix), 1280×720 with an 80px
 * header and a 60px footer: the page's scrollHeight read 860 against a
 * clientHeight of 720 — the 140px of header and footer.
 */

const HEADER = 80
const FOOTER = 60

const sequenceRows = (page: Page) =>
  page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')

/** The customer's host page: a header before `#root`, a footer after it. */
async function embedBetweenHeaderAndFooter(page: Page) {
  await page.evaluate(
    ({ header, footer }) => {
      const root = document.getElementById('root')!
      const make = (className: string, height: number) => {
        const div = document.createElement('div')
        div.className = className
        div.textContent = className
        div.style.height = `${height}px`
        div.style.background = '#3a2a5a'
        return div
      }
      root.before(make('header', header))
      root.after(make('footer', footer))
    },
    { header: HEADER, footer: FOOTER },
  )
}

interface Boxes {
  header: { top: number; bottom: number }
  app: { top: number; bottom: number }
  footer: { top: number; bottom: number }
  innerHeight: number
}

/** All three boxes from one render. */
async function readBoxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }
    return {
      header: box('body > .header'),
      app: box('.app'),
      footer: box('body > .footer'),
      innerHeight: window.innerHeight,
    }
  })
}

/**
 * The app lies between the host's header and footer, and the footer ends at
 * the window's bottom. Polled, all four values in one read, because the layout settles
 * a frame after the siblings are inserted (`quality-and-ci.md`). The 1px is
 * sub-pixel layout: `100dvh` on an odd viewport height rounds.
 */
async function expectBetweenHeaderAndFooter(page: Page, where: string) {
  await expect
    .poll(
      async () => {
        const boxes = await readBoxes(page)
        return {
          appStartsBelowHeader: Math.abs(boxes.app.top - boxes.header.bottom) <= 1,
          appEndsAtFooter: Math.abs(boxes.app.bottom - boxes.footer.top) <= 1,
          // At the window's bottom, not merely on screen: a shell collapsed to
          // its content's height would leave the footer floating mid-window.
          footerAtWindowBottom: Math.abs(boxes.footer.bottom - boxes.innerHeight) <= 1,
          boxes,
        }
      },
      { message: `the app between the host's header and footer, ${where}` },
    )
    .toMatchObject({ appStartsBelowHeader: true, appEndsAtFooter: true, footerAtWindowBottom: true })
}

test('embedded between a header and a footer, an empty project fits the window without a page scroll (#652)', async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1280, height: 720 },
    // Where the app's own header wraps (app-fit.spec.ts), so the room left
    // for the editor is smallest.
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('./')
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
    await embedBetweenHeaderAndFooter(page)
    const where = `empty project at ${size.width}×${size.height}`

    await expectBetweenHeaderAndFooter(page, where)
    await expectNoVerticalPageScroll(page, where)
    await expectNoHorizontalScroll(page, where)
    if (size.width === 1280) {
      await page.screenshot({ path: testInfo.outputPath('embedded-empty-1280x720.png') })
    }
  }
})

test('embedded, a populated project scrolls in the editor column and never the page (#652)', async ({
  page,
}, testInfo) => {
  // Measured populated, as `development.md` requires of a layout claim: an
  // empty panel cannot overflow. Fourteen clips and eight rows are more than
  // either panel can show at this size (app-fit.spec.ts uses the same).
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('./')
  await embedBetweenHeaderAndFooter(page)
  await page.getByTestId('clip-file-input').setInputFiles(
    Array.from({ length: 14 }, (_, i) => ({
      name: `clip-${String(i + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: sineWav(0.2),
    })),
  )
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(14)
  for (let i = 0; i < 8; i += 1) await chooseFromAddMenu(page, ADD_SLATE)
  await expect(sequenceRows(page)).toHaveCount(8)
  const where = 'fourteen clips and eight slates at 1280×720'

  await expectBetweenHeaderAndFooter(page, where)
  await expectNoVerticalPageScroll(page, where)
  await expectNoHorizontalScroll(page, where)

  // The overflow went to the editor column — the scrolling the customer
  // accepts "once the timeline gets populated enough" (#651).
  const column = page.getByRole('main')
  const overflow = await column.evaluate((node) => node.scrollHeight - node.clientHeight)
  expect(overflow, 'the editor column scrolls once the project outgrows it').toBeGreaterThan(0)

  // And everything in it is reachable above the footer: the last row,
  // scrolled into view, ends above the footer's top.
  const last = sequenceRows(page).last()
  await last.scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const row = (await last.boundingBox())!
      const { footer } = await readBoxes(page)
      return row.y + row.height <= footer.top + 1
    }, { message: 'the last timeline row, scrolled to, ends above the footer' })
    .toBe(true)
  expect(await page.evaluate(() => window.scrollY), 'the page scrolled').toBe(0)
  await page.screenshot({ path: testInfo.outputPath('embedded-populated-1280x720.png') })
})

test('on its own, as on GitHub Pages, the app still fills the whole window (#652)', async ({ page }) => {
  // The same rules, with `#root` the body's only child: it gets the whole
  // window, as `.app`'s old `100dvh` gave it. The page-fit assertions in
  // app-fit.spec.ts cannot see a shell that collapsed to its content's
  // height — that page does not scroll either — so this measures the fill.
  for (const size of [
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('./')
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rect = document.querySelector('.app')!.getBoundingClientRect()
            return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), window: window.innerHeight }
          }),
        { message: `the app fills the window at ${size.width}×${size.height}` },
      )
      .toEqual({ top: 0, bottom: size.height, window: size.height })
    await expectNoVerticalPageScroll(page, `alone at ${size.width}×${size.height}`)
  }
})
