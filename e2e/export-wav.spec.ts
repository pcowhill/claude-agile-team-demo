import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { sineWav } from './sineWav'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The More export formats plugin's WAV audio (#866), end to end. It enables
 * the plugin through the manager (the real lazy chunk), puts a 440 Hz tone
 * under a 3 s slate, and judges the downloaded file:
 *
 * 1. **The header**, read in Node: RIFF/WAVE, PCM, 16-bit, stereo, at the
 *    sample rate the browser's Web Audio runs at, with sizes that match.
 * 2. **The duration** is the timeline's 3 s, within 50 ms.
 * 3. **The tone**: its frequency, recovered from the samples by counting
 *    zero crossings, is 440 Hz.
 * 4. **Parity with MP3**: the same timeline exported as MP3 has the same
 *    RMS level over the same window, within 1 dB. Both formats tap the one
 *    mix, so this is the check that they hear the same samples.
 * 5. **FFmpeg**, where `ffprobe` is installed, reads `pcm_s16le`, stereo,
 *    at that rate and duration. It is not installed on every machine that
 *    runs this spec, so its absence is logged rather than failed, as
 *    `export-apng.spec.ts` does.
 */

const SECONDS = 3
const TONE_HZ = 440

interface Wav {
  format: number
  channels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bits: number
  riffSize: number
  dataSize: number
  left: Int16Array
}

/** The canonical 44-byte header and the left channel's samples. */
function readWav(bytes: Buffer): Wav {
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE')
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('fmt ')
  expect(bytes.readUInt32LE(16)).toBe(16)
  expect(bytes.subarray(36, 40).toString('latin1')).toBe('data')
  const channels = bytes.readUInt16LE(22)
  const dataSize = bytes.readUInt32LE(40)
  const frames = dataSize / (2 * channels)
  const left = new Int16Array(frames)
  for (let frame = 0; frame < frames; frame++) left[frame] = bytes.readInt16LE(44 + frame * 2 * channels)
  return {
    format: bytes.readUInt16LE(20),
    channels,
    sampleRate: bytes.readUInt32LE(24),
    byteRate: bytes.readUInt32LE(28),
    blockAlign: bytes.readUInt16LE(32),
    bits: bytes.readUInt16LE(34),
    riffSize: bytes.readUInt32LE(4),
    dataSize,
    left,
  }
}

/** The tone's frequency over [from, to) seconds: rising zero crossings, interpolated. */
function frequency(samples: Int16Array, sampleRate: number, from: number, to: number): number {
  const crossings: number[] = []
  for (let index = Math.floor(from * sampleRate) + 1; index < Math.floor(to * sampleRate); index++) {
    const before = samples[index - 1]
    const after = samples[index]
    if (before < 0 && after >= 0) crossings.push(index - 1 + -before / (after - before))
  }
  return ((crossings.length - 1) * sampleRate) / (crossings.at(-1)! - crossings[0])
}

/** What `ffprobe` reads in the file, or null where it is not installed. */
async function probe(path: string) {
  try {
    const { stdout } = await promisify(execFile)('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,channels,sample_rate,duration',
      '-of',
      'json',
      path,
    ])
    return JSON.parse(stdout) as {
      streams: { codec_name: string; channels: number; sample_rate: string; duration: string }[]
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** The RMS level over [from, to) seconds of the first channel, as the browser decodes the file, in dBFS. */
async function rmsDb(page: Page, media: Buffer, from: number, to: number): Promise<number> {
  return await page.evaluate(
    async ({ base64, from, to }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(bytes.buffer)
        const samples = buffer.getChannelData(0)
        const start = Math.floor(from * buffer.sampleRate)
        const end = Math.min(samples.length, Math.floor(to * buffer.sampleRate))
        let sum = 0
        for (let index = start; index < end; index++) sum += samples[index] * samples[index]
        return 20 * Math.log10(Math.sqrt(sum / (end - start)))
      } finally {
        await context.close()
      }
    },
    { base64: media.toString('base64'), from, to },
  )
}

/** Exports with the named format picked in the dialog; returns the file and its path. */
async function exportAs(page: Page, radio: string, filename: string): Promise<{ bytes: Buffer; path: string }> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: radio }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = (await download.path()) as string
  return { bytes: await readFile(path), path }
}

test('the enabled More export formats plugin exports the mix as a 16-bit stereo WAV that matches the MP3', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')
  // A click first gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()

  // A 3 s slate is the sequence; a 2 s 440 Hz tone under it is the mix.
  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' })
  await duration.fill(String(SECONDS))
  await duration.blur()
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const volume = page.getByRole('spinbutton', { name: 'Volume of audio track tone.wav at position 1 (0 to 4)' })
  await volume.fill('0.8')
  await volume.blur()

  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable More export formats' }).click()
  await expect(page.getByRole('button', { name: 'Disable More export formats' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  const wav = await exportAs(page, 'WAV audio (uncompressed)', 'sequence-export.wav')
  const mixRate = await page.evaluate(async () => {
    const context = new AudioContext()
    const rate = context.sampleRate
    await context.close()
    return rate
  })

  // 1. The header.
  const parsed = readWav(wav.bytes)
  const seconds = parsed.left.length / parsed.sampleRate
  const hz = frequency(parsed.left, parsed.sampleRate, 0.5, 1.5)
  console.log(
    `[${browserName}] WAV: ${wav.bytes.length} B, ${parsed.channels} ch, ${parsed.sampleRate} Hz ` +
      `(Web Audio ${mixRate} Hz), ${parsed.bits}-bit, ${seconds.toFixed(4)} s, tone ${hz.toFixed(2)} Hz`,
  )
  expect(parsed.format).toBe(1)
  expect(parsed.channels).toBe(2)
  expect(parsed.bits).toBe(16)
  expect(parsed.sampleRate).toBe(mixRate)
  expect(parsed.blockAlign).toBe(4)
  expect(parsed.byteRate).toBe(parsed.sampleRate * 4)
  expect(parsed.dataSize).toBe(wav.bytes.length - 44)
  expect(parsed.riffSize).toBe(wav.bytes.length - 8)

  // 2. The duration: the timeline's, within 50 ms.
  expect(Math.abs(seconds - SECONDS), `WAV lasts ${seconds} s against the timeline's ${SECONDS} s`).toBeLessThanOrEqual(
    0.05,
  )

  // 3. The tone.
  expect(Math.abs(hz - TONE_HZ), `recovered ${hz} Hz`).toBeLessThan(1)

  // 4. Parity with the MP3 export of the same timeline: RMS over the tone's middle.
  const mp3 = await exportAs(page, 'Audio only (MP3)', 'sequence-export.mp3')
  const wavDb = await rmsDb(page, wav.bytes, 0.5, 1.5)
  const mp3Db = await rmsDb(page, mp3.bytes, 0.5, 1.5)
  console.log(`[${browserName}] RMS 0.5-1.5 s: WAV ${wavDb.toFixed(2)} dBFS, MP3 ${mp3Db.toFixed(2)} dBFS`)
  expect(wavDb).toBeGreaterThan(-30)
  expect(Math.abs(wavDb - mp3Db)).toBeLessThanOrEqual(1)

  // 5. FFmpeg, where it is installed.
  const probed = await probe(wav.path)
  console.log(`[${browserName}] ffprobe: ${probed === null ? 'not installed, skipped' : JSON.stringify(probed)}`)
  if (probed !== null) {
    expect(probed.streams).toHaveLength(1)
    expect(probed.streams[0]).toMatchObject({ codec_name: 'pcm_s16le', channels: 2, sample_rate: String(mixRate) })
    expect(Math.abs(Number(probed.streams[0].duration) - SECONDS)).toBeLessThanOrEqual(0.05)
  }
})
