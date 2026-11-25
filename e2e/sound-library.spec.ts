import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { expectAlignedLines, expectAlignedRow, expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Sound library plugin (#861): the Media Library header's Sound library…
 * lists short CC0 effects, and Add imports one as an ordinary audio clip.
 * Exercised through the real chain: the manager loads the lazy chunk, the
 * button joins the header, Add downloads exactly one file through the dev
 * server and the app's own import path probes it, and the clip previews and
 * goes onto the timeline like any imported audio.
 */

interface ManifestSound {
  id: string
  name: string
  category: string
  /** A music bed's mood (#869); effects have none. */
  mood?: string
  file: string
  duration: number
  licence: string
  source: string
}

const MANIFEST = JSON.parse(
  readFileSync(new URL('../src/plugins/soundLibrary/sounds/manifest.json', import.meta.url), 'utf8'),
) as { sounds: ManifestSound[] }

/**
 * A request for one of the plugin's audio files. The dev server also serves
 * each `?url` import as a tiny JavaScript module (`…/whoosh.webm?import&url…`)
 * that only exports the file's path. Those are script requests, the plugin's
 * code rather than its sounds, and they do not exist in the build, where the
 * paths are inlined into the chunk. So they are not counted.
 */
const isSoundFile = (request: import('@playwright/test').Request) =>
  request.resourceType() !== 'script' && /\/soundLibrary\/sounds\/[^/?]+\.webm(\?|$)/.test(request.url())

async function setSoundLibrary(page: Page, enabled: boolean) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Sound library` }).click()
  // The toggle flips only once the chunk has loaded and activate ran.
  await expect(page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Sound library` })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** The Media Library header's controls, by accessible name, in order. */
const headerControls = (page: Page): Promise<string[]> =>
  page
    .locator('.library-header')
    .evaluate((header) =>
      [...header.querySelectorAll(':scope > button, :scope > * > .menu-trigger, :scope > .menu-trigger')].map(
        (control) => (control.getAttribute('aria-label') ?? control.textContent ?? '').trim(),
      ),
    )

async function openSoundLibrary(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Sound library…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sound library' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('the header offers Sound library… only while the plugin is enabled, and disabling keeps added clips', async ({
  page,
}) => {
  await page.goto('./')
  const before = await headerControls(page)
  expect(before[0]).toBe('Import clips')
  expect(before).not.toContain('Sound library…')

  await setSoundLibrary(page, true)
  expect(await headerControls(page)).toEqual([before[0], 'Sound library…', ...before.slice(1)])

  const dialog = await openSoundLibrary(page)
  await dialog.getByRole('button', { name: 'Add Pop to the library' }).click()
  await expect(page.getByRole('button', { name: 'Add Pop.webm to timeline' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  await setSoundLibrary(page, false)
  expect(await headerControls(page)).toEqual(before)
  await expect(page.getByRole('button', { name: 'Add Pop.webm to timeline' })).toBeVisible()
})

test('Add downloads that one file, and the sound previews and goes on the timeline like any imported audio', async ({
  page,
}) => {
  const fetched: string[] = []
  page.on('request', (request) => {
    if (isSoundFile(request)) fetched.push(request.url())
  })
  await page.goto('./')
  await setSoundLibrary(page, true)
  const dialog = await openSoundLibrary(page)
  // Enabling the plugin and opening the list fetched no sound.
  expect(fetched).toEqual([])

  await dialog.getByRole('button', { name: 'Add Ding to the library' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Added Ding to the library.')
  const clips = page.getByRole('list', { name: 'Imported clips' })
  await expect(clips.getByRole('listitem')).toHaveCount(1)
  await expect(clips.getByRole('listitem').first()).toContainText('Ding.webm')
  await expect(clips.getByRole('listitem').first()).toContainText('Audio')
  expect(fetched).toHaveLength(1)
  expect(fetched[0]).toMatch(/\/ding\.webm(\?|$)/)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)

  // It plays in the preview, as an imported audio file does (#403).
  await page.getByRole('button', { name: 'Preview Ding.webm' }).click()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  const audio = page.getByTestId('source-audio')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause source' })).toBeVisible()
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLMediaElement).currentTime))
    .toBeGreaterThan(0.2)

  // And it goes on the timeline as an audio track, its length the file's.
  await page.getByRole('button', { name: 'Add Ding.webm to timeline' }).click()
  const outPoint = page.getByRole('spinbutton', {
    name: 'Trim out point of audio track Ding.webm at position 1 in seconds',
  })
  await expect(outPoint).toBeVisible()
  const ding = MANIFEST.sounds.find((sound) => sound.id === 'ding')!
  await expect.poll(async () => Math.abs(Number(await outPoint.inputValue()) - ding.duration)).toBeLessThan(0.05)
  // Still one download: the preview and the track use the imported file.
  expect(fetched).toHaveLength(1)
})

test('every shipped sound decodes in this browser, at its manifest length, and carries a licence and a source', async ({
  page,
}) => {
  await page.goto('./')
  expect(MANIFEST.sounds.length).toBeGreaterThanOrEqual(10)
  for (const sound of MANIFEST.sounds) {
    expect(sound.licence, sound.id).toBe('CC0-1.0')
    expect(sound.source, sound.id).not.toBe('')
    const decoded = await page.evaluate(async (file) => {
      const response = await fetch(`./src/plugins/soundLibrary/sounds/${file}`)
      const context = new OfflineAudioContext(1, 1, 48000)
      try {
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        return { duration: buffer.duration, channels: buffer.numberOfChannels }
      } catch (error) {
        return { error: String(error) }
      }
    }, sound.file)
    expect(decoded, `${sound.file} failed to decode`).not.toHaveProperty('error')
    const { duration, channels } = decoded as { duration: number; channels: number }
    // Effects are mono; the music beds are stereo (#869).
    expect(channels, sound.file).toBe(sound.category === 'Music' ? 2 : 1)
    // Opus decodes at 48 kHz; its framing may add or trim a few ms.
    expect(Math.abs(duration - sound.duration), `${sound.file}: decoded ${duration} s`).toBeLessThan(0.03)
  }
})

test('the dialog works from the keyboard alone, Escape closes it, and closing stops the preview', async ({
  page,
}) => {
  await page.goto('./')
  await setSoundLibrary(page, true)
  await page.getByRole('button', { name: 'Sound library…' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Sound library' })
  await expect(dialog).toBeVisible()
  const first = MANIFEST.sounds[0]
  await expect(dialog.getByRole('button', { name: `Play ${first.name}` })).toBeFocused()

  // Enter plays the first sound (the next test shows a preview really plays).
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: `Stop ${first.name}` })).toBeFocused()

  // Tab to Add and add it from the keyboard.
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: `Add ${first.name} to the library` })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('status')).toHaveText(`Added ${first.name} to the library.`)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Add ${first.name}.webm to timeline` })).toBeVisible()
})

test('closing the dialog stops a preview that is playing', async ({ page }) => {
  // Every HTMLAudioElement the page plays is recorded, including the
  // dialog's off-DOM preview element.
  await page.addInitScript(() => {
    const played: HTMLMediaElement[] = []
    ;(window as unknown as { __played: HTMLMediaElement[] }).__played = played
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      played.push(this)
      return play.call(this)
    }
  })
  await page.goto('./')
  await setSoundLibrary(page, true)
  const dialog = await openSoundLibrary(page)
  // Typing is the longest sound (2 s), so it is still playing when closed.
  await dialog.getByRole('button', { name: 'Play Typing' }).click()
  const anyPlaying = () =>
    page.evaluate(() =>
      (window as unknown as { __played: HTMLMediaElement[] }).__played.some(
        (element) => !element.paused && element.currentTime > 0,
      ),
    )
  await expect.poll(anyPlaying).toBe(true)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await anyPlaying()).toBe(false)
})

test('adding a sound keeps focus on its Add and the list where it was scrolled, at 360px (#889 review)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('./')
  await setSoundLibrary(page, true)
  const dialog = await openSoundLibrary(page)
  const list = dialog.getByTestId('sound-library-list')
  // The last sound, scrolled into view: the list is scrolled, and the first
  // ▶, where focus used to land after every Add, is above the fold.
  const last = MANIFEST.sounds[MANIFEST.sounds.length - 1]
  const add = dialog.getByRole('button', { name: `Add ${last.name} to the library` })
  await add.scrollIntoViewIfNeeded()
  const scrolled = await list.evaluate((element) => element.scrollTop)
  expect(scrolled, 'the list must be scrolled for this test to mean anything').toBeGreaterThan(0)

  // From the keyboard, as criterion 7 asks.
  await add.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('status')).toHaveText(`Added ${last.name} to the library.`)
  // The import re-renders the library, which is what used to move focus.
  await expect(page.getByRole('button', { name: `Add ${last.name}.webm to timeline` })).toBeVisible()
  await expect(add).toBeFocused()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(scrolled)
})

test('the Music category lists each bed with its mood and length, and a bed downloads only when played or added (#869)', async ({
  page,
}) => {
  const fetched: string[] = []
  page.on('request', (request) => {
    if (isSoundFile(request)) fetched.push(request.url())
  })
  await page.addInitScript(() => {
    const played: HTMLMediaElement[] = []
    ;(window as unknown as { __played: HTMLMediaElement[] }).__played = played
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      played.push(this)
      return play.call(this)
    }
  })
  await page.goto('./')
  await setSoundLibrary(page, true)
  const dialog = await openSoundLibrary(page)
  const music = MANIFEST.sounds.filter((sound) => sound.category === 'Music')
  expect(music.length).toBeGreaterThanOrEqual(5)
  expect(music.length).toBeLessThanOrEqual(8)

  // Populated: every bed, in manifest order, with its name, mood, length, ▶ and Add.
  const section = dialog.getByRole('region', { name: 'Music' })
  await section.scrollIntoViewIfNeeded()
  const rows = section.locator('.sound-library-row')
  await expect(rows).toHaveCount(music.length)
  const parts = await rows.evaluateAll((nodes) => nodes.map((row) => [...row.children].map((part) => part.textContent)))
  expect(parts).toEqual(
    music.map((track) => {
      const seconds = Math.round(track.duration)
      return [track.name, track.mood, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, '▶', 'Add']
    }),
  )
  // Opening the list fetched nothing.
  expect(fetched).toEqual([])

  // ▶ streams that one bed, and it really plays.
  const [first, second] = music
  await dialog.getByRole('button', { name: `Play ${first.name}` }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __played: HTMLMediaElement[] }).__played.some(
          (element) => !element.paused && element.currentTime > 0.3,
        ),
      ),
    )
    .toBe(true)
  await dialog.getByRole('button', { name: `Stop ${first.name}` }).click()
  // A stream may take several range requests, all for the one file.
  expect(new Set(fetched).size).toBe(1)
  expect(fetched[0]).toMatch(new RegExp(`/${first.file}(\\?|$)`))

  // Add downloads that one more bed, which joins the library as audio.
  await dialog.getByRole('button', { name: `Add ${second.name} to the library` }).click()
  await expect(dialog.getByRole('status')).toHaveText(`Added ${second.name} to the library.`)
  const clips = page.getByRole('list', { name: 'Imported clips' })
  await expect(clips.getByRole('listitem')).toHaveCount(1)
  await expect(clips.getByRole('listitem').first()).toContainText(`${second.name}.webm`)
  await expect(clips.getByRole('listitem').first()).toContainText('Audio')
  expect([...new Set(fetched)].map((url) => new URL(url).pathname.split('/').pop())).toEqual([first.file, second.file])
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the populated list fits at ${viewport.width}px: the dialog in the viewport, the list scrolling, every row on one line`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    await setSoundLibrary(page, true)
    const where = `at ${viewport.width}px`

    const dialog = await openSoundLibrary(page)
    const rows = dialog.locator('.sound-library-row')
    // Populated: every sound in the manifest is listed.
    await expect(rows).toHaveCount(MANIFEST.sounds.length)

    // The dialog lies inside the viewport on both axes.
    const box = (await dialog.boundingBox())!
    const inViewport = `the dialog ${JSON.stringify(box)} ${where}`
    expect(box.x, `${inViewport}: left edge outside`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${inViewport}: right edge outside`).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y, `${inViewport}: top edge outside`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${inViewport}: bottom edge outside`).toBeLessThanOrEqual(viewport.height + 1)
    await expectNoHorizontalScroll(page, `with the sound library open ${where}`)

    // The list scrolls inside the dialog rather than overflowing it.
    const list = dialog.getByTestId('sound-library-list')
    await expectWithin(list, dialog, { what: `the list ${where}` })
    const scroll = await list.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }))
    expect(scroll.overflowY, `the list's overflow ${where}`).toBe('auto')
    expect(scroll.scrollHeight, `the list holds more than it shows ${where}`).toBeGreaterThan(scroll.clientHeight)

    // Name, length, ▶ and Add each on one line. Checked part by part: over
    // the whole row, the length and buttons (centred on the row) would
    // bridge a wrapped name's two lines and hide the wrap.
    await expectNoWrap(dialog.locator('.sound-library-row > *'), `a sound row's part ${where}`)
    // And the four parts share one line: every part's box overlaps every
    // other's vertically, read in one page read.
    const offLine = await rows.evaluateAll((nodes) =>
      nodes.flatMap((row) => {
        const boxes = [...row.children].map((child) => child.getBoundingClientRect())
        const lowestTop = Math.max(...boxes.map((box) => box.top))
        const highestBottom = Math.min(...boxes.map((box) => box.bottom))
        return lowestTop < highestBottom ? [] : [row.textContent]
      }),
    )
    expect(offLine, `rows whose parts are not on one line ${where}`).toEqual([])
    const clean: number[] = []
    for (let index = 0; index < MANIFEST.sounds.length; index++) {
      await expectWithin(rows.nth(index), list, { axis: 'x', what: `sound row ${index + 1} ${where}` })
      // ▶ and Add: one height, tops and bottoms aligned (#792).
      clean.push(await expectAlignedRow(rows.nth(index).getByRole('button'), `sound row ${index + 1}'s ▶ and Add ${where}`))
    }
    // ▶ is drawn from a fallback symbol font that differs by platform. A
    // taller one must not change the row's buttons, as adjacent-buttons.spec
    // checks for the app's other clusters.
    const style = await page.addStyleTag({ content: '.sound-library-play { font-size: 150% !important; }' })
    for (let index = 0; index < MANIFEST.sounds.length; index++) {
      const tall = await expectAlignedRow(
        rows.nth(index).getByRole('button'),
        `sound row ${index + 1}'s ▶ and Add ${where}, taller glyphs`,
      )
      expect(Math.abs(tall - clean[index]), `sound row ${index + 1}: a taller ▶ changed the height ${where}`).toBeLessThanOrEqual(1)
    }
    await style.evaluate((node) => (node as Element).remove())

    await dialog.screenshot({ path: testInfo.outputPath(`sound-library-${viewport.width}.png`) })
    // And with the list scrolled to the music beds (#869), whose rows carry a mood.
    await dialog.getByRole('region', { name: 'Music' }).scrollIntoViewIfNeeded()
    await dialog.screenshot({ path: testInfo.outputPath(`sound-library-music-${viewport.width}.png`) })

    // The header, on a populated library (`development.md`: an empty panel
    // cannot overflow): three sounds added through the dialog itself.
    for (const name of ['Whoosh', 'Click', 'Ding']) {
      await dialog.getByRole('button', { name: `Add ${name} to the library` }).click()
      await expect(dialog.getByRole('status')).toHaveText(`Added ${name} to the library.`)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(3)

    // The plugin's button still fits the header's panel, each button's
    // label on one line. The header wraps whole controls onto a second line
    // when they do not fit (#793), which it does with the plugin on.
    await expectNoWrap(page.locator('.library-header > button'), `a library header button ${where}`)
    // And it lines up with Import clips, Record ▾ and View ▾ (#793), its
    // "…" drawn in a taller fallback font or not, as button-clusters.spec
    // checks for the header without it.
    const header = page.locator('.library-header button, .library-header select')
    const cleanHeight = await expectAlignedLines(header, `the library header with Sound library… ${where}`)
    const tallStyle = await page.addStyleTag({
      content: '.library-header > button:nth-of-type(2) { font-size: 150% !important; }',
    })
    const tallHeight = await expectAlignedLines(header, `the library header with Sound library… ${where}, taller glyphs`)
    expect(Math.abs(tallHeight - cleanHeight), `a taller "…" changed the header's height ${where}`).toBeLessThanOrEqual(1)
    await tallStyle.evaluate((node) => (node as Element).remove())
    await page.getByRole('region', { name: 'Media library' }).screenshot({
      path: testInfo.outputPath(`library-with-sound-library-${viewport.width}.png`),
    })
    await expectWithin(page.locator('.library-header'), page.getByRole('region', { name: 'Media library' }), {
      axis: 'x',
      what: `the library header ${where}`,
    })
  })
}
