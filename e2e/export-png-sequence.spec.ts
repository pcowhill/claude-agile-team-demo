import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The More export formats plugin's PNG image sequence, end to end (#865).
 * It enables the plugin through the manager (the real lazy chunk), exports
 * a 2 s two-slate timeline at a Frame rate and Frame size that are not the
 * dialog's defaults, and judges the downloaded ZIP:
 *
 * 1. **The archive**, walked from its local headers: stored entries named
 *    `frame-00001.png` onwards, in order, with no gap.
 * 2. **The frames.** There are `frame rate × duration` of them, within
 *    one, and each is a PNG at the export's frame size (its `IHDR`).
 * 3. **Preview parity, exactly.** PNG is lossless, so the frame at 0.5 s
 *    and the frame at 1.5 s have the preview's centre pixel at those times.
 * 4. **Python's `zipfile`**, where `python3` is installed: it lists the same
 *    names and finds every CRC correct (`testzip`). Its absence is logged
 *    rather than failed, as `export-apng.spec.ts` treats `ffprobe`.
 */

const RED = '#c03020'
const BLUE = '#2050d0'
/** Not the dialog's defaults (30 fps, Auto at 640×360), so the export is seen to follow them. */
const FPS = 24
const WIDTH = 800
const HEIGHT = 450

interface Rgb {
  r: number
  g: number
  b: number
}

/** The stored files of a ZIP, read from its local headers. */
function walkZip(bytes: Buffer): { name: string; method: number; data: Buffer }[] {
  const files: { name: string; method: number; data: Buffer }[] = []
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8)
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extra = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('latin1')
    const at = offset + 30 + nameLength + extra
    files.push({ name, method, data: bytes.subarray(at, at + size) })
    offset = at + size
  }
  expect(bytes.readUInt32LE(offset), 'the central directory follows the last file').toBe(0x02014b50)
  return files
}

/** A PNG's size, from its `IHDR`. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** The centre pixel of a PNG, decoded by the browser. */
async function pngCentre(page: Page, png: Buffer): Promise<Rgb> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const [r, g, b] = context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data
    return { r, g, b }
  }, png.toString('base64'))
}

/** The preview's composed frame at `time`: its centre pixel. */
async function previewCentre(page: Page, time: number): Promise<Rgb> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(time))
  return await pngCentre(page, await page.getByTestId('preview-frame').screenshot())
}

/** What Python's zipfile reads in the archive, or null where python3 is not installed. */
async function pythonZipfile(path: string): Promise<{ names: string[]; bad: string | null } | null> {
  const script = [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'print(json.dumps({"names": z.namelist(), "bad": z.testzip()}))',
  ].join('\n')
  try {
    const { stdout } = await promisify(execFile)('python3', ['-c', script, path])
    return JSON.parse(stdout) as { names: string[]; bad: string | null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

test('the enabled More export formats plugin exports a PNG image sequence at the dialog’s rate and size', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  // Two slates, 1 s each, in clearly different colours: the visible change.
  await chooseFromAddMenu(page, ADD_SLATE)
  await chooseFromAddMenu(page, ADD_SLATE)
  for (const [position, color] of [
    [1, RED],
    [2, BLUE],
  ] as const) {
    const duration = page.getByRole('spinbutton', {
      name: `Duration of Color slate at position ${position} in seconds`,
    })
    await duration.fill('1')
    await duration.blur()
    await page.getByLabel(`Color of Color slate at position ${position}`).fill(color)
  }

  // With the plugin off, the format is not offered.
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await expect(page.getByRole('radio', { name: 'WebM', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'PNG image sequence (ZIP)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable More export formats' }).click()
  await expect(page.getByRole('button', { name: 'Disable More export formats' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'PNG image sequence (ZIP)' }).check()
  await expect(page.getByText('one per frame at the Frame rate and Frame size below')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Export size limit' })).toHaveCount(0)
  // The Frame size and Frame rate stay: this format follows them.
  await page.getByRole('spinbutton', { name: 'Export width in pixels' }).fill(String(WIDTH))
  await page.getByRole('spinbutton', { name: 'Export height in pixels' }).fill(String(HEIGHT))
  await page.getByRole('spinbutton', { name: 'Export frame rate in frames per second' }).fill(String(FPS))
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.zip')
  const path = (await download.path()) as string
  const bytes = await readFile(path)

  // 1. The archive: stored, named in order, no gap.
  const files = walkZip(bytes)
  expect(files.map((file) => file.name)).toEqual(
    files.map((_, index) => `frame-${String(index + 1).padStart(5, '0')}.png`),
  )
  for (const file of files) expect(file.method, `${file.name} is stored`).toBe(0)

  // 2. rate × duration frames, within one, each at the export's frame size.
  console.log(`[${browserName}] PNG sequence: ${files.length} frames in ${bytes.length} bytes`)
  expect(files.length).toBeGreaterThanOrEqual(2 * FPS - 1)
  expect(files.length).toBeLessThanOrEqual(2 * FPS + 1)
  for (const file of files) expect(pngSize(file.data), file.name).toEqual({ width: WIDTH, height: HEIGHT })

  // 3. Preview parity at 0.5 s and 1.5 s: frame n shows tick n − 1.
  const red = await previewCentre(page, 0.5)
  const blue = await previewCentre(page, 1.5)
  // The two slates really are two colours, so an exact match means the right frame.
  expect(red.r).toBeGreaterThan(blue.r + 100)
  expect(blue.b).toBeGreaterThan(red.b + 100)
  expect(await pngCentre(page, files[0.5 * FPS].data), 'the frame at 0.5 s against the preview').toEqual(red)
  expect(await pngCentre(page, files[1.5 * FPS].data), 'the frame at 1.5 s against the preview').toEqual(blue)

  // 4. Python's zipfile, where it is installed.
  const python = await pythonZipfile(path)
  console.log(`[${browserName}] python zipfile: ${python === null ? 'not installed, skipped' : `${python.names.length} names, testzip ${python.bad}`}`)
  if (python !== null) {
    expect(python.names).toEqual(files.map((file) => file.name))
    expect(python.bad, 'every CRC is correct').toBeNull()
  }
})
