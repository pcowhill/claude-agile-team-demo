import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture } from './pictureDisclosure'
import { chooseClipAction } from './clipMenu'
import { sineWav } from './sineWav'

/**
 * The range sliders beside the single-number fields (#426, from #402's
 * approved slider polish / feedback #396) in real Chromium.
 *
 * jsdom carries the wiring — that a slider mirrors its field and that one
 * gesture is one undo step — but not the two things that matter here: a
 * range in jsdom has no thumb to drag and no native keyboard stepping, and
 * jsdom has no layout, so it cannot say whether a field and its slider still
 * share a line in rows that were already busy.
 */

/** Records a real WebM in-browser, as the audio specs do — an entry needs sound. */
async function recordWebm(page: Page): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async () => {
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
        if (performance.now() - start > 1200) resolve()
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
  return Buffer.from(webmBase64, 'base64')
}

const POSITION = 'clip.webm at position 1'
const VOLUME = `Volume of ${POSITION} (0 to 1)`

const numberField = (page: Page, label: string) => page.getByRole('spinbutton', { name: label })
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label} slider` })

async function placeClip(page: Page): Promise<void> {
  await page.goto('./')
  const webm = await recordWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(1)
}

/**
 * Drags a range to a fraction across its own track: press in the middle of
 * the control — where Chromium puts the thumb under the pointer and begins
 * a drag — then move to the target and release. Pressing on the thumb where
 * it happens to be is not reliable at the ends, where its centre sits half
 * a thumb inside the box. `fraction` outside 0..1 is deliberate: the value
 * pins to that limit, which is what makes those two positions exact.
 */
async function dragSliderTo(page: Page, control: Locator, fraction: number): Promise<void> {
  const box = (await control.boundingBox())!
  const y = box.y + box.height / 2
  const from = box.x + box.width / 2
  const target = box.x + box.width * fraction
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(from + ((target - from) * step) / 6, y)
  }
  await page.mouse.up()
}

test('a volume slider drag commits the value its number field then shows, in one undo step (#426)', async ({
  page,
}) => {
  await placeClip(page)
  const volume = slider(page, VOLUME)
  const field = numberField(page, VOLUME)
  await expect(field).toHaveValue('1')
  await expect(volume).toHaveValue('1')

  // Dragged past the left end: a range pins to its minimum, so this position
  // is exact rather than a pixel estimate.
  await dragSliderTo(page, volume, -0.5)
  await expect(field).toHaveValue('0')
  await expect(volume).toHaveValue('0')

  // One gesture, one undo step — several `input` events crossed the track on
  // the way down, and a single Undo must return to full volume.
  await page.keyboard.press('Control+z')
  await expect(field).toHaveValue('1')
  await expect(volume).toHaveValue('1')

  // A drag that lands in the middle commits whatever the thumb reached, and
  // the field reads exactly that: a step of the field's own 0.05 grid,
  // strictly between the ends.
  await dragSliderTo(page, volume, 0.25)
  const landed = Number(await field.inputValue())
  expect(landed, `the drag committed ${landed}, not a middle value`).toBeGreaterThan(0)
  expect(landed).toBeLessThan(1)
  expect(Math.round(landed * 100) % 5, `${landed} is off the field's 0.05 step`).toBe(0)
  await expect(volume).toHaveValue(String(landed))

  // Native keyboard stepping, committed on the key-up: jsdom has neither.
  await volume.focus()
  await page.keyboard.press('ArrowRight')
  await expect(field).toHaveValue(String(Math.round((landed + 0.05) * 100) / 100))
  await page.keyboard.press('Control+z')
  await expect(field).toHaveValue(String(landed))
})

test('a field and its slider share a line inside the row, at both widths (#426)', async ({
  page,
}, testInfo) => {
  await placeClip(page)
  const row = page.getByRole('list', { name: 'Sequence' }).getByRole('listitem').first()

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    // Every pair on the row: the three audio ones, and the three colour
    // dials plus the row's crop-free picture group behind the disclosure.
    await openPicture(page, POSITION)
    const pairs = row.locator('.timeline-field')
    await expect(pairs).toHaveCount(6)

    for (let index = 0; index < 6; index++) {
      const pair = pairs.nth(index)
      const number = pair.getByRole('spinbutton')
      const control = pair.getByRole('slider')
      const pairBox = (await pair.boundingBox())!
      const numberBox = (await number.boundingBox())!
      const sliderBox = (await control.boundingBox())!
      const name = await number.getAttribute('aria-label')
      // One line: the pair is no taller than its own field, give or take
      // the slider's thumb, and the two sit side by side rather than
      // stacked — a wrapped pair would be twice the height and the slider
      // would start back at the pair's left edge.
      expect(
        pairBox.height,
        `${name} and its slider wrapped at ${viewport.width}px: the pair is ` +
          `${pairBox.height.toFixed(0)}px against a ${numberBox.height.toFixed(0)}px field`,
      ).toBeLessThan(numberBox.height * 1.6)
      expect(
        sliderBox.x,
        `${name}'s slider is not beside its field at ${viewport.width}px`,
      ).toBeGreaterThanOrEqual(numberBox.x + numberBox.width - 1)
      await expectWithin(pair, row, { what: `${name} and its slider` })
    }
    await expectNoHorizontalScroll(page, `slider pairs at ${viewport.width}px`)

    await row.scrollIntoViewIfNeeded()
    await row.screenshot({
      path: testInfo.outputPath(`timeline-sliders-${viewport.width}.png`),
    })
  }
})

test('the audio track and overlay rows get the same pairs, boxed like the entry\'s (#426)', async ({
  page,
}, testInfo) => {
  await placeClip(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) }])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await chooseClipAction(page, 'clip.webm', 'Add as overlay')

  // The range rule's own width and height, measured. It had to out-specify
  // `.audio-track-gain input`, which predated ranges, until #441 scoped that
  // rule to `input[type='number']` — nothing competes for these now, and the
  // row's own screenshot and this measurement are what say so. A boxed range
  // would be 4.5rem — 72px — and taller than the 1rem the rule sets.
  for (const [row, label] of [
    ['audio track tone.wav at position 1', 'Volume of audio track tone.wav at position 1 (0 to 1)'],
    [
      'overlay clip.webm at position 1',
      'Volume of overlay clip.webm at position 1 (0 to 1)',
    ],
  ] as const) {
    const control = slider(page, label)
    const box = (await control.boundingBox())!
    expect(box.width, `${row}'s volume slider is ${box.width}px wide`).toBeGreaterThan(60)
    expect(box.width).toBeLessThan(100)
    expect(
      await control.evaluate((node) => getComputedStyle(node).borderTopWidth),
      `${row}'s volume slider kept a border`,
    ).toBe('0px')
    const pair = page.locator('.timeline-field', { has: page.getByRole('slider', { name: `${label} slider` }) })
    expect((await pair.boundingBox())!.height).toBeLessThan(
      (await numberField(page, label).boundingBox())!.height * 1.6,
    )
  }

  const trackRow = page
    .getByRole('list', { name: 'Audio tracks' })
    .getByRole('listitem')
    .first()
  await trackRow.scrollIntoViewIfNeeded()
  await trackRow.screenshot({ path: testInfo.outputPath('timeline-sliders-audio-track.png') })
  await expectNoHorizontalScroll(page, 'audio track and overlay slider pairs')
})
