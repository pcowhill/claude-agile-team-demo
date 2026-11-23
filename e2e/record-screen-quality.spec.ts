import { expect, test } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'

type Page = import('@playwright/test').Page

/**
 * Screen recording quality (#853, from customer feedback #852), against the
 * browser's real `MediaRecorder` and its fake display capture (see
 * `record-screen.spec.ts` for the flags). The unit tests pin which options
 * the recording module asks for; what only a real browser can show is that
 * the option survives to the recorder the page actually constructs, sized
 * from the capture track's real `getSettings()`, and that a recording made
 * with it still lands in the library.
 *
 * The page's `MediaRecorder` is wrapped before the app loads, so every
 * construction is logged with its options and the video track's settings.
 * The wrapper subclasses the real one: the recording itself is untouched.
 */
withFakeMedia(test, ['--auto-select-tab-capture-source-by-title=Browser Video Editor'])

const SETTINGS_KEY = 'browser-video-editor.settings'

interface Construction {
  videoBitsPerSecond: number | null
  hasVideo: boolean
  width: number | null
  height: number | null
  frameRate: number | null
}

async function logRecorders(page: Page) {
  await page.addInitScript(() => {
    const Real = window.MediaRecorder
    const log: unknown[] = []
    ;(window as unknown as { __recorders: unknown[] }).__recorders = log
    class Logged extends Real {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {}
        log.push({
          videoBitsPerSecond: options?.videoBitsPerSecond ?? null,
          hasVideo: stream.getVideoTracks().length > 0,
          width: settings.width ?? null,
          height: settings.height ?? null,
          frameRate: settings.frameRate ?? null,
        })
      }
    }
    window.MediaRecorder = Logged
  })
}

const constructions = (page: Page) =>
  page.evaluate(() => (window as unknown as { __recorders: Construction[] }).__recorders)

/** The High rate, re-derived here rather than imported: 0.25 bits per pixel per frame, capped. */
function expectedHighRate({ width, height, frameRate }: Construction): number {
  const or = (value: number | null, fallback: number) =>
    value !== null && Number.isFinite(value) && value > 0 ? value : fallback
  return Math.min(40_000_000, Math.round(or(width, 1920) * or(height, 1080) * or(frameRate, 30) * 0.25))
}

/** One screen take through the Record menu, stopped once a frame and a second are in. */
async function recordScreen(page: Page) {
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Recording screen' })).toBeVisible()
  await expect
    .poll(() =>
      page.getByTestId('record-preview').evaluate((el: HTMLVideoElement) => el.videoWidth),
    )
    .toBeGreaterThan(0)
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Imported clips' })
      .getByRole('listitem')
      .filter({ hasText: 'Screen recording 1.webm' }),
  ).toBeVisible({ timeout: 30_000 })
}

test('High, the default: the real recorder is asked for a rate sized from the captured tab (#853)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await logRecorders(page)
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ countdownSeconds: 0 }))
  }, SETTINGS_KEY)
  await page.goto('./')

  await recordScreen(page)

  const [screen] = await constructions(page)
  expect(screen.hasVideo).toBe(true)
  // The fake tab capture reports its real size; the rate follows it.
  expect(screen.width).toBeGreaterThan(0)
  expect(screen.videoBitsPerSecond).toBe(expectedHighRate(screen))
  // Above what the browser picks on its own (#853 measured 2.5 Mbit/s for
  // that) at any capture this suite's 1280×720 viewport can produce.
  expect(screen.videoBitsPerSecond).toBeGreaterThan(2_500_000)
})

test('Standard: the real recorder is asked for no rate, and the browser chooses as before (#853)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await logRecorders(page)
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ countdownSeconds: 0, screenRecordingQuality: 'standard' }),
    )
  }, SETTINGS_KEY)
  await page.goto('./')

  await recordScreen(page)

  const [screen] = await constructions(page)
  expect(screen.hasVideo).toBe(true)
  expect(screen.videoBitsPerSecond).toBeNull()
})
