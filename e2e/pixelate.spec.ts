import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFrameMenu } from './frameMenu'
import { openPicture } from './pictureDisclosure'
import { chooseEffect } from './timelineRowMenu'
import type { PictureFilter } from '../src/lib/pictureEffect'

/**
 * The `pixelate` picture filter (#871): the picture downscaled into a grid
 * of columns × rows and stretched back over the card with smoothing off,
 * so every block is one colour. The export draws it (step 3b(i)) and so
 * does the preview's canvas (step 3b(ii)), which is read against saved
 * frames block by block. No effect the app ships uses the kind yet
 * (Pixelate adopts it in step 3c). The spec registers a test-only
 * definition into the running app's registry through the dev server's own
 * module URL, as `slices.spec.ts` does, and adds it from + Effect ▾ like
 * any other.
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
 * frame's: the preview downscales the element straight into the grid, the
 * export its full-size card, so the two bilinear averages differ slightly.
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
