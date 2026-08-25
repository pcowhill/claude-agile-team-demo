import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Media library sorting (#123): sort controls reorder the real clip list,
 * a repeated key reverses, and a previous sort carries over as tie order —
 * sort by name, then by type, and each kind group stays alphabetical
 * (the customer's own example in #121).
 */

/** Records a short real WebM in-browser as decodable video source material. */
async function recordWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
        if (performance.now() - start > 1200) resolve()
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

test('sorting by name then type carries the name order into each kind group (#123)', async ({
  page,
}) => {
  await page.goto('./')

  // Deliberately shuffled import order, mixing kinds, names, and durations.
  const webm = await recordWebm(page)
  const input = page.getByTestId('clip-file-input')
  const list = page.getByRole('list', { name: 'Imported clips' })
  const rows = list.getByRole('listitem')

  await input.setInputFiles([{ name: 'zebra.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(rows).toHaveCount(1)
  await input.setInputFiles([{ name: 'mango.wav', mimeType: 'audio/wav', buffer: sineWav(4) }])
  await expect(rows).toHaveCount(2)
  await input.setInputFiles([{ name: 'apple.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(rows).toHaveCount(3)
  await input.setInputFiles([{ name: 'banana.wav', mimeType: 'audio/wav', buffer: sineWav(2) }])
  await expect(rows).toHaveCount(4)

  const names = () => rows.locator('.clip-name').allTextContents()
  expect(await names()).toEqual(['zebra.webm', 'mango.wav', 'apple.webm', 'banana.wav'])

  // Alphabetical.
  await page.getByRole('button', { name: 'Sort by name' }).click()
  await expect
    .poll(names)
    .toEqual(['apple.webm', 'banana.wav', 'mango.wav', 'zebra.webm'])

  // The same key again reverses that sort.
  await page.getByRole('button', { name: 'Sort by name' }).click()
  await expect
    .poll(names)
    .toEqual(['zebra.webm', 'mango.wav', 'banana.wav', 'apple.webm'])
  await page.getByRole('button', { name: 'Sort by name' }).click()
  await expect
    .poll(names)
    .toEqual(['apple.webm', 'banana.wav', 'mango.wav', 'zebra.webm'])

  // By type: videos grouped first, audios after — and inside each group the
  // alphabetical order from the previous sort survives as tie order.
  await page.getByRole('button', { name: 'Sort by type' }).click()
  await expect
    .poll(names)
    .toEqual(['apple.webm', 'zebra.webm', 'banana.wav', 'mango.wav'])

  // Reversing the type sort flips the groups, not the order inside them.
  await page.getByRole('button', { name: 'Sort by type' }).click()
  await expect
    .poll(names)
    .toEqual(['banana.wav', 'mango.wav', 'apple.webm', 'zebra.webm'])
})
