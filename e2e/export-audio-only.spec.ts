import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Audio-only export (#245): the project's mixed soundtrack saved as a
 * WebM/Opus audio file with no video track. Bit-exact content is not
 * assertable in CI; the executable proxies are the audio-mix idiom — the
 * exported file demuxes with a decodable audio track whose duration covers
 * the sequence and whose window peaks reflect the configured gains — plus
 * the no-video-track check: a <video> element decodes the file with zero
 * intrinsic dimensions.
 */

/** Records a real silent-video WebM in-browser, as in export-audio-mix. */
async function recordWebm(page: Page, durationMs: number): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ durationMs }) => {
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
        if (performance.now() - start > durationMs) resolve()
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
  }, { durationMs })
  return Buffer.from(webmBase64, 'base64')
}

/** Decodes the exported audio and reports the loudest sample, as in export-audio-mix. */
async function measureAudio(
  page: Page,
  media: Buffer,
): Promise<{ peak: number; duration: number; channels: number }> {
  return await page.evaluate(async ({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(bytes.buffer)
      const samples = buffer.getChannelData(0)
      let peak = 0
      for (let index = 0; index < samples.length; index++) {
        peak = Math.max(peak, Math.abs(samples[index]))
      }
      return { peak, duration: buffer.duration, channels: buffer.numberOfChannels }
    } finally {
      await context.close()
    }
  }, { base64: media.toString('base64') })
}

/** The file's intrinsic video dimensions — an audio-only file decodes 0×0. */
async function probeVideoDimensions(
  page: Page,
  media: Buffer,
): Promise<{ width: number; height: number }> {
  return await page.evaluate(async ({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    try {
      const video = document.createElement('video')
      video.preload = 'metadata'
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('undecodable')), { once: true })
        video.src = url
      })
      return { width: video.videoWidth, height: video.videoHeight }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, { base64: media.toString('base64') })
}

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

/** Exports with the audio-only format picked in the modal. */
const exportAudioOnly = async (page: Page) => {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Audio only (WebM/Opus)' }).check()
  // The video-only output settings vanish for an audio-only format (#245).
  await expect(page.getByRole('spinbutton', { name: 'Export width in pixels' })).toHaveCount(0)
  await expect(
    page.getByRole('spinbutton', { name: 'Export frame rate in frames per second' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.webm')
  return await readFile(await download.path())
}

test('the mixed soundtrack exports as an audio file with no video track', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await activate(page)

  // A silent ~2.6 s video carries the sequence; a 2 s tone track is the mix.
  const webm = await recordWebm(page, 2600)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await setField(page, 'Volume of audio track tone.wav at position 1 (0 to 1)', '0.8')

  const exported = await exportAudioOnly(page)

  // Decodable audio covering the sequence, carrying the tone's energy.
  const audio = await measureAudio(page, exported)
  expect(audio.channels).toBeGreaterThan(0)
  expect(audio.duration).toBeGreaterThan(1.5)
  expect(audio.peak).toBeGreaterThan(AUDIBLE_PEAK)

  // And genuinely no video track: the file decodes with no intrinsic size.
  const dimensions = await probeVideoDimensions(page, exported)
  expect(dimensions).toEqual({ width: 0, height: 0 })
})

test('a muted mix still exports a valid — near-silent — audio file', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await activate(page)

  const webm = await recordWebm(page, 2100)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  // The video is silent already; zeroing the track mutes the whole mix.
  await setField(page, 'Volume of audio track tone.wav at position 1 (0 to 1)', '0')

  const exported = await exportAudioOnly(page)

  // Soundless sources still yield a valid audio file, not a failure (#245).
  const audio = await measureAudio(page, exported)
  expect(audio.channels).toBeGreaterThan(0)
  expect(audio.duration).toBeGreaterThan(1.5)
  expect(audio.peak).toBeLessThan(SILENT_PEAK)
})
