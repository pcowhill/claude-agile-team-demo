import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Save frame (#237): the transport's Save frame button downloads the
 * playhead's frame as a PNG at the output resolution, composed through the
 * export's draw path. The banded fixture (left green, right blue — the
 * export-orientation.spec idiom, every frame identical) makes composition
 * evidence unmistakable in the decoded PNG pixels: an unoriented snapshot
 * samples the bands as shot, and a 90° turn — a composed feature the export
 * path owns (#232/#233) — produces a portrait PNG with the left band
 * carried to the top.
 */

/** Records a WebM whose left half is green and right half blue. */
async function recordBandedWebm(page: Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = 'rgb(0, 205, 0)'
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height)
        if (performance.now() - start > 2000) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

interface PngSample {
  width: number
  height: number
  r: number
  g: number
  b: number
}

/** Decodes a PNG and averages the pixels of a fractional region. */
async function samplePng(
  page: Page,
  png: Buffer,
  rect: { x: number; y: number; width: number; height: number },
): Promise<PngSample> {
  return await page.evaluate(
    async ({ base64, rect }) => {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('the saved frame failed to decode as an image'))
        image.src = `data:image/png;base64,${base64}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const x = Math.floor(rect.x * canvas.width)
      const y = Math.floor(rect.y * canvas.height)
      const w = Math.max(1, Math.floor(rect.width * canvas.width))
      const h = Math.max(1, Math.floor(rect.height * canvas.height))
      const data = ctx.getImageData(x, y, w, h).data
      let r = 0
      let g = 0
      let b = 0
      const pixels = data.length / 4
      for (let index = 0; index < data.length; index += 4) {
        r += data[index]
        g += data[index + 1]
        b += data[index + 2]
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        r: r / pixels,
        g: g / pixels,
        b: b / pixels,
      }
    },
    { base64: png.toString('base64'), rect },
  )
}

/** Clicks Save frame and returns the downloaded PNG bytes and filename. */
async function saveFrameOnce(page: Page): Promise<{ png: Buffer; fileName: string }> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('preview-save-frame').click()
  const download = await downloadPromise
  return { png: await readFile(await download.path()), fileName: download.suggestedFilename() }
}

test('Save frame downloads the composed playhead frame as a PNG, orientation included (#237)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')

  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()

  // The unoriented control at the initial playhead: a landscape PNG at the
  // output resolution with the bands where they were shot.
  const control = await saveFrameOnce(page)
  expect(control.fileName).toBe('sequence-frame-0.00s.png')
  const left = await samplePng(page, control.png, { x: 0, y: 0.25, width: 0.25, height: 0.5 })
  const right = await samplePng(page, control.png, { x: 0.75, y: 0.25, width: 0.25, height: 0.5 })
  expect(left.width).toBe(320)
  expect(left.height).toBe(180)
  expect(left.g).toBeGreaterThan(left.b + 60)
  expect(right.b).toBeGreaterThan(right.g + 60)

  // Rotate 90° (#232) and save again: the snapshot composes through the
  // export draw path (#233), so the PNG is portrait at the oriented output
  // resolution with the left band carried to the top.
  await page
    .getByRole('button', {
      name: 'Rotate banded.webm at position 1 90 degrees clockwise (currently 0 degrees)',
    })
    .click()
  const rotated = await saveFrameOnce(page)
  const top = await samplePng(page, rotated.png, { x: 0.25, y: 0, width: 0.5, height: 0.25 })
  const bottom = await samplePng(page, rotated.png, { x: 0.25, y: 0.75, width: 0.5, height: 0.25 })
  expect(top.width).toBe(180)
  expect(top.height).toBe(320)
  expect(top.g).toBeGreaterThan(top.b + 60)
  expect(bottom.b).toBeGreaterThan(bottom.g + 60)
})
