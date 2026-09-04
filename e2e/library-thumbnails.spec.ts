import { expect, test } from '@playwright/test'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page

/**
 * The media library's thumbnail view (#311, from feedback #309): the clip
 * list becomes a responsive grid of square-ish cards, each showing the media
 * itself. What only a real browser can establish is checked here — the grid
 * putting several cards on a row, the picture boxes actually being
 * square-ish once laid out, the real decode chain producing a video capture
 * and an audio waveform, and the page not scrolling sideways at a narrow
 * viewport (#208). The component tests pin the DOM decisions jsdom can see.
 */

/** A real WebM recorded in the browser, so the capture chain runs for real. */
async function recordWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
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
  })
  return Buffer.from(base64, 'base64')
}

/** A real PNG, wider than it is tall, so cover-cropping is observable. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 32
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0c6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/** No horizontal page scroll — the #208 guard, as its own spec words it. */
async function pageOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

test('thumbnail view grids square-ish cards showing each kind of media (#311)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) },
    { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(0.6) },
  ])

  const list = page.getByRole('list', { name: 'Imported clips' })
  const cards = list.getByRole('listitem')
  await expect(cards).toHaveCount(3)

  // The list is rows until the view is switched.
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Thumbnail view' }).click()
  await expect(page.getByRole('button', { name: 'Thumbnail view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // (a) Several cards per row: at least two share a row's top edge. This is
  // the claim a grid makes and a column list cannot.
  const boxes = await cards.evaluateAll((items) =>
    items.map((item) => {
      const { x, y, width, height } = item.getBoundingClientRect()
      return { x, y, width, height }
    }),
  )
  const topRow = boxes.filter((box) => Math.abs(box.y - boxes[0].y) < 1)
  expect(topRow.length).toBeGreaterThanOrEqual(2)
  // Same row means side by side, not stacked.
  expect(topRow[1].x).toBeGreaterThan(topRow[0].x + topRow[0].width - 1)

  // (b) Every card's picture area is square-ish once laid out, whatever the
  // media's own aspect ratio (16:9 video, 3:1 image, no picture at all for
  // audio) — the cover-crop is doing the work, not the source.
  const pictures = await page
    .locator('.clip-card-picture')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { width, height } = element.getBoundingClientRect()
        return width / height
      }),
    )
  expect(pictures).toHaveLength(3)
  for (const ratio of pictures) {
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.35)
  }

  // (c) The real chains ran: a captured frame for the video (object URL →
  // decode → canvas → data URL, #193) and decoded peaks for the audio
  // (#191), plus the image itself.
  const thumbnail = page.getByTestId('clip-card-thumbnail-0')
  await expect(thumbnail).toBeVisible()
  expect(await thumbnail.getAttribute('src')).toMatch(/^data:image\/jpeg/)
  await expect(page.getByTestId('clip-card-image-1')).toBeVisible()
  const waveform = page.getByTestId('clip-card-waveform-2')
  await expect(waveform).toBeVisible()
  // A real waveform, not an empty band: the path has drawing instructions.
  expect((await waveform.locator('path').getAttribute('d'))!.length).toBeGreaterThan(10)

  // Each picture fills its box rather than sitting in a corner of it — the
  // card shows the media, it does not merely contain it.
  const pictureTestIds = ['clip-card-thumbnail-0', 'clip-card-image-1', 'clip-card-waveform-2']
  for (const [index, testId] of pictureTestIds.entries()) {
    const media = (await page.getByTestId(testId).boundingBox())!
    const box = (await page.locator('.clip-card-picture').nth(index).boundingBox())!
    // Covers the box, allowing for its 1px bottom border: an absolutely
    // positioned `inset: 0` fills the padding box, so the media is a pixel
    // shorter than the border box by design.
    expect(media.width / box.width).toBeGreaterThan(0.98)
    expect(media.height / box.height).toBeGreaterThan(0.98)
    expect(media.x).toBeCloseTo(box.x, 0)
    expect(media.y).toBeCloseTo(box.y, 0)
  }

  // (d) A card's Add really adds: the same action the row offered.
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' })).toContainText('clip.webm')

  // The choice survives a reload — a per-browser preference (#128's idiom).
  await page.reload()
  await expect(page.getByRole('button', { name: 'Thumbnail view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('thumbnail view does not scroll the page sideways at a narrow viewport (#208)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto('./')

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'a-rather-long-clip-filename-for-the-card.wav', mimeType: 'audio/wav', buffer: sineWav(0.3) },
    { name: 'tone-two.wav', mimeType: 'audio/wav', buffer: sineWav(0.3) },
    { name: 'tone-three.wav', mimeType: 'audio/wav', buffer: sineWav(0.3) },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(
    3,
  )

  const before = await pageOverflow(page)
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth)

  await page.getByRole('button', { name: 'Thumbnail view' }).click()
  await expect(page.locator('.clip-item-card').first()).toBeVisible()

  // The grid's own min-content is what could floor the library column and
  // push the page wider than the viewport; a long filename inside a card is
  // the other candidate, so one is included above.
  const after = await pageOverflow(page)
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth)
})

test('the grid inherits the library\'s bounded height and internal scrolling (#308)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')

  // Enough cards to exceed the cap at this viewport, so the claim that the
  // #308 bound "applies to the grid automatically" is measured, not assumed.
  await page.getByTestId('clip-file-input').setInputFiles(
    Array.from({ length: 18 }, (_, i) => ({
      name: `tone-${String(i + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: sineWav(0.2),
    })),
  )
  const list = page.getByRole('list', { name: 'Imported clips' })
  await expect(list.getByRole('listitem')).toHaveCount(18)

  await page.getByRole('button', { name: 'Thumbnail view' }).click()
  await expect(page.locator('.clip-item-card').first()).toBeVisible()

  const metrics = await list.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    display: getComputedStyle(element).display,
  }))
  expect(metrics.display).toBe('grid')
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  // It scrolls itself rather than pushing the timeline down the page, and
  // the controls above it stay put — #308's actual promise.
  const timelineTop = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!.y
  const importBox = (await page.getByRole('button', { name: 'Import clips' }).boundingBox())!
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(list.getByRole('listitem').last()).toBeInViewport()
  expect((await page.getByRole('region', { name: 'Timeline' }).boundingBox())!.y).toBe(timelineTop)
  expect(await page.getByRole('button', { name: 'Import clips' }).boundingBox()).toEqual(importBox)

  const overflow = await pageOverflow(page)
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})
