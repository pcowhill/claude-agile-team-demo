import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { GUIDE_FIXTURES_DIR, GUIDE_FIXTURE_CLIPS } from './guideFixtures'

/**
 * Records the two fixture clips the guide's screenshots import (#483):
 * `npm run guide:fixtures`, through playwright.guide.config.ts. Each is a
 * short WebM recorded in-page from a canvas — a solid colour with a label,
 * so the thumbnails and the preview read as a picture rather than noise.
 * The files are committed: a screenshot retake (`npm run guide:screenshots`)
 * then imports the same bytes every time, and its images change only when
 * the UI does. Re-run this only to change the clips themselves; a new
 * recording's exact duration differs by a frame or two, which is why the
 * clips are not recorded on every retake.
 */

async function recordLabelledWebm(page: Page, label: string, hue: number, seconds: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ label, hue, seconds }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
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
          ctx.fillStyle = `hsl(${hue}, 45%, 38%)`
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 72px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, canvas.width / 2, canvas.height / 2)
          if (performance.now() - start > seconds * 1000) resolve()
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
    { label, hue, seconds },
  )
  return Buffer.from(base64, 'base64')
}

test('record the guide fixture clips', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('./')
  mkdirSync(GUIDE_FIXTURES_DIR, { recursive: true })
  for (const clip of GUIDE_FIXTURE_CLIPS) {
    const webm = await recordLabelledWebm(page, clip.label, clip.hue, clip.seconds)
    writeFileSync(join(GUIDE_FIXTURES_DIR, clip.file), webm)
  }
})
