import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Audio ducking (#241): a duck-enabled voice track lowers every other sound
 * source to its duck level while it plays, identically in the exported mix.
 * Bit-exact content is not assertable in CI; the executable proxy is the
 * audio-mix spec idiom — window peak levels of the exported file's decoded
 * audio. With ducking off the music's level under the voice window matches
 * its level outside; with ducking on it is measurably quieter there.
 */

/** Records a real silent WebM in-browser, as in export-audio-mix.spec.ts. */
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

/** Decodes the exported audio and reports the loudest sample in a window. */
async function measureAudio(
  page: Page,
  media: Buffer,
  window: { fromSeconds?: number; toSeconds?: number } = {},
): Promise<{ peak: number; duration: number; channels: number }> {
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

test('a duck-enabled voice track lowers the music under its window in the export', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')
  await activate(page)

  // A silent ~4.2 s video carries the sequence; a 4 s music tone spans it,
  // and a quiet 1 s "voice" tone sits at [1.5, 2.5). The voice's own volume
  // is 0.1 so the peak under its window measures mostly the (ducked) music,
  // not the voice itself.
  const webm = await recordWebm(page, 4200)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
    { name: 'voice.wav', mimeType: 'audio/wav', buffer: sineWav(1) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(3)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add music.wav to timeline' }).click()
  await page.getByRole('button', { name: 'Add voice.wav to timeline' }).click()

  const voice = 'audio track voice.wav at position 2'
  await setField(page, `Start time of ${voice} in seconds`, '1.5')
  await setField(page, `Volume of ${voice} (0 to 1)`, '0.1')

  // Baseline, ducking off: the music is as loud under the voice window
  // ([1.7, 2.3], clear of the 0.25 s edge ramps at [1.25, 1.5] and
  // [2.5, 2.75]) as outside it ([0.3, 1.1]).
  const offExport = await exportOnce(page)
  const offFull = await measureAudio(page, offExport)
  expect(offFull.channels).toBeGreaterThan(0)
  expect(offFull.duration).toBeGreaterThan(3)
  const offInside = await measureAudio(page, offExport, { fromSeconds: 1.7, toSeconds: 2.3 })
  const offOutside = await measureAudio(page, offExport, { fromSeconds: 0.3, toSeconds: 1.1 })
  expect(offOutside.peak).toBeGreaterThan(AUDIBLE_PEAK)
  // Unchanged with the toggle off: the window is no quieter than outside.
  expect(offInside.peak).toBeGreaterThan(offOutside.peak * 0.8)

  // Duck the voice at level 0.2 and export again: the same window is now
  // measurably quieter than the music outside it. (Expected ≈ music × 0.2
  // + voice × 0.1 versus full music — far below the 0.6 ratio asserted.)
  await page
    .getByRole('checkbox', { name: `Duck other audio while ${voice} plays` })
    .check()
  await setField(page, `Duck level of ${voice} (0 to 1)`, '0.2')

  const onExport = await exportOnce(page)
  const onInside = await measureAudio(page, onExport, { fromSeconds: 1.7, toSeconds: 2.3 })
  const onOutside = await measureAudio(page, onExport, { fromSeconds: 0.3, toSeconds: 1.1 })
  expect(onOutside.peak).toBeGreaterThan(AUDIBLE_PEAK)
  expect(onInside.peak).toBeLessThan(onOutside.peak * 0.6)
})
