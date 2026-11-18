import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoVerticalPageScroll, expectWithin } from './layout'
import { choosePreviewLayout, expectPreviewLayout } from './previewView'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page

/**
 * Fit to width (#667, from the customer's #660): the preview stays in its
 * Default place beside the media library, and its picture takes the panel's
 * whole width, height following the frame's aspect, instead of the largest
 * frame that fits the panel's height. The top row grows to fit and the
 * editor column — not the page — scrolls for it.
 *
 * Measured on a populated project (`development.md`: an empty panel cannot
 * overflow): fourteen clips in the library, as `app-fit.spec.ts` uses, and a
 * real 16:9 recording on the timeline, so the stage holds a decoded picture.
 */

const LIBRARY_CLIPS = 14

/** A 1 s solid-colour 320×180 WebM, recorded in the page. */
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
        ctx.fillStyle = 'rgb(0, 120, 205)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1000) resolve()
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

/** Fourteen tiny WAVs in the library and a 16:9 recording on the timeline. */
async function populate(page: Page): Promise<void> {
  const input = page.getByTestId('clip-file-input')
  await input.setInputFiles([
    ...Array.from({ length: LIBRARY_CLIPS }, (_, i) => ({
      name: `clip-${String(i + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: sineWav(0.2),
    })),
    { name: 'wide.webm', mimeType: 'video/webm', buffer: await recordWebm(page) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(LIBRARY_CLIPS + 1)
  await page.getByRole('button', { name: 'Add wide.webm to timeline' }).click()
  await expect(page.getByTestId('preview-frame')).toBeVisible()
}

/** The preview panel's content-box width, and the frame's and library's boxes. */
async function readLayout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('section.preview-panel')!
    const style = getComputedStyle(panel)
    const contentWidth =
      panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const frame = document.querySelector<HTMLElement>('[data-testid="preview-frame"]')!.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    const library = document.querySelector<HTMLElement>('section.library-panel')!.getBoundingClientRect()
    const column = document.querySelector<HTMLElement>('main')!
    return {
      contentWidth,
      frame: { width: frame.width, height: frame.height },
      panel: { left: panelBox.left, top: panelBox.top },
      library: { right: library.right, top: library.top },
      columnScrolls: column.scrollHeight > column.clientHeight,
    }
  })
}

test.describe('Fit to width (#667)', () => {
  test('at 1280×720 with a 16:9 canvas, the picture takes the panel\'s width beside the library, and the column scrolls, not the page', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('./')
    await populate(page)
    await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption('16:9')

    // Default first, for the PR's stated difference: height-bound here.
    await expectPreviewLayout(page, 'Default')
    const before = await readLayout(page)
    await page.screenshot({ path: testInfo.outputPath('preview-default-1280.png') })

    await choosePreviewLayout(page, 'Fit to width')
    await expectPreviewLayout(page, 'Fit to width')
    // The frame is the panel's content width and its height follows 16:9.
    // Read in one poll so width and height come from the same render.
    await expect
      .poll(async () => {
        const { contentWidth, frame } = await readLayout(page)
        return {
          widthGap: Math.abs(frame.width - contentWidth) <= 1,
          aspectGap: Math.abs(frame.height - (frame.width * 9) / 16) <= 1,
        }
      })
      .toEqual({ widthGap: true, aspectGap: true })
    const after = await readLayout(page)
    console.log(
      `Default frame ${before.frame.width.toFixed(1)}×${before.frame.height.toFixed(1)} ` +
        `(panel content ${before.contentWidth.toFixed(1)} wide); ` +
        `Fit to width ${after.frame.width.toFixed(1)}×${after.frame.height.toFixed(1)} ` +
        `(panel content ${after.contentWidth.toFixed(1)} wide)`,
    )

    // Still beside the media library, in the same row.
    expect(Math.abs(after.panel.top - after.library.top), 'preview and library share a row').toBeLessThanOrEqual(1)
    expect(after.panel.left, 'the preview is right of the library').toBeGreaterThanOrEqual(after.library.right)

    // The picture is drawn inside its panel, which a mis-sized row (the
    // `auto`-row defect App.css describes at `.app-main-preview-expanded`,
    // or a row left at Default's `minmax(40dvh, 1fr)`) would break while the
    // frame's own size stayed right.
    await expectWithin(page.getByTestId('preview-frame'), page.getByRole('region', { name: 'Preview' }), {
      what: 'the Fit to width picture',
    })
    // The page does not scroll; the editor column takes the extra height.
    await expectNoVerticalPageScroll(page, 'Fit to width at 1280×720')
    await expectNoHorizontalScroll(page, 'Fit to width at 1280×720')
    expect(after.columnScrolls, 'the editor column scrolls').toBe(true)
    await expectWithin(
      page.getByRole('list', { name: 'Imported clips' }),
      page.getByRole('region', { name: 'Media library' }),
      { axis: 'y', what: 'the library list beside the Fit to width preview' },
    )
    await page.screenshot({ path: testInfo.outputPath('preview-fit-width-1280.png') })

    // It survives a reload.
    await page.reload()
    await expectPreviewLayout(page, 'Fit to width')
    await expect(page.locator('main')).toHaveClass(/app-main-preview-fit/)

    // Expanded, for the third screenshot: the full-width first row.
    await populate(page)
    await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption('16:9')
    await choosePreviewLayout(page, 'Expanded')
    await expect(page.locator('main')).toHaveClass(/app-main-preview-expanded/)
    await page.screenshot({ path: testInfo.outputPath('preview-expanded-1280.png') })
  })

  test('with a 9:16 canvas at 1280×720, the panel stays inside the column\'s width and the column scrolls, not the page', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('./')
    await populate(page)
    await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption('9:16')
    await choosePreviewLayout(page, 'Fit to width')

    await expect
      .poll(async () => {
        const { contentWidth, frame } = await readLayout(page)
        return {
          widthGap: Math.abs(frame.width - contentWidth) <= 1,
          aspectGap: Math.abs(frame.height - (frame.width * 16) / 9) <= 1,
        }
      })
      .toEqual({ widthGap: true, aspectGap: true })
    const column = page.getByRole('main')
    await expectWithin(page.getByRole('region', { name: 'Preview' }), column, {
      axis: 'x',
      what: 'the portrait Fit to width preview panel',
    })
    // The 1381px-tall picture is inside its panel: the row grew to it rather
    // than the picture painting past the panel's border.
    await expectWithin(page.getByTestId('preview-frame'), page.getByRole('region', { name: 'Preview' }), {
      what: 'the portrait Fit to width picture',
    })
    await expectNoVerticalPageScroll(page, 'portrait Fit to width at 1280×720')
    await expectNoHorizontalScroll(page, 'portrait Fit to width at 1280×720')
    expect((await readLayout(page)).columnScrolls, 'the editor column scrolls').toBe(true)
    // The timeline below is still reachable by scrolling the column.
    const timelineHeading = page.getByRole('region', { name: 'Timeline' }).getByRole('heading', { name: 'Timeline' })
    await timelineHeading.scrollIntoViewIfNeeded()
    await expect(timelineHeading).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('preview-fit-width-portrait-1280.png') })
  })
})
