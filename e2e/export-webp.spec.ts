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

/**
 * A reference animated WebP made by libwebp's own animation encoder, the
 * control for the decoder check below: `ffmpeg -f lavfi -i
 * "color=c=0xc03020:s=64x36:r=10:d=0.5" -f lavfi -i
 * "color=c=0x2050d0:s=64x36:r=10:d=0.5" -filter_complex
 * "[0][1]concat=n=2:v=1" -c:v libwebp_anim -lossless 0 -quality 80 -loop 0`
 * (FFmpeg 6.1.1). libwebp merges the identical frames: two frames, red for
 * 0.5 s, then blue.
 */
const REFERENCE_ANIMATION = 'e2e/fixtures/reference-anim.webp'

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

/**
 * What the browser's own decoder reports for an animated WebP, plus the
 * centre pixel of the frames showing at `times`. Each frame is decoded
 * once, in order, and sampled during that pass: Firefox's `ImageDecoder`
 * handed back frames with no pixels ("No media resource in VideoFrame")
 * when an index was decoded a second time, and read every frame in one
 * pass (#858, CI runs 45272145766 and 45277109106). Also: whether an `<img>`
 * displays the file (decoded, at its own size), and its first frame as an
 * `<img>` reads it.
 *
 * A decoded frame's pixels are read the first way the browser allows:
 * drawing the `VideoFrame` onto a canvas, then `createImageBitmap` of it,
 * then `copyTo` into an RGBA buffer. Each refusal is recorded, so a failure
 * names what the browser said instead of stopping at the first throw.
 */
async function decodeWebp(page: Page, bytes: Buffer, times: number[]) {
  return await page.evaluate(
    async ({ base64, times }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const blob = new Blob([data], { type: 'image/webp' })
      const errors: string[] = []
      const centre = (source: CanvasImageSource, width: number, height: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.drawImage(source, 0, 0)
        const [r, g, b] = context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data
        return { r, g, b }
      }
      const pixelOf = async (image: VideoFrame) => {
        const width = image.displayWidth
        const height = image.displayHeight
        try {
          return { via: 'drawImage', ...centre(image, width, height) }
        } catch (error) {
          errors.push(`drawImage: ${(error as Error).message}`)
        }
        try {
          const bitmap = await createImageBitmap(image)
          return { via: 'createImageBitmap', ...centre(bitmap, width, height) }
        } catch (error) {
          errors.push(`createImageBitmap: ${(error as Error).message}`)
        }
        try {
          const rect = { x: Math.floor(width / 2), y: Math.floor(height / 2), width: 1, height: 1 }
          const pixel = new Uint8Array(4)
          await image.copyTo(pixel, { rect, format: 'RGBA' } as VideoFrameCopyToOptions)
          return { via: 'copyTo', r: pixel[0], g: pixel[1], b: pixel[2] }
        } catch (error) {
          errors.push(`copyTo: ${(error as Error).message}`)
        }
        return null
      }

      // An <img> displays it: decoded, at the file's own size.
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.src = url
      let imgSize: { width: number; height: number } | null = null
      try {
        await img.decode()
        imgSize = { width: img.naturalWidth, height: img.naturalHeight }
      } catch (error) {
        errors.push(`<img>: ${(error as Error).message}`)
      } finally {
        URL.revokeObjectURL(url)
      }
      const bitmap = await createImageBitmap(blob)
      const firstFrame = { via: 'createImageBitmap', ...centre(bitmap, bitmap.width, bitmap.height) }

      if (typeof ImageDecoder === 'undefined') {
        return {
          decoder: 'createImageBitmap' as const,
          imgSize,
          errors,
          firstFrame,
          width: bitmap.width,
          height: bitmap.height,
          frameCount: null,
          animated: null,
          repetitionCount: null,
          durationsMs: null,
          samples: [] as { time: number; pixel: ReturnType<typeof centre> | null }[],
        }
      }
      const decoder = new ImageDecoder({ data, type: 'image/webp' })
      await decoder.tracks.ready
      await decoder.completed
      const track = decoder.tracks.selectedTrack!
      const durationsMs: number[] = []
      const samples: { time: number; pixel: ReturnType<typeof centre> | null }[] = []
      let width = 0
      let height = 0
      let clock = 0
      for (let index = 0; index < track.frameCount; index += 1) {
        const { image } = await decoder.decode({ frameIndex: index })
        const duration = (image.duration ?? 0) / 1000
        // Sampled now, for every requested time this frame is showing at.
        for (const time of times) {
          if (time * 1000 >= clock && time * 1000 < clock + duration) {
            samples.push({ time, pixel: await pixelOf(image) })
          }
        }
        durationsMs.push(duration)
        clock += duration
        width = image.displayWidth
        height = image.displayHeight
        image.close()
      }
      decoder.close()
      return {
        decoder: 'ImageDecoder' as const,
        imgSize,
        errors,
        firstFrame,
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
  // Which decoder and pixel path this browser took, for a reader of the CI log.
  console.log(
    `[${browserName}] WebP decoded by ${decoded.decoder}: ${decoded.frameCount} frames, ` +
      `<img> ${JSON.stringify(decoded.imgSize)}, samples ${JSON.stringify(decoded.samples)}, ` +
      `refusals ${JSON.stringify(decoded.errors)}`,
  )
  expect(decoded.imgSize, 'an <img> displays the file').toEqual(webp.canvas)
  expect({ width: decoded.width, height: decoded.height }).toEqual(webp.canvas)
  if (decoded.decoder === 'ImageDecoder') {
    expect(decoded.animated).toBe(true)
    expect(decoded.repetitionCount).toBe(Infinity)
    expect(decoded.frameCount).toBe(webp.frames.length)
    expect(decoded.durationsMs).toEqual(webp.frames.map((frame) => frame.durationMs))
    expect(decoded.samples.map((sample) => sample.time)).toEqual(times)
  }

  const readable = decoded.decoder === 'ImageDecoder' && decoded.samples.every((sample) => sample.pixel !== null)
  if (decoded.decoder === 'ImageDecoder' && !readable) {
    // Only a decoder that yields no pixels for animated WebP at all excuses
    // this file's frames being unreadable. The control is a reference
    // animation from libwebp's own encoder (FFmpeg's libwebp_anim, red then
    // blue), read by exactly the same procedure: if this browser reads its
    // frames, the fault is this file's.
    const reference = await decodeWebp(page, await readFile(REFERENCE_ANIMATION), [0.25, 0.75])
    console.log(`[${browserName}] reference animation: ${JSON.stringify(reference.samples)}, refusals ${JSON.stringify(reference.errors)}`)
    expect(
      reference.samples.every((sample) => sample.pixel === null),
      `this browser reads libwebp's reference animation but not this file's frames: ${decoded.errors.join('; ')}`,
    ).toBe(true)
  }
  if (!readable) {
    // Parity is then judged on the first frame, read as an <img> reads it.
    expectClose(decoded.firstFrame, await previewCentre(page, 0), 'WebP first frame against the preview at 0 s')
    return
  }
  const pixels = decoded.samples.map((sample) => sample.pixel!)
  for (const [index, sample] of decoded.samples.entries()) {
    expectClose(pixels[index], await previewCentre(page, sample.time), `WebP at ${sample.time} s against the preview`)
  }
  // The two samples really are the two slates, not one colour twice.
  expect(pixels[0].r).toBeGreaterThan(pixels[1].r + 100)
  expect(pixels[1].b).toBeGreaterThan(pixels[0].b + 100)
})
