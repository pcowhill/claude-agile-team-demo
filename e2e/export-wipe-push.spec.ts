import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of wipes and pushes (#181), exercised media-free with two slates —
 * a red one then a blue one — whose flat, exactly-known colors let a decoded
 * frame attribute each region to either clip unambiguously, the
 * export-transitions fixture idea without recording fixtures.
 */

/** Two 1 s slates (red, then blue) with a 0.5 s transition of the type. */
async function buildSlateSequence(page: Page, type: string) {
  for (const position of [1, 2] as const) {
    await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
    const duration = page.getByRole('spinbutton', {
      name: `Duration of Color slate at position ${position} in seconds`,
    })
    await duration.fill('1')
    await duration.blur()
  }
  // The first slate keeps its default red; the second turns blue.
  await page.getByLabel('Color of Color slate at position 2').fill('#0000ff')
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption(type)
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '1.5',
  )
}

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * averages the pixels of a band of that frame. Sample times anchor to the
 * END of the file because export overhead pads the front: the final entry
 * always occupies the file's last second, so the overlap is exactly
 * [end − 1.0, end − 0.5] regardless of the padding (the export-transitions
 * spec's rule).
 */
async function sampleBand(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  band: 'left-fifth' | 'right-fifth' | 'top-quarter' | 'bottom-quarter',
): Promise<{ r: number; b: number; duration: number }> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, band }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const settleIfKnown = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve()
              return true
            }
            return false
          }
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (settleIfKnown()) return
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => settleIfKnown()
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        const duration = video.duration
        const target = Math.max(0, duration - fromEndSeconds)
        video.currentTime = target
        // Poll instead of listening for `seeked`: the duration scan above
        // may still have a seek in flight, and its events would race.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now()
          const check = () => {
            if (
              !video.seeking &&
              Math.abs(video.currentTime - target) < 0.25 &&
              video.readyState >= 2
            ) {
              resolve()
            } else if (performance.now() - started > 10_000) {
              reject(new Error('seeking the exported file timed out'))
            } else {
              requestAnimationFrame(check)
            }
          }
          check()
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)
        let bandX = 0
        let bandWidth = canvas.width
        let bandTop = 0
        let bandHeight = canvas.height
        if (band === 'top-quarter' || band === 'bottom-quarter') {
          bandHeight = Math.max(1, Math.floor(canvas.height / 4))
          bandTop = band === 'bottom-quarter' ? canvas.height - bandHeight : 0
        } else {
          bandWidth = Math.max(1, Math.floor(canvas.width / 5))
          bandX = band === 'right-fifth' ? canvas.width - bandWidth : 0
        }
        const data = ctx.getImageData(bandX, bandTop, bandWidth, bandHeight).data
        const pixels = data.length / 4
        let r = 0
        let b = 0
        for (let index = 0; index < data.length; index += 4) {
          r += data[index]
          b += data[index + 2]
        }
        return { r: r / pixels, b: b / pixels, duration }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, band },
  )
}

/** Strong presence of a slate's own color channel in a band average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60

test('a wipe-from-left exports with the incoming clip revealed from the left (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'wipe-from-left')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-wipe (0.75 s from the end = overlap middle): the left of the frame
  // shows the incoming blue behind the wipe's edge, the right still the
  // outgoing red — and neither side is a blend, the edge is a hard reveal.
  const left = await sampleBand(page, exported, 0.75, 'left-fifth')
  const right = await sampleBand(page, exported, 0.75, 'right-fifth')
  expect(left.duration).toBeGreaterThan(1.5 * 0.6)
  expect(left.duration).toBeLessThan(1.5 + 1)
  expect(left.b).toBeGreaterThan(DOMINANT)
  expect(left.r).toBeLessThan(ABSENT)
  expect(right.r).toBeGreaterThan(DOMINANT)
  expect(right.b).toBeLessThan(ABSENT)

  // Deep in the final slate the wipe is over: the whole frame is blue.
  const late = await sampleBand(page, exported, 0.2, 'right-fifth')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})

test('a push-from-above exports with the incoming clip pushing the outgoing one down (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'push-from-above')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-push: the incoming blue occupies the top half while the outgoing
  // red, pushed down in lockstep, still fills the bottom.
  const top = await sampleBand(page, exported, 0.75, 'top-quarter')
  const bottom = await sampleBand(page, exported, 0.75, 'bottom-quarter')
  expect(top.duration).toBeGreaterThan(1.5 * 0.6)
  expect(top.duration).toBeLessThan(1.5 + 1)
  expect(top.b).toBeGreaterThan(DOMINANT)
  expect(top.r).toBeLessThan(ABSENT)
  expect(bottom.r).toBeGreaterThan(DOMINANT)
  expect(bottom.b).toBeLessThan(ABSENT)

  // Before the overlap begins the frame is still all red.
  const early = await sampleBand(page, exported, 1.3, 'top-quarter')
  expect(early.r).toBeGreaterThan(DOMINANT)
  expect(early.b).toBeLessThan(ABSENT)
})
