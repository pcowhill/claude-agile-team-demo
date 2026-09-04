import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Copy settings / Paste settings (#315), in real Chromium: a distinctive
 * grade and crop set on one clip, copied, and pasted onto a second clip
 * with Color checked and Crop unchecked — the target takes the color but
 * not the crop, the source is untouched, and one Undo reverts the paste.
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

test('pasting with Color checked and Crop unchecked applies only the color (#315)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordWebm(page, 1200)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // A distinctive grade and crop on the first clip.
  const saturation = page.getByRole('spinbutton', {
    name: 'Saturation of clip.webm at position 1 (percent)',
  })
  await saturation.fill('0')
  await saturation.blur()
  const cropTop = page.getByRole('spinbutton', {
    name: 'Crop top of clip.webm at position 1 (percent)',
  })
  await cropTop.fill('20')
  await cropTop.blur()

  await page.getByRole('button', { name: 'Copy settings of clip.webm at position 1' }).click()
  await page.getByRole('button', { name: 'Paste settings onto clip.webm at position 2' }).click()

  // The checklist opens with every compatible group checked; uncheck Crop.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: 'Color' })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Crop' }).uncheck()
  await dialog.getByRole('button', { name: 'Apply' }).click()

  // The target took the color but not the crop; the source is untouched.
  await expect(
    page.getByRole('spinbutton', { name: 'Saturation of clip.webm at position 2 (percent)' }),
  ).toHaveValue('0')
  await expect(
    page.getByRole('spinbutton', { name: 'Crop top of clip.webm at position 2 (percent)' }),
  ).toHaveValue('0')
  await expect(
    page.getByRole('spinbutton', { name: 'Crop top of clip.webm at position 1 (percent)' }),
  ).toHaveValue('20')

  // One Undo reverts the whole paste.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(
    page.getByRole('spinbutton', { name: 'Saturation of clip.webm at position 2 (percent)' }),
  ).toHaveValue('100')
})
