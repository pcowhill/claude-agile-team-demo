import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Records a real WebM in-browser (as in import.spec.ts / preview.spec.ts)
 * so removal runs against genuinely imported, playable clips.
 */
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

test('removing a clip asks for confirmation, cascades to its timeline entries, and the rest still plays (#40)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'doomed.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'survivor.webm', mimeType: 'video/webm', buffer: webm },
  ])
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(2)

  // doomed.webm twice + survivor.webm once, so removal must cascade to
  // exactly two of the three entries.
  await page.getByRole('button', { name: 'Add doomed.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add doomed.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add survivor.webm to timeline' }).click()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(3)

  // Cancel path: Escape leaves everything untouched.
  await page.getByRole('button', { name: 'Remove doomed.webm from library' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove doomed.webm?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('all 2 timeline entries')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(library.getByRole('listitem')).toHaveCount(2)
  await expect(sequence.getByRole('listitem')).toHaveCount(3)

  // Cancel path: the Cancel button, likewise.
  await page.getByRole('button', { name: 'Remove doomed.webm from library' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(library.getByRole('listitem')).toHaveCount(2)

  // Confirm while the preview is playing the doomed clip: removal cascades
  // and playback fails gracefully (the player pauses; no crash, no stuck UI).
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByTestId('preview-now-playing')).toContainText('doomed.webm')
  await page.getByRole('button', { name: 'Remove doomed.webm from library' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()

  await expect(library.getByRole('listitem')).toHaveCount(1)
  await expect(library.getByRole('listitem')).toContainText('survivor.webm')
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(sequence.getByRole('listitem')).toContainText('survivor.webm')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible()

  // The remaining ~1.2s sequence still plays through to the end.
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByTestId('preview-now-playing')).toContainText('Clip 1 of 1: survivor.webm')
  await expect(page.getByRole('button', { name: 'Play preview' })).toBeVisible({ timeout: 10_000 })
  const positionText = await page.getByTestId('preview-position').textContent()
  const [current, total] = positionText!.split(' / ')
  expect(current).toBe(total)
})
