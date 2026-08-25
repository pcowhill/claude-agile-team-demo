import { expect, test } from '@playwright/test'

/**
 * Preview layout guarantees (#128, design approved in #126):
 * - A: the preview row never shrinks below a usable floor (40% of the
 *   viewport); a busy timeline pushes the page into vertical scrolling
 *   instead of crushing the preview.
 * - B: an expand toggle makes the preview span the full content width, its
 *   height following the playing video's own aspect ratio, and the choice
 *   survives a reload.
 *
 * The viewport is pinned so the geometry asserted below is stable by
 * construction (#116/#117 lesson: specs deriving assertions from live layout
 * must pin the layout inputs they depend on).
 */
test.use({ viewport: { width: 1280, height: 900 } })

const VIEWPORT_HEIGHT = 900

/** Records a real WebM in-browser so the preview has decodable video; the
 * frame size is parameterized so the expand test can prove the stage follows
 * the video's own aspect ratio rather than a hardcoded 16:9. */
async function recordWebm(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
): Promise<Buffer> {
  const webmBase64 = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
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
          ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > 1200) resolve()
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
    },
    { width, height },
  )
  return Buffer.from(webmBase64, 'base64')
}

async function importClip(
  page: import('@playwright/test').Page,
  name: string,
  width: number,
  height: number,
) {
  const webm = await recordWebm(page, width, height)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name, mimeType: 'video/webm', buffer: webm }])
  await expect(page.getByRole('button', { name: `Add ${name} to timeline` })).toBeVisible()
}

test('a busy timeline scrolls the page instead of crushing the preview (#128 A)', async ({
  page,
}) => {
  await page.goto('./')
  await importClip(page, 'clip.webm', 320, 180)

  // Enough entries that the timeline alone far exceeds the viewport.
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  }
  await expect(page.getByTestId('preview-now-playing')).toContainText('of 8')

  // The preview row holds its floor: 40% of the viewport for the panel…
  const panel = (await page.getByRole('region', { name: 'Preview' }).boundingBox())!
  expect(panel.height).toBeGreaterThanOrEqual(VIEWPORT_HEIGHT * 0.4 - 1)
  // …which leaves the video stage a genuinely usable picture, not a sliver.
  const stage = (await page.getByTestId('preview-video').boundingBox())!
  expect(stage.height).toBeGreaterThanOrEqual(180)

  // The overflow went to the page, and the timeline is reachable by scroll.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight,
  )
  expect(scrolls).toBe(true)
  const exportButton = page.getByRole('button', { name: 'Export video' })
  await exportButton.scrollIntoViewIfNeeded()
  await expect(exportButton).toBeInViewport()
})

test('expand spans the full width at the video aspect, restores, and is remembered (#128 B)', async ({
  page,
}) => {
  await page.goto('./')
  // A square clip: the expanded stage must follow THIS ratio, not 16:9.
  await importClip(page, 'square.webm', 320, 320)
  await page.getByRole('button', { name: 'Add square.webm to timeline' }).click()

  const previewPanel = page.getByRole('region', { name: 'Preview' })
  const timelinePanel = page.getByRole('region', { name: 'Timeline' })

  // Normal layout: the preview shares its row with the media library.
  const normalWidth = (await previewPanel.boundingBox())!.width
  const fullWidth = (await timelinePanel.boundingBox())!.width
  expect(normalWidth).toBeLessThan(fullWidth * 0.8)

  await page.getByRole('button', { name: 'Expand preview' }).click()

  // Expanded: full content width, stage height following the square video.
  await expect
    .poll(async () => (await previewPanel.boundingBox())!.width)
    .toBeGreaterThan(fullWidth - 2)
  await expect
    .poll(async () => {
      const stage = (await page.getByTestId('preview-video').boundingBox())!
      return stage.width / stage.height
    })
    .toBeCloseTo(1, 1)

  // The choice survives a page load (the project itself does not, so the
  // remembered state shows on the toggle rather than the stage).
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restore preview size' })).toBeVisible()

  // Restoring brings back the shared row and is itself remembered.
  await page.getByRole('button', { name: 'Restore preview size' }).click()
  await expect(page.getByRole('button', { name: 'Expand preview' })).toBeVisible()
  await importClip(page, 'clip.webm', 320, 180)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  const restoredWidth = (await previewPanel.boundingBox())!.width
  expect(restoredWidth).toBeLessThan(fullWidth * 0.8)
})
