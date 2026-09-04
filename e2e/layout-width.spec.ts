import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll } from './layout'

/**
 * Narrow-viewport width regression guard (#208). The app grid's `fr` tracks
 * floor at their panels' min-content, so any panel row that cannot shrink
 * widens the whole page instead — historically the media library's clip row
 * (name, badge, duration, and four buttons on one non-wrapping line) set a
 * ~540px floor that made the page scroll horizontally at viewports under
 * ~900px, and unrelated PRs discovered it as `preview-zoom` screenshot
 * failures. This spec pins the outcome the issue asks for: with a video
 * clip imported and on the timeline (the widest clip row — Add, Overlay,
 * Extract audio, Remove all present), the page must not scroll horizontally
 * at an 800px viewport. Future min-content growth fails here, deliberately,
 * instead of via an unrelated spec's screenshot probe.
 */
test.use({ viewport: { width: 800, height: 1100 } })

/** A short recorded WebM — real video, so the row shows every control. The
 * long filename matters: a nowrap clip name's min-content is the whole
 * string, so the guard also pins that a long name ellipsizes instead of
 * inflating the page (#208). */
async function recordWebm(page: import('@playwright/test').Page): Promise<Buffer> {
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
    const draw = () => {
      ctx.fillStyle = '#3a6ea5'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (performance.now() - start < 700) requestAnimationFrame(draw)
      else recorder.stop()
    }
    draw()
    await stopped
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(webmBase64, 'base64')
}

test('no horizontal page scroll at an 800px viewport with a video clip in play (#208)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'my-vacation-video-part-1.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add my-vacation-video-part-1.webm to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)

  // Every clip-row control is present and usable — shrinking must not cost
  // any of them (#208 acceptance criteria).
  for (const name of [
    'Add my-vacation-video-part-1.webm to timeline',
    'Add my-vacation-video-part-1.webm as overlay',
    'Extract audio from my-vacation-video-part-1.webm',
    'Remove my-vacation-video-part-1.webm from library',
  ]) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }

  // The guard itself: the page lays out within the viewport instead of
  // scrolling horizontally. The shared assertion counts every overflowing
  // descendant, so this catches any panel's min-content floor pushing the
  // grid wide — not just the media library's. It measures against
  // `clientWidth` where this spec used `window.innerWidth`, which is
  // stricter by the scrollbar's width; see ./layout for why.
  await expectNoHorizontalScroll(page, 'video clip imported and on the timeline')
})
