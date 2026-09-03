import { expect, test } from '@playwright/test'

/**
 * Collapsible timeline elements (#299): a collapsed row keeps its coverage
 * bar and main line and drops its controls; Collapse all / Expand all act
 * on every lane; the timeline really gets shorter.
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
        ctx.fillStyle = '#3a6'
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

test('collapsing rows hides their controls, keeps the bars, and shortens the timeline (#299)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add text overlay to timeline' }).click()

  const timeline = page.getByRole('region', { name: 'Timeline' })
  await expect(page.getByRole('heading', { name: 'Sequence' })).toBeVisible()
  const trimIn = page.getByRole('spinbutton', {
    name: 'Trim in point of clip.webm at position 1 in seconds',
  })
  const textStart = page.getByRole('spinbutton', {
    name: 'Start time of text overlay at position 1 in seconds',
  })
  await expect(trimIn).toBeVisible()
  await expect(textStart).toBeVisible()
  const expandedHeight = (await timeline.boundingBox())!.height

  // Collapse one clip: its controls go, its bar and name stay.
  const clipToggle = page.getByRole('button', { name: 'Collapse clip.webm at position 1' })
  await clipToggle.click()
  await expect(trimIn).toHaveCount(0)
  await expect(page.getByTestId('timeline-entry-bar-0')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Sequence' })).toContainText('clip.webm')
  await expect(
    page.getByRole('button', { name: 'Expand clip.webm at position 1' }),
  ).toHaveAttribute('aria-expanded', 'false')
  // The text overlay is untouched.
  await expect(textStart).toBeVisible()

  // Collapse all: no trim/offset controls anywhere; the panel is shorter.
  await page.getByRole('button', { name: 'Collapse all timeline elements' }).click()
  await expect(textStart).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: /Trim in point|Start time/ })).toHaveCount(0)
  const collapsedHeight = (await timeline.boundingBox())!.height
  expect(collapsedHeight).toBeLessThan(expandedHeight)

  // Expand all restores today's full view.
  await page.getByRole('button', { name: 'Expand all timeline elements' }).click()
  await expect(trimIn).toBeVisible()
  await expect(textStart).toBeVisible()
  const restoredHeight = (await timeline.boundingBox())!.height
  expect(restoredHeight).toBeGreaterThan(collapsedHeight)
})
