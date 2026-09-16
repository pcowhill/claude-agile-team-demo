import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { comparePixels, decodePng, isRasterNoise } from '../tools/guide/pngPixels'
import { GUIDE_FIXTURES_DIR, GUIDE_FIXTURE_CLIPS } from './guideFixtures'

/**
 * Retakes Quick Start's screenshots (#483, from the customer's change on
 * #477: "a few in the Quick Start only"): `npm run guide:screenshots`, through
 * playwright.guide.config.ts. The script walks the Quick Start steps on the
 * committed fixture clips and writes `docs/guide/images/`; after a UI change
 * one command brings every picture up to date, which is the design's
 * mitigation for stale screenshots (§7).
 *
 * Determinism: the clips are committed (`guide-fixtures.ts`), the viewport is
 * fixed, animations are disabled, the caret hidden, the pointer parked and
 * focus cleared before each shot, and a frame is written only once two
 * consecutive captures agree. What remains is Chromium's own rasterizer
 * noise — see `writeUnlessNoise` — which the retake tolerates rather than
 * writes. Fonts differ between machines, so a retake on another machine
 * changes the text's pixels — that is a retake, not a defect.
 */
const IMAGES_DIR = join('docs', 'guide', 'images')
const VIEWPORT = { width: 1280, height: 720 }

/** Park the pointer, drop focus, and let the frame settle before a shot. */
async function settle(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

type ShotOptions = Parameters<Page['screenshot']>[0]

const SHOT_OPTIONS = { animations: 'disabled', caret: 'hide' } as const

/**
 * Writes `name` once two consecutive captures agree byte for byte, so a
 * frame still settling — a thumbnail decoding, a row mid-render under load —
 * is never the one written. The final state is deterministic; this waits
 * for it.
 */
async function writeStable(name: string, capture: () => Promise<Buffer>): Promise<void> {
  let previous = await capture()
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const next = await capture()
    if (next.equals(previous)) {
      writeUnlessNoise(name, next)
      return
    }
    previous = next
  }
  throw new Error(`${name}: the frame kept changing between captures`)
}

/**
 * Keeps the committed image when the new capture differs from it only by
 * rasterizer noise. Chromium's anti-aliased rounded corners come out one
 * shade apart between otherwise identical runs (eleven pixels of a
 * 1280 × 720 frame, measured on #483, in two states that alternate from run
 * to run); a retake that rewrote the file for that would churn the
 * repository for nothing. A real UI change moves whole rows of pixels and
 * is written.
 */
function writeUnlessNoise(name: string, captured: Buffer): void {
  const path = join(IMAGES_DIR, name)
  if (existsSync(path)) {
    const existing = decodePng(readFileSync(path))
    const next = decodePng(captured)
    const difference = comparePixels(existing, next)
    if (difference !== null && difference.count === 0) {
      console.log(`${name}: unchanged`)
      return
    }
    if (isRasterNoise(difference, next.width * next.height)) {
      console.log(`${name}: kept — ${difference!.count} pixel(s) differ by at most ${difference!.maxDelta}, rasterizer noise`)
      return
    }
    console.log(`${name}: rewritten — ${difference === null ? 'the size changed' : `${difference.count} pixel(s) differ`}`)
  } else {
    console.log(`${name}: written`)
  }
  writeFileSync(path, captured)
}

const pageShot = (page: Page, name: string, options: ShotOptions = {}) =>
  writeStable(name, () => page.screenshot({ ...SHOT_OPTIONS, ...options }))

const elementShot = (target: Locator, name: string) =>
  writeStable(name, () => target.screenshot(SHOT_OPTIONS))

/**
 * A screenshot of `target` with its surroundings: `frame`'s full width, and
 * `above` / `below` pixels of the rows around it, so a control between two
 * rows is seen between them.
 */
async function shotAround(
  page: Page,
  target: Locator,
  frame: Locator,
  name: string,
  margins: { above: number; below: number },
): Promise<void> {
  const [box, outer] = await Promise.all([target.boundingBox(), frame.boundingBox()])
  if (box === null || outer === null) throw new Error(`${name}: the target has no box`)
  const y = Math.max(outer.y, box.y - margins.above)
  await pageShot(page, name, {
    clip: {
      x: outer.x,
      y,
      width: outer.width,
      height: Math.min(outer.y + outer.height - y, box.y + box.height + margins.below - y),
    },
  })
}

test('retake the Quick Start screenshots', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize(VIEWPORT)
  await page.goto('./')

  // 1. Import your clips — two fixture clips land as rows with their durations.
  await page
    .getByTestId('clip-file-input')
    .setInputFiles(GUIDE_FIXTURE_CLIPS.map((clip) => join(GUIDE_FIXTURES_DIR, clip.file)))
  const library = page.getByRole('region', { name: 'Media library' })
  for (const clip of GUIDE_FIXTURE_CLIPS) {
    await expect(library.getByRole('listitem').filter({ hasText: clip.file })).toContainText(/\d:\d\d/)
  }
  await settle(page)
  await pageShot(page, 'editor-after-import.png')

  // 2. Put them on the timeline — Add both; the Sequence gains two rows.
  for (const clip of GUIDE_FIXTURE_CLIPS) {
    await page.getByRole('button', { name: `Add ${clip.file} to timeline` }).click()
  }
  const timeline = page.getByRole('region', { name: 'Timeline' })
  await expect(timeline.getByRole('button', { name: /^Collapse .* at position 2$/ })).toBeVisible()
  // The thumbnails and the preview's first frame are captured from the media;
  // wait for the second row's thumbnail so the shot is not taken mid-capture.
  await expect(timeline.locator('img, canvas').nth(1)).toBeVisible()
  await settle(page)
  await elementShot(timeline, 'timeline-two-clips.png')

  // 4. Add a transition — the boundary's control opens with its type menu and duration.
  await page.getByRole('button', { name: /^Add transition/ }).click()
  const transition = page.getByRole('combobox', { name: /^Transition type/ })
  await expect(transition).toBeVisible()
  await settle(page)
  await shotAround(page, timeline.locator('.timeline-transition'), timeline, 'transition-added.png', {
    above: 72,
    below: 88,
  })

  // 7. Export — the dialog with its format, range and output groups.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(dialog).toBeVisible()
  await settle(page)
  await elementShot(dialog, 'export-dialog.png')
  await page.keyboard.press('Escape')
})
