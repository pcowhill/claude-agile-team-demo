import { expect } from '@playwright/test'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Where to press a native range input to land on a value, measured from
 * the browser itself rather than assumed (#598).
 *
 * A range maps a pointer x over its thumb's *travel*: the box less one
 * thumb width, with the value's x at the thumb's centre. The thumb is a
 * different size in each engine, so a press placed linearly across the box
 * misses it by a different amount. In CI the half-thumb measured about 8 px
 * in Chromium and about 10 px in Firefox, where pointer coordinates also
 * arrive as whole pixels (#644). A press on the thumb grabs it in place, but
 * a press beside it jumps the value to the pointer. So a spec that means to
 * press *the thumb* must find it in the browser it runs in.
 *
 * Two probes with Alt held (so a seek slider's #391 snap cannot move them)
 * at 15 % and 85 % of the box fit the line, and every x is rounded so both
 * engines see the same pixel. The probes move the value, so they are taken
 * before the spec positions the thumb; `yFraction` lets a spec press where
 * its own clicks will, clear of anything drawn under the track.
 */
export async function measureSeekMapping(
  page: Page,
  slider: Locator,
  yFraction = 0.5,
): Promise<{ xFor: (value: number) => number; pixelSeconds: number; y: number }> {
  const box = (await slider.boundingBox())!
  const y = Math.round(box.y + box.height * yFraction)
  const probe = async (fraction: number, previous: string) => {
    const x = Math.round(box.x + fraction * box.width)
    await page.keyboard.down('Alt')
    await page.mouse.click(x, y)
    await page.keyboard.up('Alt')
    // The value has committed once it leaves the one before the press
    // (`quality-and-ci.md`: never one read straight after an input).
    await expect(slider).not.toHaveValue(previous)
    return { x, value: Number(await slider.inputValue()) }
  }
  const start = await slider.inputValue()
  const low = await probe(0.15, start)
  const high = await probe(0.85, String(low.value))
  const secondsPerPixel = (high.value - low.value) / (high.x - low.x)
  return {
    xFor: (value: number) => Math.round(low.x + (value - low.value) / secondsPerPixel),
    pixelSeconds: secondsPerPixel,
    y,
  }
}
