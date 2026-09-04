import { chromium, expect, test } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'

/**
 * Webcam recording (#226), against Chromium's fake capture devices: the
 * flags below auto-grant the permission prompt and stand in a fake camera
 * and microphone (headless CI has neither), so the capture pipeline
 * (getUserMedia → MediaRecorder → import path) runs for real — the proxy
 * evidence for the customer-verifiable real-camera criterion. The
 * executable resolution mirrors playwright.config.ts, which per-file launch
 * options would otherwise drop.
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

/** Runs one webcam capture through the Record menu, ~1s long, and stops it. */
async function recordWebcam(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Webcam' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording webcam' })).toBeVisible()
  // The dialog's live self-view plays the capture itself: a decodable video
  // frame from the stream is what a nonzero intrinsic width proves.
  await expect
    .poll(() =>
      page.getByTestId('record-preview').evaluate((el: HTMLVideoElement) => el.videoWidth),
    )
    .toBeGreaterThan(0)
  // The elapsed readout ticks — capture at least a second.
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop recording' }).click()
}

test('a webcam capture records into the library and overlays the timeline (#226)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  await recordWebcam(page)

  // The capture landed as an ordinary video clip with a real probed
  // duration (MediaRecorder WebM reports Infinity until the probe's
  // seek-to-end trick resolves it — a listed duration proves that worked).
  const library = page.getByRole('list', { name: 'Imported clips' })
  const recording = library.getByRole('listitem').filter({ hasText: 'Webcam recording 1.webm' })
  await expect(recording).toBeVisible()
  await expect(recording).toContainText(/0:0[1-9]/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The commentary-bubble case (#226): a slate carries the sequence and the
  // recording layers above it as a picture-in-picture video overlay — the
  // whole clip path, no special-casing downstream.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add Webcam recording 1.webm as overlay' }).click()
  await expect(
    page.getByRole('list', { name: 'Overlay layers' }).getByRole('listitem'),
  ).toHaveCount(1)

  // And it genuinely plays as video: the overlay's preview element decodes
  // real frames (nonzero intrinsic size) while the sequence plays.
  await page.getByRole('button', { name: 'Play preview' }).click()
  const overlay = page.getByTestId('preview-overlay-0')
  await expect
    .poll(() => overlay.evaluate((el: HTMLVideoElement) => el.videoWidth))
    .toBeGreaterThan(0)
})

test('cancel discards the webcam capture without touching the library (#226)', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Webcam' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording webcam' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
})
