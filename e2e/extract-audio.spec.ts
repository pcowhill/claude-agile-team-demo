import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Extracting a video clip's audio into a standalone library clip (#154):
 * the button appears on video clips, the extracted clip lists as ordinary
 * audio, it survives removing the source video, and — the whole point — its
 * sound genuinely plays: an export with the extracted clip on the audio
 * lane (over a silent slate) carries the tone that only the extracted
 * clip's bytes contain.
 */

/** Records a real WebM carrying a steady 440 Hz tone (as export.spec.ts does). */
async function recordToneWebm(page: import('@playwright/test').Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)

    const audio = new AudioContext()
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

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' })
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
    await audio.close()
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

/** Decodes a WebM's audio and reports the loudest sample (export.spec.ts). */
async function measurePeak(page: import('@playwright/test').Page, webm: Buffer): Promise<number> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(bytes.buffer)
      const samples = buffer.getChannelData(0)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      return peak
    } finally {
      await context.close()
    }
  }, webm.toString('base64'))
}

const AUDIBLE_PEAK = 0.05

test('extracted audio lists as audio, survives removing the video, and exports audibly', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('./')
  // A click gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()

  const webm = await recordToneWebm(page)
  // Guard against a vacuous pass: the fixture itself must be audible.
  expect(await measurePeak(page, webm)).toBeGreaterThan(AUDIBLE_PEAK)

  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'tone.webm', mimeType: 'video/webm', buffer: webm }])
  const list = page.getByRole('list', { name: 'Imported clips' })
  await expect(list.getByRole('listitem')).toHaveCount(1)

  // Extract: a second clip appears, badged Audio, same duration column.
  await page.getByRole('button', { name: 'Extract audio from tone.webm' }).click()
  const items = list.getByRole('listitem')
  await expect(items).toHaveCount(2)
  const extracted = items.filter({ hasText: 'tone.webm (audio)' })
  await expect(extracted).toHaveCount(1)
  await expect(extracted.locator('.clip-kind')).toHaveText('Audio')
  // Audio clips offer no extraction of their own.
  await expect(
    page.getByRole('button', { name: 'Extract audio from tone.webm (audio)' }),
  ).toHaveCount(0)

  // Remove the source video: the extracted clip stays.
  await page.getByRole('button', { name: 'Remove tone.webm from library' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list.getByRole('listitem')).toContainText('tone.webm (audio)')

  // Put the extracted audio on the timeline over a short silent slate…
  await page.getByRole('button', { name: 'Add tone.webm (audio) to timeline' }).click()
  await expect(
    page.getByRole('list', { name: 'Audio tracks' }).getByRole('listitem'),
  ).toContainText('tone.webm (audio)')
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration.fill('2')
  await duration.blur()

  // …and export: the only possible source of sound is the extracted clip,
  // whose video was already removed. An audible tone in the file proves the
  // extraction produced genuinely independent, playable audio.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile(await download.path())
  expect(exported.byteLength).toBeGreaterThan(1000)
  expect(await measurePeak(page, exported)).toBeGreaterThan(AUDIBLE_PEAK)
})
