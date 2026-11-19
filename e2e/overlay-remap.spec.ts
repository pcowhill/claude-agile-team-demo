import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { sampleExportedFrame } from './decodedFrame'
import type { FrameSample, SampleRect } from './decodedFrame'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'

type Page = import('@playwright/test').Page

/**
 * Speed segments and pauses on a video overlay (#700), from decoded pixels
 * of a real export and from the preview at the same instants.
 *
 * `fixtures/overlay-colours.webm`, made with FFmpeg: 5 s of 320×180 VP8 at
 * 30 fps, one colour per second — red, green, blue, yellow, magenta — with
 * an Opus 440 Hz tone, so Firefox's export takes the overlay's audio-twin
 * path (#611) too. It is placed as an overlay from sequence time 0, over the
 * default red slate.
 *
 * The overlay carries a 2× segment over source 1 → 3 s and a 1.5 s pause on
 * source 3.5 s. So on screen:
 *
 * | sequence time | source             | colour  | remap-free |
 * |---------------|--------------------|---------|------------|
 * | 0.5           | 0.5                | red     | red        |
 * | 1.25          | 1.5 (2×)           | green   | green      |
 * | 1.75          | 2.5 (2×)           | blue    | green      |
 * | 2.25          | 3.25               | yellow  | blue       |
 * | 3.25          | 3.5, held          | yellow  | yellow     |
 * | 3.75          | 3.5, held          | yellow  | yellow     |
 * | 5             | 4.5                | magenta | base       |
 * | 5.75          | past the window    | base    | base       |
 *
 * The segment shows the colours advancing twice as fast: blue at 1.75 s,
 * where 1:1 playback is still green. The pause holds yellow from 2.5 s to
 * 4 s; without it the sequence would reach magenta at 3 s. The window
 * itself is 5 − 2 + 1 + 1.5 = 5.5 s, so magenta still shows at 5 s, when a
 * remap-free overlay would have ended. Every sample but one sits half a
 * source second from a colour change; 2.25 s (source 3.25, a quarter
 * second after the segment hands back to 1×) sits a quarter second from
 * blue → yellow, the whole of the 1× drift tolerance (0.25 s), so a flake
 * there points at the replay's re-cue after the segment rather than at the
 * mapping.
 */

const CLIP = 'overlay-colours.webm'
const POSITION = `overlay ${CLIP} at position 1`
const SLATE_SECONDS = 6.25

const SAMPLES: { time: number; colour: string }[] = [
  { time: 0.5, colour: 'red' },
  { time: 1.25, colour: 'green' },
  { time: 1.75, colour: 'blue' },
  { time: 2.25, colour: 'yellow' },
  { time: 3.25, colour: 'yellow' },
  { time: 3.75, colour: 'yellow' },
  { time: 5, colour: 'magenta' },
]
/** Past the 5.5 s window: the card's region shows the base slate. */
const AFTER = 5.75

/** The card's middle, as frame fractions: the default card (0.62, 0.62)–(0.97, 0.97). */
const CARD_MIDDLE: SampleRect = { x: 0.74, y: 0.74, width: 0.11, height: 0.11 }
/** The base, well away from the card. */
const BASE: SampleRect = { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }

type Rgb = Pick<FrameSample, 'r' | 'g' | 'b'>
/**
 * One of the fixture's five colours, or the reading itself. Each channel is
 * either near 255 or near 0 in the source, so "high" above 150 and "low"
 * below 100 leave VP8/VP9's chroma softening and the preview's scaling far
 * inside the margins. The base slate is red too, which is why the after-
 * window check compares the card's region with the base's.
 */
function colourOf(c: Rgb): string {
  const high = (v: number) => v > 150
  const low = (v: number) => v < 100
  if (high(c.r) && low(c.g) && low(c.b)) return 'red'
  if (low(c.r) && high(c.g) && low(c.b)) return 'green'
  if (low(c.r) && low(c.g) && high(c.b)) return 'blue'
  if (high(c.r) && high(c.g) && low(c.b)) return 'yellow'
  if (high(c.r) && low(c.g) && high(c.b)) return 'magenta'
  return JSON.stringify(c)
}

async function setField(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name })
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** A slate base, the colour clip as an overlay from 0, and its two effects. */
async function setUp(page: Page) {
  await chooseFromAddMenu(page, ADD_SLATE)
  await setField(page, 'Duration of Color slate at position 1 in seconds', String(SLATE_SECONDS))
  const buffer = await readFile(join('e2e', 'fixtures', CLIP))
  await page.getByTestId('clip-file-input').setInputFiles([{ name: CLIP, mimeType: 'video/webm', buffer }])
  await chooseClipAction(page, CLIP, 'Add as overlay')

  await chooseEffect(page, POSITION, 'Speed segment')
  await setField(page, `Speed segment 1 start of ${POSITION} in seconds`, '1')
  await setField(page, `Speed segment 1 end of ${POSITION} in seconds`, '3')
  await setField(page, `Speed segment 1 factor of ${POSITION}`, '2')
  await chooseEffect(page, POSITION, 'Pause')
  await setField(page, `Pause 1 position of ${POSITION} in seconds`, '3.5')
  await setField(page, `Pause 1 hold of ${POSITION} in seconds`, '1.5')
  // The row states the remapped length: 5 − 2 + 1 + 1.5. (The file is
  // 5.008 s long, so the readouts may carry a hundredth.)
  await expect(page.getByText(/plays 5(\.\d+)?s of 5(\.\d+)?s — 5\.5\d?s remapped/)).toBeVisible()
}

/** Exports with the current settings and returns the file's bytes. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return await readFile(await (await downloadPromise).path())
}

/** Per-channel average of a screenshot clip, decoded in-page. */
async function sampleScreenRect(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Rgb> {
  const png = await page.screenshot({ clip: rect })
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let r = 0
    let g = 0
    let b = 0
    const pixels = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      g += data[index + 1]
      b += data[index + 2]
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels }
  }, png.toString('base64'))
}

/** A frame-fraction region of the preview stage, sampled from the screen. */
async function samplePreview(page: Page, rect: SampleRect): Promise<Rgb> {
  const stage = page.getByTestId('preview-overlay-card-0').locator('..')
  await stage.scrollIntoViewIfNeeded()
  const box = (await stage.boundingBox())!
  return sampleScreenRect(page, {
    x: box.x + box.width * rect.x,
    y: box.y + box.height * rect.y,
    width: box.width * rect.width,
    height: box.height * rect.height,
  })
}

test("an overlay's 2× segment and pause play in the export and the preview: the colours advance twice as fast, then hold (#700)", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await setUp(page)

  const exported = await exportOnce(page)
  const at = (time: number, rect: SampleRect) =>
    sampleExportedFrame(page, exported, SLATE_SECONDS - time, rect)
  for (const { time, colour } of SAMPLES) {
    const sample = await at(time, CARD_MIDDLE)
    expect(colourOf(sample), `export at ${time}s`).toBe(colour)
  }
  const after = await at(AFTER, CARD_MIDDLE)
  const base = await at(AFTER, BASE)
  expect(colourOf(after), `export card region after the window`).toBe(colourOf(base))
  expect(colourOf(base), 'export base').toBe('red')

  // The preview, paused at the same instants: the same classification.
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  for (const { time, colour } of SAMPLES) {
    await seek.fill(String(time))
    await expect
      .poll(async () => colourOf(await samplePreview(page, CARD_MIDDLE)), { message: `preview at ${time}s` })
      .toBe(colour)
  }
  await seek.fill(String(AFTER))
  await expect(page.getByTestId('preview-overlay-card-0')).toHaveClass(/preview-overlay-hidden/)
  await expect.poll(async () => colourOf(await samplePreview(page, CARD_MIDDLE))).toBe('red')
})

test("an overlay's speed segment and pause fields stay inside the editor column at 360px (#700)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('./')
  // Populated: a base entry under the overlay, as #534 asks of a layout check.
  await setUp(page)
  const column = page.getByRole('main')
  const controls = [
    page.getByRole('spinbutton', { name: `Speed segment 1 start of ${POSITION} in seconds` }),
    page.getByRole('spinbutton', { name: `Speed segment 1 factor of ${POSITION}` }),
    page.getByRole('button', { name: `Remove speed segment 1 from ${POSITION}` }),
    page.getByRole('spinbutton', { name: `Pause 1 hold of ${POSITION} in seconds` }),
    page.getByRole('button', { name: `Remove pause 1 from ${POSITION}` }),
    page.getByRole('button', { name: `+ Effect on ${POSITION}`, exact: true }),
  ]
  for (const [index, control] of controls.entries()) {
    await expectWithin(control, column, { axis: 'x', what: `remap control ${index + 1} at 360px` })
  }
  await expectNoHorizontalScroll(page, '360px with overlay remaps')
})
