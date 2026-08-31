import { expect, test } from '@playwright/test'

/**
 * The timeline flow does not need real video decoding — entries are built
 * from already-imported library clips — but importing through the real UI
 * keeps this an end-to-end path. A tiny invalid buffer would fail the probe,
 * so a real WebM is recorded in-browser exactly as in import.spec.ts.
 */
test('clips can be added to the timeline, reordered, and removed', async ({ page }) => {
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
  const webm = Buffer.from(webmBase64, 'base64')

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(2)

  // Add both clips; the sequence lists them in the order they were added.
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await expect(sequence.getByRole('listitem').first()).toContainText('first.webm')

  // Total shows the sum of both ~1.2s clips (each rounds to 0:01 or 0:02).
  await expect(page.getByTestId('timeline-total')).toHaveText(/0:0[234]/)

  // Reorder: move the second entry up.
  await page.getByRole('button', { name: 'Move second.webm at position 2 up' }).click()
  await expect(sequence.getByRole('listitem').first()).toContainText('second.webm')

  // Remove one entry, via its confirmation dialog (#178); the library is
  // unaffected. Cancelling first proves a mis-click costs nothing.
  const removeSecond = page.getByRole('button', {
    name: 'Remove second.webm at position 1 from timeline',
  })
  await removeSecond.click()
  const removalDialog = page.getByRole('dialog')
  await expect(removalDialog).toContainText('Remove second.webm at position 1?')
  await removalDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  await removeSecond.click()
  await removalDialog.getByRole('button', { name: 'Remove' }).click()
  await expect(sequence.getByRole('listitem')).toHaveCount(1)
  await expect(sequence.getByRole('listitem')).toContainText('first.webm')
  await expect(library.getByRole('listitem')).toHaveCount(2)

  // Trim the remaining ~1.2s entry down to 0.4s; commit happens on blur.
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of first.webm at position 1 in seconds',
  })
  await outField.fill('0.4')
  await outField.blur()
  await expect(sequence.getByRole('listitem')).toContainText('plays 0.4s of')
  // 0.4s rounds down to zero whole seconds — distinguishable from the untrimmed total.
  await expect(page.getByTestId('timeline-total')).toHaveText('0:00')

  // An impossible range (in ≥ out) is rejected and the field snaps back.
  const inField = page.getByRole('spinbutton', {
    name: 'Trim in point of first.webm at position 1 in seconds',
  })
  await inField.fill('2')
  await inField.blur()
  await expect(inField).toHaveValue('0')
  await expect(sequence.getByRole('listitem')).toContainText('plays 0.4s of')
})
