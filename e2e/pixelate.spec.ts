import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { openPicture } from './pictureDisclosure'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'
import type { PictureFilter } from '../src/lib/pictureEffect'

/**
 * The `pixelate` picture filter (#871): the picture downscaled into a grid
 * of columns × rows and stretched back over the card with smoothing off,
 * so every block is one colour. The export draws it (step 3b(i)) and so
 * does the preview's canvas (step 3b(ii)), which is read against saved
 * frames block by block. The filter's own describes register a test-only
 * definition into the running app's registry through the dev server's own
 * module URL, as `slices.spec.ts` does, and add it from + Effect ▾ like
 * any other; the Visual effects plugin's Pixelate (step 3c), which ships
 * the kind with a Block size, has a describe of its own.
 *
 * The source is #871's step 3a picture: red ramps across, green down, and
 * blue is a diagonal ripple, so every block has a colour of its own and a
 * block drawn from its neighbour's pixels reads wrong.
 */

const STILL = 'ramp.png'
const POSITION = `${STILL} at position 1`
const SOURCE = { width: 1920, height: 1080 }
const EFFECT_NAME = 'Test pixelate'

/**
 * What a saved frame is checked for, computed in the page from the PNG:
 * - `uniform`: blocks whose interior, one px in from each of the grid's
 *   edges, is a single colour, of `blocks`;
 * - `matching`: blocks whose interior is within `LEVELS` of the source
 *   downscaled to the same grid in the page, of `blocks`; and the worst
 *   channel difference seen, `worst`.
 */
interface BlockReading {
  width: number
  height: number
  blocks: number
  uniform: number
  matching: number
  worst: number
}

/** A channel difference allowed against the page's own downscale: colour handling between the two canvases. */
const LEVELS = 3

async function makeRamp(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((source) => {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(source.width, source.height)
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const at = (y * source.width + x) * 4
        image.data[at] = Math.round((x / (source.width - 1)) * 255)
        image.data[at + 1] = Math.round((y / (source.height - 1)) * 255)
        image.data[at + 2] = Math.round(127.5 + 127.5 * Math.sin((x + y) / 40))
        image.data[at + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  }, SOURCE)
  return Buffer.from(base64, 'base64')
}

/** The still on the timeline for 4 s, with a test pixelate of `block` (a fraction of the frame width) over 0–2 s. */
async function setup(page: Page, block: number, extra: readonly PictureFilter[] = []): Promise<Buffer> {
  await page.goto('./')
  const ramp = await makeRamp(page)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: ramp }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  await page.evaluate(
    async ({ name, block, extra }) => {
      const url = new URL('src/lib/pictureEffect.ts', document.baseURI).href
      const module = (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/pictureEffect')
      module.pictureEffectRegistry.register({
        id: 'test-pixelate',
        name,
        params: [],
        look: (_params, weight) => ({
          filters: [...extra, { kind: 'pixelate', block: block * weight }],
          layers: [],
        }),
      })
    },
    { name: EFFECT_NAME, block, extra },
  )
  await chooseEffect(page, POSITION, EFFECT_NAME)
  return ramp
}

async function savedFrameAt(page: Page, seconds: number, label: string): Promise<Buffer> {
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill(String(seconds))
  const image = page.getByTestId('preview-image')
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete)).toBe(true)
  const downloadPromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const saved = await readFile((await (await downloadPromise).path())!)
  await test.info().attach(`saved frame (${label})`, { body: saved, contentType: 'image/png' })
  return saved
}

/**
 * Reads `frame` as a `columns` × `rows` grid of blocks over its whole
 * width and height, against `expected`, a PNG downscaled in the page to
 * the same grid the way the export does (`drawImage` with smoothing on).
 */
async function readBlocks(
  page: Page,
  frame: Buffer,
  expected: Buffer,
  grid: { columns: number; rows: number },
): Promise<BlockReading> {
  return await page.evaluate(
    async ({ frame, expected, grid, levels }) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
        // ImageData's fields are getters, which a spread would not copy.
        return { canvas, data: image.data, width: image.width, height: image.height }
      }
      const saved = await pixels(frame)
      const source = await pixels(expected)
      const small = document.createElement('canvas')
      small.width = grid.columns
      small.height = grid.rows
      const smallCtx = small.getContext('2d')!
      smallCtx.imageSmoothingEnabled = true
      smallCtx.drawImage(source.canvas, 0, 0, source.width, source.height, 0, 0, grid.columns, grid.rows)
      const buffer = smallCtx.getImageData(0, 0, grid.columns, grid.rows).data
      const { data, width, height } = saved
      const blockWidth = width / grid.columns
      const blockHeight = height / grid.rows
      let uniform = 0
      let matching = 0
      let worst = 0
      for (let row = 0; row < grid.rows; row++) {
        for (let column = 0; column < grid.columns; column++) {
          const x0 = Math.ceil(column * blockWidth) + 1
          const x1 = Math.floor((column + 1) * blockWidth) - 2
          const y0 = Math.ceil(row * blockHeight) + 1
          const y1 = Math.floor((row + 1) * blockHeight) - 2
          const first = (y0 * width + x0) * 4
          const want = (row * grid.columns + column) * 4
          let same = true
          let close = true
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const at = (y * width + x) * 4
              for (let channel = 0; channel < 3; channel++) {
                if (data[at + channel] !== data[first + channel]) same = false
                const off = Math.abs(data[at + channel] - buffer[want + channel])
                if (off > worst) worst = off
                if (off > levels) close = false
              }
            }
          }
          if (same) uniform += 1
          if (close) matching += 1
        }
      }
      return { width, height, blocks: grid.columns * grid.rows, uniform, matching, worst }
    },
    { frame: frame.toString('base64'), expected: expected.toString('base64'), grid, levels: LEVELS },
  )
}

/**
 * What the preview shows against a saved frame, read from a screenshot of
 * the preview's frame in device px over the same `columns` × `rows` grid:
 * - `uniform`: blocks whose interior, one device px in from each of the
 *   grid's edges, is a single colour, of `blocks` (#871's step 3a found
 *   the CSS stretch's edges within a device px of the grid's). The four
 *   corner blocks are not read: the preview frame's rounded corners cut
 *   them;
 * - `matching`: blocks whose interior is within `PREVIEW_LEVELS` of the
 *   saved frame's same block, read at its centre; and the worst channel
 *   difference seen, `worst`.
 */
async function previewBlocks(
  page: Page,
  preview: { png: Buffer; frame: { x: number; y: number; width: number; height: number } },
  saved: Buffer,
  grid: { columns: number; rows: number },
): Promise<BlockReading> {
  return await page.evaluate(
    async ({ preview, box, saved, grid, levels }) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
        return { data: image.data, width: image.width, height: image.height }
      }
      const shown = await pixels(preview)
      const frame = await pixels(saved)
      const { data, width } = shown
      // The frame's box inside the screenshot, which is clipped to whole px.
      const blockWidth = box.width / grid.columns
      const blockHeight = box.height / grid.rows
      let uniform = 0
      let matching = 0
      let worst = 0
      let blocks = 0
      for (let row = 0; row < grid.rows; row++) {
        for (let column = 0; column < grid.columns; column++) {
          // The preview frame's rounded corners cut its four corner blocks.
          const corner = (row === 0 || row === grid.rows - 1) && (column === 0 || column === grid.columns - 1)
          if (corner) continue
          blocks += 1
          const x0 = Math.ceil(box.x + column * blockWidth) + 1
          const x1 = Math.floor(box.x + (column + 1) * blockWidth) - 2
          const y0 = Math.ceil(box.y + row * blockHeight) + 1
          const y1 = Math.floor(box.y + (row + 1) * blockHeight) - 2
          const first = (y0 * width + x0) * 4
          const fx = Math.floor(((column + 0.5) * frame.width) / grid.columns)
          const fy = Math.floor(((row + 0.5) * frame.height) / grid.rows)
          const want = (fy * frame.width + fx) * 4
          let same = true
          let close = true
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const at = (y * width + x) * 4
              for (let channel = 0; channel < 3; channel++) {
                if (data[at + channel] !== data[first + channel]) same = false
                const off = Math.abs(data[at + channel] - frame.data[want + channel])
                if (off > worst) worst = off
                if (off > levels) close = false
              }
            }
          }
          if (same) uniform += 1
          if (close) matching += 1
        }
      }
      return { width: box.width, height: box.height, blocks, uniform, matching, worst }
    },
    {
      preview: preview.png.toString('base64'),
      box: preview.frame,
      saved: saved.toString('base64'),
      grid,
      levels: PREVIEW_LEVELS,
    },
  )
}

/**
 * A channel difference allowed between the preview's block and the saved
 * frame's. Both fill their grid through the export's own `pixelatedCard`
 * (#990), so they average the same pixels the same way and read 0 in both
 * browsers; the allowance is for colour handling between the preview's
 * canvas, the screenshot and the saved PNG.
 */
const PREVIEW_LEVELS = 4

/**
 * Reads the preview at `seconds` against the saved frame there, polling
 * until every block matches (the canvas paints on its own rAF loop), and
 * returns the last reading either way, for the assertions to report.
 */
async function previewAgainstSaved(
  page: Page,
  seconds: number,
  grid: { columns: number; rows: number },
  label: string,
): Promise<BlockReading> {
  const saved = await savedFrameAt(page, seconds, label)
  await expect(page.getByTestId('preview-pixelate')).toHaveAttribute('data-grid', `${grid.columns}x${grid.rows}`)
  const frame = page.getByTestId('preview-frame')
  // A screenshot clipped to whole px around the frame, and the frame's own
  // box inside it: a layout can place the frame at a fractional px.
  const shot = async () => {
    const box = (await frame.boundingBox())!
    const clip = {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.x + box.width) - Math.floor(box.x),
      height: Math.ceil(box.y + box.height) - Math.floor(box.y),
    }
    return {
      png: await page.screenshot({ clip }),
      frame: { x: box.x - clip.x, y: box.y - clip.y, width: box.width, height: box.height },
    }
  }
  let reading: BlockReading | undefined
  await expect
    .poll(
      async () => {
        reading = await previewBlocks(page, await shot(), saved, grid)
        return reading.uniform === reading.blocks && reading.matching === reading.blocks
      },
      { timeout: 10_000 },
    )
    .toBe(true)
    .catch(() => undefined)
  await test.info().attach(`preview (${label})`, { body: await frame.screenshot(), contentType: 'image/png' })
  return reading!
}

test.describe('Pixelate picture filter in the preview (#871, step 3b(ii))', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('the preview draws the saved frame\'s blocks, one colour each, and the plain picture after the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page, 15 / 1920)
    const grid = { columns: 128, rows: 72 }
    const inside = await previewAgainstSaved(page, 1, grid, 'inside the window')
    const image = page.getByTestId('preview-image')
    // The element plays on under the canvas, hidden and unfiltered.
    await expect(image).toHaveCSS('opacity', '0')
    await expect(image).toHaveCSS('filter', 'none')
    // After the window the canvas is gone and the element shows again.
    await page.getByRole('slider', { name: 'Seek within sequence' }).fill('3')
    await expect(page.getByTestId('preview-pixelate')).toHaveCount(0)
    await expect(image).toHaveCSS('opacity', '1')
    console.log(`[${testInfo.project.name}] pixelate preview, 15 px blocks: ${JSON.stringify(inside)}`)
    expect(inside.width, 'the preview frame read').toBeGreaterThan(900)
    expect(inside.uniform, 'blocks of one colour').toBe(inside.blocks)
    expect(inside.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(inside.blocks)
  })

  test('a block that does not divide the frame gives the export\'s rounded grid in the preview', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page, 50 / 1920)
    const grid = { columns: 38, rows: 22 }
    const inside = await previewAgainstSaved(page, 1, grid, '50 px blocks')
    console.log(`[${testInfo.project.name}] pixelate preview, 50 px blocks: ${JSON.stringify(inside)}`)
    expect(inside.uniform, 'blocks of one colour').toBe(inside.blocks)
    expect(inside.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(inside.blocks)
  })

  test('inside a zoom, the preview\'s blocks stay on the frame and match the saved frame\'s', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page, 15 / 1920)
    await chooseEffect(page, POSITION, 'Zoom')
    const grid = { columns: 128, rows: 72 }
    const zoomed = await previewAgainstSaved(page, 1, grid, 'zoomed')
    console.log(`[${testInfo.project.name}] pixelate preview, zoomed: ${JSON.stringify(zoomed)}`)
    expect(zoomed.uniform, 'blocks of one colour on the frame grid').toBe(zoomed.blocks)
    expect(zoomed.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(zoomed.blocks)
  })

  test('on a still turned a quarter and flipped, the preview\'s blocks match the saved frame\'s', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    // A portrait frame shows about 210 px wide here, so the blocks are
    // larger than the other tests' to leave each an interior to read:
    // 60 px of a 1920 frame's width, 1/32 of the turned frame's 1080, so
    // 32 columns and 1920 / 33.75 = 56.9 rows, rounded to 57.
    await setup(page, 60 / 1920)
    await openPicture(page, POSITION)
    await page
      .getByRole('button', { name: `Rotate ${POSITION} 90 degrees clockwise (currently 0 degrees)` })
      .click()
    await page.getByRole('checkbox', { name: `Flip ${POSITION} horizontally` }).check()
    await expect(page.getByTestId('preview-image')).toHaveCSS('transform', /matrix/)
    const grid = { columns: 32, rows: 57 }
    const turned = await previewAgainstSaved(page, 1, grid, 'turned and flipped')
    console.log(`[${testInfo.project.name}] pixelate preview, turned and flipped: ${JSON.stringify(turned)}`)
    expect(turned.uniform, 'blocks of one colour').toBe(turned.blocks)
    expect(turned.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(turned.blocks)
  })

  test('another filter in the look applies to the blocks, as in the export', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await setup(page, 15 / 1920, [{ kind: 'brightness', amount: 0.5 }])
    const grid = { columns: 128, rows: 72 }
    const darkened = await previewAgainstSaved(page, 1, grid, 'with brightness 0.5')
    console.log(`[${testInfo.project.name}] pixelate preview, with brightness 0.5: ${JSON.stringify(darkened)}`)
    expect(darkened.uniform, 'blocks of one colour').toBe(darkened.blocks)
    expect(darkened.matching, `blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(darkened.blocks)
  })
})

/**
 * The Visual effects plugin's Pixelate (#871, step 3c), added from
 * + Effect ▾ onto the ramp for 4 s: its default window is 0–2 s.
 */
async function setupPixelate(page: Page): Promise<Buffer> {
  await page.goto('./')
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await page.getByRole('button', { name: 'Enable Visual effects' }).click()
  await expect(page.getByRole('button', { name: 'Disable Visual effects' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  const ramp = await makeRamp(page)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: STILL, mimeType: 'image/png', buffer: ramp }])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
  await duration.fill('4')
  await duration.blur()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:04')
  await chooseEffect(page, POSITION, 'Pixelate')
  return ramp
}

const BLOCK_SIZE = `Pixelate 1 block size of ${POSITION} in pixels`

async function setBlockSize(page: Page, size: number) {
  const field = page.getByRole('spinbutton', { name: BLOCK_SIZE })
  await field.fill(String(size))
  await field.blur()
  await expect(field).toHaveValue(String(size))
}

test.describe('Pixelate, the Visual effects plugin\'s effect (#871, step 3c)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('+ Effect ▾ adds it at Block size 20: the preview and a saved frame draw the same 96 × 54 blocks, 38 × 22 at 50, and neither pixelates after the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const ramp = await setupPixelate(page)
    await expect(page.getByRole('spinbutton', { name: BLOCK_SIZE })).toHaveValue('20')
    await expect(page.getByRole('spinbutton', { name: `Pixelate 1 end of ${POSITION} in seconds` })).toHaveValue('2')

    // The default: 20 px blocks of a 1920 frame, 96 × 54 exactly. 1 s is
    // inside the window, at full weight.
    const grid20 = { columns: 96, rows: 54 }
    const saved20 = await readBlocks(page, await savedFrameAt(page, 1, 'Block size 20'), ramp, grid20)
    const preview20 = await previewAgainstSaved(page, 1, grid20, 'Block size 20')
    await page
      .getByTestId('preview-frame')
      .screenshot({ path: testInfo.outputPath('pixelate-block-size-20.png') })

    // 50 px does not divide the frame: 38.4 × 21.6 round to 38 × 22.
    await setBlockSize(page, 50)
    const grid50 = { columns: 38, rows: 22 }
    const saved50 = await readBlocks(page, await savedFrameAt(page, 1, 'Block size 50'), ramp, grid50)
    const preview50 = await previewAgainstSaved(page, 1, grid50, 'Block size 50')

    // After the window: the plain picture in both.
    const savedAfter = await readBlocks(page, await savedFrameAt(page, 3, 'after the window'), ramp, grid20)
    await expect(page.getByTestId('preview-pixelate')).toHaveCount(0)
    await expect(page.getByTestId('preview-image')).toHaveCSS('opacity', '1')
    console.log(
      `[${testInfo.project.name}] pixelate effect: ${JSON.stringify({ saved20, preview20, saved50, preview50, savedAfter })}`,
    )

    for (const [label, reading] of Object.entries({ saved20, saved50 })) {
      expect(reading.uniform, `${label}: blocks of one colour`).toBe(reading.blocks)
      expect(reading.matching, `${label}: blocks within ${LEVELS} levels of the page's downscale`).toBe(reading.blocks)
    }
    for (const [label, reading] of Object.entries({ preview20, preview50 })) {
      expect(reading.uniform, `${label}: blocks of one colour`).toBe(reading.blocks)
      expect(reading.matching, `${label}: blocks within ${PREVIEW_LEVELS} levels of the saved frame's`).toBe(
        reading.blocks,
      )
    }
    // After the window the ripple runs through every block: none is one colour.
    expect(savedAfter.uniform, 'saved frame after the window: blocks of one colour').toBe(0)
  })

  test('pushed out by a transition, the preview\'s blocks ride the outgoing card as the saved frame\'s do', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    await setupPixelate(page)
    await setBlockSize(page, 60)
    // The still for 2 s, its Pixelate to its end, then a 0.5 s push into a
    // red slate: the push runs over 1.5–2 s of the sequence.
    const duration = page.getByRole('spinbutton', { name: `Duration of ${POSITION} in seconds` })
    await duration.fill('2')
    await duration.blur()
    await expect(page.getByRole('spinbutton', { name: `Pixelate 1 end of ${POSITION} in seconds` })).toHaveValue('2')
    await chooseFromAddMenu(page, ADD_SLATE)
    await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
    await page.getByRole('combobox', { name: 'Transition type between position 1 and 2' }).selectOption('push-from-right')
    const transition = page.getByRole('spinbutton', { name: 'Transition duration between position 1 and 2 in seconds' })
    await transition.fill('0.5')
    await transition.blur()

    const frame = page.getByTestId('preview-frame')
    for (const seconds of [1.6, 1.75, 1.9]) {
      const saved = await savedFrameAt(page, seconds, `push at ${seconds} s`)
      await expect(page.getByTestId('preview-pixelate')).toHaveAttribute('data-grid', '32x18')
      // The preview against the saved frame, sampled every 7 px of the
      // saved frame and read at the same share of the preview's box, polled
      // until the canvas has painted.
      let reading: { samples: number; close: number; worst: number; red: number } | undefined
      await expect
        .poll(
          async () => {
            const box = (await frame.boundingBox())!
            const clip = {
              x: Math.floor(box.x),
              y: Math.floor(box.y),
              width: Math.ceil(box.x + box.width) - Math.floor(box.x),
              height: Math.ceil(box.y + box.height) - Math.floor(box.y),
            }
            const png = await page.screenshot({ clip })
            reading = await page.evaluate(
              async ({ png, saved, box }) => {
                const pixels = async (base64: string) => {
                  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
                  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
                  const canvas = document.createElement('canvas')
                  canvas.width = bitmap.width
                  canvas.height = bitmap.height
                  const ctx = canvas.getContext('2d')!
                  ctx.drawImage(bitmap, 0, 0)
                  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
                  return { data: image.data, width: image.width, height: image.height }
                }
                const shown = await pixels(png)
                const want = await pixels(saved)
                let samples = 0
                let close = 0
                let worst = 0
                let red = 0
                for (let y = 10; y < want.height - 10; y += 7) {
                  for (let x = 10; x < want.width - 10; x += 7) {
                    const px = Math.floor(box.x + ((x + 0.5) * box.width) / want.width)
                    const py = Math.floor(box.y + ((y + 0.5) * box.height) / want.height)
                    const at = (py * shown.width + px) * 4
                    const from = (y * want.width + x) * 4
                    let off = 0
                    for (let channel = 0; channel < 3; channel++) {
                      off = Math.max(off, Math.abs(shown.data[at + channel] - want.data[from + channel]))
                    }
                    samples += 1
                    if (off <= 8) close += 1
                    if (off > worst) worst = off
                    if (want.data[from] === 255 && want.data[from + 1] === 0 && want.data[from + 2] === 0) red += 1
                  }
                }
                return { samples, close, worst, red: red / samples }
              },
              {
                png: png.toString('base64'),
                saved: saved.toString('base64'),
                box: { x: box.x - clip.x, y: box.y - clip.y, width: box.width, height: box.height },
              },
            )
            return reading.close / reading.samples
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0.98)
        .catch(() => undefined)
      console.log(`[${testInfo.project.name}] pixelate mid-push at ${seconds} s: ${JSON.stringify(reading)}`)
      // The push is under way in the saved frame: the red slate fills a
      // growing share of it, from the right.
      expect(reading!.red, `push at ${seconds} s: the slate's share of the saved frame`).toBeGreaterThan(0.1)
      expect(reading!.red, `push at ${seconds} s: the slate's share of the saved frame`).toBeLessThan(0.9)
      // Block edges a sample can land either side of: 2 % of samples.
      expect(reading!.close / reading!.samples, `push at ${seconds} s: samples within 8 levels`).toBeGreaterThan(0.98)
    }
  })
})

test.describe('Pixelate picture filter in the export (#871, step 3b(i))', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('a saved frame is drawn in blocks of one colour each, the colour of the source downscaled to the same grid, and not after the window', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    // 15 px blocks of the 1920 frame: a 128 × 72 grid (`pixelateGrid`).
    const ramp = await setup(page, 15 / 1920)
    const grid = { columns: 128, rows: 72 }
    const inside = await readBlocks(page, await savedFrameAt(page, 1, 'inside the window'), ramp, grid)
    const after = await readBlocks(page, await savedFrameAt(page, 3, 'after the window'), ramp, grid)
    console.log(`[${testInfo.project.name}] pixelate, 15 px blocks: ${JSON.stringify({ inside, after })}`)

    expect(inside.width).toBe(SOURCE.width)
    expect(inside.uniform, 'blocks of one colour').toBe(inside.blocks)
    expect(inside.matching, `blocks within ${LEVELS} levels of the page's downscale`).toBe(inside.blocks)
    // After the window the ripple runs through every block: none is one colour.
    expect(after.uniform, 'blocks of one colour after the window').toBe(0)
  })

  test('a block that does not divide the frame is rounded to a whole grid whose blocks stretch to fill it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    // 50 px blocks: 38.4 columns and 21.6 rows round to 38 × 22, each block
    // about 50.5 × 49.1 px, with no partial block at the right or bottom.
    const ramp = await setup(page, 50 / 1920)
    const grid = { columns: 38, rows: 22 }
    const inside = await readBlocks(page, await savedFrameAt(page, 1, 'inside the window'), ramp, grid)
    console.log(`[${testInfo.project.name}] pixelate, 50 px blocks: ${JSON.stringify(inside)}`)
    expect(inside.uniform, 'blocks of one colour').toBe(inside.blocks)
    expect(inside.matching, `blocks within ${LEVELS} levels of the page's downscale`).toBe(inside.blocks)
  })

  test('on a still turned a quarter and flipped, the blocks are the turned picture downscaled, on the turned frame\'s grid', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    const ramp = await setup(page, 15 / 1920)
    await openPicture(page, POSITION)
    await page
      .getByRole('button', { name: `Rotate ${POSITION} 90 degrees clockwise (currently 0 degrees)` })
      .click()
    await page.getByRole('checkbox', { name: `Flip ${POSITION} horizontally` }).check()
    await expect(page.getByTestId('preview-image')).toHaveCSS('transform', /matrix/)
    // A turned still turns the frame: 1080 × 1920. The block is still 1/128
    // of the frame's width, now 8.4375 px, so 128 columns, and 1920 / 8.4375
    // = 227.6 rows round to 228.
    const grid = { columns: 128, rows: 228 }
    // The picture as the export turns and flips it, read after
    // the window: what the pixelated frame must be the downscale of. The
    // scratch takes the context's transform, so it turns the same way.
    const plain = await savedFrameAt(page, 3, 'turned and flipped, after the window')
    const turned = await readBlocks(page, await savedFrameAt(page, 1, 'turned and flipped'), plain, grid)
    const againstUnturned = await readBlocks(page, await savedFrameAt(page, 1, 'turned and flipped, again'), ramp, grid)
    console.log(`[${testInfo.project.name}] pixelate, turned and flipped: ${JSON.stringify({ turned, againstUnturned })}`)
    expect(turned.uniform, 'blocks of one colour').toBe(turned.blocks)
    expect(turned.matching, `blocks within ${LEVELS} levels of the turned picture's downscale`).toBe(turned.blocks)
    // And not the un-turned source's: the turn reached the pixelated draw.
    expect(againstUnturned.matching, 'blocks matching the un-turned source').toBeLessThan(turned.blocks / 2)
  })

  test('inside a zoom, the grid stays on the frame: the same 128 × 72 blocks of one colour', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    const ramp = await setup(page, 15 / 1920)
    // The default zoom holds over 0.5–1.5 s, so 1 s is at its full scale.
    await chooseEffect(page, POSITION, 'Zoom')
    const grid = { columns: 128, rows: 72 }
    const zoomed = await readBlocks(page, await savedFrameAt(page, 1, 'zoomed'), ramp, grid)
    console.log(`[${testInfo.project.name}] pixelate, zoomed: ${JSON.stringify(zoomed)}`)
    expect(zoomed.uniform, 'blocks of one colour on the frame grid').toBe(zoomed.blocks)
    // The zoom magnified the ramp, so the blocks no longer match the
    // un-zoomed source's downscale: the picture under the grid moved.
    expect(zoomed.matching, 'blocks matching the un-zoomed source').toBeLessThan(zoomed.blocks / 2)
  })
})
