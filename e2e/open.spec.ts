import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Opening a saved project (#77): the full round trip — build a sequence with
 * trims, a transition, and a zoom; save it; wipe the editor with New Project
 * (through the unsaved-changes guard); open the saved file; re-link the same
 * media; and confirm the timeline is back and the sequence plays and exports.
 */

/** Records a ~1.6s WebM in-browser so the import probe accepts it. */
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
        if (performance.now() - start > 1600) resolve()
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

test('a saved project reopens with its trims, transition and zoom, then plays and exports', async ({
  page,
}) => {
  // Download-path saving keeps the file capturable by Playwright.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()
  for (const [clip, position] of [
    ['first', 1],
    ['second', 2],
  ] as const) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${clip}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page.getByRole('button', { name: 'Add zoom to first.webm at position 1' }).click()
  const totalBefore = await page.getByTestId('timeline-total').textContent()

  // Save references-only (#98) — this spec exercises the re-link open path —
  // then dirty the project again so New Project must ask.
  await page.getByRole('button', { name: 'Save As…' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const projectBytes = await readFile((await (await downloadPromise).path())!)
  const retrim = page.getByRole('spinbutton', {
    name: 'Trim out point of second.webm at position 2 in seconds',
  })
  await retrim.fill('0.9')
  await retrim.blur()

  // New Project: guard appears (dirty), confirming wipes the editor.
  await page.getByRole('button', { name: 'New Project' }).click()
  const guard = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'Discard and start new' }).click()
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  // Open the saved file; the re-link dialog lists both clips as missing.
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'trip.bvep', mimeType: 'application/gzip', buffer: projectBytes }])
  const dialog = page.getByRole('dialog', { name: 'Open trip.bvep' })
  await expect(dialog).toBeVisible()
  const media = dialog.getByRole('list', { name: 'Project media' })
  await expect(media.getByRole('listitem')).toHaveCount(2)
  await expect(media.getByRole('listitem').filter({ hasText: 'first.webm' })).toContainText(
    'Missing',
  )

  // Re-link with the same recordings; the open button unlocks.
  const openButton = dialog.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeDisabled()
  await page.getByTestId('relink-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(media.getByRole('listitem').filter({ hasText: 'first.webm' })).toContainText(
    'Linked',
  )
  await expect(media.getByRole('listitem').filter({ hasText: 'second.webm' })).toContainText(
    'Linked',
  )
  await expect(openButton).toBeEnabled()
  await openButton.click()

  // The sequence is back: same entries, trims, transition, zoom, and total.
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence.getByRole('listitem')).toHaveCount(2)
  for (const [clip, position] of [
    ['first', 1],
    ['second', 2],
  ] as const) {
    await expect(
      page.getByRole('spinbutton', {
        name: `Trim out point of ${clip}.webm at position ${position} in seconds`,
      }),
    ).toHaveValue('1')
  }
  await expect(
    page.getByRole('button', { name: 'Remove transition between position 1 and 2' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Remove zoom 1 from first.webm at position 1' }),
  ).toBeVisible()
  await expect(page.getByTestId('timeline-total')).toHaveText(totalBefore!)
  // The reopened project is clean until the next edit.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  // It plays: the position readout advances from 0.
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  const position = page.getByTestId('preview-position')
  await expect(position).not.toContainText('0:00 /', { timeout: 10_000 })

  // And it exports: a real, decodable WebM of roughly the sequence length
  // (two 1 s entries overlapped by a 1 s crossfade → ~1 s).
  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile((await (await exportPromise).path())!)
  expect(exported.byteLength).toBeGreaterThan(1000)
  const probed = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    return await new Promise<number>((resolve, reject) => {
      const settleIfKnown = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          URL.revokeObjectURL(url)
          resolve(video.duration)
          return true
        }
        return false
      }
      video.onloadedmetadata = () => {
        if (settleIfKnown()) return
        video.ondurationchange = () => settleIfKnown()
        video.currentTime = Number.MAX_SAFE_INTEGER
      }
      video.onerror = () => reject(new Error('exported file failed to decode'))
      video.preload = 'metadata'
      video.muted = true
      video.src = url
    })
  }, exported.toString('base64'))
  // Real-time re-recording adds clip-switch overhead; a file that lost the
  // trims or the transition overlap would be ~2 s and fail the upper bound.
  expect(probed).toBeGreaterThan(0.5)
  expect(probed).toBeLessThan(1.8)
})

test('cancelling the guard and the re-link dialog leaves the project untouched', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'first.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()

  // Cancel the New Project guard: everything stays, still dirty.
  await page.getByRole('button', { name: 'New Project' }).click()
  await page
    .getByRole('dialog', { name: 'Discard unsaved changes?' })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // Save references-only (clears dirty), then open a saved file but cancel
  // the re-link dialog: the current project stays.
  await page.getByRole('button', { name: 'Save As…' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const projectBytes = await readFile((await (await downloadPromise).path())!)
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'again.bvep', mimeType: 'application/gzip', buffer: projectBytes }])
  const dialog = page.getByRole('dialog', { name: 'Open again.bvep' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)
})
