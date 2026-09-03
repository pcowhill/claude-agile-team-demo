import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Crash-safe autosave (#194), end to end against the real IndexedDB: build
 * a small timeline from a genuinely recorded WebM, wait for the snapshot
 * (structure + the clip's blob) to land, reload the page — the crash — and
 * restore. The timeline must come back exactly and the media must be
 * playable again from the restored blob, with no file re-picking.
 */

/** Records a short real WebM so restored playback is genuinely decodable. */
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

/**
 * Waits until the snapshot in IndexedDB has a structure and `blobs` media
 * records. Polled via `page.evaluate` (which awaits page promises) rather
 * than `waitForFunction`, whose predicate is not awaited when async — the
 * returned pending Promise object is truthy and "passes" immediately.
 */
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
            const get = <T>(request: IDBRequest<T>) =>
              new Promise<T>((resolve, reject) => {
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
            const structure = await get(tx.objectStore('structure').get('current'))
            const mediaKeys = await get(tx.objectStore('media').getAllKeys())
            return structure !== undefined && mediaKeys.length === expectedBlobs
          } finally {
            db.close()
          }
        }, blobs),
      { timeout: 20_000 },
    )
    .toBe(true)
}

test('a session survives a reload: restore brings back the timeline and playable media', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const trimOut = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await trimOut.fill('1')
  await trimOut.blur()

  // The debounced snapshot lands: structure plus the clip's blob.
  await waitForSnapshot(page, 1)

  // The session was never saved to a file, so the indicator is up (#288).
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // The "crash": nothing is saved to a file, the page simply goes away.
  await page.reload()

  // The offer appears; restoring needs no file picking at all.
  await page.getByRole('button', { name: 'Restore' }).click()

  // Restored never-saved work still shows the unsaved indicator (#288) —
  // the restore must not silently present unsaved work as saved.
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // The library and the timeline are back, trim included.
  await expect(library.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toContainText(
    'clip.webm',
  )
  await expect(
    page.getByRole('spinbutton', { name: 'Trim out point of clip.webm at position 1 in seconds' }),
  ).toHaveValue('1')

  // The media is genuinely playable from the restored blob: pressing Play
  // actually advances the preview element (the preview.spec.ts evidence).
  const previewVideo = page.getByTestId('preview-video')
  await expect(previewVideo).toBeVisible()
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect
    .poll(async () => await previewVideo.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.1)

  // The restored session keeps autosaving: the snapshot still exists after
  // restore (it re-mirrors the restored state rather than vanishing).
  await waitForSnapshot(page, 1)
})

/** Polls the snapshot's saved marker (#288) until it has the expected value. */
async function waitForSavedMarker(page: Page, expected: boolean) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const openDb = () =>
            new Promise<IDBDatabase | null>((resolve) => {
              const request = indexedDB.open('bvep-autosave')
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => resolve(null)
            })
          const db = await openDb()
          if (db === null) return null
          try {
            if (!db.objectStoreNames.contains('structure')) return null
            const tx = db.transaction('structure', 'readonly')
            const get = <T>(request: IDBRequest<T>) =>
              new Promise<T>((resolve, reject) => {
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
            const saved = await get(tx.objectStore('structure').get('saved'))
            return typeof saved === 'boolean' ? saved : null
          } finally {
            db.close()
          }
        }),
      { timeout: 20_000 },
    )
    .toBe(expected)
}

test('restoring a session that was saved to a file starts clean (#288)', async ({ page }) => {
  test.setTimeout(120_000)
  // Force the download save path — the real picker cannot be automated.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // Save the project (references-only keeps this on the small-file path).
  await page.getByRole('button', { name: 'Save (unsaved changes)' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloaded = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  await downloaded
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  // The debounced snapshot pass after the save records the state as saved.
  await waitForSnapshot(page, 1)
  await waitForSavedMarker(page, true)

  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()

  // The restored state matches the save: no unsaved indicator.
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toHaveCount(0)

  // The next edit raises the indicator again, exactly as after a live save.
  const trimOut = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await trimOut.fill('1')
  await trimOut.blur()
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()
})

test('discarding the offer clears the snapshot and starts fresh', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await waitForSnapshot(page, 1)

  await page.reload()
  await page.getByRole('button', { name: 'Discard' }).click()
  // The offer dismisses only once the snapshot clear has committed (#240),
  // so waiting for it is what makes the reload below race-free — reloading
  // mid-delete used to abort the IndexedDB transaction and resurrect the
  // snapshot.
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0)

  // Fresh session: nothing restored, and the stored snapshot is gone — a
  // second reload offers nothing.
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Add color slate to timeline' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0)
})
