import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of fades through a color and irises (#181), exercised media-free
 * with two slates — a red one then a blue one — whose flat, exactly-known
 * colors let a decoded frame attribute each region to either clip (or to the
 * dip's veil) unambiguously, the export-transitions sampling approach.
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
 * averages the pixels of a patch of that frame. Sample times anchor to the
 * END of the file because export overhead pads the front: the final entry
 * always occupies the file's last second, so the overlap is exactly
 * [end − 1.0, end − 0.5] regardless of the padding (the export-transitions
 * spec's rule). `centre` is the middle tenth of the frame; `corner` the
 * top-left tenth-by-tenth — at mid-iris the centre lies inside the reveal
 * ellipse and the corner well outside it.
 */
async function samplePatch(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  patch: 'centre' | 'corner',
): Promise<{ r: number; b: number; duration: number }> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, patch }) => {
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
        const patchWidth = Math.max(1, Math.floor(canvas.width / 10))
        const patchHeight = Math.max(1, Math.floor(canvas.height / 10))
        const x = patch === 'centre' ? Math.floor((canvas.width - patchWidth) / 2) : 0
        const y = patch === 'centre' ? Math.floor((canvas.height - patchHeight) / 2) : 0
        const data = ctx.getImageData(x, y, patchWidth, patchHeight).data
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
    { base64: webm.toString('base64'), fromEndSeconds, patch },
  )
}

/** Strong presence of a slate's own color channel in a patch average. */
const DOMINANT = 150
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 60

test('a fade through black exports with the frame dipped to black at the overlap middle (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'fade-through-black')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-dip (0.75 s from the end = overlap middle): the veil dims the whole
  // frame. Real-time recording timestamps jitter a frame or two, so the
  // sampled instant may sit slightly off the exact midpoint where the veil
  // is fully opaque — the threshold below still discriminates a dip from
  // any crossfade-like blend, which would keep r + b ≈ 255 everywhere.
  const DIMMED = 110
  const centre = await samplePatch(page, exported, 0.75, 'centre')
  const corner = await samplePatch(page, exported, 0.75, 'corner')
  expect(centre.duration).toBeGreaterThan(1.5 * 0.6)
  expect(centre.duration).toBeLessThan(1.5 + 1)
  expect(centre.r).toBeLessThan(DIMMED)
  expect(centre.b).toBeLessThan(DIMMED)
  expect(corner.r).toBeLessThan(DIMMED)
  expect(corner.b).toBeLessThan(DIMMED)

  // Before the overlap the frame is still all red; deep in the final slate
  // the dip is over and the frame is all blue — the veil really ramps out.
  const early = await samplePatch(page, exported, 1.3, 'centre')
  expect(early.r).toBeGreaterThan(DOMINANT)
  expect(early.b).toBeLessThan(ABSENT)
  const late = await samplePatch(page, exported, 0.2, 'centre')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})

test('an iris-open exports with the incoming clip revealed inside a centre ellipse (#181)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('./')
  await buildSlateSequence(page, 'iris-open')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Mid-iris: the centre of the frame lies inside the reveal ellipse (the
  // incoming blue), the corner outside it (still the outgoing red) — and
  // neither is a blend, the iris edge is a hard reveal.
  const centre = await samplePatch(page, exported, 0.75, 'centre')
  const corner = await samplePatch(page, exported, 0.75, 'corner')
  expect(centre.duration).toBeGreaterThan(1.5 * 0.6)
  expect(centre.duration).toBeLessThan(1.5 + 1)
  expect(centre.b).toBeGreaterThan(DOMINANT)
  expect(centre.r).toBeLessThan(ABSENT)
  expect(corner.r).toBeGreaterThan(DOMINANT)
  expect(corner.b).toBeLessThan(ABSENT)

  // Deep in the final slate the iris is fully open: corners are blue too.
  const late = await samplePatch(page, exported, 0.2, 'corner')
  expect(late.b).toBeGreaterThan(DOMINANT)
  expect(late.r).toBeLessThan(ABSENT)
})
