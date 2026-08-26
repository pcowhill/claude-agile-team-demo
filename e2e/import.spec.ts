import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

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
  // Video clips carry a kind badge like audio clips do (#120).
  await expect(item).toContainText('Video')
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

test('importing an audio file lists it with duration, marked audio', async ({ page }) => {
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
  // Add places it on the audio lane (#102) — exercised in timeline-audio.spec.
  await expect(page.getByRole('button', { name: 'Add tone.wav to timeline' })).toBeVisible()
  // And it can be removed like any clip.
  await expect(
    page.getByRole('button', { name: 'Remove tone.wav from library' }),
  ).toBeVisible()
})

test('importing an image lists it with an Image badge and no duration (#137)', async ({
  page,
}) => {
  // A real PNG generated in the browser, so the <img> probe decodes it for
  // real — same no-committed-binary-fixture approach as the WebM above.
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c00'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })

  await page.getByTestId('clip-file-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBase64, 'base64'),
  })

  const list = page.getByRole('list', { name: 'Imported clips' })
  const item = list.getByRole('listitem')
  await expect(item).toContainText('logo.png')
  await expect(item).toContainText('Image')
  // A still has no duration: the length column shows a dash.
  await expect(item).toContainText('—')
  // No Add button until images can join the timeline (#140); Remove works.
  await expect(page.getByRole('button', { name: 'Add logo.png to timeline' })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Remove logo.png from library' }),
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
