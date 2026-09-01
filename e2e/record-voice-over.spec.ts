import { chromium, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'

/**
 * Voice-over recording (#224), against Chromium's fake media device: the
 * flags below make `getUserMedia` deliver a generated tone with permission
 * auto-granted, so the capture pipeline (getUserMedia → MediaRecorder →
 * import path) runs for real — the proxy evidence for the
 * customer-verifiable real-microphone criterion. The executable resolution
 * mirrors playwright.config.ts, which per-file launch options would
 * otherwise drop.
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

/** Records a short real WebM in-page (the preview.spec idiom), so the
 * voice-over has footage to narrate over and the preview can play. */
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
        ctx.fillStyle = 'rgb(0, 128, 0)'
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

/** Polls until the debounced autosave snapshot holds `blobs` media blobs
 * (the autosave.spec idiom, #194). */
async function waitForSnapshot(page: Page, blobs: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async (expectedBlobs) => {
          const openDb = () =>
            new Promise<IDBDatabase | null>((resolve) => {
              const request = indexedDB.open('bvep-autosave')
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => resolve(null)
            })
          const db = await openDb()
          if (db === null) return false
          try {
            if (
              !db.objectStoreNames.contains('structure') ||
              !db.objectStoreNames.contains('media')
            ) {
              return false
            }
            const tx = db.transaction(['structure', 'media'], 'readonly')
            const count = (store: string) =>
              new Promise<number>((resolve) => {
                const request = tx.objectStore(store).count()
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => resolve(0)
              })
            const [structures, media] = await Promise.all([count('structure'), count('media')])
            return structures > 0 && media === expectedBlobs
          } finally {
            db.close()
          }
        }, blobs),
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Runs one capture through the Record menu, ~1s long, and stops it. */
async function recordVoiceOver(page: Page) {
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Microphone' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording voice-over' })).toBeVisible()
  // The elapsed readout ticks — capture at least a second of tone.
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop recording' }).click()
}

test('a voice-over records into the library and plays on the timeline (#224)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  // Footage to narrate over.
  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()

  await recordVoiceOver(page)

  // The capture landed as an ordinary audio clip with a real probed
  // duration (MediaRecorder WebM reports Infinity until the probe's
  // seek-to-end trick resolves it — a listed duration proves that worked).
  const library = page.getByRole('list', { name: 'Imported clips' })
  const recording = library.getByRole('listitem').filter({ hasText: 'Voice-over 1.webm' })
  await expect(recording).toBeVisible()
  await expect(recording).toContainText('Audio')
  await expect(recording).toContainText(/0:0[1-9]/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Placed on the timeline it is a normal audio track, and its coverage bar
  // draws a waveform — the #191 evidence that the recorded bytes decode to
  // real amplitude (the fake microphone generates a tone).
  await page.getByRole('button', { name: 'Add Voice-over 1.webm to timeline' }).click()
  await expect(page.getByTestId('audio-track-waveform-0')).toBeVisible()

  // And it genuinely plays: the mixed preview advances its audio element.
  await page.getByRole('button', { name: 'Play preview' }).click()
  const audio = page.getByTestId('preview-audio-0')
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0.1)
})

test('cancel discards the capture without touching the library (#224)', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Microphone' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording voice-over' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
})

test('a recorded clip autosaves and restores like any other clip (#224/#194)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  await recordVoiceOver(page)
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add Voice-over 1.webm to timeline' }).click()

  // The debounced snapshot lands: structure plus the recording's blob.
  await waitForSnapshot(page, 1)

  // The "crash" — and the restore needs no file that never existed on disk.
  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()

  await expect(library.getByRole('listitem')).toHaveCount(1)
  await expect(library).toContainText('Voice-over 1.webm')
  // The restored blob still decodes: the track's waveform re-renders a real
  // amplitude path (the strip has no width without a video sequence, so the
  // evidence is the decoded path itself, not visibility).
  const waveformPath = page.getByTestId('audio-track-waveform-0').locator('path')
  await expect(waveformPath).toHaveCount(1)
  expect((await waveformPath.getAttribute('d'))?.length ?? 0).toBeGreaterThan(100)
})
