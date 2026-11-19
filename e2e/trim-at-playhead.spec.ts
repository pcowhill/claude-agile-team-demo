import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Q's landing (#754), in a real browser: after Q trims the entry under the
 * playhead to start there, the playhead sits on the entry's new start and
 * the preview shows the frame Q was pressed on — not one later by the
 * amount cut. The clip is `fixtures/trim-clip.webm` (6 s, 30 fps).
 */

const CLIP = 'trim-clip.webm'
const ENTRY = `${CLIP} at position 1`

test('Q 2 s in trims In to 2, and the playhead lands on 0 showing source 2 s (#754)', async ({ page }) => {
  await page.goto('./')
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await page.getByRole('button', { name: `Add ${CLIP} to timeline` }).click()
  const inField = page.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })
  await expect(inField).toHaveValue('0')

  const seekSlider = page.getByRole('slider', { name: 'Seek within sequence' })
  const preview = page.getByTestId('preview-video')
  // The transport keys act wherever the focus is not a field.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(seekSlider).toHaveValue('2')
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(2, 1)

  await page.keyboard.press('q')
  await expect(inField).toHaveValue('2')
  // The playhead is on the entry's new start, and the picture is still the
  // frame Q was pressed on. Both read in one page read, from one render.
  await expect
    .poll(() =>
      page.evaluate(() => ({
        playhead: Number(
          (document.querySelector('input[aria-label="Seek within sequence"]') as HTMLInputElement).value,
        ),
        frame:
          Math.round(
            (document.querySelector('[data-testid="preview-video"]') as HTMLVideoElement).currentTime * 10,
          ) / 10,
      })),
    )
    .toEqual({ playhead: 0, frame: 2 })
})
