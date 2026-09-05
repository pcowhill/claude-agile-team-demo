import { chromium, expect, test } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'

/**
 * Screen recording (#225), against Chromium's fake display capture: the
 * flags below make `getDisplayMedia` auto-select the editor's own tab
 * (no picker UI exists headless) with permission auto-granted, and provide
 * a fake audio device so the capture's audio:true request can start in an
 * audio-less container (headless CI has no real audio subsystem). The
 * capture pipeline (getDisplayMedia → MediaRecorder → import path) runs for
 * real — the proxy evidence for the customer-verifiable real-window/display
 * criterion. The executable resolution mirrors playwright.config.ts, which
 * per-file launch options would otherwise drop.
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: [
      '--auto-select-tab-capture-source-by-title=Browser Video Editor',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

/** Runs one screen capture through the Record menu, ~1s long, and stops it. */
async function recordScreen(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording screen' })).toBeVisible()
  // The dialog's live preview plays the capture itself: a decodable video
  // frame from the stream is what a nonzero intrinsic width proves.
  await expect
    .poll(() =>
      page.getByTestId('record-preview').evaluate((el: HTMLVideoElement) => el.videoWidth),
    )
    .toBeGreaterThan(0)
  // The elapsed readout ticks — the product's wall-clock counter works.
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
  // "Captured at least a second" is anchored on media the stream actually
  // delivered, not on that wall clock (#373): tab capture only emits frames
  // when the captured tab repaints, so under CPU load the recorder can hold
  // almost no media while the readout ticks past 0:01 — the saved WebM's
  // probed duration is its last frame's timestamp, and the library card
  // then reads 0:00. The probe below rides the live preview (which plays
  // the capture stream itself) and records the span of presented frames'
  // mediaTime; the recorder attached to the same stream before the preview
  // started playing, so its recorded span is at least this. 1.2 s of span
  // keeps the card's rounded display at 0:01 or more with margin. Load can
  // make this wait longer, never the later assertion false; a capture that
  // truly delivers no frames times out loudly here.
  await page.getByTestId('record-preview').evaluate((el: HTMLVideoElement) => {
    const probe = { first: -1, span: 0 }
    ;(window as unknown as { __captureSpanProbe: typeof probe }).__captureSpanProbe = probe
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (probe.first < 0) probe.first = metadata.mediaTime
      probe.span = metadata.mediaTime - probe.first
      el.requestVideoFrameCallback(onFrame)
    }
    el.requestVideoFrameCallback(onFrame)
  })
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __captureSpanProbe: { span: number } }).__captureSpanProbe
              .span,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(1.2)
  await page.getByRole('button', { name: 'Stop recording' }).click()
}

test('a screen capture records into the library and plays on the timeline (#225)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  await recordScreen(page)

  // The capture landed as an ordinary video clip with a real probed
  // duration (MediaRecorder WebM reports Infinity until the probe's
  // seek-to-end trick resolves it — a listed duration proves that worked).
  const library = page.getByRole('list', { name: 'Imported clips' })
  const recording = library.getByRole('listitem').filter({ hasText: 'Screen recording 1.webm' })
  await expect(recording).toBeVisible()
  await expect(recording).toContainText(/0:0[1-9]/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Placed on the timeline it is a normal video entry — the whole clip
  // path, no special-casing downstream.
  await page.getByRole('button', { name: 'Add Screen recording 1.webm to timeline' }).click()

  // And it genuinely plays as video: the preview element advances and
  // decodes real frames (nonzero intrinsic size).
  await page.getByRole('button', { name: 'Play preview' }).click()
  const video = page.getByTestId('preview-video')
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.1)
  expect(await video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBeGreaterThan(0)
})

test('cancel discards the screen capture without touching the library (#225)', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording screen' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
})

test("the browser's own stop-sharing ends the capture like Stop (#225)", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording screen' })).toBeVisible()
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[1-9]/, { timeout: 15_000 })

  // End the share from outside our dialog — what the browser's "stop
  // sharing" bar does is end the capture's tracks.
  await page.evaluate(() => {
    const preview = document.querySelector(
      '[data-testid="record-preview"]',
    ) as HTMLVideoElement | null
    const stream = preview?.srcObject as MediaStream | null
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
      track.dispatchEvent(new Event('ended'))
    }
  })

  // The recording concluded exactly as Stop would: dialog gone, clip landed.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(
    library.getByRole('listitem').filter({ hasText: 'Screen recording 1.webm' }),
  ).toBeVisible()
})
