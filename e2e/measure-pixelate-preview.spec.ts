import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { choosePreviewLayout } from './previewView'

/**
 * MEASUREMENT ONLY (#871, step 3a): how the preview can draw Pixelate so
 * that it matches the export, and what it costs. Dispatched in CI per
 * `docs/rules/quality-and-ci.md` (#779) for Firefox, and read from the
 * job's log. Not meant to merge: the numbers go on #871.
 *
 * The export route is settled (the 04:48 comment on #871): draw the card
 * into a canvas of W/B × H/B, then draw that back over the frame with
 * smoothing off. The preview has no downscale filter, so two candidates:
 *
 * - **Route 1, a canvas layer.** A canvas in the card, whose buffer is the
 *   same W/B × H/B, drawn from the media element as the export draws from
 *   its frame, and stretched over the card by CSS with
 *   `image-rendering: pixelated`. The buffer then holds the very numbers
 *   the export upscales, so parity is a question only of how CSS's nearest
 *   neighbour places the blocks against the canvas's.
 * - **Route 2, a downscaled copy.** The issue body's suggestion: the media
 *   shown at W/B × H/B CSS px and scaled back up by a CSS transform, with
 *   `image-rendering: pixelated`. Whether the browser downsamples before
 *   the transform at all is the question.
 *
 * The parity test runs in both browsers on a synthetic 1920×1080 source:
 * red and green ramp across and down, blue is a diagonal ripple, so every
 * block has a colour of its own. The cost test runs in the app on a real
 * 1080p 30 fps video, and only where `MEASURE_PIXELATE_VIDEO` names one.
 */

const W = 1920
const H = 1080

type ParityReading = {
  route: string
  dpr: number
  previewWidth: number
  left: number
  block: number
  pixels: number
  exact: number
  neighbour: number
  other: number
  uniformBlocks: number
  blocks: number
  edgeErrorMax: number
}

/** Builds the source, the export's frame and the preview's element(s) in a blank page, and reads them. */
async function measureParity(
  page: Page,
  route: 'canvas' | 'downscaled-img',
  block: number,
  previewWidth: number,
  left: number,
  dpr: number,
): Promise<ParityReading> {
  await page.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>')
  const setup = await page.evaluate(
    async ({ W, H, block, previewWidth, left, route }) => {
      const source = document.createElement('canvas')
      source.width = W
      source.height = H
      const sctx = source.getContext('2d')!
      const image = sctx.createImageData(W, H)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          image.data[i] = Math.round((x / W) * 255)
          image.data[i + 1] = Math.round((y / H) * 255)
          image.data[i + 2] = Math.round(127.5 + 127.5 * Math.sin((x + y) / 37))
          image.data[i + 3] = 255
        }
      }
      sctx.putImageData(image, 0, 0)
      const n = W / block
      const m = H / block
      // The buffer both routes share: the export's low-resolution card.
      const low = document.createElement('canvas')
      low.width = n
      low.height = m
      const lctx = low.getContext('2d')!
      lctx.drawImage(source, 0, 0, n, m)
      const lowData = Array.from(lctx.getImageData(0, 0, n, m).data)
      // The export: the buffer drawn back over the frame, smoothing off.
      const out = document.createElement('canvas')
      out.width = W
      out.height = H
      const octx = out.getContext('2d')!
      octx.imageSmoothingEnabled = false
      octx.drawImage(low, 0, 0, W, H)
      const od = octx.getImageData(0, 0, W, H).data
      let exportMismatch = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const j = (Math.floor(y / block) * n + Math.floor(x / block)) * 4
          if (Math.max(Math.abs(od[i] - lowData[j]), Math.abs(od[i + 1] - lowData[j + 1]), Math.abs(od[i + 2] - lowData[j + 2])) > 0) exportMismatch++
        }
      }
      const previewHeight = (previewWidth * H) / W
      const host = document.createElement('div')
      host.id = 'host'
      host.style.cssText = `position:absolute;left:${left}px;top:${left}px;width:${previewWidth}px;height:${previewHeight}px;overflow:hidden;background:#000`
      document.body.append(host)
      if (route === 'canvas') {
        const shown = document.createElement('canvas')
        shown.width = n
        shown.height = m
        shown.getContext('2d')!.drawImage(source, 0, 0, n, m)
        shown.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated'
        host.append(shown)
      } else {
        const img = document.createElement('img')
        img.src = source.toDataURL('image/png')
        await img.decode()
        img.style.cssText = `position:absolute;left:0;top:0;width:${n}px;height:${m}px;transform-origin:0 0;transform:scale(${previewWidth / n});image-rendering:pixelated`
        host.append(img)
      }
      return { n, m, lowData, exportMismatch, previewHeight }
    },
    { W, H, block, previewWidth, left, route },
  )
  expect(setup.exportMismatch, 'the export frame is the buffer, block for block').toBe(0)
  const rect = { x: left, y: left, width: previewWidth, height: setup.previewHeight }
  // Whole device pixels inside the host, so a fractional box edge is not read.
  const clip = {
    x: Math.ceil(rect.x),
    y: Math.ceil(rect.y),
    width: Math.floor(rect.width) - 1,
    height: Math.floor(rect.height) - 1,
  }
  const png = await page.screenshot({ clip })
  return await page.evaluate(
    async ({ base64, n, m, lowData, clip, rect, dpr, block, route, previewWidth, left }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const scale = width / clip.width
      const blockPx = (rect.width * scale) / n
      const offsetX = (clip.x - rect.x) * scale
      const offsetY = (clip.y - rect.y) * scale
      const colourOf = (bx: number, by: number) => {
        const j = (Math.min(m - 1, Math.max(0, by)) * n + Math.min(n - 1, Math.max(0, bx))) * 4
        return [lowData[j], lowData[j + 1], lowData[j + 2]]
      }
      const near = (i: number, c: number[]) =>
        Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2])) <= 3
      let exact = 0
      let neighbour = 0
      let other = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const bx = Math.floor((x + 0.5 + offsetX) / blockPx)
          const by = Math.floor((y + 0.5 + offsetY) / blockPx)
          if (near(i, colourOf(bx, by))) exact++
          else if (
            near(i, colourOf(bx - 1, by)) ||
            near(i, colourOf(bx + 1, by)) ||
            near(i, colourOf(bx, by - 1)) ||
            near(i, colourOf(bx, by + 1))
          )
            neighbour++
          else other++
        }
      }
      // Blocks whose interior (one device px in from each expected edge) is one colour.
      let uniformBlocks = 0
      let blocks = 0
      for (let by = 0; by < m; by++) {
        for (let bx = 0; bx < n; bx++) {
          const x0 = Math.ceil(bx * blockPx - offsetX) + 1
          const x1 = Math.floor((bx + 1) * blockPx - offsetX) - 2
          const y0 = Math.ceil(by * blockPx - offsetY) + 1
          const y1 = Math.floor((by + 1) * blockPx - offsetY) - 2
          if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height || x1 < x0 || y1 < y0) continue
          blocks++
          let lo = [255, 255, 255]
          let hi = [0, 0, 0]
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const i = (y * width + x) * 4
              lo = lo.map((v, c) => Math.min(v, data[i + c]))
              hi = hi.map((v, c) => Math.max(v, data[i + c]))
            }
          }
          if (hi.every((v, c) => v - lo[c] <= 3)) uniformBlocks++
        }
      }
      // Where each block edge landed along a middle row, against k × blockPx.
      let edgeErrorMax = 0
      const row = Math.floor(height / 2)
      for (let x = 1; x < width; x++) {
        const i = (row * width + x) * 4
        const p = i - 4
        const changed = Math.abs(data[i] - data[p]) + Math.abs(data[i + 1] - data[p + 1]) + Math.abs(data[i + 2] - data[p + 2]) > 3
        if (!changed) continue
        const k = Math.round((x + offsetX) / blockPx)
        edgeErrorMax = Math.max(edgeErrorMax, Math.abs(x + offsetX - k * blockPx))
      }
      return {
        route,
        dpr,
        previewWidth,
        left,
        block,
        pixels: width * height,
        exact,
        neighbour,
        other,
        uniformBlocks,
        blocks,
        edgeErrorMax: Math.round(edgeErrorMax * 100) / 100,
      }
    },
    {
      base64: png.toString('base64'),
      n: setup.n,
      m: setup.m,
      lowData: setup.lowData,
      clip,
      rect,
      dpr,
      block,
      route,
      previewWidth,
      left,
    },
  )
}

test.describe('MEASURE: Pixelate preview routes (#871, step 3a)', () => {
  test('parity of the canvas layer and the downscaled copy with the export, at device scale 1 and 2', async ({
    browser,
    browserName,
  }) => {
    test.setTimeout(600_000)
    const readings: ParityReading[] = []
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr })
      const page = await context.newPage()
      for (const route of ['canvas', 'downscaled-img'] as const) {
        for (const [previewWidth, left] of [
          [955, 0],
          [1203, 0],
          [944.4, 10.3],
        ] as const) {
          for (const block of [15, 24]) {
            const reading = await measureParity(page, route, block, previewWidth, left, dpr)
            readings.push(reading)
            console.log(`[${browserName}] pixelate parity ${JSON.stringify(reading)}`)
          }
        }
      }
      await context.close()
    }
    expect(readings.length).toBeGreaterThan(0)
  })

  test('playback cost in the app of a canvas layer redrawn every frame, at 1080p 30 fps', async ({ page, browserName }) => {
    const video = process.env.MEASURE_PIXELATE_VIDEO
    test.skip(video === undefined, 'set MEASURE_PIXELATE_VIDEO to a 1080p 30 fps WebM')
    test.setTimeout(600_000)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('./')
    await page
      .getByTestId('clip-file-input')
      .setInputFiles([{ name: 'testsrc2.webm', mimeType: 'video/webm', buffer: await readFile(video!) }])
    await page.getByRole('button', { name: 'Add testsrc2.webm to timeline' }).click()
    await expect(page.getByTestId('timeline-total')).toHaveText('0:06')
    for (const layout of ['Default', 'Fit to width'] as const) {
      await choosePreviewLayout(page, layout)
      for (const variant of ['none', 'canvas-low-css', 'canvas-full-upscaled', 'canvas-low-css-block8'] as const) {
        for (let run = 0; run < 2; run++) {
          await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
          const reading = await page.evaluate(async (variant) => {
            const element = document.querySelector('[data-testid="preview-video"]') as HTMLVideoElement
            const card = element.parentElement!
            let canvas: HTMLCanvasElement | null = null
            let paint = 0
            let paints = 0
            let paintMs = 0
            if (variant !== 'none') {
              canvas = document.createElement('canvas')
              canvas.className = 'preview-redactions'
              canvas.style.imageRendering = 'pixelated'
              card.append(canvas)
              const block = variant === 'canvas-low-css-block8' ? 8 : 15
              const low = document.createElement('canvas')
              low.width = Math.round(1920 / block)
              low.height = Math.round(1080 / block)
              const lctx = low.getContext('2d')!
              const loop = () => {
                paint = requestAnimationFrame(loop)
                if (element.readyState < 2) return
                const t0 = performance.now()
                paints++
                if (variant === 'canvas-full-upscaled') {
                  const w = Math.round(canvas!.clientWidth)
                  const h = Math.round(canvas!.clientHeight)
                  if (canvas!.width !== w) canvas!.width = w
                  if (canvas!.height !== h) canvas!.height = h
                  lctx.drawImage(element, 0, 0, low.width, low.height)
                  const ctx = canvas!.getContext('2d')!
                  ctx.imageSmoothingEnabled = false
                  ctx.drawImage(low, 0, 0, w, h)
                } else {
                  if (canvas!.width !== low.width) canvas!.width = low.width
                  if (canvas!.height !== low.height) canvas!.height = low.height
                  canvas!.getContext('2d')!.drawImage(element, 0, 0, low.width, low.height)
                }
                paintMs += performance.now() - t0
              }
              paint = requestAnimationFrame(loop)
            }
            const width = card.getBoundingClientRect().width
            let frames = 0
            let rafs = 0
            let longest = 0
            let counting = true
            const onFrame = () => {
              if (!counting) return
              frames++
              element.requestVideoFrameCallback(onFrame)
            }
            let last = performance.now()
            const onRaf = (now: number) => {
              if (!counting) return
              rafs++
              longest = Math.max(longest, now - last)
              last = now
              requestAnimationFrame(onRaf)
            }
            const play = document.querySelector('button[aria-label="Play preview"]') as HTMLButtonElement | null
            if (play !== null) play.click()
            else await element.play()
            await new Promise((resolve) => setTimeout(resolve, 300))
            frames = 0
            rafs = 0
            last = performance.now()
            element.requestVideoFrameCallback(onFrame)
            requestAnimationFrame(onRaf)
            await new Promise((resolve) => setTimeout(resolve, 3000))
            counting = false
            const pause = document.querySelector('button[aria-label="Pause preview"]') as HTMLButtonElement | null
            if (pause !== null) pause.click()
            else element.pause()
            cancelAnimationFrame(paint)
            let lit = 0
            if (canvas !== null) {
              const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
              for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++
              lit = Math.round((100 * lit) / (d.length / 4))
            }
            canvas?.remove()
            return {
              variant,
              width: Math.round(width),
              fps: Math.round((frames / 3) * 10) / 10,
              raf: Math.round((rafs / 3) * 10) / 10,
              longestMs: Math.round(longest),
              paintMsPerFrame: paints === 0 ? null : Math.round((paintMs / paints) * 100) / 100,
              canvasLitPercent: canvas === null ? null : lit,
            }
          }, variant)
          console.log(`[${browserName}] pixelate cost ${layout} run ${run + 1} ${JSON.stringify(reading)}`)
        }
      }
    }
  })
})
