import { expect, test } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * Webcam recording (#226), against Chromium's fake capture devices: the
 * flags auto-grant the permission prompt and stand in a fake camera
 * and microphone (headless CI has neither), so the capture pipeline
 * (getUserMedia → MediaRecorder → import path) runs for real — the proxy
 * evidence for the customer-verifiable real-camera criterion.
 * `withFakeMedia` (`fakeMedia.ts`) gives each browser its own fakes (#599).
 */
withFakeMedia(test)

/** Runs one webcam capture through the Record menu, ~2s long, and stops it. */
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
  // The elapsed readout ticks. Stop at 0:02, not 0:01 (#812): with the fake
  // camera the recorder starts ~0.4 s behind the readout's clock — a take
  // stopped at 0:01 held only 0–586 ms of media in CI's Firefox (#788's
  // measurement, run 44782336721) — so under load a 0:01 take can fall
  // under half a second and list as 0:00. At 0:02 it holds ~1.6 s or more.
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[2-9]/, { timeout: 15_000 })
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
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseClipAction(page, 'Webcam recording 1.webm', 'Add as overlay')
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
