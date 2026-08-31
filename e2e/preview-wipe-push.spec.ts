import { expect, test } from '@playwright/test'

/**
 * Wipes and pushes in the preview (#181), exercised media-free with two
 * slates: seeking to the middle of the overlap must show the mid-effect
 * state the shared spec dictates — a wipe's reveal as the incoming card's
 * clip-path, a push as lockstep translates on both layers.
 */

/** Two 1 s slates with a 0.5 s transition: overlap [0.5, 1.0) of 1.5 s. */
async function buildSlateSequence(page: import('@playwright/test').Page) {
  for (const position of [1, 2] as const) {
    await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
    const duration = page.getByRole('spinbutton', {
      name: `Duration of Color slate at position ${position} in seconds`,
    })
    await duration.fill('1')
    await duration.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
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

test('seeking into each wipe direction cuts the incoming card to the revealed band (#181)', async ({
  page,
}) => {
  await page.goto('./')
  await buildSlateSequence(page)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // Half-way through the overlap the reveal spans half the frame, hugging
  // the wipe's own edge — inset(top right bottom left), in the browser's
  // serialization (it collapses the left value when it equals the right).
  const cases = [
    ['wipe-from-left', 'inset(0% 50% 0% 0%)'],
    ['wipe-from-right', 'inset(0% 0% 0% 50%)'],
    ['wipe-from-above', 'inset(0% 0% 50%)'],
    ['wipe-from-below', 'inset(50% 0% 0%)'],
  ] as const
  for (const [type, clipPath] of cases) {
    // Leave the overlap before switching type so the re-entry re-renders
    // the incoming element from a change event.
    await seek.fill('0.25')
    await expect(page.getByTestId('preview-slate-incoming')).toHaveCount(0)
    await page
      .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
      .selectOption(type)
    await seek.fill('0.75')
    const incoming = page.getByTestId('preview-slate-incoming')
    await expect(incoming).toBeVisible()
    expect(await incoming.evaluate((el) => el.style.clipPath)).toBe(clipPath)
    // Wipes move nothing: the card sits at exact cover the whole time.
    expect(await incoming.evaluate((el) => el.style.transform)).toBe('translate(0%, 0%)')
  }
})

test('seeking into each push direction translates both layers in lockstep (#181)', async ({
  page,
}) => {
  await page.goto('./')
  await buildSlateSequence(page)
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })

  // Half-way: the incoming card is half a frame from its entry edge and the
  // outgoing layer half a frame out through the opposite edge.
  const cases = [
    ['push-from-left', 'translate(-50%, 0%)', 'translate(50%, 0%)'],
    ['push-from-right', 'translate(50%, 0%)', 'translate(-50%, 0%)'],
    ['push-from-above', 'translate(0%, -50%)', 'translate(0%, 50%)'],
    ['push-from-below', 'translate(0%, 50%)', 'translate(0%, -50%)'],
  ] as const
  for (const [type, incomingTransform, outgoingTransform] of cases) {
    await seek.fill('0.25')
    await expect(page.getByTestId('preview-slate-incoming')).toHaveCount(0)
    await page
      .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
      .selectOption(type)
    await seek.fill('0.75')
    const incoming = page.getByTestId('preview-slate-incoming')
    await expect(incoming).toBeVisible()
    expect(await incoming.evaluate((el) => el.style.transform)).toBe(incomingTransform)
    expect(
      await page.getByTestId('preview-slate').evaluate((el) => el.style.transform),
    ).toBe(outgoingTransform)
  }
})
