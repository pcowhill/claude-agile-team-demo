import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * The More export formats plugin's Animated WebP, end to end (#858): enable
 * the plugin through the manager (the real lazy chunk, fetched over the dev
 * server), export a 2 s two-slate timeline, and judge the downloaded file
 * three ways:
 *
 * 1. **Its container**, by walking the RIFF chunks the way `webpinfo` lists
 *    them: `VP8X` with the animation flag, `ANIM`, one `ANMF` per frame,
 *    each frame's size and duration.
 * 2. **A real decoder.** Where the browser has `ImageDecoder` (Chromium),
 *    the browser's own WebP decoder — libwebp, not this plugin's code —
 *    reads the file and reports its frame count, size and frame durations.
 *    Without it (Firefox), `createImageBitmap` decodes the first frame.
 * 3. **Preview parity.** A decoded frame's centre pixel matches the
 *    preview's composed frame at the same time, within a tolerance for the
 *    lossy encode.
 */

const RED = '#c03020'
const BLUE = '#2050d0'

/** The plugin's stated limits (`src/plugins/moreFormatsLimits.ts`). */
const FPS = 10
const MAX_PX = 480

/**
 * Per channel, how far a decoded WebP pixel may sit from the preview's.
 * Lossy WebP stores colour at half resolution in YUV 4:2:0 and quantizes
 * it, so a flat colour comes back a few levels off. Measured on this spec's
 * slates in Chromium at quality 0.8, three runs: at most 1 level. The two slates
 * differ by more than 100 levels in red and in blue, so 16 still tells
 * them apart with a wide margin.
 */
const TOLERANCE = 16

interface Rgb {
  r: number
  g: number
  b: number
}

/** The chunks of an animated WebP, read the way `webpinfo` lists them. */
function walkWebp(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8)
  expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP')
  const ids: string[] = []
  let flags = -1
  let canvas = { width: 0, height: 0 }
  const frames: { width: number; height: number; durationMs: number; bitstream: string }[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('latin1')
    const size = bytes.readUInt32LE(offset + 4)
    const at = offset + 8
    ids.push(id)
    if (id === 'VP8X') {
      flags = bytes[at]
      canvas = { width: bytes.readUIntLE(at + 4, 3) + 1, height: bytes.readUIntLE(at + 7, 3) + 1 }
    }
    if (id === 'ANMF') {
      frames.push({
        width: bytes.readUIntLE(at + 6, 3) + 1,
        height: bytes.readUIntLE(at + 9, 3) + 1,
        durationMs: bytes.readUIntLE(at + 12, 3),
        // The frame's own first sub-chunk: its bitstream (or its ALPH).
        bitstream: bytes.subarray(at + 16, at + 20).toString('latin1'),
      })
    }
    offset = at + size + (size % 2)
  }
  expect(offset, 'the chunks fill the file exactly').toBe(bytes.length)
  return { ids, flags, canvas, frames }
}

/** What the browser's own decoder reports, plus the centre pixel of the frames showing at `times`. */
async function decodeWebp(page: Page, bytes: Buffer, times: number[]) {
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
      if (typeof ImageDecoder === 'undefined') {
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/webp' }))
        return {
          decoder: 'createImageBitmap' as const,
          width: bitmap.width,
          height: bitmap.height,
          frameCount: null,
          durationsMs: null,
          samples: [{ time: 0, pixel: centre(bitmap, bitmap.width, bitmap.height) }],
        }
      }
      const decoder = new ImageDecoder({ data, type: 'image/webp' })
      await decoder.tracks.ready
      await decoder.completed
      const track = decoder.tracks.selectedTrack!
      const durationsMs: number[] = []
      const starts: number[] = []
      let width = 0
      let height = 0
      let clock = 0
      for (let index = 0; index < track.frameCount; index += 1) {
        const { image } = await decoder.decode({ frameIndex: index })
        starts.push(clock)
        durationsMs.push((image.duration ?? 0) / 1000)
        clock += (image.duration ?? 0) / 1000
        width = image.displayWidth
        height = image.displayHeight
        image.close()
      }
      const samples = []
      for (const time of times) {
        // The frame showing at `time`: the last one starting at or before it.
        const index = starts.filter((start) => start <= time * 1000).length - 1
        const { image } = await decoder.decode({ frameIndex: index })
        samples.push({ time, pixel: centre(image, image.displayWidth, image.displayHeight) })
        image.close()
      }
      decoder.close()
      return {
        decoder: 'ImageDecoder' as const,
        width,
        height,
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
    const [r, g, b] = context.getImageData(
      Math.floor(bitmap.width / 2),
      Math.floor(bitmap.height / 2),
      1,
      1,
    ).data
    return { r, g, b }
  }, png.toString('base64'))
}

function expectClose(actual: Rgb, expected: Rgb, where: string) {
  for (const channel of ['r', 'g', 'b'] as const) {
    expect(Math.abs(actual[channel] - expected[channel]), `${where}: ${channel} ${actual[channel]} vs ${expected[channel]}`).toBeLessThanOrEqual(TOLERANCE)
  }
}

test('the enabled More export formats plugin exports a slate timeline as a valid animated WebP', async ({
  page,
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
  await expect(page.getByRole('radio', { name: 'Animated WebP' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable More export formats' }).click()
  await expect(page.getByRole('button', { name: 'Disable More export formats' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated WebP' }).check()
  // The format states its limits under the Format group.
  await expect(page.getByText(`samples at ${FPS} fps, scaled down to at most ${MAX_PX} px`)).toBeVisible()
  // An encoder of its own: no Size limit to offer (the GIF and MP3 rule).
  await expect(page.getByRole('combobox', { name: 'Export size limit' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.webp')
  const bytes = await readFile((await download.path()) as string)

  // 1. The container.
  const webp = walkWebp(bytes)
  expect(webp.ids.slice(0, 2)).toEqual(['VP8X', 'ANIM'])
  expect(webp.ids.slice(2).every((id) => id === 'ANMF')).toBe(true)
  expect(webp.flags & 0x02, 'VP8X animation flag').toBe(0x02)
  // A slate-only timeline exports at the dialog's Auto size, 640×360, which
  // the plugin's cap scales to exactly 480×270.
  expect(webp.canvas).toEqual({ width: 480, height: 270 })
  // 2 s at 10 fps is 20 frames; within one frame either way.
  expect(webp.frames.length).toBeGreaterThanOrEqual(19)
  expect(webp.frames.length).toBeLessThanOrEqual(21)
  for (const frame of webp.frames) {
    expect({ width: frame.width, height: frame.height }).toEqual(webp.canvas)
    // Every frame lasts a whole number of 100 ms ticks: one, or more where
    // the real-time pipeline skipped a tick and the frame before it holds.
    expect(frame.durationMs % (1000 / FPS)).toBe(0)
    expect(frame.durationMs).toBeGreaterThan(0)
    expect(['VP8 ', 'VP8L', 'ALPH']).toContain(frame.bitstream)
  }
  const totalMs = webp.frames.reduce((sum, frame) => sum + frame.durationMs, 0)
  expect(totalMs).toBeGreaterThanOrEqual(1900)
  expect(totalMs).toBeLessThanOrEqual(2100)

  // 2. A real decoder, and 3. the preview at the same times.
  const times = [0.5, 1.5]
  const decoded = await decodeWebp(page, bytes, times)
  expect({ width: decoded.width, height: decoded.height }).toEqual(webp.canvas)
  if (decoded.decoder === 'ImageDecoder') {
    expect(decoded.animated).toBe(true)
    expect(decoded.repetitionCount).toBe(Infinity)
    expect(decoded.frameCount).toBe(webp.frames.length)
    expect(decoded.durationsMs).toEqual(webp.frames.map((frame) => frame.durationMs))
  }
  for (const sample of decoded.samples) {
    const preview = await previewCentre(page, sample.time)
    expectClose(sample.pixel, preview, `WebP at ${sample.time} s against the preview`)
  }
  if (decoded.decoder === 'ImageDecoder') {
    // The two samples really are the two slates, not one colour twice.
    expect(decoded.samples[0].pixel.r).toBeGreaterThan(decoded.samples[1].pixel.r + 100)
    expect(decoded.samples[1].pixel.b).toBeGreaterThan(decoded.samples[0].pixel.b + 100)
  }
})
