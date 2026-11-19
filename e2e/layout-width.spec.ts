import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openClipMenu } from './clipMenu'
import { sineWav } from './sineWav'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'

/**
 * Narrow-viewport width regression guard (#208). The app grid's `fr` tracks
 * floor at their panels' min-content, so any panel row that cannot shrink
 * widens the whole page instead — historically the media library's clip row
 * (name, badge, duration, and four buttons on one non-wrapping line) set a
 * ~540px floor that made the page scroll horizontally at viewports under
 * ~900px, and unrelated PRs discovered it as `preview-zoom` screenshot
 * failures. This spec pins the outcome the issue asks for: with a video
 * clip imported and on the timeline (the widest clip row — Add, Overlay,
 * Extract audio, Remove all present), the page must not scroll horizontally
 * at an 800px viewport. Future min-content growth fails here, deliberately,
 * instead of via an unrelated spec's screenshot probe.
 */
test.use({ viewport: { width: 800, height: 1100 } })

/** A short recorded WebM — real video, so the row shows every control. The
 * long filename matters: a nowrap clip name's min-content is the whole
 * string, so the guard also pins that a long name ellipsizes instead of
 * inflating the page (#208). */
async function recordWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
    const draw = () => {
      ctx.fillStyle = '#3a6ea5'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (performance.now() - start < 700) requestAnimationFrame(draw)
      else recorder.stop()
    }
    draw()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

test('no horizontal page scroll at an 800px viewport with a video clip in play (#208)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'my-vacation-video-part-1.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add my-vacation-video-part-1.webm to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)

  // Every clip-row control is present and usable — shrinking must not cost
  // any of them (#208 acceptance criteria). Since #416 that is the two
  // inline actions plus the ⋯ the rest moved into, and the items inside it.
  // `exact`, because #419 gave the timeline's rows a ⋯ of their own, named
  // "More actions for <clip> at position 1" — the library's name with a
  // suffix. Playwright matches a name by substring, so the loose match
  // resolves to both rows' triggers and fails strict mode; `clipMenu.ts`
  // already spells `exact` for the same reason between two library rows.
  const clip = 'my-vacation-video-part-1.webm'
  for (const name of [`Add ${clip} to timeline`, `Preview ${clip}`, `More actions for ${clip}`]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  const menu = await openClipMenu(page, clip)
  for (const item of ['Add as overlay', 'Extract audio', 'Rename…', 'Remove']) {
    await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // The guard itself: the page lays out within the viewport instead of
  // scrolling horizontally. The shared assertion counts every overflowing
  // descendant, so this catches any panel's min-content floor pushing the
  // grid wide — not just the media library's. It measures against
  // `clientWidth` where this spec used `window.innerWidth`, which is
  // stricter by the scrollbar's width; see ./layout for why.
  await expectNoHorizontalScroll(page, 'video clip imported and on the timeline')
})

/**
 * A transition row at 360px (#749). The boundary row between two entries —
 * the type select, the duration field and ✕ behind a 1.25rem indent — did
 * not wrap, and its min-content (294px, the select alone 149px because a
 * select is as wide as its longest option) floored the timeline's `1fr`
 * track the way #534's main line did: once a transition existed, every
 * panel was 349px wide in a 360px column, the column's scrollWidth 397.
 * #534's case below has three slates and no transition, so it never saw
 * this row. Two real video entries, as the issue measured it.
 */
test('the editor column lays out within a 360px window with a transition between two clips (#749)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('./')
  const clip = 'trim-clip.webm'
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: clip, mimeType: 'video/webm', buffer: await readFile(join('e2e', 'fixtures', clip)) }])
  const add = page.getByRole('button', { name: `Add ${clip} to timeline`, exact: true })
  await add.click()
  await add.click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
  await expectNoHorizontalScroll(page, 'two clips at 360px, before the transition')

  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const boundary = 'between position 1 and 2'
  const type = page.getByRole('combobox', { name: `Transition type ${boundary}` })
  await expect(type).toBeVisible()
  await expectNoHorizontalScroll(page, 'two clips and a transition at 360px')

  const timeline = page.getByRole('main').locator(':scope > .panel', { has: page.getByRole('list', { name: 'Sequence' }) })
  for (const [control, what] of [
    [type, 'the transition type'],
    [page.getByRole('spinbutton', { name: `Transition duration ${boundary} in seconds` }), 'the transition duration'],
    [page.getByRole('button', { name: `Remove transition ${boundary}`, exact: true }), 'the remove-transition button'],
  ] as const) {
    await expectWithin(control, timeline, { axis: 'x', what: `${what} at 360px` })
  }

  // The row wraps only when it must: with room, select, duration and ✕
  // still share one line, as before the fix.
  await page.setViewportSize({ width: 1280, height: 740 })
  const tops = await page.locator('.timeline-transition').evaluate((row) =>
    Array.from(row.children, (child) => Math.round(child.getBoundingClientRect().top + child.getBoundingClientRect().height / 2)),
  )
  expect(tops, 'the transition row is three controls').toHaveLength(3)
  for (const top of tops) expect(Math.abs(top - tops[0]), `the row's centres ${tops.join(', ')} at 1280px`).toBeLessThanOrEqual(2)
})

/**
 * Below the 700px breakpoint (#534). The same mechanism as #208 one band
 * down: a timeline row's main line — toggle, thumbnail, a name floored at
 * 5rem, the duration and the ↑ ↓ ⋯ ✕ cluster — did not wrap, its
 * min-content was about 390px, and the single `1fr` track grew to fit it.
 * Measured on `main` before the fix at 360×640 with three slates: every
 * panel 445px wide in a 360px column, 109px of it off-screen. And since
 * #524 made the editor column its own scroll container, that overflow
 * scrolled the *column* while `documentElement` read zero — the test above
 * would have passed on it. `expectNoHorizontalScroll` now measures the
 * column too; this is the populated project that makes the measurement
 * mean something (an empty project at 360px never overflowed), with a row
 * of each kind on the timeline, since each kind has its own main-line rule.
 */
test('the editor column lays out within a 360px window with a row of every kind on the timeline (#534)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')

  const clip = 'my-vacation-video-part-1.webm'
  const voice = 'voice-over-take-one.wav'
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: clip, mimeType: 'video/webm', buffer: webm },
    { name: voice, mimeType: 'audio/wav', buffer: sineWav(1) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)

  // A video entry, the same video as an overlay, an audio track, a text
  // overlay and two slates: every row kind the timeline has.
  await page.getByRole('button', { name: `Add ${clip} to timeline`, exact: true }).click()
  const menu = await openClipMenu(page, clip)
  await menu.getByRole('menuitem', { name: 'Add as overlay', exact: true }).click()
  await page.getByRole('button', { name: `Add ${voice} to timeline`, exact: true }).click()
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  const sequence = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')
  await expect(sequence).toHaveCount(3)
  await expect(page.getByRole('list', { name: 'Overlay layers' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Audio tracks' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Text overlays' }).getByRole('listitem')).toHaveCount(1)

  const column = page.getByRole('main')
  const panels = column.locator(':scope > .panel')
  // 360 is where it overflowed; 500 and the breakpoint itself already
  // passed and are the regression guard for the fix.
  for (const width of [360, 500, 700]) {
    await page.setViewportSize({ width, height: 640 })
    const where = `${width}×640 with a row of every kind`
    await expectNoHorizontalScroll(page, where)
    expect(await panels.count(), 'the editor column holds its panels').toBeGreaterThanOrEqual(3)
    for (let index = 0; index < (await panels.count()); index += 1) {
      await expectWithin(panels.nth(index), column, { axis: 'x', what: `panel ${index + 1} at ${where}` })
    }
  }

  // The cluster wraps as one (#416's lesson, kept): at 360px a slate's ↑ ↓
  // ⋯ ✕ sit on one line together, below the name rather than beside it.
  await page.setViewportSize({ width: 360, height: 640 })
  const position = 'Color slate at position 2'
  const tops = await Promise.all(
    [
      `Move ${position} up`,
      `Move ${position} down`,
      `More actions for ${position}`,
      `Remove ${position} from timeline`,
    ].map(async (name) => (await page.getByRole('button', { name, exact: true }).boundingBox())!.y),
  )
  for (const top of tops) expect(Math.abs(top - tops[0]), `the cluster's tops ${tops.join(', ')}`).toBeLessThanOrEqual(1)
  const nameTop = (await sequence.nth(1).locator('.clip-name').boundingBox())!.y
  expect(tops[0], 'the cluster sits under the name at 360px').toBeGreaterThan(nameTop + 10)
})
