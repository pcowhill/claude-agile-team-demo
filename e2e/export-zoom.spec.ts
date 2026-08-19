import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of the zoom effect (#65): an exported file must show the configured
 * region magnified during the hold window, and a zoom must compose with a
 * transition on the same clip. Fixtures are colour-banded (left half green,
 * right half blue) so a decoded frame reveals whether the zoom was applied:
 * zoomed into the green band's centre the whole frame reads green; unzoomed
 * it reads green|blue. Sampling anchors to the end of the file, as the
 * existing export specs do, because export overhead pads the front.
 */

/** Records a banded WebM: left half green, right half blue, every frame identical. */
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

/** Records a solid red WebM (constant brightness, every frame identical). */
async function recordRedWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = 'rgb(205, 0, 0)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
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

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

interface FrameSample {
  r: number
  g: number
  b: number
  duration: number
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * averages the pixels of a band of that frame (see export-transitions.spec).
 */
async function sampleExportedFrame(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  band: 'full' | 'left-fifth' | 'right-fifth',
): Promise<FrameSample> {
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
        // Poll instead of listening for `seeked`: the duration scan above may
        // still have a seek in flight, and its events would race a listener.
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
        if (band === 'left-fifth' || band === 'right-fifth') {
          bandWidth = Math.max(1, Math.floor(canvas.width / 5))
          bandX = band === 'right-fifth' ? canvas.width - bandWidth : 0
        }
        const data = ctx.getImageData(bandX, 0, bandWidth, canvas.height).data
        let r = 0
        let g = 0
        let b = 0
        const pixels = data.length / 4
        for (let index = 0; index < data.length; index += 4) {
          r += data[index]
          g += data[index + 1]
          b += data[index + 2]
        }
        return { r: r / pixels, g: g / pixels, b: b / pixels, duration }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, band },
  )
}

/** Strong presence of a clip's own colour channel in a frame average. */
const DOMINANT = 80
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 25

/** Sets one zoom parameter through its labelled field. */
async function fillZoomField(page: Page, label: string, value: string) {
  const field = page.getByRole('spinbutton', { name: label })
  await field.fill(value)
  await field.blur()
}

test('an export renders the zoom: the held region fills the frame (#65)', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const banded = await recordBandedWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'banded.webm', mimeType: 'video/webm', buffer: banded }])
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  const outField = page.getByRole('spinbutton', {
    name: 'Trim out point of banded.webm at position 1 in seconds',
  })
  await outField.fill('1.5')
  await outField.blur()

  // 2× zoom into the green band's centre — the canvas frame equals the only
  // source's dimensions, so frame fractions are source fractions: the green
  // half spans [0, 0.5] and the zoomed region [0, 0.5] × [0.25, 0.75] lies
  // entirely inside it. Window [0.5, 1.5]: full zoom over [0.7, 1.3].
  await page.getByRole('button', { name: 'Add zoom to banded.webm at position 1' }).click()
  await fillZoomField(page, 'Zoom start of banded.webm at position 1 in seconds', '0.5')
  await fillZoomField(page, 'Zoom ramp-in of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField(page, 'Zoom hold of banded.webm at position 1 in seconds', '0.6')
  await fillZoomField(page, 'Zoom ramp-out of banded.webm at position 1 in seconds', '0.2')
  await fillZoomField(page, 'Zoom scale of banded.webm at position 1', '2')
  await fillZoomField(page, 'Zoom centre X of banded.webm at position 1 (0 to 1)', '0.25')
  await fillZoomField(page, 'Zoom centre Y of banded.webm at position 1 (0 to 1)', '0.5')

  const exported = await exportOnce(page)

  // The file's last 1.5 s are the entry; entry time t samples at 1.5 − t.
  const before = {
    left: await sampleExportedFrame(page, exported, 1.3, 'left-fifth'),
    right: await sampleExportedFrame(page, exported, 1.3, 'right-fifth'),
  }
  const hold = await sampleExportedFrame(page, exported, 0.5, 'full')
  expect(hold.duration).toBeGreaterThan(1.5 * 0.6)
  expect(hold.duration).toBeLessThan(1.5 + 1)

  // Before the window the frame still shows the full banding …
  expect(before.left.g).toBeGreaterThan(DOMINANT)
  expect(before.left.b).toBeLessThan(ABSENT)
  expect(before.right.b).toBeGreaterThan(DOMINANT)
  expect(before.right.g).toBeLessThan(ABSENT)

  // … and inside the hold the magnified green region fills the whole frame:
  // no blue band, no letterbox black (the region never leaves the frame).
  expect(hold.g).toBeGreaterThan(DOMINANT)
  expect(hold.b).toBeLessThan(ABSENT)
  expect(hold.r).toBeLessThan(ABSENT)
})

test('a zoomed clip on the incoming side of a slide exports both effects (#65)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordRedWebm(page)
  const banded = await recordBandedWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.webm', mimeType: 'video/webm', buffer: red },
    { name: 'banded.webm', mimeType: 'video/webm', buffer: banded },
  ])
  await page.getByRole('button', { name: 'Add red.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add banded.webm to timeline' }).click()
  for (const [position, name] of [
    [1, 'red'],
    [2, 'banded'],
  ] as const) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${name}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-left')
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '1.5',
  )

  // The incoming clip zooms into its green band from its very head (a zero
  // ramp-in starts at full zoom), so its whole overlap appearance is the
  // magnified green region.
  await page.getByRole('button', { name: 'Add zoom to banded.webm at position 2' }).click()
  await fillZoomField(page, 'Zoom start of banded.webm at position 2 in seconds', '0')
  await fillZoomField(page, 'Zoom ramp-in of banded.webm at position 2 in seconds', '0')
  await fillZoomField(page, 'Zoom hold of banded.webm at position 2 in seconds', '1')
  await fillZoomField(page, 'Zoom ramp-out of banded.webm at position 2 in seconds', '0')
  await fillZoomField(page, 'Zoom scale of banded.webm at position 2', '2')
  await fillZoomField(page, 'Zoom centre X of banded.webm at position 2 (0 to 1)', '0.25')
  await fillZoomField(page, 'Zoom centre Y of banded.webm at position 2 (0 to 1)', '0.5')

  const exported = await exportOnce(page)

  // Mid-overlap (sequence 0.75 = 0.75 s from the end) the slide card covers
  // the left half of the frame. Its content is the ZOOMED incoming clip —
  // all green — where an unzoomed card would show the banded clip's right
  // (blue) half in that slice. The outgoing red clip still owns the right of
  // the frame: the zoomed card was clipped to its own slice, exactly as the
  // preview clips it (#64).
  const left = await sampleExportedFrame(page, exported, 0.75, 'left-fifth')
  const right = await sampleExportedFrame(page, exported, 0.75, 'right-fifth')
  expect(left.duration).toBeGreaterThan(1.5 * 0.6)
  expect(left.duration).toBeLessThan(1.5 + 1)

  expect(left.g).toBeGreaterThan(DOMINANT)
  expect(left.b).toBeLessThan(ABSENT)
  expect(left.r).toBeLessThan(ABSENT)
  expect(right.r).toBeGreaterThan(DOMINANT)
  expect(right.g).toBeLessThan(ABSENT)
})
