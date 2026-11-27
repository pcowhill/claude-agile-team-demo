import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { choosePreviewLayout } from './previewView'
import { chooseEffect } from './timelineRowMenu'

/**
 * Measurement only (#978, step 1). Not meant to merge. Plays 3 s of a
 * 1080p 30 fps source with a test look over the whole entry and counts
 * requestVideoFrameCallback and rAF frames. MEASURE_978_VIDEO names the
 * source; MEASURE_978_VARIANTS the looks; MEASURE_978_LAYOUTS the layouts.
 */
const VIDEO = process.env.MEASURE_978_VIDEO ?? ''
const NAME = 'src.webm'
const POSITION = `${NAME} at position 1`
const VARIANTS = (process.env.MEASURE_978_VARIANTS ?? 'none,full,no-offset').split(',')
const LAYOUTS = (process.env.MEASURE_978_LAYOUTS ?? 'Default,Fit to width').split(',') as ('Default' | 'Fit to width')[]
const AMOUNT = Number(process.env.MEASURE_978_AMOUNT ?? '100')
const RUNS = Number(process.env.MEASURE_978_RUNS ?? '2')

test.use({ viewport: { width: 1920, height: 1080 } })
test.setTimeout(600_000)

async function setup(page: Page, variant: string) {
  await page.goto('./')
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await page.getByRole('button', { name: 'Enable Visual effects' }).click()
  await expect(page.getByRole('button', { name: 'Disable Visual effects' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByTestId('clip-file-input').setInputFiles([{ name: NAME, mimeType: 'video/webm', buffer: await readFile(VIDEO) }])
  await page.getByRole('button', { name: `Add ${NAME} to timeline` }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:08')
  if (variant === 'none') return
  await page.evaluate(
    async ({ variant, amount }) => {
      const url = new URL('src/lib/pictureEffect.ts', document.baseURI).href
      const m = (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/pictureEffect')
      const VHS = { blur: 0.0015, scanlines: 0.4, tracking: 0.5, offset: 0.002 }
      const s = amount / 100
      const parts = new Set(
        variant === 'full' ? ['offset', 'blur', 'layers'] : variant === 'no-offset' ? ['blur', 'layers'] : variant.split('+'),
      )
      m.pictureEffectRegistry.register({
        id: 'measure-978',
        name: 'Measure 978',
        params: [],
        look: (_p, weight, time = 0) => {
          const k = s * weight
          const filters: import('../src/lib/pictureEffect').PictureFilter[] = []
          if (parts.has('offset')) filters.push({ kind: 'channel-offset', offset: VHS.offset * k })
          if (parts.has('blur')) filters.push({ kind: 'blur', radius: VHS.blur * k })
          const layers: import('../src/lib/pictureEffect').PictureLayer[] = parts.has('layers')
            ? [
                { kind: 'scanlines', amount: VHS.scanlines * k, seed: m.textureStep(time) },
                { kind: 'tracking', amount: VHS.tracking * k, seed: m.textureStep(time) },
              ]
            : []
          return { filters, layers }
        },
      })
    },
    { variant, amount: AMOUNT },
  )
  await chooseEffect(page, POSITION, 'Measure 978')
  for (const [edge, value] of [['end', '8'], ['start', '0']] as const) {
    const field = page.getByRole('spinbutton', { name: `Measure 978 1 ${edge} of ${POSITION} in seconds` })
    await field.fill(value)
    await field.blur()
  }
  console.log(await page.getByRole('spinbutton', { name: /Measure 978 1/ }).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
}

async function measure(page: Page) {
  const video = page.getByTestId('preview-video')
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.2')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Play preview' }).click()
  await page.waitForTimeout(300)
  const r = await video.evaluate(async (element) => {
    const v = element as HTMLVideoElement
    const t0 = v.currentTime
    let frames = 0
    let rafs = 0
    let last = performance.now()
    let longest = 0
    let done = false
    const onFrame = () => {
      frames++
      if (!done) v.requestVideoFrameCallback(onFrame)
    }
    v.requestVideoFrameCallback(onFrame)
    const onRaf = (now: number) => {
      rafs++
      longest = Math.max(longest, now - last)
      last = now
      if (!done) requestAnimationFrame(onRaf)
    }
    requestAnimationFrame(onRaf)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    done = true
    return { fps: frames / 3, raf: rafs / 3, longest: Math.round(longest), advanced: v.currentTime - t0, width: v.getBoundingClientRect().width, filter: getComputedStyle(v).filter }
  })
  await page.getByRole('button', { name: 'Pause preview' }).click()
  return r
}

for (const variant of VARIANTS) {
  test(`measure ${variant} at ${AMOUNT}`, async ({ page }) => {
    test.skip(VIDEO === '', 'MEASURE_978_VIDEO')
    await setup(page, variant)
    if (process.env.MEASURE_978_DISCOVER) {
      console.log(await page.getByRole('spinbutton').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
    }
    for (const layout of LAYOUTS) {
      await choosePreviewLayout(page, layout)
      for (let run = 1; run <= RUNS; run++) {
        const r = await measure(page)
        console.log(`MEASURE ${variant} amount=${AMOUNT} ${layout} run${run} ${JSON.stringify(r)}`)
      }
    }
  })
}
