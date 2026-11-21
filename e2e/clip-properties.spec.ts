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
 * Its container rows (#805) are ffprobe's too: `ffprobe -show_entries
 * stream=codec_name,r_frame_rate,sample_rate:format=format_name` reads
 * matroska,webm; vp8 at 30/1; opus at 48000.
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
  await expect(value(dialog, 'Container')).toHaveText('WebM')
  await expect(value(dialog, 'Frame rate')).toHaveText('30 fps')
  await expect(value(dialog, 'Video codec')).toHaveText('VP8')
  await expect(value(dialog, 'Audio codec')).toHaveText('Opus')
  await expect(value(dialog, 'Sample rate')).toHaveText('48,000 Hz')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(clipMenuTrigger(page, CLIP)).toBeFocused()

  await chooseClipAction(page, 'tone.wav', 'Properties…')
  const audio = page.getByRole('dialog', { name: 'Properties of tone.wav' })
  await expect(value(audio, 'Audio channels')).toHaveText('Mono')
  await expect(value(audio, 'File type')).toHaveText('audio/wav')
  // sineWav's default: 16-bit PCM at 8 kHz.
  await expect(value(audio, 'Container')).toHaveText('WAV')
  await expect(value(audio, 'Audio codec')).toHaveText('PCM')
  await expect(value(audio, 'Sample rate')).toHaveText('8,000 Hz')
  await expect(audio.locator('dt', { hasText: /^Dimensions$/ })).toHaveCount(0)
  await audio.getByRole('button', { name: 'Close' }).click()
  await expect(audio).toHaveCount(0)
  await expect(clipMenuTrigger(page, 'tone.wav')).toBeFocused()
})

/**
 * #805's other fixtures. `ntsc-vp9.mp4` was made with FFmpeg 7:
 *
 *   ffmpeg -f lavfi -i testsrc2=size=160x90:rate=30000/1001 \
 *     -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 \
 *     -c:v libvpx-vp9 -b:v 100k -c:a libopus -b:a 32k -movflags +faststart ntsc-vp9.mp4
 *
 * VP9 and Opus rather than H.264 and AAC because Playwright's Chromium
 * plays no proprietary codec, and the clip has to import. ffprobe reads it
 * as mov,mp4; vp9 at r_frame_rate 30000/1001; opus at 48000.
 *
 * `tone.ogg` (`ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 0.5
 * -c:a libopus -b:a 16k tone.ogg`) is a container the header reader does not
 * read, so its rows are Unknown while the browser still decodes it.
 *
 * The 44.1 kHz WAV is `sineWav(1, 44100)`, built in Node (`sineWav.ts`).
 */
test('Properties… reads an MP4’s non-integer frame rate, a 44.1 kHz WAV, and says Unknown for an unread container (#805)', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'ntsc-vp9.mp4', mimeType: 'video/mp4', buffer: await readFile(join('e2e', 'fixtures', 'ntsc-vp9.mp4')) },
    { name: 'tone-44k.wav', mimeType: 'audio/wav', buffer: sineWav(1, 44100) },
    { name: 'tone.ogg', mimeType: 'audio/ogg', buffer: await readFile(join('e2e', 'fixtures', 'tone.ogg')) },
  ])
  const library = page.getByRole('list', { name: 'Imported clips' })
  for (const name of ['ntsc-vp9.mp4', 'tone-44k.wav', 'tone.ogg']) {
    await expect(library.getByRole('listitem').filter({ hasText: name })).toBeVisible()
  }

  await chooseClipAction(page, 'ntsc-vp9.mp4', 'Properties…')
  const mp4 = page.getByRole('dialog', { name: 'Properties of ntsc-vp9.mp4' })
  await expect(value(mp4, 'Container')).toHaveText('MP4')
  await expect(value(mp4, 'Frame rate')).toHaveText('29.97 fps')
  await expect(value(mp4, 'Video codec')).toHaveText('VP9')
  await expect(value(mp4, 'Audio codec')).toHaveText('Opus')
  await expect(value(mp4, 'Sample rate')).toHaveText('48,000 Hz')
  await expect(value(mp4, 'Dimensions')).toHaveText('160 × 90 px')
  await mp4.getByRole('button', { name: 'Close' }).click()

  await chooseClipAction(page, 'tone-44k.wav', 'Properties…')
  const wav = page.getByRole('dialog', { name: 'Properties of tone-44k.wav' })
  await expect(value(wav, 'Sample rate')).toHaveText('44,100 Hz')
  await expect(value(wav, 'Audio codec')).toHaveText('PCM')
  await wav.getByRole('button', { name: 'Close' }).click()

  // Headers this editor does not read: those rows say Unknown, and the
  // rows the other reads fill are unaffected.
  await chooseClipAction(page, 'tone.ogg', 'Properties…')
  const ogg = page.getByRole('dialog', { name: 'Properties of tone.ogg' })
  for (const label of ['Container', 'Audio codec', 'Sample rate']) {
    await expect(value(ogg, label)).toHaveText('Unknown')
  }
  await expect(value(ogg, 'File type')).toHaveText('audio/ogg')
  await expect(value(ogg, 'File size')).toHaveText('1.4 kB (1,424 bytes)')
  await expect(value(ogg, 'Audio channels')).toHaveText('Mono')
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
    await expect(value(dialog, 'Sample rate')).toHaveText('48,000 Hz')

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
