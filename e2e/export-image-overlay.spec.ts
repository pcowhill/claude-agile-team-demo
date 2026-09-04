import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { SampleRect } from './decodedFrame'

type Page = import('@playwright/test').Page

/**
 * Export of still overlay layers (#295): the exported file must show the
 * still where and when the preview shows it (#294), alpha included. The
 * fixture mirrors `image-overlay.spec.ts` — which proves the same properties
 * about the *preview* by screenshot — decoded from a real export instead:
 * a red slate base with a half-transparent PNG as an overlay, so the card's
 * opaque half must decode green and its transparent half must decode the red
 * base showing through.
 *
 * The PNG is 16:9, exactly the shape of the default overlay card, so it
 * fills the card with no letterbox gutters to reason about: a slate-only
 * sequence composes at the 640×360 fallback frame, and the card at
 * (0.62, 0.62)–(0.97, 0.97) is therefore 224×126 px — 16:9, because a
 * square fraction of a 16:9 frame is 16:9.
 */

/**
 * A real PNG with alpha: the left half opaque green, the right half fully
 * transparent. Generated in the browser so the actual encoder and decoder
 * handle it, as `image-overlay.spec.ts` does.
 */
async function makeHalfTransparentPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 36
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgb(0, 200, 0)'
    ctx.fillRect(0, 0, canvas.width / 2, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

/**
 * The exported file's loudest sample, or `null` when it carries no decodable
 * audio at all. Both answers satisfy "a still contributes no audio source":
 * a PNG has no sound, and the only thing that could put one in the mix is a
 * replay element, which a still overlay never gets.
 */
async function peakOf(page: Page, media: Buffer): Promise<number | null> {
  return await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(bytes.buffer)
      const samples = buffer.getChannelData(0)
      let peak = 0
      for (let index = 0; index < samples.length; index++) {
        peak = Math.max(peak, Math.abs(samples[index]))
      }
      return peak
    } catch {
      return null
    } finally {
      await context.close()
    }
  }, media.toString('base64'))
}

/** Exports with the current settings and returns the file's bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

// Both squares sit inside the card (0.62–0.97 on each axis) and well inside
// their own half of it: the picture's halves meet at x 0.795 of the frame.
const CARD_OPAQUE_HALF: SampleRect = { x: 0.66, y: 0.7, width: 0.06, height: 0.06 }
const CARD_ALPHA_HALF: SampleRect = { x: 0.87, y: 0.7, width: 0.06, height: 0.06 }

test('an exported still overlay shows its picture and its alpha (#295)', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('./')

  // The base: the default red slate (#143), trimmed short for export speed.
  await page.getByRole('button', { name: 'Add color slate to timeline' }).click()
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('1.5')
  await slateDuration.blur()

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'logo.png', mimeType: 'image/png', buffer: await makeHalfTransparentPng(page) },
  ])
  await page.getByRole('button', { name: 'Add logo.png as overlay' }).click()

  // Inside the still's window (its default 5s length covers the whole
  // sequence), the card decodes as the picture over the base: green where
  // the PNG is opaque, and the slate's red through its transparent half —
  // the property a logo or a watermark depends on.
  const exported = await exportOnce(page)
  const opaque = await sampleExportedFrame(page, exported, 0.6, CARD_OPAQUE_HALF)
  const alpha = await sampleExportedFrame(page, exported, 0.6, CARD_ALPHA_HALF)

  // The output frame is decided by the sequence's own sources (#176): an
  // overlay's fractional rectangle never reshapes it.
  expect(opaque.width).toBe(640)
  expect(opaque.height).toBe(360)

  expect(opaque.g, `opaque half ${JSON.stringify(opaque)}`).toBeGreaterThan(opaque.r + 60)
  expect(alpha.r, `alpha half ${JSON.stringify(alpha)}`).toBeGreaterThan(alpha.g + 60)

  // Outside the window it is simply not in the file. Shortening the still's
  // Length to 0.3s puts the sampled instant (0.6s before the end of a 1.5s
  // export) past its end, so the card decodes as the bare red base.
  const stillLength = page.getByRole('spinbutton', {
    name: 'Duration of overlay logo.png at position 1 in seconds',
  })
  await stillLength.fill('0.3')
  await stillLength.blur()

  const afterEnd = await sampleExportedFrame(page, await exportOnce(page), 0.6, CARD_OPAQUE_HALF)
  expect(afterEnd.r, `past the window ${JSON.stringify(afterEnd)}`).toBeGreaterThan(
    afterEnd.g + 60,
  )

  // A still contributes no audio source to the mix: the file is silent (or
  // carries no audio track at all) over a slate base with no other sound.
  // The stronger evidence is that this export completed — a still wired into
  // the replay path would have stalled it on a <video> that cannot load an
  // image, which is the failure the old deliberate skip existed to prevent.
  const peak = await peakOf(page, exported)
  if (peak !== null) expect(peak, `exported peak ${peak}`).toBeLessThan(0.01)
})
