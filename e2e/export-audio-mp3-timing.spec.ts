import { readFile } from 'node:fs/promises'
import { Mp3Encoder } from '@breezystack/lamejs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The MP3 export's soundtrack starts and ends where the exported window does
 * (#908). The tap used to keep every buffer from the moment the mix graph
 * existed, before the pipeline had started playback, so the file opened on
 * 0.1–0.15 s of silence the timeline does not have and ran that much long.
 *
 * The arrangement is #908's: a 3 s slate with a 2 s 440 Hz tone at offset 0.
 * The tone's onset in the export is compared with its onset in a reference
 * MP3 that this spec encodes itself, with the same LAME encoder and settings
 * the app uses, from samples whose tone starts at exactly 0. Both files are
 * decoded by the same browser and measured by the same threshold, so the
 * encoder's delay and the threshold's own lag cancel out, and what remains
 * is the export's offset.
 */

const SECONDS = 3
const TONE_SECONDS = 2
const TONE_HZ = 440
/** The track's Volume. sineWav's amplitude is 0x4000 / 0x8000, so the mix peaks at 0.4. */
const VOLUME = 0.8
const AMPLITUDE = 0.5 * VOLUME
/** First sample above this counts as the tone's onset. Well above MP3's noise, well below the tone. */
const ONSET_THRESHOLD = 0.05
/** The app's MP3 bitrate (`src/lib/mp3Bitrate.ts`). */
const MP3_KBPS = 192

/**
 * How late the tone may start, after the encoder's delay, per browser.
 * Chromium's 20 ms is #908's criterion, and CI reads 0 ms there. Firefox's
 * start latency is bimodal (#915): attempts read 3.9-4.0 ms or 21.3-24.3 ms,
 * both modes within one run. Across 31 Firefox readings in eleven CI runs
 * (#917), every one is at most 24.3 ms but one: 44.5 ms, in the head-trim
 * test, which is exactly 40 ms + the fast mode, the signature of the defect
 * that test guards. So Firefox gets 35 ms, between the two:
 * - above the slow latency mode (24.3 ms), so latency alone passes;
 * - below 40 ms + the fast mode (~44 ms), the least the head-trim defect
 *   (a track playing its trimmed-off 40 ms, the second test) can read, so
 *   that defect fails here in either mode, as it does in Chromium. Shown
 *   failing in CI's Firefox with the tracks' up-front cue removed (#917).
 * The pre-#908 107-147 ms fails too. If 44.5 ms recurs as `flaky`, measure
 * it (#917 says how) rather than widen this.
 */
const ONSET_BOUND: Record<string, number> = { chromium: 0.02, firefox: 0.035 }
const onsetBound = (browserName: string) => ONSET_BOUND[browserName] ?? 0.02

/** The reference: SECONDS of stereo at `sampleRate`, the tone from sample 0 for TONE_SECONDS, as LAME encodes it. */
function referenceMp3(sampleRate: number): Buffer {
  const frames = SECONDS * sampleRate
  const pcm = new Int16Array(frames)
  const toneFrames = TONE_SECONDS * sampleRate
  for (let index = 0; index < toneFrames; index++) {
    pcm[index] = Math.round(Math.sin((2 * Math.PI * TONE_HZ * index) / sampleRate) * AMPLITUDE * 0x7fff)
  }
  const encoder = new Mp3Encoder(2, sampleRate, MP3_KBPS)
  const parts: Buffer[] = []
  for (let offset = 0; offset < frames; offset += 1152) {
    const block = pcm.subarray(offset, offset + 1152)
    parts.push(Buffer.from(encoder.encodeBuffer(block, block)))
  }
  parts.push(Buffer.from(encoder.flush()))
  return Buffer.concat(parts)
}

interface Decoded {
  duration: number
  sampleRate: number
  onset: number
  /** The last sample above the threshold, in seconds. */
  offset: number
}

/** Decodes the file in the page and finds where the tone starts and stops on channel 0. */
async function decode(page: Page, bytes: Buffer): Promise<Decoded> {
  return await page.evaluate(
    async ({ base64, threshold }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(data.buffer)
        const samples = buffer.getChannelData(0)
        let first = -1
        let last = -1
        for (let index = 0; index < samples.length; index++) {
          if (Math.abs(samples[index]) > threshold) {
            if (first === -1) first = index
            last = index
          }
        }
        return {
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          onset: first / buffer.sampleRate,
          offset: last / buffer.sampleRate,
        }
      } finally {
        await context.close()
      }
    },
    { base64: bytes.toString('base64'), threshold: ONSET_THRESHOLD },
  )
}

/**
 * `sineWav`'s tone with `silence` seconds of silence in front of it, so a
 * track trimmed by exactly that much starts on the tone. Played from 0
 * instead of its in-point, the export would open on that silence.
 */
function toneAfterSilence(silence: number): Buffer {
  const sampleRate = 8000
  const wav = sineWav(TONE_SECONDS + silence, sampleRate)
  // 16-bit mono after a 44-byte header: zero the samples before the tone.
  wav.fill(0, 44, 44 + Math.round(silence * sampleRate) * 2)
  return wav
}

/**
 * #908's arrangement — a SECONDS slate and a TONE_SECONDS tone at offset 0,
 * Volume VOLUME — exported as MP3 and compared with the reference. With
 * `headTrim`, the track's source carries that much silence first and its
 * in-point trims it off, so the tone is still the track's first sound.
 */
async function exportAgainstReference(page: Page, browserName: string, headTrim = 0) {
  await page.goto('./')
  // A click first gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()

  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' })
  await duration.fill(String(SECONDS))
  await duration.blur()
  await page.getByTestId('clip-file-input').setInputFiles([
    {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: headTrim === 0 ? sineWav(TONE_SECONDS) : toneAfterSilence(headTrim),
    },
  ])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const volume = page.getByRole('spinbutton', { name: 'Volume of audio track tone.wav at position 1 (0 to 4)' })
  await volume.fill(String(VOLUME))
  await volume.blur()
  if (headTrim !== 0) {
    const inPoint = page.getByRole('spinbutton', { name: 'Trim in point of audio track tone.wav at position 1 in seconds' })
    await inPoint.fill(String(headTrim))
    await inPoint.blur()
    await expect(inPoint).toHaveValue(String(headTrim))
  }

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Audio only (MP3)' }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.mp3')
  const exported = await decode(page, await readFile((await download.path()) as string))
  // The export is encoded at the mix's rate, which is the page's Web Audio rate.
  const reference = await decode(page, referenceMp3(exported.sampleRate))
  const lag = exported.onset - reference.onset
  console.log(
    `[${browserName}] head trim ${headTrim} s. ${exported.sampleRate} Hz. Export: ` +
      `${exported.duration.toFixed(4)} s, tone ${exported.onset.toFixed(4)}–${exported.offset.toFixed(4)} s. ` +
      `Reference: ${reference.duration.toFixed(4)} s, tone ${reference.onset.toFixed(4)}–` +
      `${reference.offset.toFixed(4)} s. Export lag ${(lag * 1000).toFixed(1)} ms.`,
  )
  return { exported, lag }
}

test('the MP3 export starts on the window\'s first sample and lasts the window (#908)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  const { exported, lag } = await exportAgainstReference(page, browserName)
  // The tone starts with the window, once the encoder's delay is taken out.
  expect(Math.abs(lag), `the tone starts ${(lag * 1000).toFixed(1)} ms late`).toBeLessThanOrEqual(
    onsetBound(browserName),
  )
  // The file lasts the window.
  expect(
    Math.abs(exported.duration - SECONDS),
    `the export lasts ${exported.duration} s against the window's ${SECONDS} s`,
  ).toBeLessThanOrEqual(0.05)
})

test('a track trimmed by less than a seek\'s threshold starts at its in-point (#908 review)', async ({
  page,
  browserName,
}) => {
  // A paused track starts without a seek when it is within 50 ms of where it
  // should be (START_SEEK_EPSILON), so it must be cued to its in-point up
  // front. Left at 0, a 40 ms head trim plays the 40 ms of silence it cut,
  // and the tone lands that much late.
  test.setTimeout(120_000)
  const { lag } = await exportAgainstReference(page, browserName, 0.04)
  expect(Math.abs(lag), `the tone starts ${(lag * 1000).toFixed(1)} ms late`).toBeLessThanOrEqual(
    onsetBound(browserName),
  )
})
