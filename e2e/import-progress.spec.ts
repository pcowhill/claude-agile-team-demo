import { expect, test } from '@playwright/test'
import { chooseView } from './clipMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page

/**
 * The placeholder row a file shows while it is read for import (#798, the
 * customer's option A in #794): "Importing <name>…", a busy bar and Cancel,
 * replaced by the clip when the read finishes.
 *
 * A real import is over too fast to measure, so the spec holds one on
 * demand. Before the app loads, an init script wraps `onload` on
 * `HTMLImageElement`: while `window.__holdImports` is set, an image's load
 * handler is queued instead of run, and `window.__releaseImports()` runs
 * the queue. The image probe (`probeImageFile`) is the only code that
 * assigns `onload` on an image, so this holds exactly the import and
 * nothing else. The probe's own 15 s timeout still applies, which is far
 * longer than any step here.
 */

declare global {
  interface Window {
    __holdImports: boolean
    __heldImports: (() => void)[]
    __releaseImports: () => void
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__holdImports = false
    window.__heldImports = []
    window.__releaseImports = () => {
      window.__holdImports = false
      for (const run of window.__heldImports.splice(0)) run()
    }
    const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onload')!
    Object.defineProperty(HTMLImageElement.prototype, 'onload', {
      configurable: true,
      get() {
        return native.get!.call(this)
      },
      set(handler: ((this: HTMLImageElement, event: Event) => void) | null) {
        if (handler === null || !window.__holdImports) {
          native.set!.call(this, handler)
          return
        }
        native.set!.call(this, function (this: HTMLImageElement, event: Event) {
          window.__heldImports.push(() => handler.call(this, event))
        })
      },
    })
  })
})

/** A 64×64 PNG made in the page, so no binary fixture is committed. */
async function makePng(page: Page, colour: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')!
    context.fillStyle = fill
    context.fillRect(0, 0, 64, 64)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, colour)
  return Buffer.from(base64, 'base64')
}

/** The long name a real screen recording gets: the row must ellipsize it, not wrap. */
const HELD = 'Screen recording 2026-11-20 at 16.42.07 (the long take, unedited).png'

const importingList = (page: Page) => page.getByRole('list', { name: 'Importing clips' })
const importedClips = (page: Page) => page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')

/** Two clips imported normally, then `HELD` picked and held mid-read. */
async function populateAndHold(page: Page) {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav() },
    { name: 'still.png', mimeType: 'image/png', buffer: await makePng(page, '#3a7') },
  ])
  await expect(importedClips(page)).toHaveCount(2)
  const held = await makePng(page, '#a37')
  await page.evaluate(() => {
    window.__holdImports = true
  })
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: HELD, mimeType: 'image/png', buffer: held },
  ])
  // The probe has assigned its handler and the load is queued, not run.
  await expect.poll(() => page.evaluate(() => window.__heldImports.length)).toBe(1)
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  for (const view of ['List', 'Thumbnails'] as const) {
    test(`at ${viewport.width}px in the ${view} view, an importing file shows a row inside the library that does not wrap, then becomes its clip (#798)`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await populateAndHold(page)
      if (view === 'Thumbnails') await chooseView(page, 'Thumbnails')

      const row = importingList(page).getByRole('listitem')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(`Importing ${HELD}…`)
      await expect(row.getByRole('progressbar', { name: `Importing ${HELD}` })).toBeVisible()
      const cancel = row.getByRole('button', { name: `Cancel importing ${HELD}` })
      await expect(cancel).toBeVisible()

      // Inside the library panel, beside the clips already there; the long
      // name ellipsizes and Cancel keeps one line.
      const panel = page.getByRole('region', { name: 'Media library' })
      await expectWithin(row, panel, { what: 'the importing row' })
      await expectNoWrap(row.locator('.import-name'), 'the importing row\'s name')
      await expectNoWrap(cancel, 'Cancel')
      await expectNoHorizontalScroll(page, `${view} view, one file importing`)
      if (viewport.width === 1280) {
        await row.screenshot({ path: testInfo.outputPath(`importing-row-${view.toLowerCase()}.png`) })
        await panel.screenshot({ path: testInfo.outputPath(`library-${view.toLowerCase()}.png`) })
      }

      await page.evaluate(() => window.__releaseImports())
      await expect(importingList(page)).toHaveCount(0)
      await expect(importedClips(page)).toHaveCount(3)
      await expect(page.getByRole('button', { name: `Add ${HELD} to timeline` })).toBeVisible()
    })
  }
}

test('Cancel removes the row at once, and the file never reaches the library (#798)', async ({ page }) => {
  await populateAndHold(page)
  await page.getByRole('button', { name: `Cancel importing ${HELD}` }).click()
  await expect(importingList(page)).toHaveCount(0)

  // The read finishes after Cancel: its result is discarded.
  await page.evaluate(() => window.__releaseImports())
  await expect(page.getByRole('button', { name: `Add ${HELD} to timeline` })).toHaveCount(0)
  await expect(importedClips(page)).toHaveCount(2)
  await expect(page.locator('.import-errors')).toHaveCount(0)
})

test('with reduced motion the busy bar holds still (#798)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await populateAndHold(page)
  const bar = importingList(page).getByRole('progressbar')
  await expect(bar).toBeVisible()
  const animation = await bar.evaluate((node) => getComputedStyle(node, '::after').animationName)
  expect(animation).toBe('none')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect
    .poll(() => bar.evaluate((node) => getComputedStyle(node, '::after').animationName))
    .toBe('import-bar-sweep')
  await page.evaluate(() => window.__releaseImports())
})
