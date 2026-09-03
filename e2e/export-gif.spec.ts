import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * The GIF export plugin, end to end (#198): enable the plugin through the
 * manager (the real lazy chunk, gifenc included, fetched over the dev
 * server), export a short slate-based timeline as Animated GIF, and verify
 * the downloaded bytes are a plausible animated GIF — GIF89a header, capped
 * logical-screen dimensions, several image frames at the plugin's fixed
 * 10 cs delay.
 */

/** Counts a GIF's image frames and reads its header facts by walking the
 * real block structure — sub-block chains and all — rather than grepping
 * bytes that could occur inside LZW data. */
function parseGif(bytes: Buffer): {
  signature: string
  width: number
  height: number
  frames: number
  /** The first Graphic Control Extension's delay, in centiseconds. */
  firstDelayCs: number | null
  trailer: boolean
} {
  const signature = bytes.subarray(0, 6).toString('latin1')
  const width = bytes.readUInt16LE(6)
  const height = bytes.readUInt16LE(8)
  const packed = bytes[10]
  let offset = 13
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1) // global color table
  let frames = 0
  let firstDelayCs: number | null = null
  let trailer = false
  const skipSubBlocks = () => {
    for (;;) {
      const size = bytes[offset]
      offset += 1
      if (size === 0) return
      offset += size
    }
  }
  while (offset < bytes.length) {
    const block = bytes[offset]
    if (block === 0x3b) {
      trailer = true
      break
    }
    if (block === 0x21) {
      const label = bytes[offset + 1]
      if (label === 0xf9 && firstDelayCs === null) {
        // GCE: introducer, label, size(4), packed, delay lo, delay hi ...
        firstDelayCs = bytes.readUInt16LE(offset + 4)
      }
      offset += 2
      skipSubBlocks()
    } else if (block === 0x2c) {
      frames += 1
      const localPacked = bytes[offset + 9]
      offset += 10
      if (localPacked & 0x80) offset += 3 * 2 ** ((localPacked & 0x07) + 1)
      offset += 1 // LZW minimum code size
      skipSubBlocks()
    } else {
      break // unknown block: stop rather than loop forever
    }
  }
  return { signature, width, height, frames, firstDelayCs, trailer }
}

test('the enabled GIF plugin exports a slate timeline as a plausible animated GIF', async ({
  page,
}) => {
  await page.goto('./')

  // Enable the plugin: the manager fetches the real chunk and activates it.
  await page.getByRole('button', { name: 'Plugins…' }).click()
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  // A two-slate sequence (red then blue, 1 s each): deterministic frames
  // with a scene change, so per-frame palettes genuinely differ.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const duration1 = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await duration1.fill('1')
  await duration1.blur()
  const duration2 = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 2 in seconds',
  })
  await duration2.fill('1')
  await duration2.blur()
  await page.getByLabel('Color of Color slate at position 2').fill('#0000ff')

  // Export as Animated GIF; the format states its limits right there.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated GIF' }).check()
  await expect(page.getByText(/soundless and sample at 10 fps/)).toBeVisible()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.gif')

  const bytes = await readFile((await download.path()) as string)
  const gif = parseGif(bytes)
  expect(gif.signature).toBe('GIF89a')
  // The slate-only timeline composes at the fallback frame; whatever that
  // is, the plugin's dimension cap bounds the GIF.
  expect(Math.max(gif.width, gif.height)).toBeLessThanOrEqual(480)
  expect(Math.min(gif.width, gif.height)).toBeGreaterThan(0)
  // ~2 s at 10 fps is ~20 frames; real-time capture can drop a few at the
  // edges, but a GIF that ignored the animation would have 1.
  expect(gif.frames).toBeGreaterThanOrEqual(10)
  expect(gif.frames).toBeLessThanOrEqual(30)
  // The plugin's fixed sampling rate, exactly representable in GIF timing.
  expect(gif.firstDelayCs).toBe(10)
  expect(gif.trailer).toBe(true)

  // The canvas preset flows into the GIF too (#274): the plugin encodes
  // whatever frame the shared pipeline composes, so fixing the canvas to
  // 9:16 reshapes the slate timeline's fallback frame to 648×1152, which the
  // plugin's own dimension cap scales to exactly 270×480 (gifOutputSize).
  await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption('9:16')
  const presetDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated GIF' }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const presetGif = parseGif(await readFile((await (await presetDownload).path()) as string))
  expect(presetGif.signature).toBe('GIF89a')
  expect(presetGif.width).toBe(270)
  expect(presetGif.height).toBe(480)
  expect(presetGif.frames).toBeGreaterThanOrEqual(10)
})
