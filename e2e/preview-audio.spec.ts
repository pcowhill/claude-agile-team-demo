import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Preview plays audio tracks (#103): a real video plus a real WAV placed as
 * audio tracks play together. Audibility itself is not assertable in CI; the
 * executable proxy is the audio elements' playing state and currentTime
 * tracking the preview position (the issue's stated criterion).
 */

/** Records a real WebM in-browser, as in preview.spec.ts. */
async function recordWebm(page: Page): Promise<Buffer> {
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
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1500) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
})

test('an overlapping track plays with the video and a mid-sequence track joins in', async ({
  page,
}) => {
  // Track 1 covers the whole ~1.5s sequence, playing source [1, 3).
  // Track 2 starts mid-sequence at 0.8s.
  const addTone = page.getByRole('button', { name: 'Add tone.wav to timeline' })
  await addTone.click()
  await addTone.click()
  const inField = page.getByRole('spinbutton', {
    name: 'Trim in point of audio track tone.wav at position 1 in seconds',
  })
  await inField.fill('1')
  await inField.blur()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of audio track tone.wav at position 1 in seconds',
  })
  await outField.fill('3')
  await outField.blur()
  const startField = page.getByRole('spinbutton', {
    name: 'Start time of audio track tone.wav at position 2 in seconds',
  })
  await startField.fill('0.8')
  await startField.blur()

  const track1 = page.getByTestId('preview-audio-0')
  const track2 = page.getByTestId('preview-audio-1')

  // The mid-playback observations ride an in-page rAF probe (the
  // export-base-readiness pattern) rather than poll round-trips from the
  // test: track 2's overlap window is well under a second, a protocol poll
  // whose backoff has grown to 1 s can straddle it entirely, and a separate
  // re-read of track 1 can land after the sequence ended and everything
  // re-paused — `paused` flipping back to true is exactly the full-suite
  // failure #365 recorded for this test. The probe samples every animation
  // frame and records each fact when it observes it, so the assertions
  // below read stable history, not transient state.
  await page.evaluate(() => {
    const probe = {
      track1Started: false,
      // Latest currentTime sampled while track 1 was playing — never a
      // post-pause read.
      track1Time: -1,
      videoPlayedWithTrack1: false,
      overlap: false,
      // Track 2's currentTime on the first tick that saw both tracks
      // unpaused together.
      track2Time: -1,
    }
    ;(window as unknown as { __audioProbe: typeof probe }).__audioProbe = probe
    const element = (testId: string) =>
      document.querySelector<HTMLMediaElement>(`[data-testid="${testId}"]`)
    const tick = () => {
      const track1 = element('preview-audio-0')
      const track2 = element('preview-audio-1')
      const video = element('preview-video')
      if (track1 && !track1.paused) {
        probe.track1Started = true
        probe.track1Time = track1.currentTime
        if (video && !video.paused) probe.videoPlayedWithTrack1 = true
        if (track2 && !track2.paused && !probe.overlap) {
          probe.overlap = true
          probe.track2Time = track2.currentTime
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const readProbe = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __audioProbe: {
              track1Started: boolean
              track1Time: number
              videoPlayedWithTrack1: boolean
              overlap: boolean
              track2Time: number
            }
          }
        ).__audioProbe,
    )

  await page.getByRole('button', { name: 'Play preview' }).click()

  // Track 1 plays immediately, from its in-point; the video plays with it
  // (the video can start a tick later than the track, so it gets its own
  // poll rather than being read off track 1's first tick).
  await expect.poll(async () => (await readProbe()).track1Started).toBe(true)
  await expect.poll(async () => (await readProbe()).videoPlayedWithTrack1).toBe(true)
  expect((await readProbe()).track1Time).toBeGreaterThanOrEqual(1)

  // Track 2 joins when the position crosses its 0.8s start, cued near the
  // start of its source (position − offset). Both tracks audible at once is
  // the point (#100), and the probe's overlap flag only sets on a tick that
  // saw both unpaused together — the simultaneity is measured in one frame,
  // not inferred from two reads.
  await expect.poll(async () => (await readProbe()).overlap, { timeout: 10_000 }).toBe(true)
  const overlap = await readProbe()
  expect(overlap.track2Time).toBeGreaterThanOrEqual(0)
  expect(overlap.track2Time).toBeLessThan(1.5)

  // The sequence ends: playback stops and every track pauses with it.
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({
    timeout: 10_000,
  })
  expect(await track1.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  expect(await track2.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
})

test('pause freezes a playing track; scrubbing while paused re-cues it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const track = page.getByTestId('preview-audio-0')

  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect
    .poll(async () => track.evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)

  await page.getByRole('button', { name: 'Pause preview' }).click()
  expect(await track.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  const frozenAt = await track.evaluate((el: HTMLAudioElement) => el.currentTime)
  await page.waitForTimeout(300)
  expect(await track.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(frozenAt)

  // Scrub to 1.0s while paused: the track re-cues to source 1.0 (offset 0,
  // untrimmed) without playing.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
  expect(await track.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  expect(await track.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(1, 1)

  // Resuming picks the track up from the scrubbed position.
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect
    .poll(async () => track.evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
  expect(await track.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThanOrEqual(1)
})
