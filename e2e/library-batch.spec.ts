import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Media library multi-select (#292): Select all / Shift+click ranges, and
 * the selection bar's Add to timeline placing every selected clip in library
 * order as one undoable step.
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

test('select all, add to timeline in library order, undo the whole batch at once (#292)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  const input = page.getByTestId('clip-file-input')
  const rows = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')

  await input.setInputFiles([{ name: 'zebra.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(rows).toHaveCount(1)
  await input.setInputFiles([{ name: 'mango.wav', mimeType: 'audio/wav', buffer: sineWav(2) }])
  await expect(rows).toHaveCount(2)
  await input.setInputFiles([{ name: 'apple.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(rows).toHaveCount(3)

  const bar = page.getByRole('toolbar', { name: 'Selected clips' })
  await expect(bar).toHaveCount(0)

  // Shift+click ranges over the display order: zebra … apple is all three.
  await page.getByRole('checkbox', { name: 'Select zebra.webm' }).click()
  await expect(bar).toContainText('1 selected')
  await page.getByRole('checkbox', { name: 'Select apple.webm' }).click({ modifiers: ['Shift'] })
  await expect(bar).toContainText('3 selected')
  await expect(page.getByRole('checkbox', { name: 'Select all' })).toBeChecked()

  // Clear, then Select all — the header box selects everything at once.
  await bar.getByRole('button', { name: 'Clear' }).click()
  await expect(bar).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await expect(bar).toContainText('3 selected')

  await bar.getByRole('button', { name: 'Add to timeline' }).click()

  // Videos join the sequence in library order; the audio clip its lane.
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of zebra.webm at position 1 in seconds' }),
  ).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of apple.webm at position 2 in seconds' }),
  ).toBeVisible()
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toContainText('mango.wav')
  // The selection is spent.
  await expect(bar).toHaveCount(0)

  // One undo removes the whole batch.
  await page.keyboard.press('Control+z')
  await expect(page.getByRole('list', { name: 'Sequence' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toHaveCount(0)
  // …and one redo brings it all back.
  await page.keyboard.press('Control+Shift+z')
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of apple.webm at position 2 in seconds' }),
  ).toBeVisible()
  await expect(page.getByRole('list', { name: 'Audio tracks' })).toContainText('mango.wav')
})
