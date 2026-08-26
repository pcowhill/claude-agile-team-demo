import { expect, test } from '@playwright/test'

/**
 * Text overlays in the preview (#139): a real browser renders the overlay
 * for its window, positioned by frame fractions and sized as a fraction of
 * the stage height via container-query units — the one part jsdom cannot
 * verify (component tests pin the visibility window and the style values;
 * this proves the stage's `container-type: size` + `cqh` sizing actually
 * resolves to pixels).
 */
test('a text overlay renders over the stage, sized by the stage height', async ({ page }) => {
  await page.goto('./')

  // A slate keeps the fixture media-free: the preview stage exists as soon
  // as the sequence has an entry (#143).
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  await page.getByRole('button', { name: 'Add text overlay to timeline' }).click()

  // The default overlay (offset 0) is visible at the initial position.
  const text = page.getByTestId('preview-text-0')
  await expect(text).toHaveText('Title')
  await expect(text).toBeVisible()

  // Sized relative to the frame: the default 0.08 of the stage height.
  const stage = await page.locator('.preview-stage').boundingBox()
  expect(stage).not.toBeNull()
  const fontSize = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontSize).toBeGreaterThan(stage!.height * 0.08 - 1)
  expect(fontSize).toBeLessThan(stage!.height * 0.08 + 1)

  // Centred on the default position: the overlay's box centre sits on the
  // stage centre (within a pixel of rounding).
  const box = await text.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width / 2).toBeCloseTo(stage!.x + stage!.width / 2, 0)
  expect(box!.y + box!.height / 2).toBeCloseTo(stage!.y + stage!.height / 2, 0)

  // Past its window (default 3s of the 5s slate) the overlay is gone.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('4')
  await expect(text).not.toBeAttached()
})
