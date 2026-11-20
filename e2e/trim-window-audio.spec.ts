import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { sineWav } from './sineWav'

/**
 * The Trim window on an audio track (#711), in a real browser: no picture,
 * Play trim playing the sound from In and stopping at Out, and the window's
 * geometry at 1280×720 and 360px. The video entry's window is
 * `trim-window.spec.ts`'s; this one differs in what it plays and what its
 * strip holds.
 *
 * The track is a 6 s, 440 Hz WAV built in Node (`sineWav`), so no binary
 * fixture is committed.
 */

const NAME = 'tone.wav'
const TRACK = `audio track ${NAME} at position 1`

async function addTrack(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: NAME, mimeType: 'audio/wav', buffer: sineWav(6) }])
  await page.getByRole('button', { name: `Add ${NAME} to timeline` }).click()
  await expect(page.getByRole('spinbutton', { name: `Trim in point of ${TRACK} in seconds` })).toBeVisible()
}

async function openTrim(page: Page) {
  await page.getByRole('button', { name: `Trim ${TRACK} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${TRACK}` })
  await expect(dialog).toBeVisible()
  // The sound is loaded, so its clock is the track's.
  await expect
    .poll(() => dialog.getByTestId('trim-audio').evaluate((audio: HTMLAudioElement) => audio.readyState))
    .toBeGreaterThanOrEqual(2)
  return dialog
}

async function setClamps(dialog: Locator, inPoint: number, outPoint: number) {
  for (const [name, value] of [
    ['In point to apply in seconds', inPoint],
    ['Out point to apply in seconds', outPoint],
  ] as const) {
    const field = dialog.getByRole('spinbutton', { name })
    await field.fill(String(value))
    await field.press('Enter')
  }
  await expect(dialog.getByRole('slider', { name: 'In clamp' })).toHaveAttribute('aria-valuenow', String(inPoint))
  await expect(dialog.getByRole('slider', { name: 'Out clamp' })).toHaveAttribute('aria-valuenow', String(outPoint))
}

/** The window's player, read in one page read: its clock and whether it plays. */
const audioState = (dialog: Locator) =>
  dialog
    .getByTestId('trim-audio')
    .evaluate((audio: HTMLAudioElement) => ({ time: audio.currentTime, paused: audio.paused }))

/** One look at the player, taken in the page. */
type Sample = { at: number; via: string; paused: boolean; time: number; readyState: number }
/** What the page saw of the player while it was being recorded. */
type PlaybackRecord = { samples: Sample[]; plays: string[]; startedAt: number }
type RecordingWindow = Window & { trimPlayback?: PlaybackRecord }

/**
 * Starts recording the window's player in the page (#763): every animation
 * frame and every media event, and the outcome of each `play()` call.
 *
 * Playing from In = 1 to Out = 2 lasts about a second, and only part of it
 * is "playing and past 1.05 s". Where that part falls varies. Firefox with
 * a null sink reports the element playing at once, but its clock can stand
 * at In for up to 2 s first (0.08–1.96 s over 24 runs, #763). A poll from
 * the test reads only at its own moments, which settle 1 s apart plus the
 * time each read takes, so on a loaded machine every read can fall outside
 * that part.
 * Once the window has stopped at Out the state never comes back, and the
 * poll waits out its timeout. The page sees every frame. This recorder's
 * frame callback is registered before Play trim is pressed, so in each frame
 * it runs before the window's own tick. It therefore sees the player still
 * playing on the frame where that tick stops it at Out.
 *
 * `plays` is there for the other way this could fail: `play()` rejecting,
 * which the window swallows into "not playing" (`TrimDialog.tsx`).
 */
async function recordPlayback(dialog: Locator) {
  await dialog.getByTestId('trim-audio').evaluate((audio: HTMLAudioElement) => {
    const record: PlaybackRecord = { samples: [], plays: [], startedAt: performance.now() }
    ;(window as RecordingWindow).trimPlayback = record
    const sample = (via: string) =>
      record.samples.push({
        at: Math.round(performance.now() - record.startedAt),
        via,
        paused: audio.paused,
        time: audio.currentTime,
        readyState: audio.readyState,
      })
    // Frames for ten seconds: far longer than the test waits for anything.
    const frame = () => {
      sample('frame')
      if (performance.now() - record.startedAt < 10_000) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    for (const type of ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'timeupdate', 'ended']) {
      audio.addEventListener(type, () => sample(type))
    }
    // The window calls play() on this element, so an own property sees it.
    const play = audio.play.bind(audio)
    audio.play = () => {
      const at = () => Math.round(performance.now() - record.startedAt)
      record.plays.push(`called at ${at()} ms`)
      const promise = play()
      promise.then(
        () => record.plays.push(`resolved at ${at()} ms`),
        (error: unknown) => record.plays.push(`rejected at ${at()} ms: ${String(error)}`),
      )
      return promise
    }
  })
}

/**
 * What the recording shows so far: whether the player was ever seen playing
 * past `past`, with what a failure needs in order to say why it was not.
 */
const playbackSummary = (page: Page, past: number) =>
  page.evaluate((past) => {
    const record = (window as RecordingWindow).trimPlayback
    if (record === undefined) return { seenPlayingPast: false, why: 'no recording in the page' }
    const playing = record.samples.filter((sample) => !sample.paused)
    return {
      seenPlayingPast: playing.some((sample) => sample.time > past),
      plays: record.plays,
      samples: record.samples.length,
      firstPlaying: playing[0] ?? null,
      lastPlaying: playing.at(-1) ?? null,
      last: record.samples.at(-1) ?? null,
      // The media events alone, which are few: the order they came in is
      // most of the story when the player never got going.
      events: record.samples
        .filter((sample) => sample.via !== 'frame')
        .slice(0, 40)
        .map((sample) => `${sample.at} ${sample.via} ${sample.paused ? 'paused' : 'playing'} ${sample.time.toFixed(3)}`),
    }
  }, past)

test('an audio track’s Trim window has no picture, and Play trim plays the sound from In and stops at Out (#711)', async ({
  page,
}) => {
  await addTrack(page)
  const dialog = await openTrim(page)
  await expect(dialog.locator('video')).toHaveCount(0)
  await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
  await setClamps(dialog, 1, 2)

  await recordPlayback(dialog)
  await dialog.getByRole('button', { name: 'Play trim' }).click()
  // It plays from In: the clock moves on past it, while playing. Read from
  // the page's recording, not by polling the element (#763). Short of that,
  // the poll reads the whole summary as text, so a failure prints play()'s
  // outcome and the player's events rather than a bare false.
  await expect
    .poll(async () => {
      const summary = await playbackSummary(page, 1.05)
      return summary.seenPlayingPast ? 'seen playing past 1.05 s' : JSON.stringify(summary, null, 2)
    })
    .toBe('seen playing past 1.05 s')
  // …and stops at Out, within a tenth of a second. The button reading Play
  // trim again is the window's own record that it stopped; the element's
  // clock and paused state are then read together, from one render.
  await expect(dialog.getByRole('button', { name: 'Play trim' })).toBeVisible({ timeout: 5000 })
  await expect.poll(async () => (await audioState(dialog)).paused).toBe(true)
  const stopped = await audioState(dialog)
  expect(Math.abs(stopped.time - 2)).toBeLessThanOrEqual(0.1)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`an audio track’s Trim window fits a ${viewport.width}px window: strip, clamps and buttons inside it, no label wrapping (#711)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await addTrack(page)
    const what = `at ${viewport.width}px`
    // The row's Trim… first: on its row, on one line, the page still.
    const row = page.getByRole('list', { name: 'Audio tracks' }).getByRole('listitem').first()
    const trim = row.getByRole('button', { name: `Trim ${TRACK} in the Trim window` })
    await expectWithin(trim, row, { what: `the track row's Trim… ${what}` })
    await expectNoWrap(trim, `the track row's Trim… ${what}`)
    await expectNoHorizontalScroll(page, `with Trim… on the track row ${what}`)

    const dialog = await openTrim(page)
    // A trim set, so the clamps sit apart and the dim parts show.
    await setClamps(dialog, 1.5, 4.5)
    const strip = dialog.getByTestId('trim-strip')
    await expect(dialog.getByTestId('trim-waveform')).toBeVisible()
    await expectWithin(strip, dialog, { what: `the strip ${what}` })
    // The waveform fills the strip: there is no frame row above it. A 2px
    // allowance for the strip's 1px border, inside which the lane sits.
    const [stripBox, waveBox] = await Promise.all([
      strip.boundingBox(),
      dialog.locator('.trim-strip-waveform').boundingBox(),
    ])
    expect(waveBox!.height, `the waveform's share of the strip ${what}`).toBeGreaterThanOrEqual(stripBox!.height - 2)
    for (const name of ['In clamp', 'Out clamp']) {
      await expectWithin(dialog.getByRole('slider', { name }), dialog, { what: `the ${name} ${what}` })
    }
    const buttons = dialog.getByRole('button')
    // ✕, ⏮ In, Play trim, Out ⏭, ↻ Loop, Set In, Set Out, Cancel, Apply:
    // the frame steps are not there, an audio track having no frames.
    expect(await buttons.count()).toBe(9)
    for (const button of await buttons.all()) {
      await expectWithin(button, dialog, { what: `button "${await button.textContent()}" ${what}` })
    }
    await expectNoWrap(buttons, `a Trim window button ${what}`)
    await expectNoHorizontalScroll(page, `with the Trim window open ${what}`)

    await dialog.screenshot({ path: testInfo.outputPath(`trim-window-audio-${viewport.width}.png`) })
  })
}
