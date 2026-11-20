import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'

type Page = import('@playwright/test').Page

/**
 * Download in a library clip's ⋯ menu (#803, from the customer's #800): the
 * clip's own file, saved on its own through the browser's download.
 *
 * - An imported clip downloads as its bytes, unchanged, under its name.
 * - A clip renamed without an extension gets the original one back on the
 *   download, so the file still opens.
 * - An extracted audio clip has no file of its own (its URL is the video's
 *   bytes), so it downloads as a WAV of its sound: read here from the
 *   saved file's own header, which says it is PCM audio and how long.
 */

const CLIP = 'trim-clip.webm'
/** `ffprobe -show_entries format=duration e2e/fixtures/trim-clip.webm`. */
const CLIP_SECONDS = 6.008

async function importFixture(page: Page): Promise<Buffer> {
  const bytes = await readFile(join('e2e', 'fixtures', CLIP))
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer: bytes }])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(1)
  return bytes
}

/** Chooses Download on `clipName` and returns the download's name and saved bytes. */
async function download(page: Page, clipName: string, savedAs: string) {
  const pending = page.waitForEvent('download')
  await chooseClipAction(page, clipName, 'Download')
  const event = await pending
  const path = test.info().outputPath(savedAs)
  await event.saveAs(path)
  return { name: event.suggestedFilename(), bytes: await readFile(path) }
}

/** What a WAV's RIFF header says: format, channels, rate, and the length its data holds. */
function readWav(bytes: Buffer) {
  expect(bytes.toString('ascii', 0, 4), 'RIFF tag').toBe('RIFF')
  expect(bytes.toString('ascii', 8, 12), 'WAVE tag').toBe('WAVE')
  expect(bytes.toString('ascii', 12, 16), 'fmt chunk').toBe('fmt ')
  expect(bytes.toString('ascii', 36, 40), 'data chunk').toBe('data')
  const byteRate = bytes.readUInt32LE(28)
  const dataLength = bytes.readUInt32LE(40)
  expect(bytes.length, 'the data chunk runs to the end of the file').toBe(44 + dataLength)
  return {
    format: bytes.readUInt16LE(20),
    channels: bytes.readUInt16LE(22),
    sampleRate: bytes.readUInt32LE(24),
    bitsPerSample: bytes.readUInt16LE(34),
    seconds: dataLength / byteRate,
  }
}

test('an imported clip downloads as its own bytes, under its name (#803)', async ({ page }) => {
  const imported = await importFixture(page)
  const saved = await download(page, CLIP, 'imported.webm')
  expect(saved.name).toBe(CLIP)
  expect(saved.bytes.length).toBe(imported.length)
  expect(saved.bytes.equals(imported), 'the downloaded bytes are the imported file’s').toBe(true)
})

test('a clip renamed without an extension downloads with the original one (#803)', async ({ page }) => {
  const imported = await importFixture(page)
  await chooseClipAction(page, CLIP, 'Rename…')
  const field = page.getByRole('textbox', { name: `New name for ${CLIP}`, exact: true })
  await field.fill('Beach day')
  await field.press('Enter')
  await expect(page.getByRole('button', { name: 'Add Beach day to timeline' })).toBeVisible()

  const saved = await download(page, 'Beach day', 'renamed.webm')
  expect(saved.name).toBe('Beach day.webm')
  expect(saved.bytes.equals(imported), 'a rename changes the name, not the bytes').toBe(true)
})

test('an extracted audio clip downloads as a WAV of its sound, as long as the clip (#803)', async ({ page }) => {
  test.setTimeout(60_000)
  await importFixture(page)
  await chooseClipAction(page, CLIP, 'Extract audio')
  const extracted = `${CLIP} (audio)`
  await expect(page.getByRole('button', { name: `Add ${extracted} to timeline` })).toBeVisible()

  const saved = await download(page, extracted, 'extracted.wav')
  expect(saved.name).toBe(`${extracted}.wav`)
  const wav = readWav(saved.bytes)
  expect(wav.format, 'PCM').toBe(1)
  expect(wav.bitsPerSample).toBe(16)
  expect(wav.channels).toBeGreaterThan(0)
  expect(wav.sampleRate).toBeGreaterThan(0)
  expect(
    Math.abs(wav.seconds - CLIP_SECONDS),
    `the WAV holds ${wav.seconds} s against the clip's ${CLIP_SECONDS} s`,
  ).toBeLessThanOrEqual(0.1)
  // Not a silent file: the fixture's sound made it through the decode.
  let peak = 0
  for (let offset = 44; offset < saved.bytes.length; offset += 2) {
    peak = Math.max(peak, Math.abs(saved.bytes.readInt16LE(offset)))
  }
  expect(peak, 'the WAV carries sound, not silence').toBeGreaterThan(1000)
})
