import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * MP3 audio-only export (#269, from customer feedback #264): the mixed
 * soundtrack encoded client-side to MP3 — no browser's MediaRecorder emits
 * MP3, so the format taps the mix graph and brings its own encoder. The
 * executable proxies for "plays in other players" (per the
 * verifiable-criteria rule): the file's own bytes walk as MPEG audio frames
 * (sync pattern at every frame boundary the headers declare), and the bytes
 * decode in the browser as `audio/mpeg` with the expected duration and
 * loudness. Mix parity with the #245 WebM path is asserted on a fade: both
 * exports of the same project carry the same envelope.
 */

/** Records a real silent-video WebM in-browser, as in export-audio-only. */
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

/** Decodes exported audio and reports peak over a window, as export-audio-mix. */
async function measureAudio(
  page: Page,
  media: Buffer,
  window: { fromSeconds?: number; toSeconds?: number } = {},
): Promise<{ peak: number; duration: number; channels: number }> {
  return await page.evaluate(async ({ base64, fromSeconds, toSeconds }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(bytes.buffer)
      const samples = buffer.getChannelData(0)
      const from = Math.floor((fromSeconds ?? 0) * buffer.sampleRate)
      const to = Math.min(
        samples.length,
        Math.ceil((toSeconds ?? buffer.duration) * buffer.sampleRate),
      )
      let peak = 0
      for (let index = from; index < to; index++) {
        peak = Math.max(peak, Math.abs(samples[index]))
      }
      return { peak, duration: buffer.duration, channels: buffer.numberOfChannels }
    } finally {
      await context.close()
    }
  }, { base64: media.toString('base64'), ...window })
}

/**
 * Walks the file's leading MPEG audio frames by their own headers — the
 * frame-level check a demuxer performs. Each MPEG-1 Layer III header
 * declares its bitrate, sample rate and padding, which fix the frame's
 * length; the next sync pattern must sit exactly there.
 */
function walkMp3Frames(bytes: Buffer, count: number): { frames: number; failure: string | null } {
  const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const SAMPLE_RATES = [44100, 48000, 32000]
  let at = 0
  for (let frame = 0; frame < count; frame++) {
    if (at + 4 > bytes.length) return { frames: frame, failure: `file ends inside frame ${frame}` }
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) {
      return { frames: frame, failure: `no sync pattern at byte ${at} (frame ${frame})` }
    }
    // MPEG-1 Layer III: version bits 11, layer bits 01.
    if ((bytes[at + 1] & 0x18) !== 0x18 || (bytes[at + 1] & 0x06) !== 0x02) {
      return { frames: frame, failure: `not MPEG-1 Layer III at byte ${at}` }
    }
    const bitrate = BITRATES_KBPS[bytes[at + 2] >> 4]
    const sampleRate = SAMPLE_RATES[(bytes[at + 2] >> 2) & 0x03]
    const padding = (bytes[at + 2] >> 1) & 0x01
    if (!bitrate || sampleRate === undefined) {
      return { frames: frame, failure: `invalid header fields at byte ${at}` }
    }
    at += Math.floor((144 * bitrate * 1000) / sampleRate) + padding
  }
  return { frames: count, failure: null }
}

const AUDIBLE_PEAK = 0.05

/** Clicking first gives the page the user activation an AudioContext needs. */
async function activate(page: Page) {
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
}

const setField = async (page: Page, name: string, value: string) => {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
}

/** Exports with the named audio-only format picked in the modal. */
const exportAs = async (page: Page, radio: string, filename: string) => {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: radio }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  return await readFile(await download.path())
}

test('the mixed soundtrack exports as a real MPEG audio stream', async ({ page }) => {
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
  const exported = await exportAs(page, 'Audio only (MP3)', 'sequence-export.mp3')

  // Frame-level: the leading frames walk by their own declared lengths.
  const walked = walkMp3Frames(exported, 5)
  expect(walked.failure, `MPEG frame walk: ${walked.failure ?? 'ok'}`).toBeNull()

  // Decodes as audio covering the sequence, carrying the tone's energy.
  const audio = await measureAudio(page, exported)
  expect(audio.channels).toBeGreaterThan(0)
  expect(audio.duration).toBeGreaterThan(1.5)
  expect(audio.peak).toBeGreaterThan(AUDIBLE_PEAK)
})

test('the MP3 carries the same mix as the WebM path — one fade, two encoders', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')
  await activate(page)

  // The same project exports through both audio paths: a 1.5 s fade-in on
  // the tone track gives the envelope a shape either export must carry.
  const webm = await recordWebm(page, 2600)
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

  const asWebm = await exportAs(page, 'Audio only (WebM/Opus)', 'sequence-export.webm')
  const asMp3 = await exportAs(page, 'Audio only (MP3)', 'sequence-export.mp3')

  // Both carry the fade: a quiet head against a full tail...
  const mp3Head = await measureAudio(page, asMp3, { toSeconds: 0.5 })
  const mp3Tail = await measureAudio(page, asMp3, { fromSeconds: 1.8, toSeconds: 2.4 })
  const webmHead = await measureAudio(page, asWebm, { toSeconds: 0.5 })
  const webmTail = await measureAudio(page, asWebm, { fromSeconds: 1.8, toSeconds: 2.4 })
  expect(mp3Tail.peak).toBeGreaterThan(AUDIBLE_PEAK)
  expect(mp3Head.peak).toBeLessThan(mp3Tail.peak * 0.6)
  // ...and the same envelope, not merely a similar one: the two files come
  // from the same mix graph, so head-to-tail ratio and absolute tail level
  // agree across encoders within codec tolerance. A separate re-mix (a
  // dropped fade, a doubled gain) would move these far past 25%.
  const mp3Ratio = mp3Head.peak / mp3Tail.peak
  const webmRatio = webmHead.peak / webmTail.peak
  expect(Math.abs(mp3Ratio - webmRatio), `head/tail ${mp3Ratio} vs ${webmRatio}`).toBeLessThan(
    0.25,
  )
  expect(
    Math.abs(mp3Tail.peak - webmTail.peak) / webmTail.peak,
    `tail peaks ${mp3Tail.peak} vs ${webmTail.peak}`,
  ).toBeLessThan(0.25)
})
