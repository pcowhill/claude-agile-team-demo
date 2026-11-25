import { expect, test } from '@playwright/test'

/**
 * MEASUREMENT ONLY (#870, step 2b(ii)): which per-channel shift draws alike
 * in the preview (a CSS `filter` on an element) and in the export (a
 * canvas `ctx.filter`), in Chromium and in Firefox. Dispatched in CI per
 * `docs/rules/quality-and-ci.md` (#779), and read from the job's log. Not
 * meant to merge: the numbers go on #870.
 *
 * The candidate is one SVG filter, referenced by `url(#id)` from both: red
 * moved left by D pixels, blue right by D, green in place, screened back
 * together. The source is a white bar on black, so each channel's bar edges
 * say exactly where that channel landed.
 */

const SOURCE = { width: 320, height: 180, left: 100, right: 200 }

test('measure: an SVG channel-offset filter in CSS and in a canvas', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#888">
    <svg width="0" height="0" style="position:absolute">
      ${[6, 12]
        .map(
          (d) => `<filter id="shift${d}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
        <feOffset in="r" dx="-${d}" dy="0" result="r2"/>
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
        <feOffset in="b" dx="${d}" dy="0" result="b2"/>
        <feBlend in="r2" in2="g" mode="screen" result="rg"/>
        <feBlend in="rg" in2="b2" mode="screen"/>
      </filter>`,
        )
        .join('')}
    </svg>
    <canvas id="css1" width="320" height="180" style="display:block;filter:url(#shift6)"></canvas>
    <canvas id="css2" width="320" height="180" style="display:block;width:640px;height:360px;filter:url(#shift12)"></canvas>
    <canvas id="css3" width="320" height="180" style="display:block;filter:url(#shift6) blur(0px) sepia(0)"></canvas>
  </body></html>`)

  // The source, drawn into each CSS canvas element and kept for the canvas path.
  await page.evaluate((source) => {
    for (const id of ['css1', 'css2', 'css3']) {
      const ctx = (document.getElementById(id) as HTMLCanvasElement).getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, source.width, source.height)
      ctx.fillStyle = '#fff'
      ctx.fillRect(source.left, 0, source.right - source.left, source.height)
    }
  }, SOURCE)

  /** Each channel's first and last lit x on a row of RGBA pixels. */
  const edgesScript = (data: number[], width: number) => {
    const out: Record<string, [number, number] | null> = {}
    ;['r', 'g', 'b'].forEach((name, channel) => {
      let first = -1
      let last = -1
      for (let x = 0; x < width; x++) {
        if (data[x * 4 + channel] > 128) {
          if (first < 0) first = x
          last = x
        }
      }
      out[name] = first < 0 ? null : [first, last]
    })
    return out
  }

  // The canvas path: ctx.filter on a fresh canvas, at 1x and at 2x.
  const canvasReadings = await page.evaluate(
    ({ source, edges }) => {
      const edgesOf = new Function('data', 'width', `return (${edges})(data, width)`) as (
        data: number[],
        width: number,
      ) => Record<string, [number, number] | null>
      const src = document.getElementById('css1') as HTMLCanvasElement
      const read = (scale: number, filter: string) => {
        const canvas = document.createElement('canvas')
        canvas.width = source.width * scale
        canvas.height = source.height * scale
        const ctx = canvas.getContext('2d')!
        ctx.filter = filter
        const accepted = ctx.filter
        // The source unfiltered: draw it from a plain copy, since css1's
        // own CSS filter does not reach its bitmap.
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
        const row = Array.from(ctx.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data)
        return { scale, filter, accepted, edges: edgesOf(row, canvas.width) }
      }
      return [
        read(1, 'url(#shift6)'),
        read(2, 'url(#shift12)'),
        read(1, 'url(#shift6) blur(0px) sepia(0)'),
        read(1, 'none'),
      ]
    },
    { source: SOURCE, edges: edgesScript.toString() },
  )

  // The CSS path: each element as rendered, screenshotted and read back.
  const cssReadings = []
  for (const id of ['css1', 'css2', 'css3']) {
    const shot = (await page.locator(`#${id}`).screenshot()).toString('base64')
    const reading = await page.evaluate(
      async ({ shot, edges }) => {
        const edgesOf = new Function('data', 'width', `return (${edges})(data, width)`) as (
          data: number[],
          width: number,
        ) => Record<string, [number, number] | null>
        const image = new Image()
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('decode'))
          image.src = `data:image/png;base64,${shot}`
        })
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        const row = Array.from(ctx.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data)
        return { size: [canvas.width, canvas.height], edges: edgesOf(row, canvas.width) }
      },
      { shot, edges: edgesScript.toString() },
    )
    const style = await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).filter)
    cssReadings.push({ id, style, ...reading })
  }

  console.log(`[${browserName}] channel-offset canvas: ${JSON.stringify(canvasReadings)}`)
  console.log(`[${browserName}] channel-offset css: ${JSON.stringify(cssReadings)}`)
  expect(cssReadings).toHaveLength(3)
})
