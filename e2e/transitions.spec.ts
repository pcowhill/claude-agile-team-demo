import { expect, test } from '@playwright/test'

/**
 * Adding and removing a transition between two timeline entries, and the
 * overlap shrinking the displayed total (#41). As in timeline.spec.ts a real
 * WebM is recorded in-browser so the import probe succeeds; both entries are
 * then trimmed to exactly 1s so the totals are deterministic.
 */
test('a transition can be added between clips and removed, shrinking the total', async ({
  page,
}) => {
  await page.goto('./')

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
        ctx.fillStyle = '#63a'
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
  const webm = Buffer.from(webmBase64, 'base64')

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()

  // Trim both ~1.2s entries to exactly 1s for a deterministic total of 0:02.
  for (const position of [1, 2]) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${position === 1 ? 'first' : 'second'}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')

  // There is exactly one boundary; adding a transition there overlaps the
  // clips by the default 1s (clamped to the 1s neighbors), so the total
  // shrinks to 0:01.
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await expect(
    page.getByRole('combobox', { name: 'Transition type between position 1 and 2' }),
  ).toHaveValue('crossfade')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Transition duration between position 1 and 2 in seconds',
    }),
  ).toHaveValue('1')
  await expect(page.getByTestId('timeline-total')).toHaveText('0:01')

  // Removing it restores the hard cut and the full total.
  await page.getByRole('button', { name: 'Remove transition between position 1 and 2' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:02')
  await expect(
    page.getByRole('button', { name: 'Add transition between position 1 and 2' }),
  ).toBeVisible()
})
