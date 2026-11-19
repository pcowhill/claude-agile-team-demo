import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoWrap, expectWithin } from './layout'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The export's Size limit (#726): a file size the export aims under, by
 * giving the recorder a bitrate worked out from the limit and the exported
 * duration. The recorder treats that as a target, so the evidence is the
 * downloaded file's own size.
 */

/**
 * Records a screen-like WebM in the browser: a page of dark text on white,
 * scrolling a line at a time, with a line being typed and a cursor that
 * moves. That is the content the limit is for (a screen recording). A flat
 * colour would compress to almost nothing whatever the bitrate, and prove
 * nothing.
 */
async function recordScreenLikeWebm(
  page: Page,
  { seconds, width, height }: { seconds: number; width: number; height: number },
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ seconds, width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      const lineHeight = Math.round(height / 24)
      const words = 'const export size limit bitrate recorder frame chapter range sound picture'.split(' ')
      const line = (n: number) =>
        `${String(n).padStart(4, ' ')}  ` +
        Array.from({ length: 9 }, (_, i) => words[(n * 7 + i * 3) % words.length]).join(' ')
      recorder.start()
      const start = performance.now()
      await new Promise<void>((resolve) => {
        const draw = () => {
          const elapsed = (performance.now() - start) / 1000
          const typed = Math.floor(elapsed * 12)
          const top = Math.floor(typed / 40)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = '#1e1e1e'
          ctx.font = `${Math.round(lineHeight * 0.7)}px monospace`
          for (let row = 0; row < 22; row++) {
            const text = line(top + row)
            ctx.fillText(row === 21 ? text.slice(0, typed % 40) : text, 12, (row + 1) * lineHeight)
          }
          ctx.fillStyle = '#d03030'
          ctx.fillRect(
            (Math.sin(elapsed) * 0.4 + 0.5) * width,
            (Math.cos(elapsed * 0.7) * 0.4 + 0.5) * height,
            14,
            20,
          )
          if (elapsed > seconds) resolve()
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
    },
    { seconds, width, height },
  )
  return Buffer.from(base64, 'base64')
}

/** Imports the clip and puts it on the timeline `times` times. */
async function placeClip(page: Page, webm: Buffer, times: number) {
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'screen.webm', mimeType: 'video/webm', buffer: webm }])
  const add = page.getByRole('button', { name: 'Add screen.webm to timeline', exact: true })
  for (let i = 0; i < times; i++) await add.click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(times)
}

/** Opens the export dialog with a Custom limit of `megabytes`, or none. */
async function openExport(page: Page, megabytes: number | null) {
  await page.getByRole('button', { name: 'Export Project…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export project' })
  if (megabytes !== null) {
    await dialog.getByRole('combobox', { name: 'Export size limit' }).selectOption('custom')
    await dialog.getByRole('spinbutton', { name: 'Custom size limit in MB' }).fill(String(megabytes))
    await expect(dialog.getByTestId('export-limit-estimate')).toBeVisible()
  }
  return dialog
}

/** Presses Export and returns the downloaded file's bytes. */
async function exportBytes(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download', { timeout: 180_000 })
  await page
    .getByRole('dialog', { name: 'Export project' })
    .getByRole('button', { name: 'Export', exact: true })
    .click()
  return readFile(await (await download).path())
}

test('a Custom limit at half an unlimited export’s size brings the file under it (#726)', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(150_000)
  await page.goto('./')
  // 12 s of screen-like content at 1280×720: the clip, recorded at the
  // browser's own default rate, is the unlimited export's material.
  await placeClip(page, await recordScreenLikeWebm(page, { seconds: 12, width: 1280, height: 720 }), 1)

  await openExport(page, null)
  const unlimited = await exportBytes(page)
  // With no limit the dialog closes on the download, as it always has.
  await expect(page.getByRole('dialog', { name: 'Export project' })).toBeHidden()

  const limitBytes = Math.floor(unlimited.length / 2)
  const dialog = await openExport(page, limitBytes / 1_000_000)
  const limited = await exportBytes(page)
  console.log(`[${browserName}] size limit: unlimited ${unlimited.length} B; limit ${limitBytes} B; limited ${limited.length} B`)
  test.info().annotations.push({
    type: 'sizes',
    description: `unlimited ${unlimited.length} B; limit ${limitBytes} B; limited ${limited.length} B`,
  })
  // The unlimited file exceeded the limit (it is twice it), so the limit is
  // what brought the second one under.
  expect(unlimited.length).toBeGreaterThan(limitBytes)
  expect(limited.length, `limited ${limited.length} B against a ${limitBytes} B limit`).toBeLessThanOrEqual(
    limitBytes,
  )
  // A limited export stays open to state what the file came to.
  await expect(dialog.getByTestId('export-size-result')).toContainText(
    `Saved sequence-export.webm: ${(Math.round(limited.length / 100_000) / 10).toString()}`,
  )
  await expectWithin(dialog.getByTestId('export-size-result'), dialog, { axis: 'x', what: 'the size result' })
  await expectNoWrap(dialog.getByTestId('export-size-result').locator('.export-size-figure'), 'a stated size')
  await dialog.getByTestId('export-size-result').screenshot({ path: testInfo.outputPath('size-result.png') })
})

/**
 * The control, the Custom field and the estimate line inside the dialog,
 * and the rate in the estimate on one line (#726). On a populated project
 * (three slates), at the desktop and phone widths. The dialog scrolls
 * vertically by design, so containment is horizontal.
 */
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the Size limit and its estimate fit the export dialog at ${viewport.width}px (#726)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    for (let i = 0; i < 3; i++) await chooseFromAddMenu(page, ADD_SLATE)
    await page.getByRole('button', { name: 'Export Project…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export project' })
    const select = dialog.getByRole('combobox', { name: 'Export size limit' })
    await select.selectOption('custom')
    const field = dialog.getByRole('spinbutton', { name: 'Custom size limit in MB' })
    await field.fill('2')
    const estimate = dialog.getByTestId('export-limit-estimate')
    await expect(estimate).toContainText('Aims at about')
    for (const [element, what] of [
      [select, 'the Size limit select'],
      [field, 'the Custom MB field'],
      [estimate, 'the estimate line'],
    ] as const) {
      await expectWithin(element, dialog, { axis: 'x', what: `${what} at ${viewport.width}px` })
    }
    await expectNoWrap(estimate.locator('.export-limit-rate'), `estimate rate at ${viewport.width}px`)
    // A preset too, whose estimate is the one most people will read.
    await select.selectOption('25')
    await expectWithin(estimate, dialog, { axis: 'x', what: `the 25 MB estimate at ${viewport.width}px` })
    await expectNoWrap(estimate.locator('.export-limit-rate'), `25 MB estimate rate at ${viewport.width}px`)
    await dialog.screenshot({ path: testInfo.outputPath(`size-limit-${viewport.width}.png`) })
  })
}

/**
 * The overshoot measurement #726 asks for, and the source of the margin in
 * `sizeLimit.ts`: a ≥ 60 s screen-like export at 1280×720 against a limit.
 * Slow (real time, minutes per browser), so it runs only on request:
 * `SIZE_LIMIT_MEASURE=25,5 npx playwright test export-size-limit`, a list
 * of limits in MB. Each limit's actual size is reported as an annotation
 * and on stdout, beside the unlimited export of the same timeline.
 */
const measureLimits = (process.env.SIZE_LIMIT_MEASURE ?? '')
  .split(',')
  .filter((value) => value.trim() !== '')
  .map(Number)
test('overshoot at a 60 s, 1280×720 screen-like export (#726 measurement)', async ({ page, browserName }) => {
  test.skip(measureLimits.length === 0, 'measurement only: set SIZE_LIMIT_MEASURE')
  test.setTimeout(600_000)
  await page.goto('./')
  // 15 s of content four times over: 60 s of output.
  await placeClip(page, await recordScreenLikeWebm(page, { seconds: 15, width: 1280, height: 720 }), 4)
  await openExport(page, null)
  const unlimited = await exportBytes(page)
  const rows = [`${browserName}: unlimited ${unlimited.length} B`]
  for (const megabytes of measureLimits) {
    await openExport(page, megabytes)
    const limited = await exportBytes(page)
    const limitBytes = megabytes * 1_000_000
    rows.push(
      `${browserName}: limit ${megabytes} MB -> ${limited.length} B (${((limited.length / limitBytes) * 100).toFixed(1)}% of the limit)`,
    )
    await page.getByRole('dialog', { name: 'Export project' }).getByRole('button', { name: 'Cancel' }).click()
  }
  for (const row of rows) console.log(`[size-limit] ${row}`)
  test.info().annotations.push({ type: 'overshoot', description: rows.join('; ') })
})
