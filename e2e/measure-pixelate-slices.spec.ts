import { expect, test } from '@playwright/test'

/**
 * MEASUREMENT ONLY (#871, steps 2b and 3): whether two SVG filters draw
 * alike in the preview (a CSS `filter` on an element) and in the export (a
 * canvas `ctx.filter`), in Chromium and in Firefox, as #870's
 * measure-channel-offset spec did for the channel offset. Dispatched in CI
 * per `docs/rules/quality-and-ci.md` (#779), and read from the job's log.
 * Not meant to merge: the numbers go on #871.
 *
 * - **Pixelate (step 3):** one sample per B×B block, at the block's
 *   top-left pixel, grown over the block: a 1-px flood tiled every B px,
 *   `in` the source, dilated by (B − 1) / 2 and moved by as much, then
 *   clipped back to the source's alpha. The region is user-space and
 *   reaches B px past the top-left, so the first row and column of blocks
 *   are not clipped before the move. Dilation covers 2r + 1 px, so only an
 *   odd B tiles exactly; B = 8 is measured to see what an even one does.
 * - **Slices (step 2b):** horizontal bands of the source moved sideways,
 *   each an `feOffset` with a primitive subregion, merged over the source.
 *
 * Sources are 320×180: a diagonal gradient for Pixelate, so every block
 * has a colour of its own, and a white bar on black for the slices, so the
 * bar's edges on each row say how far that row moved.
 */

const W = 320
const H = 180

function pixelateFilter(id: string, block: number): string {
  const r = (block - 1) / 2
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-${block}" y="-${block}" width="100000" height="100000" color-interpolation-filters="sRGB">
    <feFlood x="0" y="0" width="1" height="1" flood-color="#fff" result="dot"/>
    <feComposite in="dot" in2="dot" operator="over" x="0" y="0" width="${block}" height="${block}" result="cell"/>
    <feTile in="cell" result="grid"/>
    <feComposite in="SourceGraphic" in2="grid" operator="in" result="samples"/>
    <feMorphology in="samples" operator="dilate" radius="${r}" result="grown"/>
    <feOffset in="grown" dx="${r}" dy="${r}" result="moved"/>
    <feComposite in="moved" in2="SourceAlpha" operator="in"/>
  </filter>`
}

/** Bands as [y, height, dx] in the filtered surface's own px. */
const SLICES: [number, number, number][] = [
  [20, 10, 12],
  [60, 25, -20],
  [120, 6, 30],
]

function slicesFilter(id: string, scale: number): string {
  const bands = SLICES.map(
    ([y, height, dx], index) =>
      `<feOffset in="SourceGraphic" dx="${dx * scale}" dy="0" x="0" y="${y * scale}" width="100%" height="${height * scale}" result="s${index}"/>`,
  ).join('')
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    ${bands}
    <feMerge><feMergeNode in="SourceGraphic"/>${SLICES.map((_, index) => `<feMergeNode in="s${index}"/>`).join('')}</feMerge>
  </filter>`
}

/** Pixelate's reading of an RGBA image: per block of B, how many distinct colours, and each block's colour. */
function pixelateReadingScript(data: number[], width: number, height: number, block: number) {
  let uniform = 0
  let total = 0
  let maxDistinct = 0
  let notOpaque = 0
  const firstRow: string[] = []
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const colours = new Set<string>()
      for (let y = by; y < Math.min(by + block, height); y++) {
        for (let x = bx; x < Math.min(bx + block, width); x++) {
          const i = (y * width + x) * 4
          colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
          if (data[i + 3] < 255) notOpaque++
        }
      }
      total++
      if (colours.size === 1) uniform++
      maxDistinct = Math.max(maxDistinct, colours.size)
      if (by === block && firstRow.length < 6) {
        const i = ((by + 1) * width + bx + 1) * 4
        firstRow.push(`${data[i]},${data[i + 1]},${data[i + 2]}`)
      }
    }
  }
  return { uniform, total, maxDistinct, notOpaque, secondRowColours: firstRow }
}

/** The slices' reading: the white bar's left edge on a row inside each band and on one outside them all. */
function slicesReadingScript(data: number[], width: number, rows: number[]) {
  return rows.map((y) => {
    let first = -1
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] > 128) {
        first = x
        break
      }
    }
    return [y, first]
  })
}

test('measure: SVG pixelate and slice filters in CSS and in a canvas', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1400, height: 1200 })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#888">
    <svg width="0" height="0" style="position:absolute">
      ${pixelateFilter('px7', 7)}${pixelateFilter('px15', 15)}${pixelateFilter('px8', 8)}
      ${slicesFilter('sl1', 1)}${slicesFilter('sl2', 2)}
    </svg>
    <canvas id="grad" width="${W}" height="${H}" style="display:block"></canvas>
    <canvas id="bar" width="${W}" height="${H}" style="display:block"></canvas>
    <canvas id="css-px15" width="${W}" height="${H}" style="display:block;filter:url(#px15)"></canvas>
    <canvas id="css-px7" width="${W}" height="${H}" style="display:block;filter:url(#px7)"></canvas>
    <canvas id="css-px8" width="${W}" height="${H}" style="display:block;filter:url(#px8)"></canvas>
    <canvas id="css-px15-2x" width="${W}" height="${H}" style="display:block;width:${W * 2}px;height:${H * 2}px;filter:url(#px15)"></canvas>
    <canvas id="css-sl1" width="${W}" height="${H}" style="display:block;filter:url(#sl1)"></canvas>
    <canvas id="css-sl1-2x" width="${W}" height="${H}" style="display:block;width:${W * 2}px;height:${H * 2}px;filter:url(#sl2)"></canvas>
  </body></html>`)

  await page.evaluate(
    ({ w, h }) => {
      const gradient = (ctx: CanvasRenderingContext2D) => {
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, '#f00')
        g.addColorStop(0.5, '#0f0')
        g.addColorStop(1, '#00f')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      const bar = (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#fff'
        ctx.fillRect(100, 0, 100, h)
      }
      for (const id of ['grad', 'css-px15', 'css-px7', 'css-px8', 'css-px15-2x']) {
        gradient((document.getElementById(id) as HTMLCanvasElement).getContext('2d')!)
      }
      for (const id of ['bar', 'css-sl1', 'css-sl1-2x']) {
        bar((document.getElementById(id) as HTMLCanvasElement).getContext('2d')!)
      }
    },
    { w: W, h: H },
  )

  const sliceRows = [...SLICES.map(([y, height]) => y + Math.floor(height / 2)), 100, 170]

  // The canvas path: ctx.filter while drawing the plain source onto a fresh canvas.
  const canvasReadings = await page.evaluate(
    ({ w, h, pixelate, slices, rows }) => {
      const pixelateOf = new Function('data', 'width', 'height', 'block', `return (${pixelate})(data, width, height, block)`)
      const slicesOf = new Function('data', 'width', 'rows', `return (${slices})(data, width, rows)`)
      const draw = (sourceId: string, scale: number, filter: string) => {
        const canvas = document.createElement('canvas')
        canvas.width = w * scale
        canvas.height = h * scale
        const ctx = canvas.getContext('2d')!
        ctx.filter = filter
        const accepted = ctx.filter
        ctx.drawImage(document.getElementById(sourceId) as HTMLCanvasElement, 0, 0, canvas.width, canvas.height)
        return { accepted, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data), canvas }
      }
      const px = (filter: string, block: number) => {
        const { accepted, data } = draw('grad', 1, filter)
        return { filter, accepted, ...pixelateOf(data, w, h, block) }
      }
      const sl = (filter: string, scale: number) => {
        const { accepted, data } = draw('bar', scale, filter)
        return { filter, scale, accepted, rows: slicesOf(data, w * scale, rows.map((y: number) => y * scale)) }
      }
      // Time: 60 draws of a 1920×1080 gradient through px39 (odd) and through no filter.
      const big = document.createElement('canvas')
      big.width = 1920
      big.height = 1080
      const bctx = big.getContext('2d')!
      bctx.drawImage(document.getElementById('grad') as HTMLCanvasElement, 0, 0, 1920, 1080)
      const svg = document.querySelector('svg')!
      svg.insertAdjacentHTML('beforeend', '') // keep the svg live
      const timing = (filter: string) => {
        const out = document.createElement('canvas')
        out.width = 1920
        out.height = 1080
        const octx = out.getContext('2d')!
        octx.filter = filter
        const start = performance.now()
        for (let i = 0; i < 20; i++) octx.drawImage(big, 0, 0)
        octx.getImageData(0, 0, 1, 1)
        return { filter, msPerDraw: Number(((performance.now() - start) / 20).toFixed(1)) }
      }
      // The alternative Pixelate: down to one pixel per block, then up with smoothing off.
      const downscaled = (block: number) => {
        const small = document.createElement('canvas')
        small.width = Math.ceil(1920 / block)
        small.height = Math.ceil(1080 / block)
        const sctx = small.getContext('2d')!
        const out = document.createElement('canvas')
        out.width = 1920
        out.height = 1080
        const octx = out.getContext('2d')!
        octx.imageSmoothingEnabled = false
        const start = performance.now()
        for (let i = 0; i < 20; i++) {
          sctx.drawImage(big, 0, 0, small.width, small.height)
          octx.drawImage(small, 0, 0, small.width * block, small.height * block)
        }
        octx.getImageData(0, 0, 1, 1)
        return { filter: `downscale ${block}`, msPerDraw: Number(((performance.now() - start) / 20).toFixed(1)) }
      }
      return {
        pixelate: [px('url(#px15)', 15), px('url(#px7)', 7), px('url(#px8)', 8), px('none', 15)],
        slices: [sl('url(#sl1)', 1), sl('url(#sl2)', 2), sl('none', 1)],
        timing: [timing('none'), timing('url(#px15)'), timing('url(#px7)'), timing('url(#sl1)'), downscaled(15)],
      }
    },
    { w: W, h: H, pixelate: pixelateReadingScript.toString(), slices: slicesReadingScript.toString(), rows: sliceRows },
  )

  // The CSS path: each element as rendered, screenshotted and read back.
  const readShot = async (id: string) => {
    const shot = (await page.locator(`#${id}`).screenshot()).toString('base64')
    return await page.evaluate(async (base64) => {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('decode'))
        image.src = `data:image/png;base64,${base64}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return { width: canvas.width, height: canvas.height, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) }
    }, shot)
  }
  const pixelateOf = new Function('data', 'width', 'height', 'block', `return (${pixelateReadingScript.toString()})(data, width, height, block)`)
  const slicesOf = new Function('data', 'width', 'rows', `return (${slicesReadingScript.toString()})(data, width, rows)`)
  const cssReadings: Record<string, unknown> = {}
  for (const [id, block] of [
    ['css-px15', 15],
    ['css-px7', 7],
    ['css-px8', 8],
    ['css-px15-2x', 30],
  ] as const) {
    const { width, height, data } = await readShot(id)
    const style = await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).filter)
    cssReadings[id] = { style, size: [width, height], ...pixelateOf(data, width, height, block) }
  }
  for (const [id, scale] of [
    ['css-sl1', 1],
    ['css-sl1-2x', 2],
  ] as const) {
    const { width, data } = await readShot(id)
    cssReadings[id] = { rows: slicesOf(data, width, sliceRows.map((y) => y * scale)) }
  }

  console.log(`[${browserName}] pixelate canvas: ${JSON.stringify(canvasReadings.pixelate)}`)
  console.log(`[${browserName}] slices canvas: ${JSON.stringify(canvasReadings.slices)}`)
  console.log(`[${browserName}] filter timing 1920x1080 canvas: ${JSON.stringify(canvasReadings.timing)}`)
  console.log(`[${browserName}] pixelate+slices css: ${JSON.stringify(cssReadings)}`)
  expect(Object.keys(cssReadings)).toHaveLength(6)
})
