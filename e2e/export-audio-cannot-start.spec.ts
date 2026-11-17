import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * An export whose audio cannot start still completes, without sound (#596).
 *
 * A browser whose audio backend cannot open an output device (a machine
 * with no sound device, or a sound server that is down) leaves
 * `AudioContext.resume()` pending forever. The export awaited it without a
 * bound, so it never reached the recorder: the dialog sat at 0%, with no
 * error, until Cancel. Firefox does this in a session container (#586's
 * audit). Chromium's headless build has a fake audio output, so here an init
 * script reproduces the condition. Every AudioContext reports `suspended`,
 * and its `resume()` never settles.
 *
 * The export must give up on sound after the bound (`AUDIO_START_TIMEOUT_MS`,
 * 5 s) and produce a WebM with a video track and no audio track.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'state', {
      configurable: true,
      get: () => 'suspended',
    })
    AudioContext.prototype.resume = () => new Promise<void>(() => {})
  })
})

/** The WebM `TrackType` of every track in the file's `Tracks` element: 1 video, 2 audio. */
function webmTrackTypes(file: Buffer): number[] {
  // EBML IDs: EBML header 1A45DFA3, Tracks 1654AE6B, TrackType 83.
  expect(file.subarray(0, 4).toString('hex'), 'an EBML (WebM) header').toBe('1a45dfa3')
  const tracksAt = file.indexOf(Buffer.from('1654ae6b', 'hex'))
  expect(tracksAt, 'a Tracks element').toBeGreaterThan(0)
  // The element's size is an EBML variable-length integer: the leading
  // zero bits of its first byte say how many bytes follow.
  let at = tracksAt + 4
  const first = file[at]
  let length = 1
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length++
  let size = first & (0xff >> length)
  for (let i = 1; i < length; i++) size = size * 256 + file[at + i]
  at += length
  const tracks = file.subarray(at, at + size)
  const types: number[] = []
  for (let i = 0; i + 2 < tracks.length; i++) {
    // TrackType, a one-byte size (0x81), then the value.
    if (tracks[i] === 0x83 && tracks[i + 1] === 0x81) types.push(tracks[i + 2])
  }
  return types
}

test('an export whose audio never starts completes without sound instead of hanging at 0% (#596)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('./')

  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('1')
  await duration.blur()

  // On today's code the download never comes. The bound is 5 s and a 1 s
  // slate exports in about a second, so 30 s is ample headroom and still a
  // prompt failure.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  // Video only: one video track, no audio track.
  expect(webmTrackTypes(exported)).toEqual([1])

  // And the video track decodes: the browser loads the file and reports a
  // frame size.
  const size = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('the exported file did not load'))
    })
    URL.revokeObjectURL(url)
    return { width: video.videoWidth, height: video.videoHeight }
  }, exported.toString('base64'))
  expect(size.width).toBeGreaterThan(0)
  expect(size.height).toBeGreaterThan(0)
})
