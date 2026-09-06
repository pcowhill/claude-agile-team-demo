import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page

/**
 * Rename timeline elements (#405, from feedback #398), in real Chromium: a
 * sequence entry and an audio track renamed from their row headers, every
 * label and the preview's now-playing line following, Ctrl+Z undoing the
 * rename, and the names surviving save → open. Plus the geometry of the new
 * control: the ✎ and the edit field stay on the row header's line inside
 * the row, and the page never scrolls sideways.
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
  return Buffer.from(base64, 'base64')
}

const blurActive = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

test('renaming an entry and an audio track relabels the rows and the preview; Ctrl+Z undoes; save → open keeps the names (#405)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // The download path for Save As…, so the saved bytes can be reopened here.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const entryRow = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()
  const trackRow = page.getByRole('list', { name: 'Audio tracks' }).getByRole('listitem').first()
  const nowPlaying = page.getByTestId('preview-now-playing')
  await expect(nowPlaying).toContainText('Clip 1 of 1: clip.webm')

  // Geometry (new visible surface): the ✎ shares the name's line inside the
  // row before editing…
  const renameEntry = page.getByRole('button', { name: 'Rename clip.webm at position 1' })
  const entryName = entryRow.locator('.clip-name').first()
  await expectWithin(renameEntry, entryRow, { what: 'entry rename button' })
  const renameBox = (await renameEntry.boundingBox())!
  const nameBox = (await entryName.boundingBox())!
  expect(Math.abs(renameBox.y + renameBox.height / 2 - (nameBox.y + nameBox.height / 2))).toBeLessThan(
    renameBox.height / 2,
  )

  // …and the field takes the name's place on that same line while editing,
  // inside the row, without the page scrolling sideways.
  await renameEntry.click()
  const entryField = page.getByRole('textbox', { name: 'New name for clip.webm at position 1' })
  await expect(entryField).toBeFocused()
  await expect(entryField).toHaveValue('clip.webm')
  await expectWithin(entryField, entryRow, { what: 'entry rename field' })
  const fieldBox = (await entryField.boundingBox())!
  const durationBox = (await entryRow.locator('.clip-duration').first().boundingBox())!
  expect(Math.abs(fieldBox.y + fieldBox.height / 2 - (durationBox.y + durationBox.height / 2))).toBeLessThan(
    fieldBox.height / 2,
  )
  await expectNoHorizontalScroll(page, 'mid-rename')
  // The human check for the PR's rendered evidence, re-taken every run.
  await entryRow.screenshot({ path: testInfo.outputPath('rename-entry-mid-edit.png') })

  // Enter commits: the row header, its controls' labels and the preview's
  // now-playing line all carry the new name; the library clip keeps its own.
  await entryField.fill('Intro')
  await entryField.press('Enter')
  await expect(entryRow.locator('.clip-name')).toHaveText('Intro')
  await expect(page.getByRole('button', { name: 'Rename Intro at position 1' })).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Trim out point of Intro at position 1 in seconds' }),
  ).toBeVisible()
  await expect(nowPlaying).toContainText('Clip 1 of 1: Intro')
  await expect(page.getByRole('button', { name: 'Add clip.webm to timeline' })).toBeVisible()

  // The audio track: double-click the name, type, click away to commit.
  await trackRow.locator('.clip-name').dblclick()
  const trackField = page.getByRole('textbox', { name: 'New name for audio track tone.wav at position 1' })
  await trackField.fill('Bed')
  await blurActive(page)
  await expect(trackRow.locator('.clip-name')).toHaveText('Bed')
  await expect(
    page.getByRole('spinbutton', { name: 'Start time of audio track Bed at position 1 in seconds' }),
  ).toBeVisible()

  // Ctrl+Z undoes the track rename, then the entry rename; redo brings one back.
  await page.keyboard.press('Control+z')
  await expect(trackRow.locator('.clip-name')).toHaveText('tone.wav')
  await expect(entryRow.locator('.clip-name')).toHaveText('Intro')
  await page.keyboard.press('Control+z')
  await expect(entryRow.locator('.clip-name')).toHaveText('clip.webm')
  await expect(nowPlaying).toContainText('Clip 1 of 1: clip.webm')
  await page.keyboard.press('Control+Shift+z')
  await expect(entryRow.locator('.clip-name')).toHaveText('Intro')
  await page.keyboard.press('Control+Shift+z')
  await expect(trackRow.locator('.clip-name')).toHaveText('Bed')

  // Save (embedded, the default) and reopen: both names persist.
  await page.getByRole('button', { name: 'Save As…' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const projectBytes = await readFile((await (await downloadPromise).path())!)
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'named.bvep', mimeType: 'application/gzip', buffer: projectBytes }])
  await expect(entryRow.locator('.clip-name')).toHaveText('Intro')
  await expect(trackRow.locator('.clip-name')).toHaveText('Bed')
  await expect(nowPlaying).toContainText('Clip 1 of 1: Intro')
  // The library clips came back under their own, unrenamed names.
  await expect(page.getByRole('button', { name: 'Add clip.webm to timeline' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add tone.wav to timeline' })).toBeVisible()
})
