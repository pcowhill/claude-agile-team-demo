import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from './timelineMenu'
import { chooseRowAction, openRowMenu, rowMenu, rowMenuTrigger } from './timelineRowMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { expectMenuUsable, scrollBox } from './menuGeometry'
import { sineWav } from './sineWav'

/**
 * An audio track's ⋯ › **End with video** (#1040, from the approved #1036),
 * in a real browser: the song is trimmed to end with the sequence and fades
 * out over its last 3 s instead of stopping dead, read from the gain the
 * preview plays the track's element at; and the new item's label sits on
 * one line inside its menu, on a populated project, at 1280×720 and
 * 360×800.
 */

const TRACK = 'audio track song.wav at position 1'

/** A 5 s slate (`DEFAULT_STILL_DURATION`) under a 12 s song from 0 s. */
async function slateAndSong(page: Page) {
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'song.wav', mimeType: 'audio/wav', buffer: sineWav(12) },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add song.wav to timeline' }).click()
  await expect(page.getByTestId('preview-audio-0')).toBeAttached()
}

test('End with video fades the song out over the last 3 s of the video instead of stopping it dead (#1040)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await slateAndSong(page)
  const element = page.getByTestId('preview-audio-0')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const gainAt = async (time: string, gain: number, when: string) => {
    await seek.fill(time)
    await expect
      .poll(() => element.evaluate((audio: HTMLAudioElement) => audio.volume), {
        message: `the track element's volume at ${time} s, ${when}`,
      })
      .toBeCloseTo(gain, 3)
  }

  // Before: the 12 s song plays at full volume right up to the cut at 5 s.
  await gainAt('4.5', 1, 'before End with video')

  await chooseRowAction(page, TRACK, 'End with video')
  const out = page.getByRole('spinbutton', { name: `Trim out point of ${TRACK} in seconds`, exact: true })
  const fadeOut = page.getByRole('spinbutton', { name: `Fade-out of ${TRACK} in seconds`, exact: true })
  await expect(out).toHaveValue('5')
  await expect(fadeOut).toHaveValue('3')

  // After: full until the fade begins at 2 s, then a linear ramp to 0 at
  // 5 s (gain.ts's rule, worked out here: (5 − t) / 3), so it falls toward
  // silence at the end rather than stopping at full volume.
  await gainAt('1.5', 1, 'after, before the fade')
  await gainAt('2.6', 0.8, 'after, early in the fade')
  await gainAt('3.5', 0.5, 'after, mid-fade')
  await gainAt('4.5', 1 / 6, 'after, near the end')

  // Pressed, it has nothing left to do: the item is greyed.
  const menu = await openRowMenu(page, TRACK)
  await expect(menu.getByRole('menuitem', { name: 'End with video', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')

  // One undo step restores both the Out and the Fade out.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  await page.keyboard.press('Control+z')
  await expect(out).toHaveValue('12')
  await expect(fadeOut).toHaveValue('0')
})

for (const [width, height] of [
  [1280, 720],
  [360, 800],
] as const) {
  test(`End with video's label sits on one line inside the track's ⋯ at ${width}×${height} (#1040)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height })
    // Populated (development.md): two slates, a text overlay and the song,
    // with rows below the track for its menu to be drawn over.
    await slateAndSong(page)
    await chooseFromAddMenu(page, ADD_SLATE)
    await chooseFromAddMenu(page, ADD_TEXT)

    const list = page.getByRole('list', { name: 'Audio tracks' })
    await rowMenuTrigger(page, TRACK).scrollIntoViewIfNeeded()
    const before = await scrollBox(list)
    const menu = await openRowMenu(page, TRACK)
    const item = menu.getByRole('menuitem', { name: 'End with video', exact: true })
    // The song (12 s) runs past the two slates (10 s), so it is offered.
    await expect(item).toBeEnabled()
    await expect(menu.getByRole('menuitem')).toHaveText(['End with video', 'Duplicate', 'Copy settings', 'Rename…', 'Remove'])
    await expectNoWrap(item, `End with video at ${width}px`)
    await expectWithin(item, menu, { what: `End with video at ${width}px` })
    await expectMenuUsable(page, list, rowMenuTrigger(page, TRACK), menu, before, `${TRACK} ⋯ at ${width}px`)
    await expectNoHorizontalScroll(page, `${TRACK} ⋯ at ${width}px`)
    await page.screenshot({ path: testInfo.outputPath(`end-with-video-menu-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(rowMenu(page, TRACK)).toHaveCount(0)
  })
}
