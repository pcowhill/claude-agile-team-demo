import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { choosePreviewLayout, expectPreviewLayout, openPreviewView } from './previewView'
import { ADD_TEXT, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page

/**
 * View ▾ › Full screen (#958, from the customer's #956): the composed
 * picture alone, filling the screen at the output frame's aspect, as a
 * video player's full screen shows it. The stage element goes full screen
 * through the browser's Fullscreen API, so the transport, the seek bar and
 * the panel header stay behind it.
 *
 * Measured on a populated timeline: a still with a Vignette on it (a
 * picture effect, from the Visual effects plugin), an image overlay and a
 * text overlay, so the frame holds every kind of layer whose geometry is
 * frame-relative. A headless browser has no tabs or URL bar to hide; that
 * part is the customer's to verify, and `document.fullscreenElement` is the
 * evidence a session can read.
 */

const STILL = 'pattern.png'
const LOGO = 'logo.png'

/** A PNG of `width`×`height`: its left half white, its right half `fill`. */
async function pattern(page: Page, width: number, height: number, fill: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, fill }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = fill
      ctx.fillRect(width / 2, 0, width / 2, height)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { width, height, fill },
  )
  return Buffer.from(base64, 'base64')
}

/** Opens the manager and enables the Visual effects plugin. */
async function enableVisualEffects(page: Page) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Enable Visual effects' }).click()
  await expect(page.getByRole('button', { name: 'Disable Visual effects' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** The still, a Vignette on it, an image overlay and a text overlay. */
async function populate(page: Page, aspect: '16:9' | '9:16') {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: STILL, mimeType: 'image/png', buffer: await pattern(page, 640, 360, '#000') },
    { name: LOGO, mimeType: 'image/png', buffer: await pattern(page, 64, 64, '#c00') },
  ])
  await page.getByRole('button', { name: `Add ${STILL} to timeline` }).click()
  await chooseClipAction(page, LOGO, 'Add as overlay')
  await chooseFromAddMenu(page, ADD_TEXT)
  await enableVisualEffects(page)
  await chooseEffect(page, `${STILL} at position 1`, 'Vignette')
  await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption(aspect)
  await expect(page.getByTestId('preview-text-0')).toBeVisible()
  await expect(page.getByTestId('preview-picture-layers')).toHaveCount(1)
}

/** The preview's geometry, all from one render. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (element === null) return null
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const frameElement = document.querySelector('[data-testid="preview-frame"]')!
    const frame = rect(frameElement)!
    /** A box as fractions of the frame. */
    const inFrame = (element: Element | null) => {
      const box = rect(element)
      return box === null
        ? null
        : {
            x: (box.x - frame.x) / frame.width,
            y: (box.y - frame.y) / frame.height,
            width: box.width / frame.width,
            height: box.height / frame.height,
          }
    }
    const full = document.fullscreenElement
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      frame,
      fullScreen: full === null ? null : (full.getAttribute('data-testid') ?? full.tagName),
      text: inFrame(document.querySelector('[data-testid="preview-text-0"]')),
      overlay: inFrame(document.querySelector('.preview-overlay-video')),
      layersInFrame: frameElement.querySelector('[data-testid="preview-picture-layers"]') !== null,
    }
  })
}

type Geometry = Awaited<ReturnType<typeof geometry>>

/** Waits for the document's full-screen element to be the stage, or none. */
async function expectFullScreen(page: Page, on: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null), {
      message: on ? 'the stage should be the full-screen element' : 'nothing should be full screen',
    })
    .toBe(on ? 'preview-stage' : null)
}

/**
 * The frame fills the screen at its aspect: centred, touching either both
 * sides or the top and bottom, and at the output frame's aspect. Half a
 * pixel of tolerance: the frame's size is a `min()` of container-query
 * lengths, which lays out at sub-pixel precision.
 */
function expectFillsScreen(reading: Geometry, aspect: number) {
  const { frame, viewport } = reading
  const TOLERANCE = 0.5
  expect(Math.abs(frame.x + frame.width / 2 - viewport.width / 2), 'frame centred across').toBeLessThan(TOLERANCE)
  expect(Math.abs(frame.y + frame.height / 2 - viewport.height / 2), 'frame centred down').toBeLessThan(TOLERANCE)
  const touchesSides = Math.abs(frame.width - viewport.width) < TOLERANCE
  const touchesTopAndBottom = Math.abs(frame.height - viewport.height) < TOLERANCE
  expect(
    touchesSides || touchesTopAndBottom,
    `frame ${frame.width}×${frame.height} should meet both sides or top and bottom of ${viewport.width}×${viewport.height}`,
  ).toBe(true)
  expect(Math.abs(frame.width / frame.height / aspect - 1), 'frame aspect within 1 %').toBeLessThan(0.01)
}

/** A layer's box is the same fraction of the frame, within 1 % of its width. */
function expectSameInFrame(
  before: Geometry['text'],
  after: Geometry['text'],
  what: string,
) {
  expect(before, `${what} before`).not.toBeNull()
  expect(after, `${what} in full screen`).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after![key] - before![key]), `${what}'s ${key}, as a fraction of the frame`).toBeLessThan(0.01)
  }
}

async function enterFromMenu(page: Page) {
  const menu = await openPreviewView(page)
  await menu.getByRole('menuitem', { name: 'Full screen' }).click()
  await expectFullScreen(page, true)
  // The stage takes the focus from View ▾'s trigger, in an effect after the
  // fullscreenchange render. `document.fullscreenElement` is set before
  // that, so a key pressed on the poll's heels can still reach the trigger,
  // where Space reopens the menu instead of playing.
  await expect(page.getByTestId('preview-stage')).toBeFocused()
}

test.describe('Preview full screen (#958)', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  for (const [aspect, ratio] of [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
  ] as const) {
    test(`View ▾ › Full screen fills the screen with the ${aspect} picture alone, its layers where they were`, async ({
      page,
    }, testInfo) => {
      await populate(page, aspect)
      const before = await geometry(page)
      expect(before.fullScreen).toBeNull()

      await enterFromMenu(page)
      // The frame's size follows the stage's container size, a layout
      // after the fullscreenchange: retried until it has settled.
      await expect(async () => expectFillsScreen(await geometry(page), ratio)).toPass()
      const after = await geometry(page)
      expect(after.fullScreen).toBe('preview-stage')
      expectFillsScreen(after, ratio)
      expect(after.frame.width).toBeGreaterThan(before.frame.width)
      expect(after.layersInFrame, 'the Vignette is drawn inside the full-screen frame').toBe(true)
      expectSameInFrame(before.text, after.text, 'the text overlay')
      expectSameInFrame(before.overlay, after.overlay, 'the image overlay')

      // Nothing else shows: the transport, the seek bar and View ▾ are
      // outside the full-screen element, and what is drawn at each one's
      // place belongs to the stage.
      const hidden = await page.evaluate(() => {
        const full = document.fullscreenElement!
        const controls = {
          transport: document.querySelector('.preview-controls'),
          seekBar: document.querySelector('[aria-label="Seek within sequence"]'),
          view: document.querySelector('[aria-label="Preview view"]'),
        }
        return Object.entries(controls).map(([name, element]) => {
          const r = element!.getBoundingClientRect()
          const x = Math.min(Math.max(r.x + r.width / 2, 0), window.innerWidth - 1)
          const y = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1)
          const top = document.elementFromPoint(x, y)
          return { name, inside: full.contains(element), covered: top !== null && full.contains(top) }
        })
      })
      expect(hidden).toEqual([
        { name: 'transport', inside: false, covered: true },
        { name: 'seekBar', inside: false, covered: true },
        { name: 'view', inside: false, covered: true },
      ])

      await page.screenshot({ path: testInfo.outputPath(`full-screen-${aspect.replace(':', 'x')}.png`) })
    })
  }

  test('Space plays and pauses in full screen, F leaves and enters it, ? leaves it for the cheat sheet, and F does nothing while typing', async ({
    page,
  }) => {
    await populate(page, '16:9')
    const seek = page.getByRole('slider', { name: 'Seek within sequence' })
    await enterFromMenu(page)

    // Space plays: the playhead advances, then holds once Space pauses.
    await page.keyboard.press('Space')
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(0.3)
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible()
    const held = Number(await seek.inputValue())
    await page.waitForTimeout(500)
    expect(Number(await seek.inputValue()), 'the playhead holds once paused').toBe(held)

    await page.keyboard.press('f')
    await expectFullScreen(page, false)

    // F enters from the page too, wherever the focus is not claiming keys.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('F')
    await expectFullScreen(page, true)
    await page.keyboard.press('F')
    await expectFullScreen(page, false)

    // ? opens the cheat sheet beside the picture, so it leaves full screen
    // first, and the sheet lists F.
    await page.keyboard.press('f')
    await expectFullScreen(page, true)
    await page.keyboard.press('?')
    await expectFullScreen(page, false)
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet.getByText('Show the preview full screen / leave full screen')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    // While a text field has the focus, F is a letter.
    const content = page.getByRole('textbox', { name: /^Content of text overlay/ })
    await content.click()
    await page.keyboard.press('End')
    await page.keyboard.press('f')
    await expect(content).toHaveValue('Titlef')
    await expectFullScreen(page, false)
  })

  test('leaving full screen restores the layout in use, the playhead and the remembered layout', async ({
    page,
  }) => {
    await populate(page, '16:9')
    await choosePreviewLayout(page, 'Expanded')
    const stage = page.getByTestId('preview-stage')
    const expandedBox = await stage.boundingBox()
    const seek = page.getByRole('slider', { name: 'Seek within sequence' })
    await seek.fill('1.5')
    await expect(seek).toHaveValue('1.5')
    const stored = () => page.evaluate(() => localStorage.getItem('browser-video-editor.preview-layout'))
    expect(await stored()).toBe('expanded')

    await enterFromMenu(page)
    // Esc's effect: the browser leaves full screen without asking the app.
    await page.evaluate(() => document.exitFullscreen())
    await expectFullScreen(page, false)

    await expect(stage).toHaveClass(/preview-stage-expanded/)
    await expect.poll(async () => (await stage.boundingBox())?.width).toBeCloseTo(expandedBox!.width, 0)
    await expect(seek).toHaveValue('1.5')
    expect(await stored()).toBe('expanded')
    await expectPreviewLayout(page, 'Expanded')
  })
})
