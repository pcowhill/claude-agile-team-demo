import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * The exported audio mix (#105): timeline audio tracks and the videos' own
 * audio reach the exported file at the gains #104 defines. Bit-exact mix
 * content is not assertable in CI; the executable proxies are that the
 * exported WebM demuxes with a decodable, nonzero-duration audio track, and
 * that window peak levels reflect the configured gains — a fade-in makes the
 * head measurably quieter than the tail, and a muted entry's tone vanishes.
 */

interface RecordOptions {
  durationMs?: number
  /** Mixes a 440 Hz tone in from the start. Omit for a silent video track. */
  withTone?: boolean
}

/** Records a real WebM in-browser, as in export.spec.ts. */
async function recordWebm(page: Page, options: RecordOptions = {}): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ durationMs = 1500, withTone }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)

    let audio: AudioContext | null = null
    if (withTone) {
      audio = new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      if (audio.state !== 'running') {
        throw new Error(`AudioContext did not start (state: ${audio.state})`)
      }
      const destination = audio.createMediaStreamDestination()
      const gain = audio.createGain()
      gain.gain.value = 0.5
      const oscillator = audio.createOscillator()
      oscillator.frequency.value = 440
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()
      stream.addTrack(destination.stream.getAudioTracks()[0])
    }

    const mimeType = withTone ? 'video/webm;codecs=vp8,opus' : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
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
        if (performance.now() - start > durationMs) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    await audio?.close()
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, options)
  return Buffer.from(webmBase64, 'base64')
}

interface AudioMeasurement {
  peak: number
  duration: number
  channels: number
}

/**
 * Decodes the exported file's audio and reports the loudest sample in a time
 * window, as in export.spec.ts. Rejects if there is no decodable audio.
 */
async function measureAudio(
  page: Page,
  media: Buffer,
  window: { fromSeconds?: number; toSeconds?: number } = {},
): Promise<AudioMeasurement> {
  return await page.evaluate(
    async ({ base64, fromSeconds, toSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(bytes.buffer)
        const samples = buffer.getChannelData(0)
        const start = Math.max(0, Math.floor((fromSeconds ?? 0) * buffer.sampleRate))
        const end = Math.min(
          samples.length,
          Math.ceil((toSeconds ?? buffer.duration) * buffer.sampleRate),
        )
        let peak = 0
        for (let index = start; index < end; index++) {
          peak = Math.max(peak, Math.abs(samples[index]))
        }
        return { peak, duration: buffer.duration, channels: buffer.numberOfChannels }
      } finally {
        await context.close()
      }
    },
    {
      base64: media.toString('base64'),
      fromSeconds: window.fromSeconds,
      toSeconds: window.toSeconds,
    },
  )
}

/** Loud enough to be audible; comfortably above codec noise in silence. */
const AUDIBLE_PEAK = 0.05
const SILENT_PEAK = 0.01

/** Clicking first gives the page the user activation an AudioContext needs. */
async function activate(page: Page) {
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
}

const setField = async (page: Page, name: string, value: string) => {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
}

const exportOnce = async (page: Page) => {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

test('an audio track exports into the mix, its fade-in audible as a quiet head', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await activate(page)

  // A silent video plus a 4 s tone track: whatever audio the export carries
  // is the track's, so window peaks measure the track's recorded envelope.
  const webm = await recordWebm(page, { durationMs: 2600 })
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()

  const position = 'audio track tone.wav at position 1'
  await setField(page, `Volume of ${position} (0 to 1)`, '0.8')
  await setField(page, `Fade-in of ${position} in seconds`, '1.5')

  const exported = await exportOnce(page)
  const full = await measureAudio(page, exported)
  // The file demuxes with a decodable audio track covering the sequence.
  expect(full.channels).toBeGreaterThan(0)
  expect(full.duration).toBeGreaterThan(1.5)
  expect(full.peak).toBeGreaterThan(AUDIBLE_PEAK)

  // The 1.5 s fade-in reached the recording: the head is far quieter than
  // the fully-faded-in tail. (Absolute levels vary with encoding; the ratio
  // is what the envelope guarantees — gain ≤ 0.27×volume before 0.5 s vs
  // full volume after 1.5 s.)
  const head = await measureAudio(page, exported, { toSeconds: 0.5 })
  const tail = await measureAudio(page, exported, { fromSeconds: 1.8 })
  expect(tail.peak).toBeGreaterThan(AUDIBLE_PEAK)
  expect(head.peak).toBeLessThan(tail.peak * 0.6)
})

test('a muted video entry is silent in the export, and a track still plays over it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await activate(page)

  // The video carries a real tone, so muting it has something to silence.
  const webm = await recordWebm(page, { durationMs: 2000, withTone: true })
  const sourceAudio = await measureAudio(page, webm)
  expect(sourceAudio.peak).toBeGreaterThan(AUDIBLE_PEAK)

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('checkbox', { name: 'Mute clip.webm at position 1' }).check()

  // Muted entry alone: the mute reaches the recorded mix — the tone is gone.
  const mutedOnly = await measureAudio(page, await exportOnce(page))
  expect(mutedOnly.channels).toBeGreaterThan(0)
  expect(mutedOnly.peak).toBeLessThan(SILENT_PEAK)

  // Adding the music track: the export still succeeds with the entry muted,
  // and the audio it carries is the track's.
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const withTrack = await measureAudio(page, await exportOnce(page))
  expect(withTrack.channels).toBeGreaterThan(0)
  expect(withTrack.peak).toBeGreaterThan(AUDIBLE_PEAK)
})
