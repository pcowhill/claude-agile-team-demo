import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'

/**
 * Match levels (#691), with real decoding: two generated recordings about
 * 12 dB apart are measured by the browser's own `decodeAudioData`, and the
 * Volumes the action writes are read back from the fields.
 *
 * The recordings are WAVs built here in Node (the `sineWav.ts` idiom: a
 * fixed header and raw PCM, no committed binary). Each is a 440 Hz tone
 * that sounds for 0.7 s of every second and is silent for 0.3 s, so the
 * silence gate is part of what is measured: ungated, the gaps would pull
 * both readings 1.5 dB down — equally, which a 12 dB difference could not
 * see, so the gating itself is pinned by the unit tests.
 */

const RATE = 48000

/** A 4 s take at `amplitude` (0–1 of full scale), sounding 0.7 s in every second. */
function takeWav(amplitude: number, seconds = 4): Buffer {
  const count = seconds * RATE
  const buffer = Buffer.alloc(44 + count * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + count * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(RATE, 24)
  buffer.writeUInt32LE(RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(count * 2, 40)
  for (let index = 0; index < count; index++) {
    const sounding = (index / RATE) % 1 < 0.7
    const sample = sounding ? amplitude * Math.sin((2 * Math.PI * 440 * index) / RATE) : 0
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2)
  }
  return buffer
}

/** 0.4 and 0.1 of full scale: −11.0 and −23.0 dB while sounding, 12.04 dB apart. */
const LOUD = 'loud-take.wav'
const QUIET = 'quiet-take.wav'
const position = (name: string, index: number) => `audio track ${name} at position ${index}`
const volumeField = (page: Page, name: string, index: number) =>
  page.getByRole('spinbutton', { name: `Volume of ${position(name, index)} (0 to 4)` })

/** 0.004 of full scale: −51 dB while sounding, beyond even Volume 4's +12 dB of a −20 dB target. */
const FAINT = 'faint-take.wav'

async function twoTakes(page: Page, { faint = false } = {}) {
  await page.goto('./')
  const takes = [
    { name: LOUD, mimeType: 'audio/wav', buffer: takeWav(0.4) },
    { name: QUIET, mimeType: 'audio/wav', buffer: takeWav(0.1) },
    ...(faint ? [{ name: FAINT, mimeType: 'audio/wav', buffer: takeWav(0.004) }] : []),
  ]
  await page.getByTestId('clip-file-input').setInputFiles(takes)
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(takes.length)
  for (const take of takes) await page.getByRole('button', { name: `Add ${take.name} to timeline` }).click()
  await expect(volumeField(page, takes[takes.length - 1].name, takes.length)).toHaveValue('1')
}

async function chooseTarget(page: Page, value: string) {
  await chooseFromFileMenu(page, 'Settings…')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByLabel('Match levels target').selectOption(value)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

test('Match levels sets two recordings 12 dB apart to one target, and reports it (#691)', async ({
  page,
  browserName,
}) => {
  await twoTakes(page)
  // −26 dB: at or below the quieter take (−23 dB), so both are matched.
  await chooseTarget(page, '-26')
  await page.getByRole('button', { name: 'Match levels', exact: true }).click()
  const report = page.getByRole('status', { name: 'Match levels report' })
  await expect(report).toHaveText(/Match levels set 2 of 2 elements to the target\./)

  // Both fields have moved off 1 before either is read (a poll, not a read
  // straight after the click).
  await expect(volumeField(page, LOUD, 1)).not.toHaveValue('1')
  await expect(volumeField(page, QUIET, 2)).not.toHaveValue('1')
  const loud = Number(await volumeField(page, LOUD, 1).inputValue())
  const quiet = Number(await volumeField(page, QUIET, 2).inputValue())
  const apart = 20 * Math.log10(quiet / loud)
  console.log(`[${browserName}] match levels: loud ${loud}, quiet ${quiet}, ${apart.toFixed(2)} dB apart`)
  // The takes are 12.04 dB apart; matched, their Volumes are too.
  expect(Math.abs(apart - 12), `Volumes ${loud} and ${quiet} are ${apart.toFixed(2)} dB apart`).toBeLessThan(1)
  // And each lands on the target: −11 + 20·log10(loud) ≈ −26.
  expect(Math.abs(-11 + 20 * Math.log10(loud) - -26)).toBeLessThan(1)

  // One Undo restores both.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(volumeField(page, LOUD, 1)).toHaveValue('1')
  await expect(volumeField(page, QUIET, 2)).toHaveValue('1')
})

test('with the default target between the takes, the quieter is raised past 1 to it (#692)', async ({ page }) => {
  await twoTakes(page)
  // The default −20 dB lies between −11 and −23.
  await page.getByRole('button', { name: 'Match levels', exact: true }).click()
  const report = page.getByRole('status', { name: 'Match levels report' })
  await expect(report).toContainText('Match levels set 2 of 2 elements to the target.')
  // −11 → −20 dB is 10^(−9/20) ≈ 0.35; −23 → −20 dB is 10^(3/20) ≈ 1.41.
  await expect.poll(async () => Number(await volumeField(page, LOUD, 1).inputValue())).toBeCloseTo(0.35, 1)
  await expect.poll(async () => Number(await volumeField(page, QUIET, 2).inputValue())).toBeCloseTo(1.41, 1)
})

test('a take more than 12 dB below the target stops at Volume 4 and is named (#692)', async ({ page }) => {
  await twoTakes(page, { faint: true })
  await page.getByRole('button', { name: 'Match levels', exact: true }).click()
  const report = page.getByRole('status', { name: 'Match levels report' })
  await expect(report).toContainText('Match levels set 2 of 3 elements to the target.')
  await expect(report).toContainText(`${FAINT} (audio, position 3): below the target even at Volume 4`)
  await expect(volumeField(page, FAINT, 3)).toHaveValue('4')
})

for (const width of [1280, 360]) {
  test(`the Match levels control and its report stay inside the timeline header at ${width}px (#691)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    // Populated (development.md): three tracks on the timeline, and the
    // report showing, which names a held-back element and is the longest
    // it gets.
    await twoTakes(page, { faint: true })
    await page.getByRole('button', { name: 'Match levels', exact: true }).click()
    const report = page.getByRole('status', { name: 'Match levels report' })
    await expect(report).toContainText('below the target')
    const timeline = page.getByRole('region', { name: 'Timeline' })
    const header = timeline.locator('.timeline-header')
    const button = page.getByRole('button', { name: 'Match levels', exact: true })
    await expectWithin(button, header, { axis: 'x', what: 'the Match levels button' })
    await expectNoWrap(button, 'the Match levels button')
    await expectWithin(report, timeline, { axis: 'x', what: 'the Match levels report' })
    await expectWithin(
      report.getByRole('button', { name: 'Dismiss the Match levels report' }),
      report,
      { what: 'the report’s ✕' },
    )
    await expectNoHorizontalScroll(page, 'with the Match levels report showing')
    await timeline.screenshot({ path: testInfo.outputPath(`match-levels-${width}.png`) })
  })
}
