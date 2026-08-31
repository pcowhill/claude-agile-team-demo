import { expect, test } from '@playwright/test'

/**
 * Fades through a color, irises, and cross-zoom in the preview (#181),
 * exercised media-free with two slates: seeking to the middle of the overlap
 * must show the mid-effect state the shared spec dictates — a dip's veil at
 * full opacity, an iris's radial-gradient mask on the incoming card, and
 * cross-zoom's scale transforms on both layers.
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

async function selectTransitionOutsideOverlap(
  page: import('@playwright/test').Page,
  type: string,
) {
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  // Leave the overlap before switching type so the re-entry re-renders the
  // transition layers from a change event.
  await seek.fill('0.25')
  await expect(page.getByTestId('preview-slate-incoming')).toHaveCount(0)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption(type)
  await seek.fill('0.75')
}

test('seeking into a fade through black shows its veil, opaque at the midpoint (#181)', async ({
  page,
}) => {
  await page.goto('./')
  await buildSlateSequence(page)

  // Outside the overlap: no veil element at all.
  await expect(page.getByTestId('preview-veil')).toHaveCount(0)
  await selectTransitionOutsideOverlap(page, 'fade-through-black')

  // Overlap middle (progress 0.5): the veil is fully opaque black and the
  // incoming card is still hidden beneath it — the swap is invisible.
  const veil = page.getByTestId('preview-veil')
  await expect(veil).toBeVisible()
  expect(await veil.evaluate((el) => el.style.backgroundColor)).toBe('rgb(0, 0, 0)')
  expect(await veil.evaluate((el) => Number(el.style.opacity))).toBeCloseTo(1, 5)
  expect(
    await page.getByTestId('preview-slate-incoming').evaluate((el) => Number(el.style.opacity)),
  ).toBe(0)

  // Late in the overlap (progress 0.8) the veil is fading back out over the
  // fully-shown incoming card.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.9')
  expect(await veil.evaluate((el) => Number(el.style.opacity))).toBeCloseTo(0.4, 5)
  expect(
    await page.getByTestId('preview-slate-incoming').evaluate((el) => Number(el.style.opacity)),
  ).toBe(1)
})

test('a fade through white dips behind a white veil (#181)', async ({ page }) => {
  await page.goto('./')
  await buildSlateSequence(page)
  await selectTransitionOutsideOverlap(page, 'fade-through-white')

  const veil = page.getByTestId('preview-veil')
  await expect(veil).toBeVisible()
  expect(await veil.evaluate((el) => el.style.backgroundColor)).toBe('rgb(255, 255, 255)')
  expect(await veil.evaluate((el) => Number(el.style.opacity))).toBeCloseTo(1, 5)
})

/**
 * First index of the painted (opaque black) and transparent color tokens in
 * a serialized gradient — browsers may serialize `#000` as `rgb(0, 0, 0)` or
 * `black`, and `transparent` as `rgba(0, 0, 0, 0)`.
 */
function stopPositions(mask: string): { painted: number; transparent: number } {
  const firstOf = (patterns: string[]) => {
    const hits = patterns.map((pattern) => mask.indexOf(pattern)).filter((index) => index >= 0)
    return hits.length === 0 ? -1 : Math.min(...hits)
  }
  return {
    transparent: firstOf(['transparent', 'rgba(0, 0, 0, 0)']),
    painted: firstOf(['rgb(0, 0, 0)', '#000', 'black']),
  }
}

test('seeking into each iris masks the incoming card with the spec ellipse (#181)', async ({
  page,
}) => {
  await page.goto('./')
  await buildSlateSequence(page)

  // Progress 0.5: radii (√½ / 2)·100 ≈ 35.36% of each frame dimension.
  await selectTransitionOutsideOverlap(page, 'iris-open')
  const incoming = page.getByTestId('preview-slate-incoming')
  await expect(incoming).toBeVisible()
  const openMask = await incoming.evaluate(
    (el) => el.style.maskImage || el.style.webkitMaskImage,
  )
  expect(openMask).toContain('radial-gradient')
  expect(openMask).toContain('35.35')
  // Open paints inside the ellipse: the painted stop comes first, then the
  // transparent one.
  const open = stopPositions(openMask)
  expect(open.painted).toBeGreaterThanOrEqual(0)
  expect(open.transparent).toBeGreaterThan(open.painted)
  // The iris card never moves.
  expect(await incoming.evaluate((el) => el.style.transform)).toBe('translate(0%, 0%)')

  // Iris close inverts the mask: transparent inside, painted outside.
  await selectTransitionOutsideOverlap(page, 'iris-close')
  await expect(incoming).toBeVisible()
  const closeMask = await incoming.evaluate(
    (el) => el.style.maskImage || el.style.webkitMaskImage,
  )
  expect(closeMask).toContain('radial-gradient')
  expect(closeMask).toContain('35.35')
  const close = stopPositions(closeMask)
  expect(close.transparent).toBeGreaterThanOrEqual(0)
  expect(close.painted).toBeGreaterThan(close.transparent)
})

test('seeking into a cross-zoom scales both layers about the centre and half-blends them (#181)', async ({
  page,
}) => {
  await page.goto('./')
  await buildSlateSequence(page)
  await selectTransitionOutsideOverlap(page, 'cross-zoom')

  // Progress 0.5: both layers at peak magnification, half blended.
  const incoming = page.getByTestId('preview-slate-incoming')
  await expect(incoming).toBeVisible()
  expect(await incoming.evaluate((el) => el.style.transform)).toBe(
    'translate(0%, 0%) scale(2.5)',
  )
  expect(await incoming.evaluate((el) => Number(el.style.opacity))).toBeCloseTo(0.5, 5)
  expect(await page.getByTestId('preview-slate').evaluate((el) => el.style.transform)).toBe(
    'scale(2.5)',
  )
})
