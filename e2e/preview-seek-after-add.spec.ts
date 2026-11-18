import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * #607: in Firefox, a paused seek made straight after adding a clip left
 * the preview on the clip's first frame. The playhead and the seek slider
 * read the new position, but the element on screen stood at 0 until the
 * next play or seek.
 *
 * Adding the clip cues the element to 0 and, because the source is new,
 * parks that cue on `loadedmetadata`. The seek's cue arrived after the load
 * had begun (`currentSrc` already read the clip) and before its metadata,
 * so it seeked at once. Then metadata landed, and the parked cue to 0 ran
 * last. `cueElement` now withdraws a parked cue when a newer one arrives
 * for the same element.
 *
 * Whether a seek falls into that window is a matter of load timing. With a
 * 6 s VP9 + Opus file, Firefox fell into it 5 times in 5 on main, and
 * Chromium never did; with a smaller file, Firefox did 1 time in 5. So
 * this spec holds the window open rather than waiting for a slow load: the
 * preview element's first `loadedmetadata` is kept from the app for a
 * second (stopped in the capture phase, then dispatched again). That gives
 * the same order of events in either browser, so the spec runs in both
 * projects and fails on the old code in both.
 *
 * The fixture is #584's cue-less recording, the only committed clip longer
 * than 5 s. Its shape is beside the point here.
 */

const fixture = () =>
  Buffer.from(readFileSync('src/lib/fixtures/cueless-clusters.webm.base64', 'utf8'), 'base64')

/** How long the app is kept waiting for the preview element's metadata. */
const METADATA_HELD_MS = 1000

test('a paused seek straight after adding a clip shows the frame at the playhead (#607)', async ({
  page,
}) => {
  await page.addInitScript((heldMs) => {
    let held = false
    document.addEventListener(
      'loadedmetadata',
      (event) => {
        const element = event.target as HTMLElement
        if (held || !event.isTrusted || element.dataset.testid !== 'preview-video') return
        held = true
        event.stopImmediatePropagation()
        setTimeout(() => element.dispatchEvent(new Event('loadedmetadata')), heldMs)
      },
      true,
    )
  }, METADATA_HELD_MS)
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'recording.webm', mimeType: 'video/webm', buffer: fixture() },
  ])
  await page.getByRole('button', { name: 'Add recording.webm to timeline' }).click()

  // Seek without waiting, so the seek lands while metadata is held back.
  // toPass only retries a fill the slider refuses while its max is still
  // settling (#365).
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  let target = 0
  await expect(async () => {
    const max = Number(await seek.getAttribute('max'))
    expect(max).toBeGreaterThan(5)
    target = Math.round((max - 0.5) * 100) / 100
    await seek.fill(String(target))
  }).toPass({ timeout: 10_000 })
  await seek.blur()
  await expect(seek).toHaveValue(String(target))

  // The playhead and the element on screen must agree. Both are read in
  // one evaluate, so they come from the same moment. The clip is untrimmed
  // and first on the timeline, so its source time is the sequence position.
  const gap = () =>
    page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>(
        'input[aria-label="Seek within sequence"]',
      )!
      const video = document.querySelector<HTMLVideoElement>('[data-testid="preview-video"]')!
      return Math.abs(video.currentTime - Number(slider.value))
    })

  // Past the held metadata, which is when the old code's parked cue ran.
  await page.waitForTimeout(METADATA_HELD_MS + 500)
  await expect
    .poll(gap, { message: 'the element on screen stands at the playhead (within 0.05 s)' })
    .toBeLessThanOrEqual(0.05)
})
