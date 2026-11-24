import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The More export formats plugin's Animated PNG, end to end (#864). It
 * enables the plugin through the manager (the real lazy chunk), exports a
 * 2 s two-slate timeline, and judges the downloaded file four ways:
 *
 * 1. **Its chunks**, walked the way the APNG specification lays them out:
 *    `IHDR`, `acTL` (frame count, loop count), then per frame an `fcTL`
 *    (size, delay) and its image data.
 * 2. **The browser's own decoder.** Where `ImageDecoder` reads PNG, it
 *    reports the frame count, size, loop count and frame durations.
 * 3. **Preview parity, exactly.** PNG is lossless, so a decoded frame's
 *    centre pixel equals the preview's composed frame at the same time.
 * 4. **FFmpeg**, where `ffprobe` is installed: it reads the file as APNG,
 *    with the same frame count, size and loop count. It is not installed
 *    on every machine that runs this spec, so its absence is logged rather
 *    than failed; the chunk walk and the browser's decoder still judge.
 */

const RED = '#c03020'
const BLUE = '#2050d0'

/** The plugin's stated limits (`src/plugins/moreFormatsLimits.ts`). */
const FPS = 10
const MAX_PX = 480

interface Rgb {
  r: number
  g: number
  b: number
}

/** The chunks of an APNG: canvas size, frame and play counts, and each frame's control. */
function walkApng(bytes: Buffer) {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const types: string[] = []
  let canvas = { width: 0, height: 0 }
  let animation = { frames: -1, plays: -1 }
  const frames: { width: number; height: number; x: number; y: number; delayMs: number }[] = []
  const sequence: number[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1')
    const at = offset + 8
    types.push(type)
    if (type === 'IHDR') canvas = { width: bytes.readUInt32BE(at), height: bytes.readUInt32BE(at + 4) }
    if (type === 'acTL') animation = { frames: bytes.readUInt32BE(at), plays: bytes.readUInt32BE(at + 4) }
    if (type === 'fcTL' || type === 'fdAT') sequence.push(bytes.readUInt32BE(at))
    if (type === 'fcTL') {
      frames.push({
        width: bytes.readUInt32BE(at + 4),
        height: bytes.readUInt32BE(at + 8),
        x: bytes.readUInt32BE(at + 12),
        y: bytes.readUInt32BE(at + 16),
        delayMs: (bytes.readUInt16BE(at + 20) * 1000) / bytes.readUInt16BE(at + 22),
      })
    }
    offset = at + length + 4
  }
  expect(offset, 'the chunks fill the file exactly').toBe(bytes.length)
  return { types, canvas, animation, frames, sequence }
}

/**
 * What the browser's own decoder reports for the file, plus the centre
 * pixel of the frames showing at `times`. Each frame is decoded once, in
 * order, and sampled during that pass, as `export-webp.spec.ts` does for
 * the reason it gives (Firefox's ImageDecoder, #858).
 */
async function decodeApng(page: Page, bytes: Buffer, times: number[]) {
  return await page.evaluate(
    async ({ base64, times }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const centre = (source: CanvasImageSource, width: number, height: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.drawImage(source, 0, 0)
        const [r, g, b] = context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data
        return { r, g, b }
      }
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }))
      const firstFrame = centre(bitmap, bitmap.width, bitmap.height)
      const supported =
        typeof ImageDecoder !== 'undefined' && (await ImageDecoder.isTypeSupported('image/png'))
      if (!supported) {
        return {
          decoder: 'createImageBitmap' as const,
          firstFrame,
          width: bitmap.width,
          height: bitmap.height,
          frameCount: null,
          animated: null,
          repetitionCount: null,
          durationsMs: null,
          samples: [] as { time: number; pixel: ReturnType<typeof centre> }[],
        }
      }
      const decoder = new ImageDecoder({ data, type: 'image/png' })
      await decoder.tracks.ready
      await decoder.completed
      const track = decoder.tracks.selectedTrack!
      const durationsMs: number[] = []
      const samples: { time: number; pixel: ReturnType<typeof centre> }[] = []
      let clock = 0
      for (let index = 0; index < track.frameCount; index += 1) {
        const { image } = await decoder.decode({ frameIndex: index })
        const duration = (image.duration ?? 0) / 1000
        for (const time of times) {
          if (time * 1000 >= clock && time * 1000 < clock + duration) {
            samples.push({ time, pixel: centre(image, image.displayWidth, image.displayHeight) })
          }
        }
        durationsMs.push(duration)
        clock += duration
        image.close()
      }
      decoder.close()
      return {
        decoder: 'ImageDecoder' as const,
        firstFrame,
        width: bitmap.width,
        height: bitmap.height,
        frameCount: track.frameCount,
        animated: track.animated,
        repetitionCount: track.repetitionCount,
        durationsMs,
        samples,
      }
    },
    { base64: bytes.toString('base64'), times },
  )
}

/** The preview's composed frame at `time`: its centre pixel. */
async function previewCentre(page: Page, time: number): Promise<Rgb> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(time))
  const png = await page.getByTestId('preview-frame').screenshot()
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

/** What `ffprobe` reads in the file, or null where it is not installed. */
async function probe(path: string) {
  try {
    const { stdout } = await promisify(execFile)('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=format_name',
      '-of',
      'json',
      path,
    ])
    return JSON.parse(stdout) as {
      streams: { codec_name: string; width: number; height: number; nb_read_frames: string }[]
      format: { format_name: string }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

test('the enabled More export formats plugin exports a slate timeline as a valid, lossless APNG', async ({
  page,
  browserName,
}) => {
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
  await expect(page.getByRole('radio', { name: 'Animated PNG (APNG)' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable More export formats' }).click()
  await expect(page.getByRole('button', { name: 'Disable More export formats' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated PNG (APNG)' }).check()
  await expect(page.getByText(`samples at ${FPS} fps, scaled down to at most ${MAX_PX} px`)).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Export size limit' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.png')
  const path = (await download.path()) as string
  const bytes = await readFile(path)

  // 1. The chunks.
  const apng = walkApng(bytes)
  expect(apng.types.slice(0, 2)).toEqual(['IHDR', 'acTL'])
  expect(apng.types.at(-1)).toBe('IEND')
  // A slate-only timeline exports at the dialog's Auto size, 640×360, which
  // the plugin's cap scales to exactly 480×270.
  expect(apng.canvas).toEqual({ width: 480, height: 270 })
  // 2 s at 10 fps is 20 frames; within one frame either way.
  expect(apng.animation.frames).toBeGreaterThanOrEqual(19)
  expect(apng.animation.frames).toBeLessThanOrEqual(21)
  expect(apng.frames).toHaveLength(apng.animation.frames)
  expect(apng.animation.plays, 'loops forever').toBe(0)
  expect(apng.sequence).toEqual(apng.sequence.map((_, index) => index))
  for (const frame of apng.frames) {
    expect(frame).toMatchObject({ ...apng.canvas, x: 0, y: 0 })
    // Every frame lasts a whole number of 100 ms ticks: one, or more where
    // the real-time pipeline skipped a tick and the frame before it holds.
    expect(frame.delayMs % (1000 / FPS)).toBe(0)
    expect(frame.delayMs).toBeGreaterThan(0)
  }
  const totalMs = apng.frames.reduce((sum, frame) => sum + frame.delayMs, 0)
  expect(totalMs).toBeGreaterThanOrEqual(1900)
  expect(totalMs).toBeLessThanOrEqual(2100)

  // 2. The browser's decoder, and 3. the preview at the same times.
  const times = [0.5, 1.5]
  const decoded = await decodeApng(page, bytes, times)
  console.log(
    `[${browserName}] APNG of ${bytes.length} bytes decoded by ${decoded.decoder}: ` +
      `${decoded.frameCount} frames, samples ${JSON.stringify(decoded.samples)}`,
  )
  expect({ width: decoded.width, height: decoded.height }).toEqual(apng.canvas)
  const red = await previewCentre(page, 0.5)
  const blue = await previewCentre(page, 1.5)
  // The two slates really are two colours, so an exact match means the right frame.
  expect(red.r).toBeGreaterThan(blue.r + 100)
  expect(blue.b).toBeGreaterThan(red.b + 100)
  expect(decoded.firstFrame, 'the first frame, as any PNG reader shows it').toEqual(await previewCentre(page, 0))
  if (decoded.decoder === 'ImageDecoder') {
    expect(decoded.animated).toBe(true)
    expect(decoded.repetitionCount).toBe(Infinity)
    expect(decoded.frameCount).toBe(apng.frames.length)
    expect(decoded.durationsMs).toEqual(apng.frames.map((frame) => frame.delayMs))
    expect(decoded.samples.map((sample) => sample.time)).toEqual(times)
    expect(decoded.samples[0].pixel, 'APNG at 0.5 s against the preview').toEqual(red)
    expect(decoded.samples[1].pixel, 'APNG at 1.5 s against the preview').toEqual(blue)
  }

  // 4. FFmpeg, where it is installed.
  const probed = await probe(path)
  console.log(`[${browserName}] ffprobe: ${probed === null ? 'not installed, skipped' : JSON.stringify(probed)}`)
  if (probed !== null) {
    expect(probed.format.format_name).toBe('apng')
    expect(probed.streams).toHaveLength(1)
    expect(probed.streams[0]).toMatchObject({ codec_name: 'apng', ...apng.canvas })
    expect(Number(probed.streams[0].nb_read_frames)).toBe(apng.frames.length)
  }
})
