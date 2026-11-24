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

test('the MP3 export starts on the window\'s first sample and lasts the window (#908)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  // A click first gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()

  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' })
  await duration.fill(String(SECONDS))
  await duration.blur()
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(TONE_SECONDS) },
  ])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const volume = page.getByRole('spinbutton', { name: 'Volume of audio track tone.wav at position 1 (0 to 4)' })
  await volume.fill(String(VOLUME))
  await volume.blur()

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
    `[${browserName}] ${exported.sampleRate} Hz. Export: ${exported.duration.toFixed(4)} s, tone ` +
      `${exported.onset.toFixed(4)}–${exported.offset.toFixed(4)} s. Reference: ` +
      `${reference.duration.toFixed(4)} s, tone ${reference.onset.toFixed(4)}–${reference.offset.toFixed(4)} s. ` +
      `Export lag ${(lag * 1000).toFixed(1)} ms.`,
  )
  // The tone starts with the window, once the encoder's delay is taken out.
  expect(Math.abs(lag), `the tone starts ${(lag * 1000).toFixed(1)} ms late`).toBeLessThanOrEqual(0.02)
  // The file lasts the window.
  expect(
    Math.abs(exported.duration - SECONDS),
    `the export lasts ${exported.duration} s against the window's ${SECONDS} s`,
  ).toBeLessThanOrEqual(0.05)
})
