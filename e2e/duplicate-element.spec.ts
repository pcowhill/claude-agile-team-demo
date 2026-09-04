import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Duplicate a timeline element (#314), in real Chromium: the row's ⧉ control
 * makes an exact copy — a sequence entry's right after the original, an
 * overlay's on the lane starting where the original ends — and one Undo
 * removes it again.
 */

/** Records a short solid-color WebM so rows have a decodable source. */
async function recordWebm(page: Page, ms: number): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async (ms) => {
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
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > ms) resolve()
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
  }, ms)
  return Buffer.from(webmBase64, 'base64')
}

test('duplicating an entry and an overlay copies the rows; Undo removes them (#314)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordWebm(page, 1200)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  const sequenceRows = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')
  await expect(sequenceRows).toHaveCount(2)

  // Trim the entry so the copy visibly carries a setting, then duplicate:
  // the copy lands at position 2, between the original and the slate, with
  // the original's trim.
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await outField.fill('0.8')
  await outField.blur()
  await page.getByRole('button', { name: 'Duplicate clip.webm at position 1' }).click()
  await expect(sequenceRows).toHaveCount(3)
  await expect(
    page.getByRole('spinbutton', { name: 'Trim out point of clip.webm at position 2 in seconds' }),
  ).toHaveValue('0.8')
  await expect(
    page.getByRole('button', { name: 'Duplicate Color slate at position 3' }),
  ).toBeVisible()

  // An overlay's copy starts where the original's trimmed window ends.
  await page.getByRole('button', { name: 'Add clip.webm as overlay' }).click()
  const overlayOut = page.getByRole('spinbutton', {
    name: 'Trim out point of overlay clip.webm at position 1 in seconds',
  })
  await overlayOut.fill('1')
  await overlayOut.blur()
  await page.getByRole('button', { name: 'Duplicate overlay clip.webm at position 1' }).click()
  await expect(
    page.getByRole('spinbutton', {
      name: 'Start time of overlay clip.webm at position 2 in seconds',
    }),
  ).toHaveValue('1')

  // Undo walks the edits back off: the overlay duplicate is one step, and
  // three more (overlay trim, overlay add, entry duplicate) restore the
  // original two-row sequence.
  const undo = page.getByRole('button', { name: 'Undo last timeline edit' })
  await undo.click()
  await expect(
    page.getByRole('list', { name: 'Overlay layers' }).getByRole('listitem'),
  ).toHaveCount(1)
  await undo.click()
  await undo.click()
  await undo.click()
  await expect(sequenceRows).toHaveCount(2)
})
