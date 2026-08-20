import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Saving a project (#76): Save As… / Save / Ctrl+S write a file that #75's
 * format round-trips, and the unsaved-changes indicator tracks edits. Two
 * tests, one per write path: the download fallback (picker removed) whose
 * output Playwright captures as a real download, and the File System Access
 * path with `showSaveFilePicker` stubbed at the browser-API boundary — the
 * real picker cannot be driven by automation.
 */

/** Records a ~1.2s WebM in-browser so the import probe accepts it. */
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

test('saving downloads a project file that round-trips, and the dirty indicator tracks edits', async ({
  page,
}) => {
  // Force the download path: without the File System Access picker both
  // Save and Save As… must fall back to downloading.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')

  // A fresh, empty session shows no unsaved-changes indicator.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()
  for (const clip of ['first', 'second']) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${clip}.webm at position ${clip === 'first' ? 1 : 2} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page.getByRole('button', { name: 'Add zoom to first.webm at position 1' }).click()

  // The edits raised the indicator.
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // Save As… asks what the file carries (#98) — references-only here keeps
  // this spec on the small-file path (the embedded twin lives in
  // open-embedded.spec.ts) — then downloads the project file.
  await page.getByRole('button', { name: 'Save As…' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const firstDownload = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const download = await firstDownload
  expect(download.suggestedFilename()).toBe('project.bvep')

  // The file is #75's format and carries exactly what was built.
  const document = JSON.parse(
    gunzipSync(readFileSync((await download.path())!)).toString('utf-8'),
  ) as {
    format: string
    schemaVersion: number
    clips: { name: string }[]
    timeline: {
      entries: { inPoint: number; outPoint: number }[]
      transitions: { type: string; duration: number }[]
      zooms: { scale: number }[]
    }
  }
  expect(document.format).toBe('browser-video-editor-project')
  expect(document.schemaVersion).toBe(1)
  expect(document.clips.map((clip) => clip.name)).toEqual(['first.webm', 'second.webm'])
  expect(document.timeline.entries.map((entry) => [entry.inPoint, entry.outPoint])).toEqual([
    [0, 1],
    [0, 1],
  ])
  expect(document.timeline.transitions).toEqual([
    expect.objectContaining({ type: 'crossfade', duration: 1 }),
  ])
  expect(document.timeline.zooms).toEqual([expect.objectContaining({ scale: 2 })])

  // Saving cleared the indicator; the next edit raises it again.
  await expect(page.getByText('Saved as project.bvep')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  const retrim = page.getByRole('spinbutton', {
    name: 'Trim out point of second.webm at position 2 in seconds',
  })
  await retrim.fill('0.8')
  await retrim.blur()
  await expect(page.getByRole('button', { name: 'Save (unsaved changes)' })).toBeVisible()

  // Ctrl+S saves again, re-using the established filename and mode — no
  // dialog re-appears (#98).
  const secondDownload = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  expect((await secondDownload).suggestedFilename()).toBe('project.bvep')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
})

test('with the File System Access picker, Save As… asks once and Save rewrites in place', async ({
  page,
}) => {
  // Stub the picker at the browser-API boundary: it hands out one handle
  // whose writes are captured (base64, for transport out of the page).
  await page.addInitScript(() => {
    const state = { pickerCalls: 0, saves: [] as string[] }
    ;(window as unknown as { __saveTest: typeof state }).__saveTest = state
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = () => {
      state.pickerCalls += 1
      return Promise.resolve({
        name: 'edit.bvep',
        createWritable: () => {
          const chunks: Uint8Array[] = []
          return Promise.resolve({
            write: (data: Uint8Array) => {
              chunks.push(data)
              return Promise.resolve()
            },
            close: () => {
              let binary = ''
              for (const chunk of chunks) {
                for (const byte of chunk) binary += String.fromCharCode(byte)
              }
              state.saves.push(btoa(binary))
              return Promise.resolve()
            },
          })
        },
      })
    }
  })
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'first.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()

  // Save with no destination behaves as Save As…: the first-save mode
  // dialog appears with embed preselected (#98), then the picker is
  // consulted. Confirming the default writes an embedded (version 2) file.
  await page.getByRole('button', { name: 'Save (unsaved changes)' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await expect(
    modeDialog.getByRole('radio', { name: 'Embed media in the project file' }),
  ).toBeChecked()
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  await expect(page.getByText('Saved as edit.bvep')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  // A further edit, then Ctrl+S: saved without asking again — neither the
  // picker nor the mode dialog.
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of first.webm at position 1 in seconds',
  })
  await outField.fill('0.8')
  await outField.blur()
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForFunction(
    () => (window as unknown as { __saveTest: { saves: string[] } }).__saveTest.saves.length === 2,
  )
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  const state = await page.evaluate(
    () => (window as unknown as { __saveTest: { pickerCalls: number; saves: string[] } }).__saveTest,
  )
  expect(state.pickerCalls).toBe(1)

  // Decode the second save in-page and check it carries the re-trim.
  const document = await page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    void writer.write(bytes)
    void writer.close()
    let json = ''
    const decoder = new TextDecoder()
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      json += decoder.decode(value, { stream: true })
    }
    return JSON.parse(json) as {
      format: string
      schemaVersion: number
      media?: Record<string, unknown>
      timeline: { entries: { outPoint: number }[] }
    }
  }, state.saves[1])
  expect(document.format).toBe('browser-video-editor-project')
  expect(document.timeline.entries[0].outPoint).toBe(0.8)
  // The default (embed) mode was remembered: version 2 with the clip's media.
  expect(document.schemaVersion).toBe(2)
  expect(Object.keys(document.media ?? {})).toHaveLength(1)
})
