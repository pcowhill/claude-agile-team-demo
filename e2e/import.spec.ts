import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Records a short real WebM video in the browser (canvas + MediaRecorder)
 * and returns it base64-encoded. Using a genuinely decodable file means the
 * import flow — including duration probing — runs for real, with no binary
 * fixture committed to the repository. MediaRecorder output also reports
 * `Infinity` duration on first load, so this exercises the probe's
 * far-seek workaround.
 */
async function recordWebmBase64(page: Page): Promise<string> {
  return page.evaluate(async () => {
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
        const elapsed = performance.now() - start
        ctx.fillStyle = `hsl(${elapsed % 360}, 80%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (elapsed > 1200) {
          resolve()
        } else {
          requestAnimationFrame(draw)
        }
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
}

/**
 * Builds a real, decodable 2-second WAV (mono, 8 kHz, 16-bit sine) directly
 * in Node — WAV is a fixed header plus raw PCM, so no recorder is needed and
 * no binary fixture is committed. Chromium decodes it natively, so the audio
 * import flow (#101), including the <audio>-element duration probe, runs for
 * real.
 */
function sineWav(seconds = 2, sampleRate = 8000): Buffer {
  const sampleCount = seconds * sampleRate
  const dataLength = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  for (let index = 0; index < sampleCount; index++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0x4000)
    buffer.writeInt16LE(sample, 44 + index * 2)
  }
  return buffer
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('importing a video via the file picker lists it with name and duration', async ({
  page,
}) => {
  const webm = Buffer.from(await recordWebmBase64(page), 'base64')

  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'picked.webm',
    mimeType: 'video/webm',
    buffer: webm,
  })

  const list = page.getByRole('list', { name: 'Imported clips' })
  const item = list.getByRole('listitem')
  await expect(item).toContainText('picked.webm')
  // ~1.2s recording; allow rounding either way.
  await expect(item).toContainText(/0:0[12]/)
})

test('dropping a video file onto the app imports it', async ({ page }) => {
  const webmBase64 = await recordWebmBase64(page)

  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([bytes], 'dropped.webm', { type: 'video/webm' }))
    document.querySelector('.app')!.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    )
  }, webmBase64)

  const list = page.getByRole('list', { name: 'Imported clips' })
  await expect(list.getByRole('listitem')).toContainText('dropped.webm')
})

test('importing an audio file lists it with duration, marked audio, without an Add button', async ({
  page,
}) => {
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: sineWav(),
  })

  const list = page.getByRole('list', { name: 'Imported clips' })
  const item = list.getByRole('listitem')
  await expect(item).toContainText('tone.wav')
  await expect(item).toContainText('0:02')
  await expect(item).toContainText('Audio')
  // The audio clip cannot join the (video) sequence until #102.
  await expect(page.getByRole('button', { name: 'Add tone.wav to timeline' })).toHaveCount(0)
  // But it can be removed like any clip.
  await expect(
    page.getByRole('button', { name: 'Remove tone.wav from library' }),
  ).toBeVisible()
})

test('a file the browser cannot decode produces a visible error and no clip', async ({
  page,
}) => {
  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'not-a-video.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('this is plainly not video data'),
  })

  await expect(page.getByRole('alert')).toContainText('not-a-video.mp4')
  await expect(page.getByRole('list', { name: 'Imported clips' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
