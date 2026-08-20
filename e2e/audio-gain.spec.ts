import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Volume, mute, and fades (#104): element-level volume is the executable
 * proxy for audibility named in the issue — the app drives playback through
 * media elements, so their `volume` property is what the mix actually uses.
 * Scrubbed (paused) positions give exact, deterministic envelope values;
 * playing asserts the same gains apply live.
 */

/** Records a real WebM in-browser, as in preview.spec.ts. */
async function recordWebm(page: Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
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
        if (performance.now() - start > 1500) resolve()
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
  })
  return Buffer.from(webmBase64, 'base64')
}

const setField = async (page: Page, name: string, value: string) => {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
})

test('a track volume and fades drive its element volume, scrubbed and playing', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const position = 'audio track tone.wav at position 1'
  await setField(page, `Volume of ${position} (0 to 1)`, '0.5')
  await setField(page, `Fade-in of ${position} in seconds`, '1')

  const track = page.getByTestId('preview-audio-0')
  const volumeAt = () => track.evaluate((el: HTMLAudioElement) => el.volume)

  // Scrubbing evaluates the envelope deterministically: half through the 1s
  // fade-in the gain is volume × 0.5; past the fade it is the full volume.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  await seek.fill('0.5')
  expect(await volumeAt()).toBeCloseTo(0.25, 5)
  await seek.fill('1.2')
  expect(await volumeAt()).toBeCloseTo(0.5, 5)

  // The same gain applies live: playing from a mid-fade position, the
  // element's volume stays within the envelope and never exceeds the
  // track's volume.
  await seek.fill('0.5')
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(() => track.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  const live = await volumeAt()
  expect(live).toBeGreaterThan(0)
  expect(live).toBeLessThanOrEqual(0.5)
})

test('muting the video entry silences its element while a track still plays', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await page.getByRole('checkbox', { name: 'Mute clip.webm at position 1' }).check()

  const video = page.getByTestId('preview-video')
  const track = page.getByTestId('preview-audio-0')

  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(() => track.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  expect(await video.evaluate((el: HTMLVideoElement) => el.volume)).toBe(0)
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false)
  expect(await track.evaluate((el: HTMLAudioElement) => el.volume)).toBe(1)
})
