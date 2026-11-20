import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction, clipMenuTrigger } from './clipMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Properties… in a library clip's ⋯ menu (#804, from the customer's #800):
 * a read-only dialog of what the app can measure about the clip's file.
 *
 * The fixture's values are ffprobe's, written here:
 * `ffprobe -show_entries stream=width,height:format=duration,size
 * e2e/fixtures/trim-clip.webm` reads 320×180, 6.008000 s and 33969 bytes.
 *
 * The geometry is measured on a populated project (#534/#545: an empty one
 * cannot overflow) at 1280×720 and 360px: every label and value inside the
 * dialog, no label wrapping, and no sideways page scroll.
 */

const CLIP = 'trim-clip.webm'
// Long enough to give the dialog its widest title and Name value, short of
// the length at which the library row itself widens the 360px page (#809).
const RENAMED = 'Opening shot, first take'
const FFPROBE = { width: 320, height: 180, seconds: 6.008, bytes: 33969 }

async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    canvas.getContext('2d')!.fillRect(0, 0, 64, 32)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

/** The fixture video, a tone and a still, each in the library and on the timeline. */
async function populate(page: Page) {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: CLIP, mimeType: 'video/webm', buffer: await readFile(join('e2e', 'fixtures', CLIP)) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav() },
    { name: 'still.png', mimeType: 'image/png', buffer: await makePng(page) },
  ])
  for (const name of [CLIP, 'tone.wav', 'still.png']) {
    await page.getByRole('button', { name: `Add ${name} to timeline` }).click()
  }
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
}

/** The value beside `label` in an open properties dialog. */
const value = (dialog: Locator, label: string): Locator =>
  dialog.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')

test('Properties… shows what ffprobe reads for the fixture, and Escape and Close dismiss it to the ⋯ (#804)', async ({
  page,
}) => {
  await populate(page)
  await chooseClipAction(page, CLIP, 'Properties…')
  const dialog = page.getByRole('dialog', { name: `Properties of ${CLIP}` })
  await expect(dialog).toBeVisible()

  await expect(value(dialog, 'Kind')).toHaveText('Video')
  await expect(value(dialog, 'File type')).toHaveText('video/webm')
  await expect(value(dialog, 'File size')).toHaveText(`34 kB (${FFPROBE.bytes.toLocaleString('en-US')} bytes)`)
  await expect(value(dialog, 'Length')).toHaveText(`0:06 (${FFPROBE.seconds.toFixed(2)} s)`)
  await expect(value(dialog, 'Dimensions')).toHaveText(`${FFPROBE.width} × ${FFPROBE.height} px`)
  await expect(value(dialog, 'Aspect ratio')).toHaveText('16:9')
  await expect(value(dialog, 'Has sound')).toHaveText('Yes')
  await expect(value(dialog, 'Audio channels')).toHaveText('Mono')
  await expect(value(dialog, 'On the timeline')).toHaveText('1 placement')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(clipMenuTrigger(page, CLIP)).toBeFocused()

  await chooseClipAction(page, 'tone.wav', 'Properties…')
  const audio = page.getByRole('dialog', { name: 'Properties of tone.wav' })
  await expect(value(audio, 'Audio channels')).toHaveText('Mono')
  await expect(value(audio, 'File type')).toHaveText('audio/wav')
  await expect(audio.locator('dt', { hasText: /^Dimensions$/ })).toHaveCount(0)
  await audio.getByRole('button', { name: 'Close' }).click()
  await expect(audio).toHaveCount(0)
  await expect(clipMenuTrigger(page, 'tone.wav')).toBeFocused()
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  test(`at ${viewport.width}px, every label and value sits inside the dialog and no label wraps (#804)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populate(page)
    // A rename gives the dialog its widest content: the title, the Name
    // value, and the Original filename row, which has the longest label.
    await chooseClipAction(page, CLIP, 'Rename…')
    const field = page.getByRole('textbox', { name: `New name for ${CLIP}`, exact: true })
    await field.fill(RENAMED)
    await field.press('Enter')
    await chooseClipAction(page, RENAMED, 'Properties…')
    const dialog = page.getByRole('dialog', { name: `Properties of ${RENAMED}` })
    await expect(value(dialog, 'Original filename')).toHaveText(CLIP)
    // Every read settled, so the measurement is of the final rows.
    await expect(value(dialog, 'Has sound')).toHaveText('Yes')
    await expect(value(dialog, 'Dimensions')).not.toHaveText('Reading…')

    const at = `at ${viewport.width}px`
    for (const cell of await dialog.locator('dt, dd').all()) {
      await expectWithin(cell, dialog, { what: `"${await cell.textContent()}" ${at}` })
    }
    await expectWithin(dialog.getByRole('button', { name: 'Close' }), dialog, { what: `Close ${at}` })
    await expectNoWrap(dialog.locator('dt'), `a property label ${at}`)
    await expectNoHorizontalScroll(page, `Properties open ${at}`)
    await dialog.screenshot({ path: testInfo.outputPath(`clip-properties-${viewport.width}.png`) })
  })
}
