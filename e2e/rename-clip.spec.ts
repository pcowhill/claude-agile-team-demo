import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { chooseFromFileMenu } from './fileMenu'

type Page = import('@playwright/test').Page

/**
 * Renaming a library clip (#404, from feedback #398), in real Chromium: the
 * display name changes everywhere the clip is named while the original
 * filename is kept underneath, so a references-only project re-links from
 * the file on disk — the re-link dialog names both, and the *original* file
 * is what links the renamed clip (linked state asserted, not just shown).
 * An embedded save and an autosave restore keep the name too. Plus the
 * geometry of the new control: the ✎ and the edit field stay inside the
 * row in both views, and the page never scrolls sideways.
 */

/** Records a ~1.2 s WebM in-browser so the import probe accepts it. */
async function recordWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
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
        ctx.fillStyle = '#36a'
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
  return Buffer.from(base64, 'base64')
}

/**
 * Waits until the autosave snapshot holds a structure and `blobs` media
 * records — autosave.spec.ts's own wait, repeated here because the
 * restore-keeps-the-name criterion needs the snapshot to have landed.
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
            if (!db.objectStoreNames.contains('structure') || !db.objectStoreNames.contains('media')) {
              return false
            }
            const tx = db.transaction(['structure', 'media'], 'readonly')
            const count = <T,>(request: IDBRequest<T>) =>
              new Promise<T>((resolve, reject) => {
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
            const structures = await count(tx.objectStore('structure').count())
            const media = await count(tx.objectStore('media').count())
            return structures >= 1 && media >= expectedBlobs
          } finally {
            db.close()
          }
        }, blobs),
      { timeout: 15_000 },
    )
    .toBe(true)
}

async function saveProject(page: Page, mode: 'references' | 'embedded'): Promise<Buffer> {
  await chooseFromFileMenu(page, 'Save As…')
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog
    .getByRole('radio', {
      name: mode === 'references' ? 'Store references only' : 'Embed media in the project file',
    })
    .check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  return readFile((await (await downloadPromise).path())!)
}

test('a renamed clip re-links from its original file, and keeps its name through embedded save and autosave (#404)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // The download path for Save As…, so the saved bytes can be reopened here.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  const row = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem').first()
  // An element placed before the rename keeps the name it was placed with.
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // Geometry (changed visible surface): the ✎ shares the name's line inside
  // the row, and the field takes the name's place while editing.
  const rename = page.getByRole('button', { name: 'Rename clip.webm', exact: true })
  await expectWithin(rename, row, { what: 'rename button (list)' })
  const nameBox = (await row.locator('.clip-name').boundingBox())!
  const renameBox = (await rename.boundingBox())!
  expect(Math.abs(renameBox.y + renameBox.height / 2 - (nameBox.y + nameBox.height / 2))).toBeLessThan(
    renameBox.height / 2,
  )
  await rename.click()
  const field = page.getByRole('textbox', { name: 'New name for clip.webm', exact: true })
  await expect(field).toBeFocused()
  await expectWithin(field, row, { what: 'rename field (list)' })
  await expectNoHorizontalScroll(page, 'mid-rename, list view')
  // The human check for the PR's rendered evidence, re-taken every run.
  await row.screenshot({ path: testInfo.outputPath('rename-clip-mid-edit.png') })
  await field.fill('Intro')
  await field.press('Enter')
  await expect(row.locator('.clip-name')).toHaveText('Intro')
  await expect(page.getByRole('button', { name: 'Add Intro to timeline' })).toBeVisible()
  // …and the placed entry still reads clip.webm.
  await expect(
    page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first().locator('.clip-name'),
  ).toHaveText('clip.webm')

  // The card view: the same control fits the card.
  await page.getByRole('button', { name: 'Thumbnail view' }).click()
  const card = page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem').first()
  await expectWithin(page.getByRole('button', { name: 'Rename Intro', exact: true }), card, {
    what: 'rename button (card)',
  })
  await page.getByRole('button', { name: 'Rename Intro', exact: true }).click()
  const cardField = page.getByRole('textbox', { name: 'New name for Intro', exact: true })
  await expectWithin(cardField, card, { what: 'rename field (card)' })
  await expectNoHorizontalScroll(page, 'mid-rename, thumbnail view')
  await cardField.press('Escape')
  await expect(card.locator('.clip-name')).toHaveText('Intro')
  await page.getByRole('button', { name: 'List view' }).click()

  // Autosave restore keeps the name: the snapshot lands, the page "crashes".
  await waitForSnapshot(page, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(row.locator('.clip-name')).toHaveText('Intro')
  await expect(page.getByRole('button', { name: 'Add Intro to timeline' })).toBeVisible()

  // References-only save → New Project → Open: the re-link dialog names the
  // clip with its file, and the ORIGINAL file is what links it.
  const references = await saveProject(page, 'references')
  await chooseFromFileMenu(page, 'New Project')
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'renamed.bvep', mimeType: 'application/gzip', buffer: references }])
  const dialog = page.getByRole('dialog', { name: /Open renamed\.bvep/ })
  const item = dialog.getByRole('list', { name: 'Project media' }).getByRole('listitem').first()
  await expect(item).toContainText('Intro')
  await expect(item).toContainText('(clip.webm)')
  await expect(item).toContainText('Missing')
  const openButton = dialog.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeDisabled()
  await page
    .getByTestId('relink-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(item).toContainText('Linked')
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(dialog).toHaveCount(0)
  await expect(row.locator('.clip-name')).toHaveText('Intro')
  await expect(page.getByRole('button', { name: 'Add Intro to timeline' })).toBeVisible()
  // The tooltip names the file the clip came from.
  await expect(row.locator('.clip-name')).toHaveAttribute('title', 'Intro (file: clip.webm)')

  // Embedded save → New Project → Open: the name persists, no re-linking.
  const embedded = await saveProject(page, 'embedded')
  await chooseFromFileMenu(page, 'New Project')
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'embedded.bvep', mimeType: 'application/gzip', buffer: embedded }])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row.locator('.clip-name')).toHaveText('Intro')
  await expect(page.getByRole('button', { name: 'Add Intro to timeline' })).toBeVisible()
})

test('a file that matches only the display name does not re-link a renamed clip (#404)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Rename clip.webm', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'New name for clip.webm', exact: true })
  await field.fill('Intro.webm')
  await field.press('Enter')
  const references = await saveProject(page, 'references')
  await chooseFromFileMenu(page, 'New Project')
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'renamed.bvep', mimeType: 'application/gzip', buffer: references }])
  const dialog = page.getByRole('dialog', { name: /Open renamed\.bvep/ })
  // The same bytes under the display name: refused as not part of the project.
  await page
    .getByTestId('relink-file-input')
    .setInputFiles([{ name: 'Intro.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(dialog).toContainText('is not one of this project')
  await expect(dialog.getByRole('button', { name: 'Open project' })).toBeDisabled()
  // Under its real name it links.
  await page
    .getByTestId('relink-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(dialog.getByRole('button', { name: 'Open project' })).toBeEnabled()
})
