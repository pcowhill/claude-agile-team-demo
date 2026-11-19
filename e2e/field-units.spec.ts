import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'
import { ADD_TEXT, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Every number box whose value has a unit carries it inside the box, right
 * after the number (#665, from the customer's #655): `In [0 s]`,
 * `left [0%]`, `at [0.5 ×]`, and the export dialog's `[1280 px]`,
 * `[30 fps]`. Before this, the unit was loose text at the end of the row —
 * `Crop left [0] right [0] top [0] bottom [0] %` — or missing.
 *
 * The geometry is read from the rendered layout, on a populated project
 * (`development.md`: an empty panel cannot overflow), at 1280×720 and at
 * 360px, where the rows wrap. For each box:
 *   - the unit and the number both lie inside the bordered box;
 *   - the unit begins at or after the number's own box ends, so it never
 *     overlaps the number, with a realistic widest value typed in;
 *   - that value fits its input — nothing scrolled out of sight;
 *   - the unit sits on the number's line, not wrapped below it;
 * and every row stays inside the editor column, the dialog inside itself.
 */

const CLIP = 'clip.webm at position 1'
const TEXT = 'text overlay at position 1'

/**
 * Boxes by accessible name (unchanged by #665), the unit each must carry,
 * and the widest value the test types into it. Seconds take four digits and
 * a decimal (a 20-minute recording), percents 100, multipliers 0.25.
 */
const UNIT_BOXES: [name: string, unit: string, widest: string][] = [
  [`Trim in point of ${CLIP} in seconds`, 's', '1234.5'],
  [`Trim out point of ${CLIP} in seconds`, 's', '1234.5'],
  [`Audio fade-in of ${CLIP} in seconds`, 's', '12.5'],
  [`Crop left of ${CLIP} (percent)`, '%', '100'],
  [`Crop bottom of ${CLIP} (percent)`, '%', '100'],
  [`Brightness of ${CLIP} (percent)`, '%', '200'],
  [`Redaction region 1 width of ${CLIP} (percent)`, '%', '100'],
  [`Redaction region 1 end of ${CLIP} in seconds`, 's', '1234.5'],
  [`Redaction region 1 block size of ${CLIP} in pixels`, 'px', '64'],
  [`Spotlight region 1 dim of ${CLIP} (percent)`, '%', '100'],
  [`Spotlight region 1 end of ${CLIP} in seconds`, 's', '1234.5'],
  [`Zoom 1 start of ${CLIP} in seconds`, 's', '123.4'],
  [`Zoom 1 scale of ${CLIP}`, '×', '2.25'],
  [`Speed segment 1 start of ${CLIP} in seconds`, 's', '123.4'],
  [`Speed segment 1 factor of ${CLIP}`, '×', '0.25'],
  [`Pause 1 hold of ${CLIP} in seconds`, 's', '12.5'],
  [`Start time of ${TEXT} in seconds`, 's', '1234.5'],
  [`Duration of ${TEXT} in seconds`, 's', '1234.5'],
]

/** Boxes that hold a 0–1 fraction, which #665 leaves unitless on purpose. */
const UNITLESS_BOXES = [
  `Volume of ${CLIP} (0 to 4)`,
  `Zoom 1 centre X of ${CLIP} (0 to 1)`,
  `Centre X of ${TEXT} (0 to 1)`,
]

/**
 * Boxes whose single label is loose text in a row that wraps. A unit makes
 * each box wider, and at 360px a wrap then fell between "Fade in" and its
 * box, so these pairs are kept together (#665) as #664 keeps a multi-box
 * row's labels; the label must end within 12px left of its box, on its line.
 */
const LABELLED_BOXES: [name: string, label: string][] = [
  [`Audio fade-in of ${CLIP} in seconds`, 'Fade in'],
  [`Audio fade-out of ${CLIP} in seconds`, 'out'],
  [`Fade-in of ${TEXT} in seconds`, 'Fade in'],
  [`Fade-out of ${TEXT} in seconds`, 'out'],
]

/** The pixels from the label's right edge to its box's, or null when the label is not on the box's line. */
async function labelGap(input: Locator, label: string): Promise<number | null> {
  await input.scrollIntoViewIfNeeded()
  return input.evaluate((element, label) => {
    const box = element.parentElement!.getBoundingClientRect()
    const row = element.closest('div')!
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let best: number | null = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() !== label) continue
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        const middle = (rect.top + rect.bottom) / 2
        if (middle < box.top || middle > box.bottom || rect.right > box.left + 0.5) continue
        const gap = box.left - rect.right
        if (best === null || gap < best) best = gap
      }
    }
    return best
  }, label)
}

const EXPORT_BOXES: [name: string, unit: string, widest: string][] = [
  ['Export width in pixels', 'px', '3840'],
  ['Export height in pixels', 'px', '2160'],
  ['Export frame rate in frames per second', 'fps', '60'],
]

/** Records a short WebM, the idiom every preview spec uses. */
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
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1500) resolve()
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

/** A video entry with its picture groups, a redaction, a spotlight, a zoom, a speed segment and a pause; a text overlay. */
async function populatedProject(page: Page) {
  await page.goto('./')
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await chooseFromAddMenu(page, ADD_TEXT)
  await chooseEffect(page, CLIP, 'Zoom')
  await chooseEffect(page, CLIP, 'Speed segment')
  await chooseEffect(page, CLIP, 'Pause')
  await openPicture(page, CLIP)
  await page.getByRole('button', { name: `Add a redaction region on ${CLIP}` }).click()
  await page.getByRole('combobox', { name: `Redaction region 1 style of ${CLIP}` }).selectOption('Pixelate')
  await page.getByRole('button', { name: `Add a spotlight region on ${CLIP}` }).click()
  for (const [name] of UNIT_BOXES) {
    await expect(page.getByRole('spinbutton', { name, exact: true }), name).toBeAttached()
  }
}

interface UnitReading {
  /** The unit drawn in the box, or null when the input has no unit box. */
  unit: string | null
  box: DOMRect
  input: DOMRect
  unitRect: DOMRect | null
  /** The input's scroll and client widths: a value wider than its box scrolls. */
  scrollWidth: number
  clientWidth: number
}

/** Reads one box's unit and geometry, with `value` typed in but not committed. */
async function readUnit(input: Locator, value: string | null): Promise<UnitReading> {
  await input.scrollIntoViewIfNeeded()
  if (value !== null) await input.fill(value)
  return input.evaluate((element) => {
    const field = element as HTMLInputElement
    const box = field.parentElement!
    const unit = box.querySelector(':scope > .timeline-unit, :scope > .export-unit')
    const plain = (rect: DOMRect) => rect.toJSON() as DOMRect
    return {
      unit: unit === null ? null : (unit.textContent ?? '').trim(),
      box: plain(box.getBoundingClientRect()),
      input: plain(field.getBoundingClientRect()),
      unitRect: unit === null ? null : plain(unit.getBoundingClientRect()),
      scrollWidth: field.scrollWidth,
      clientWidth: field.clientWidth,
    }
  })
}

/**
 * The problems with one box's reading, as strings, so one run reports every
 * box at fault rather than the first. Tolerance 0.5px: the edges are
 * fractional (rem widths at 0.8rem type) and a containment check on raw
 * `getBoundingClientRect` values is exact up to sub-pixel layout rounding,
 * which never reaches half a pixel; a real fault — a unit outside its box,
 * or over its number — is several pixels.
 */
function faults(name: string, wanted: string, reading: UnitReading): string[] {
  const at = (rect: DOMRect) =>
    `${rect.left.toFixed(1)}–${rect.right.toFixed(1)} × ${rect.top.toFixed(1)}–${rect.bottom.toFixed(1)}`
  if (reading.unit !== wanted || reading.unitRect === null) {
    return [`${name}: unit ${JSON.stringify(reading.unit)}, want ${JSON.stringify(wanted)}`]
  }
  const { box, input, unitRect: unit } = reading
  const out: string[] = []
  const inside = (rect: DOMRect) =>
    rect.left >= box.left - 0.5 &&
    rect.right <= box.right + 0.5 &&
    rect.top >= box.top - 0.5 &&
    rect.bottom <= box.bottom + 0.5
  if (!inside(unit)) out.push(`${name}: unit ${at(unit)} outside its box ${at(box)}`)
  if (!inside(input)) out.push(`${name}: number ${at(input)} outside its box ${at(box)}`)
  if (unit.left < input.right - 0.5) {
    out.push(`${name}: unit starts at ${unit.left.toFixed(1)}, over the number ending ${input.right.toFixed(1)}`)
  }
  const middle = (unit.top + unit.bottom) / 2
  if (middle < input.top || middle > input.bottom) {
    out.push(`${name}: unit ${at(unit)} is not on the number's line ${at(input)}`)
  }
  // +1: scrollWidth is an integer, rounded up from a fractional content edge.
  if (reading.scrollWidth > reading.clientWidth + 1) {
    out.push(`${name}: its value needs ${reading.scrollWidth}px, the input shows ${reading.clientWidth}px`)
  }
  return out
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 640 },
]) {
  test(`each number box carries its unit inside it, after the number, at ${viewport.width}px (#665)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await populatedProject(page)
    // The editor column, as #664's spec measures: a row too wide for the
    // column widens the Timeline panel with it, so "inside the panel" would
    // hold trivially.
    const column = page.locator('main')

    const wrong: string[] = []
    for (const [name, unit, widest] of UNIT_BOXES) {
      const input = page.getByRole('spinbutton', { name, exact: true })
      const original = await input.inputValue()
      wrong.push(...faults(name, unit, await readUnit(input, widest)))
      // Put the value back: the wide draft was only typed, never committed,
      // so the original commits as no change.
      await input.fill(original)
      await input.blur()
      await expectWithin(input.locator('xpath=ancestor::div[1]'), column, {
        axis: 'x',
        what: `the row of ${name}`,
      })
    }
    for (const [name, label] of LABELLED_BOXES) {
      const gap = await labelGap(page.getByRole('spinbutton', { name, exact: true }), label)
      if (gap === null || gap > 12) wrong.push(`${name}: "${label}" is not just before its box on its line (gap ${gap})`)
    }
    for (const name of UNITLESS_BOXES) {
      const reading = await readUnit(page.getByRole('spinbutton', { name, exact: true }), null)
      if (reading.unit !== null) wrong.push(`${name}: a fraction, but it carries "${reading.unit}"`)
    }

    // Every unit box on the timeline, not only the named ones: whatever row
    // carries a unit keeps it inside its box and off its number.
    const all = page.locator('.timeline-unit-box > input')
    const count = await all.count()
    expect(count, 'unit boxes on the populated timeline').toBeGreaterThan(UNIT_BOXES.length)
    for (let index = 0; index < count; index++) {
      const input = all.nth(index)
      const name = (await input.getAttribute('aria-label')) ?? `unit box ${index}`
      const reading = await readUnit(input, null)
      wrong.push(...faults(name, reading.unit ?? '?', reading))
    }

    expect(wrong, 'boxes whose unit is missing, outside the box, over the number or wrapped').toEqual([])
    // No row still shows a loose unit beside a box that now carries one.
    const loose = await page
      .locator('main span')
      .evaluateAll((spans) =>
        spans
          .filter((span) => span.children.length === 0 && !span.closest('.timeline-unit-box'))
          .map((span) => (span.textContent ?? '').trim())
          .filter((text) => ['s', '%', '×', 'px', 's, centre'].includes(text)),
      )
    expect(loose, 'loose unit text left in a row').toEqual([])
    await expectNoHorizontalScroll(page, `at ${viewport.width}px`)

    await page.getByRole('spinbutton', { name: `Trim in point of ${CLIP} in seconds`, exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`field-units-timeline-${viewport.width}.png`) })

    // ---- The export dialog ----
    await page.getByRole('button', { name: 'Export Project…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export project' })
    await expect(dialog).toBeVisible()
    const dialogWrong: string[] = []
    for (const [name, unit, widest] of EXPORT_BOXES) {
      const input = dialog.getByRole('spinbutton', { name, exact: true })
      const original = await input.inputValue()
      dialogWrong.push(...faults(name, unit, await readUnit(input, widest)))
      await input.fill(original)
      await expectWithin(input.locator('xpath=..'), dialog, { axis: 'x', what: `the box of ${name}` })
    }
    expect(dialogWrong, 'export boxes whose unit is missing, outside the box, over the number or wrapped').toEqual(
      [],
    )
    await page.screenshot({ path: testInfo.outputPath(`field-units-export-${viewport.width}.png`) })
  })
}
