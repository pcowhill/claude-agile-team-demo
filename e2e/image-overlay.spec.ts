import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Image overlay layers (#294): a logo, watermark or sticker composited above
 * the sequence. What only a real browser can show — the still sitting at its
 * fractional rectangle inside the frame, and a transparent PNG letting the
 * base through its alpha — is checked here by decoding a screenshot; the
 * component tests pin the DOM decisions jsdom can see.
 */

/**
 * A real PNG with alpha: the left half opaque green, the right half fully
 * transparent. Generated in the browser so the actual image decoder — and
 * the actual compositor — handle it, not a hand-rolled fixture.
 */
async function makeHalfTransparentPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgb(0, 200, 0)'
    ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/** The pixel at a fraction of a screenshot's own box, as [r, g, b]. */
async function pixelAt(
  page: Page,
  png: Buffer,
  fractionX: number,
  fractionY: number,
): Promise<[number, number, number]> {
  return page.evaluate(
    async ({ base64, fractionX, fractionY }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const x = Math.min(bitmap.width - 1, Math.floor(bitmap.width * fractionX))
      const y = Math.min(bitmap.height - 1, Math.floor(bitmap.height * fractionY))
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
      return [r, g, b] as [number, number, number]
    },
    { base64: png.toString('base64'), fractionX, fractionY },
  )
}

test('a still overlay renders above the base at its rectangle, with its alpha intact', async ({
  page,
}) => {
  await page.goto('./')

  // A red slate keeps the base media-free and gives a colour the overlay's
  // transparent half must show through (#143).
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'logo.png', mimeType: 'image/png', buffer: await makeHalfTransparentPng(page) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add logo.png as overlay' }).click()

  // The Overlays lane lists it, with the still's own window control and no
  // audio controls at all.
  await expect(page.getByRole('list', { name: 'Overlay layers' })).toBeVisible()
  const position = 'overlay logo.png at position 1'
  await expect(
    page.getByRole('spinbutton', { name: `Duration of ${position} in seconds` }),
  ).toHaveValue('5')
  await expect(
    page.getByRole('spinbutton', { name: `Trim in point of ${position} in seconds` }),
  ).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: `Mute ${position}` })).toHaveCount(0)

  // Inside its window (the whole default 5s from sequence start) the still
  // sits at the default rectangle — 35% of the frame, inset bottom-right.
  const card = page.getByTestId('preview-overlay-card-0')
  await expect(page.getByTestId('preview-overlay-0')).toBeVisible()
  const frame = await page.getByTestId('preview-frame').boundingBox()
  const box = await card.boundingBox()
  expect(frame).not.toBeNull()
  expect(box).not.toBeNull()
  expect(box!.width / frame!.width).toBeCloseTo(0.35, 1)
  expect(box!.height / frame!.height).toBeCloseTo(0.35, 1)
  expect((box!.x - frame!.x) / frame!.width).toBeCloseTo(0.62, 1)
  expect((box!.y - frame!.y) / frame!.height).toBeCloseTo(0.62, 1)

  // The composite itself: the still's opaque half is green, and the base
  // shows red through its transparent half — the alpha a logo or a sticker
  // depends on. The image letterboxes inside the card (object-fit: contain),
  // a 4:3 picture in a 16:9 card, so it spans the middle 75% of the card's
  // width: 30% and 70% across the card land inside the picture's two halves.
  const shot = await card.screenshot()
  const [leftR, leftG] = await pixelAt(page, shot, 0.3, 0.5)
  expect(leftG).toBeGreaterThan(120)
  expect(leftR).toBeLessThan(120)
  const [rightR, rightG] = await pixelAt(page, shot, 0.7, 0.5)
  expect(rightR).toBeGreaterThan(120)
  expect(rightG).toBeLessThan(120)

  // Outside the window it is gone: shorten it to 2s and seek past the end.
  const duration = page.getByRole('spinbutton', { name: `Duration of ${position} in seconds` })
  await duration.fill('2')
  await duration.blur()
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('3')
  await expect(page.getByTestId('preview-overlay-0')).not.toBeVisible()
})
