import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Audio tracks on the timeline (#102): a real WAV imports, is placed on the
 * audio lane (twice — overlap is legal), and its start time and trim are
 * edited from the lane's numeric controls. Nothing is audible yet (#103).
 */

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: sineWav(4),
  })
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toContainText('tone.wav')
})

test('placing an audio clip creates a track on the audio lane', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add tone.wav to timeline' })
  await add.click()
  await add.click()

  // Two tracks from the same clip, fully overlapping — both on the lane.
  const lane = page.getByRole('list', { name: 'Audio tracks' })
  await expect(lane.getByRole('listitem')).toHaveCount(2)
  // The video sequence stays empty: audio never becomes a sequence entry.
  await expect(page.getByRole('list', { name: 'Sequence' })).toHaveCount(0)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:00')
})

test('start time and trim are edited from the lane', async ({ page }) => {
  // A 5s slate gives the video sequence a duration: the lane scale is the
  // sequence span (#180), and with no entries every bar renders empty.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()

  const startField = page.getByRole('spinbutton', {
    name: 'Start time of audio track tone.wav at position 1 in seconds',
  })
  await startField.fill('2')
  await startField.blur()
  await expect(startField).toHaveValue('2')

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

  await expect(inField).toHaveValue('1')
  await expect(outField).toHaveValue('3')
  await expect(page.getByText('plays 2s of 4s')).toBeVisible()
  // The bar reflects offset 2s + length 2s on the 5s sequence span (#180).
  const bar = page.getByTestId('audio-track-bar-0')
  await expect(bar).toHaveCSS('left', /.+/)
  await expect(bar).toHaveAttribute('style', /left: 40%; width: 40%/)
})

test('a track can be removed; removing the library clip removes its tracks', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add tone.wav to timeline' })
  await add.click()
  await add.click()

  await page
    .getByRole('button', { name: 'Remove audio track tone.wav at position 1 from timeline' })
    .click()
  // Track removal confirms first (#178).
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  const lane = page.getByRole('list', { name: 'Audio tracks' })
  await expect(lane.getByRole('listitem')).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove tone.wav from library' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('the 1 timeline entry')
  await dialog.getByRole('button', { name: 'Remove' }).click()

  await expect(page.getByRole('list', { name: 'Audio tracks' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Imported clips' })).toHaveCount(0)
})

test("an added track draws its clip's waveform inside the coverage bar (#191)", async ({
  page,
}) => {
  // The slate gives the lane a sequence span, so the bar has real width.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()

  // The real chain: blob fetch → Web Audio decode of the WAV → peaks → SVG.
  const waveform = page.getByTestId('audio-track-waveform-0')
  await expect(waveform).toBeVisible()
  const path = await waveform.locator('path').getAttribute('d')
  // A 440Hz sine has real amplitude everywhere: the band must be a long
  // mirrored outline, not the empty midline of a silent or failed decode.
  expect(path).toBeTruthy()
  expect(path!.length).toBeGreaterThan(500)

  // A second track of the same clip shows a waveform too (shared peaks).
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await expect(page.getByTestId('audio-track-waveform-1')).toBeVisible()
})

/**
 * Records a real WebM carrying a 440 Hz audio track (the
 * export-audio-mix.spec idiom), so the entry-waveform decode path (#230) has
 * genuine audio to reduce to peaks.
 */
async function recordWebmWithTone(page: import('@playwright/test').Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)
    const audio = new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
    const destination = audio.createMediaStreamDestination()
    const oscillator = audio.createOscillator()
    oscillator.frequency.value = 440
    oscillator.connect(destination)
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
        ctx.fillStyle = 'rgb(0, 128, 0)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1200) resolve()
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

test('video entries and overlays draw their audio amplitude in the coverage bars (#230)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const webm = await recordWebmWithTone(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm as overlay' }).click()

  // The video entry's bar carries a real waveform path decoded from the
  // clip's own audio track; a tone is loud, so the path spans amplitude.
  const entryWaveform = page.getByTestId('timeline-entry-waveform-0')
  await expect(entryWaveform).toBeVisible()
  const path = await entryWaveform.locator('path').getAttribute('d')
  expect(path).toMatch(/^M0 1L/)
  expect(path?.length).toBeGreaterThan(100)

  // The soundless slate keeps its plain bar.
  await expect(page.getByTestId('timeline-entry-bar-1')).toBeVisible()
  await expect(page.getByTestId('timeline-entry-waveform-1')).toHaveCount(0)

  // The overlay's bar draws the same clip's waveform (shared peaks cache).
  await expect(page.getByTestId('video-overlay-waveform-0')).toBeVisible()
})
