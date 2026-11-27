import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { sineWav } from './sineWav'
import { chooseEffect } from './timelineRowMenu'

/**
 * Volume change on an audio track (#1025, step 1b(i)): + Effect ▾ ›
 * Volume change, its row, and the gain the preview plays it at.
 *
 * The preview's gain is read from the track's own `<audio>` element, as
 * `volume-boost.spec.ts` reads it: below 1 the element's `volume` is the
 * whole of the gain. The expected values are worked out here from the rule
 * #1025 states, not read from `audioTrackGainAt`, so the spec is a second
 * reading of the rule rather than a copy of it. The export's evidence is
 * step 1b(ii)'s.
 */

const TRACK = 'audio track tone.wav at position 1'

/** A silent WebM recorded in the page: the sequence the track plays beside. */
async function silentWebm(page: Page, durationMs: number): Promise<Buffer> {
  const base64 = await page.evaluate(async (duration) => {
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
        if (performance.now() - start > duration) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, durationMs)
  return Buffer.from(base64, 'base64')
}

/** Populated (`development.md`): a clip in the sequence and a 4 s tone track beside it. */
async function clipAndTone(page: Page) {
  await page.goto('./')
  const webm = await silentWebm(page, 4000)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
}

const changeField = (page: Page, n: number, what: 'start' | 'length' | 'level') =>
  page.getByRole('spinbutton', {
    name:
      what === 'level'
        ? `Volume change ${n} level of ${TRACK} (0 to 4)`
        : `Volume change ${n} ${what} of ${TRACK} in seconds`,
    exact: true,
  })

async function setField(field: Locator, value: string) {
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

test('the preview plays a volume change at its level, on its ramp, and at full volume away from it (#1025)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await clipAndTone(page)
  await chooseEffect(page, TRACK, 'Volume change')
  // 1 s to 2 s into the track (which starts at 0), at Level 0.25.
  await setField(changeField(page, 1, 'start'), '1')
  await setField(changeField(page, 1, 'length'), '1')
  await setField(changeField(page, 1, 'level'), '0.25')

  const element = page.getByTestId('preview-audio-0')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  // The rule (#1025): the level holds from start to start + length; the
  // factor ramps linearly over 0.25 s just before and just after; 1 beyond.
  // At 0.9 s the ramp in is 0.1 s from the change: 0.25 + 0.75 × 0.1 / 0.25.
  for (const [time, gain] of [
    ['0.5', 1],
    ['0.9', 0.55],
    ['1.5', 0.25],
    ['2.1', 0.55],
    ['3', 1],
  ] as const) {
    await seek.fill(time)
    await expect
      .poll(() => element.evaluate((audio: HTMLAudioElement) => audio.volume), {
        message: `the track element's volume at ${time} s`,
      })
      .toBeCloseTo(gain, 3)
  }

  // Volume multiplies: at Volume 0.5 the change plays at 0.125.
  await setField(page.getByRole('spinbutton', { name: `Volume of ${TRACK} (0 to 4)`, exact: true }), '0.5')
  await seek.fill('1.5')
  await expect
    .poll(() => element.evaluate((audio: HTMLAudioElement) => audio.volume))
    .toBeCloseTo(0.125, 3)
})

for (const [width, height] of [
  [1280, 720],
  [360, 800],
] as const) {
  test(`a track's volume change rows lie inside the track's row, and the page does not scroll sideways, at ${width}×${height} (#1025)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height })
    await clipAndTone(page)
    await chooseEffect(page, TRACK, 'Volume change')
    await chooseEffect(page, TRACK, 'Volume change')
    const rows = page.getByTestId('audio-track-volume-change')
    await expect(rows).toHaveCount(2)
    const trackRow = rows.first().locator('xpath=ancestor::li[1]')
    for (let index = 0; index < 2; index++) {
      const row = rows.nth(index)
      const n = index + 1
      await expectWithin(row, trackRow, { axis: 'x', what: `volume change ${n}'s row` })
      for (const [what, control] of [
        ['start', changeField(page, n, 'start')],
        ['length', changeField(page, n, 'length')],
        ['level', changeField(page, n, 'level')],
        [
          'level slider',
          page.getByRole('slider', { name: `Volume change ${n} level of ${TRACK} (0 to 4) slider`, exact: true }),
        ],
        ['remove button', page.getByRole('button', { name: `Remove volume change ${n} from ${TRACK}`, exact: true })],
      ] as const) {
        await expectWithin(control, row, { axis: 'x', what: `volume change ${n}'s ${what}` })
      }
    }
    await expectNoHorizontalScroll(page, 'a track with two volume changes')
    await trackRow.screenshot({ path: testInfo.outputPath(`volume-change-${width}.png`) })
  })
}
