import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * Section-level collapse (#300): fold a lane to its heading, and the
 * timeline-wide Collapse all / Expand all fold and unfold every section
 * along with every element.
 */

/** Records a short real WebM in-browser as decodable video source material. */
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
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = '#36a'
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
  })
  return Buffer.from(webmBase64, 'base64')
}

test('folding a lane keeps its heading; Collapse all leaves only headings; Expand all restores the full view (#300)', async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  const input = page.getByTestId('clip-file-input')
  await input.setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await input.setInputFiles([{ name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) }])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await page.getByRole('button', { name: 'Add text overlay to timeline' }).click()

  const timeline = page.getByRole('region', { name: 'Timeline' })
  const sequence = page.getByRole('list', { name: 'Sequence' })
  const audio = page.getByRole('list', { name: 'Audio tracks' })
  const texts = page.getByRole('list', { name: 'Text overlays' })
  const trimIn = page.getByRole('spinbutton', {
    name: 'Trim in point of clip.webm at position 1 in seconds',
  })
  const audioStart = page.getByRole('spinbutton', {
    name: 'Start time of audio track tone.wav at position 1 in seconds',
  })
  await expect(sequence).toBeVisible()
  await expect(audio).toBeVisible()
  await expect(texts).toBeVisible()
  await expect(trimIn).toBeVisible()
  await expect(audioStart).toBeVisible()
  const expandedHeight = (await timeline.boundingBox())!.height

  // Fold Audio: its list is gone, its heading stays with the expand control.
  await page.getByRole('button', { name: 'Collapse Audio section' }).click()
  await expect(audio).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Audio' })).toBeVisible()
  const unfoldAudio = page.getByRole('button', { name: 'Expand Audio section' })
  await expect(unfoldAudio).toHaveAttribute('aria-expanded', 'false')
  // The other lanes are untouched.
  await expect(trimIn).toBeVisible()
  await expect(texts).toBeVisible()

  // Timeline-wide Collapse all: only the headings remain.
  await page.getByRole('button', { name: 'Collapse all timeline elements' }).click()
  await expect(sequence).toHaveCount(0)
  await expect(audio).toHaveCount(0)
  await expect(texts).toHaveCount(0)
  for (const title of ['Sequence', 'Audio', 'Text']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByRole('button', { name: `Expand ${title} section` })).toBeVisible()
  }
  // Row controls only: the header's default subtitle style fields (#250) stay.
  await expect(timeline.getByRole('spinbutton', { name: /Trim in point|Start time|Duration of/ })).toHaveCount(0)
  const foldedHeight = (await timeline.boundingBox())!.height
  expect(foldedHeight).toBeLessThan(expandedHeight)

  // Expand all: the previous full view returns.
  await page.getByRole('button', { name: 'Expand all timeline elements' }).click()
  await expect(sequence).toBeVisible()
  await expect(audio).toBeVisible()
  await expect(texts).toBeVisible()
  await expect(trimIn).toBeVisible()
  await expect(audioStart).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' }),
  ).toBeVisible()
  const restoredHeight = (await timeline.boundingBox())!.height
  expect(restoredHeight).toBeGreaterThan(foldedHeight)
})

test("a folded section's own Expand all unfolds it and shows its rows (#360)", async ({
  page,
}) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  const input = page.getByTestId('clip-file-input')
  await input.setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()

  // Fold the Sequence section: its rows are hidden, its heading row (with
  // the Expand all button) remains — the state the customer clicked in (#354).
  await page.getByRole('button', { name: 'Collapse Sequence section' }).click()
  const sequence = page.getByRole('list', { name: 'Sequence' })
  await expect(sequence).toHaveCount(0)

  await page.getByRole('button', { name: 'Expand all Sequence elements' }).click()
  // The observable a jsdom test cannot see: the rows are visible on screen.
  await expect(sequence).toBeVisible()
  await expect(sequence.getByRole('listitem')).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Trim in point of clip.webm at position 1 in seconds' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collapse Sequence section' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})
