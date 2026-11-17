import { expect, test } from '@playwright/test'

/**
 * The machine running the suite has an audio output the browser can start
 * (#600).
 *
 * This is a precondition of the export and audio specs, not a product
 * behaviour. Firefox on a machine with no sound device (no `/dev/snd`, no
 * sound server) leaves `AudioContext.resume()` pending forever. An export
 * then waits out #596's bound and exports without sound, and every
 * audio-asserting spec fails on its sound, far from the cause. Chromium's
 * headless build has a fake audio output and always passes here. CI gives
 * Firefox a PulseAudio null sink before its suite (`.github/workflows/ci.yml`);
 * the README says how to do the same in a session container. When this test
 * fails, that is the step to look at.
 */
test('an AudioContext starts on this machine: the export and audio specs need an audio output (#600)', async ({
  page,
}) => {
  await page.goto('./')
  // A user gesture, so an autoplay policy cannot be what holds it.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.keyboard.press('Escape')
  const result = await page.evaluate(async () => {
    const context = new AudioContext()
    const outcome = await Promise.race([
      context.resume().then(
        () => 'resolved',
        (error: unknown) => `rejected: ${String(error)}`,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('still pending after 5 s'), 5000)),
    ])
    const state = context.state
    void context.close().catch(() => {})
    return { outcome, state }
  })
  expect(
    result,
    'AudioContext.resume() must settle and leave the context running. If it is still pending, this machine has no audio output: start a sound server with a null sink (README, "Firefox").',
  ).toEqual({ outcome: 'resolved', state: 'running' })
})
