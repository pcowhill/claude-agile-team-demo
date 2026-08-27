import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of text overlays (#142): an exported file must carry the overlay's
 * text during its window — drawn by the real canvas `fillText` path the unit
 * tests cannot reach. The fixture is a red color slate (#143, media-free) with
 * a white overlay covering only the sequence's tail, so decoded frames reveal
 * the draw: a frame inside the window contains near-white pixels; a frame
 * before it is pure red-on-black. Sampling anchors to the end of the file, as
 * the other export specs do, because export overhead pads the front.
 */

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export video' }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * counts the frame's whitish pixels (all three channels bright) — text-white
 * against the slate's red, which never brightens green or blue.
 */
async function countWhitishPixels(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
): Promise<{ whitish: number; total: number; duration: number }> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve(video.duration)
              return
            }
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => {
              if (Number.isFinite(video.duration) && video.duration > 0) {
                resolve(video.duration)
              }
            }
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = Math.max(0, duration - fromEndSeconds)
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')!
        context.drawImage(video, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let whitish = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 150 && pixels[index + 1] > 150 && pixels[index + 2] > 150) {
            whitish++
          }
        }
        return { whitish, total: pixels.length / 4, duration }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds },
  )
}

test('an exported file shows the text overlay during its window only', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('./')

  // A 3 s red slate; a large white overlay covering [1.5, end) of it.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('3')
  await slateDuration.blur()

  await page.getByRole('button', { name: 'Add text overlay to timeline' }).click()
  const offset = page.getByRole('spinbutton', {
    name: 'Start time of text overlay at position 1 in seconds',
  })
  await offset.fill('1.5')
  await offset.blur()
  const duration = page.getByRole('spinbutton', {
    name: 'Duration of text overlay at position 1 in seconds',
  })
  await duration.fill('10')
  await duration.blur()
  // A quarter of the frame height per line: thousands of lit pixels.
  const size = page.getByRole('spinbutton', {
    name: 'Size of text overlay at position 1 (fraction of frame height)',
  })
  await size.fill('0.25')
  await size.blur()

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Inside the window (0.5 s from the end, well past 1.5 s of 3): the white
  // "Title" is on the frame.
  const inWindow = await countWhitishPixels(page, exported, 0.5)
  expect(inWindow.duration).toBeGreaterThan(3 * 0.6)
  expect(inWindow.duration).toBeLessThan(3 + 2)
  expect(inWindow.whitish).toBeGreaterThan(inWindow.total * 0.005)

  // Before the window (0.5 s from the start — export overhead only ever pads
  // the front, so this instant is at or before sequence time 0.5 s): nothing
  // white anywhere, whether the frame is the red slate or leading padding.
  const beforeWindow = await countWhitishPixels(page, exported, inWindow.duration - 0.5)
  expect(beforeWindow.whitish).toBe(0)
})
