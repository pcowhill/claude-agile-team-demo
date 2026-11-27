import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { sineWav } from './sineWav'
import { chooseClipAction } from './clipMenu'
import { chooseEffect } from './timelineRowMenu'

/**
 * Volume change on an audio track (#1025, step 1b(i)): + Effect ▾ ›
 * Volume change, its row, and the gain the preview plays it at.
 *
 * The preview's gain is read from the track's own `<audio>` element, as
 * `volume-boost.spec.ts` reads it: below 1 the element's `volume` is the
 * whole of the gain. The expected values are worked out here from the rule
 * #1025 states, not read from `audioTrackGainAt`, so the spec is a second
 * reading of the rule rather than a copy of it.
 *
 * Step 1b(ii) adds the Trim window's warning for a track's changes, and the
 * export's evidence: the decoded level of the exported mix inside a change
 * against outside it, in `duck-audio.spec.ts`'s idiom.
 *
 * #1026's step 2b(i) adds the same change on a video entry: its + Effect ▾
 * item, its rows, its undo steps, and the gain the preview plays the
 * entry's own element at. Step 2b(ii) adds the entry's Trim window and its
 * export, on a clip recorded with a tone.
 *
 * #1027's step 1b adds it on a video overlay: its + Effect ▾ item, its rows,
 * its undo steps, and the gain the preview plays the overlay's own element
 * at, including behind a speed segment, where the change stays on the
 * source seconds it was set on. Step 1c adds the overlay's Trim window and
 * its export, on an overlay recorded with a tone.
 */

const TRACK = 'audio track tone.wav at position 1'

/**
 * A WebM recorded in the page: silent, as the sequence the track plays
 * beside, or with a 440 Hz tone at 0.5 (`export-audio-mix.spec.ts`'s
 * recorder) for a video entry whose own sound is measured (#1026). A tone
 * needs the page's user activation for its AudioContext.
 */
async function recordWebm(page: Page, durationMs: number, withTone: boolean): Promise<Buffer> {
  const base64 = await page.evaluate(async ({ duration, withTone }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)
    let audio: AudioContext | null = null
    if (withTone) {
      audio = new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      if (audio.state !== 'running') throw new Error(`AudioContext did not start (state: ${audio.state})`)
      const destination = audio.createMediaStreamDestination()
      const gain = audio.createGain()
      gain.gain.value = 0.5
      const oscillator = audio.createOscillator()
      oscillator.frequency.value = 440
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()
      stream.addTrack(destination.stream.getAudioTracks()[0])
    }
    const recorder = new MediaRecorder(stream, { mimeType: withTone ? 'video/webm;codecs=vp8,opus' : 'video/webm' })
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
    await audio?.close()
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, { duration: durationMs, withTone })
  return Buffer.from(base64, 'base64')
}

/** Populated (`development.md`): a clip in the sequence and a 4 s tone track beside it. */
async function clipAndTone(page: Page) {
  await page.goto('./')
  const webm = await recordWebm(page, 4000, false)
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

/** Types an Out for the Trim window to apply, as its own footer field does. */
async function setTrimOut(dialog: Locator, seconds: string) {
  const out = dialog.getByRole('spinbutton', { name: 'Out point to apply in seconds' })
  await out.fill(seconds)
  await out.blur()
  await expect(dialog.getByTestId('trim-clamp-out')).toHaveAttribute('aria-valuenow', seconds)
}

test("the Trim window marks a track's volume changes and names the ones a trim would cut into; Apply does that (#1025)", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await clipAndTone(page)
  // Volume change 1 at 0 to 2 s and Volume change 2 at 2 to 4 s: the
  // defaults, one after the other, on the 4 s track.
  await chooseEffect(page, TRACK, 'Volume change')
  await chooseEffect(page, TRACK, 'Volume change')
  await expect(changeField(page, 2, 'start')).toHaveValue('2')

  await page.getByRole('button', { name: `Trim ${TRACK} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${TRACK}` })
  await expect(dialog).toBeVisible()
  const warning = dialog.getByTestId('trim-warning')
  const marks = dialog.getByTestId('trim-effect-mark')
  const strip = dialog.getByTestId('trim-strip')

  // Untrimmed: both changes marked, inside the strip, and nothing cut.
  await expect(marks).toHaveCount(2)
  for (let index = 0; index < 2; index++) {
    await expect(marks.nth(index)).toHaveAttribute('data-kind', 'volume-change')
    await expect(marks.nth(index)).toHaveAttribute('title', `Volume change ${index + 1}`)
    await expectWithin(marks.nth(index), strip, { what: `volume change ${index + 1}'s mark` })
  }
  await expect(warning).toHaveText('')

  await setTrimOut(dialog, '3')
  await expect(warning).toHaveText('Trimming here shortens Volume change 2.')
  await setTrimOut(dialog, '1.5')
  await expect(warning).toHaveText('Trimming here shortens Volume change 1 and removes Volume change 2.')
  // A change cut to nothing has no mark.
  await expect(marks).toHaveCount(1)
  await expectWithin(marks, strip, { what: "volume change 1's mark, shortened" })
  await dialog.screenshot({ path: testInfo.outputPath('trim-window-volume-change.png') })

  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(changeField(page, 1, 'length')).toHaveValue('1.5')
  // Removed is kept at length zero at the new end, as an entry's effects are.
  await expect(changeField(page, 2, 'start')).toHaveValue('1.5')
  await expect(changeField(page, 2, 'length')).toHaveValue('0')
})

/** Decodes the exported audio and reports the loudest sample in a window. */
async function peakIn(page: Page, media: Buffer, fromSeconds: number, toSeconds: number): Promise<number> {
  return await page.evaluate(
    async ({ base64, fromSeconds, toSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(bytes.buffer)
        const samples = buffer.getChannelData(0)
        const start = Math.max(0, Math.floor(fromSeconds * buffer.sampleRate))
        const end = Math.min(samples.length, Math.ceil(toSeconds * buffer.sampleRate))
        let peak = 0
        for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(samples[index]))
        return peak
      } finally {
        await context.close()
      }
    },
    { base64: media.toString('base64'), fromSeconds, toSeconds },
  )
}

/**
 * How far the exported level inside the change may sit from the Level asked
 * for, in dB. The two windows measure the same sine through the same codec,
 * so what is left is the codec's own error on a peak. 1 dB is a ratio of
 * 0.223 to 0.281 around 0.25; a Level of 0.3 (−10.5 dB) falls outside it.
 */
const LEVEL_TOLERANCE_DB = 1

test('the export plays a volume change at its level: 0.25 is −12 dB against the track outside it (#1025)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await clipAndTone(page)
  // A click gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  await chooseEffect(page, TRACK, 'Volume change')
  // 1.5 s to 3 s into the track, at Level 0.25. Its ramps run 1.25 to 1.5 s
  // and 3 to 3.25 s, so [1.9, 2.6] is well inside and [0.3, 1.0] well clear.
  await setField(changeField(page, 1, 'start'), '1.5')
  await setField(changeField(page, 1, 'length'), '1.5')
  await setField(changeField(page, 1, 'level'), '0.25')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  const outside = await peakIn(page, exported, 0.3, 1.0)
  const inside = await peakIn(page, exported, 1.9, 2.6)
  const db = 20 * Math.log10(inside / outside)
  console.log(`volume change export: outside ${outside.toFixed(4)}, inside ${inside.toFixed(4)}, ${db.toFixed(2)} dB`)
  // Loud enough outside to be the tone, not codec noise.
  expect(outside).toBeGreaterThan(0.05)
  expect(Math.abs(db - 20 * Math.log10(0.25))).toBeLessThanOrEqual(LEVEL_TOLERANCE_DB)
})

/** The video entry `clipAndTone` adds (#1026, step 2b(i)). */
const ENTRY = 'clip.webm at position 1'

const entryChangeField = (page: Page, n: number, what: 'start' | 'length' | 'level') =>
  page.getByRole('spinbutton', {
    name:
      what === 'level'
        ? `Volume change ${n} level of ${ENTRY} (0 to 4)`
        : `Volume change ${n} ${what} of ${ENTRY} in seconds`,
    exact: true,
  })

test("the preview plays a video entry's volume change at its level, on its ramp, and at full volume away from it (#1026)", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000)
  await clipAndTone(page)
  await chooseEffect(page, ENTRY, 'Volume change')
  // The default (#1025): 2 s at Level 0.5 from the start of the trimmed range.
  await expect(entryChangeField(page, 1, 'start')).toHaveValue('0')
  await expect(entryChangeField(page, 1, 'length')).toHaveValue('2')
  await expect(entryChangeField(page, 1, 'level')).toHaveValue('0.5')
  // 1 s to 2 s into the entry (which starts the sequence), at Level 0.25.
  await setField(entryChangeField(page, 1, 'start'), '1')
  await setField(entryChangeField(page, 1, 'length'), '1')
  await setField(entryChangeField(page, 1, 'level'), '0.25')

  const video = page.getByTestId('preview-video')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  // The track's rule, worked out here rather than read from gain.ts: the
  // level from start to start + length, a linear 0.25 s ramp either side,
  // 1 beyond. At 0.9 s the ramp in is 0.1 s from the change: 0.25 + 0.75 × 0.4.
  for (const [time, gain] of [
    ['0.5', 1],
    ['0.9', 0.55],
    ['1.5', 0.25],
    ['2.1', 0.55],
    ['3', 1],
  ] as const) {
    await seek.fill(time)
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume), {
        message: `the entry's element volume at ${time} s`,
      })
      .toBeCloseTo(gain, 3)
  }

  // Volume multiplies: at Volume 0.5 the change plays at 0.125.
  await setField(page.getByRole('spinbutton', { name: `Volume of ${ENTRY} (0 to 4)`, exact: true }), '0.5')
  await seek.fill('1.5')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBeCloseTo(0.125, 3)

  // Above 1: Volume 1 × Level 2 is a gain of 2. The element holds 1 and,
  // where the preview routes (#692; not Firefox, #611), its boost the rest.
  await setField(page.getByRole('spinbutton', { name: `Volume of ${ENTRY} (0 to 4)`, exact: true }), '1')
  await setField(entryChangeField(page, 1, 'level'), '2')
  await seek.fill('1.5')
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBe(1)
  if (browserName !== 'firefox') await expect(video).toHaveAttribute('data-boost', '2')
  await page.getByRole('button', { name: 'Pause preview' }).click()
})

test("a video entry's volume change is one undo step to add, to edit and to remove (#1026)", async ({ page }) => {
  test.setTimeout(60_000)
  await clipAndTone(page)
  const rows = page.getByTestId('entry-volume-change')
  await chooseEffect(page, ENTRY, 'Volume change')
  await expect(rows).toHaveCount(1)
  await setField(entryChangeField(page, 1, 'level'), '0.25')
  await page.getByRole('button', { name: `Remove volume change 1 from ${ENTRY}`, exact: true }).click()
  await expect(rows).toHaveCount(0)

  // Undo walks back one action at a time: the removal, the edit, the add.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(1)
  await expect(entryChangeField(page, 1, 'level')).toHaveValue('0.25')
  await page.keyboard.press('Control+z')
  await expect(entryChangeField(page, 1, 'level')).toHaveValue('0.5')
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(0)
})

test("the Trim window marks a video entry's volume changes beside its zoom and names the ones a trim would cut into; Apply does that (#1026)", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await clipAndTone(page)
  // Populated: a zoom (0 to 2 s by default), then Volume change 1 at 0 to
  // 2 s and Volume change 2 from 2 s to the end of the 4 s clip.
  await chooseEffect(page, ENTRY, 'Zoom')
  await chooseEffect(page, ENTRY, 'Volume change')
  await chooseEffect(page, ENTRY, 'Volume change')
  await expect(entryChangeField(page, 2, 'start')).toHaveValue('2')

  await page.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${ENTRY}` })
  await expect(dialog).toBeVisible()
  const warning = dialog.getByTestId('trim-warning')
  const strip = dialog.getByTestId('trim-strip')
  const changeMarks = dialog.locator('[data-testid="trim-effect-mark"][data-kind="volume-change"]')

  // Untrimmed: both changes marked beside the zoom, inside the strip, and nothing cut.
  await expect(dialog.locator('[data-testid="trim-effect-mark"][data-kind="zoom"]')).toHaveCount(1)
  await expect(changeMarks).toHaveCount(2)
  for (let index = 0; index < 2; index++) {
    await expect(changeMarks.nth(index)).toHaveAttribute('title', `Volume change ${index + 1}`)
    await expectWithin(changeMarks.nth(index), strip, { what: `volume change ${index + 1}'s mark` })
  }
  await expect(warning).toHaveText('')
  // Zoom 1 and Volume change 1 span the same seconds, 0 to 2. The change's
  // bar has a lane of its own above the foot, so it never covers the zoom's:
  // read in one page read, the change's bottom edge is at or above the
  // zoom's top edge.
  const lanes = await dialog.evaluate((element) => {
    const box = (kind: string) =>
      element.querySelector(`[data-testid="trim-effect-mark"][data-kind="${kind}"]`)!.getBoundingClientRect()
    const zoomBox = box('zoom')
    const changeBox = box('volume-change')
    return { zoomTop: zoomBox.top, changeBottom: changeBox.bottom }
  })
  expect(
    lanes.changeBottom,
    `Volume change 1's mark (bottom ${lanes.changeBottom}px) overlaps Zoom 1's (top ${lanes.zoomTop}px)`,
  ).toBeLessThanOrEqual(lanes.zoomTop)

  await setTrimOut(dialog, '3')
  await expect(warning).toHaveText('Trimming here shortens Volume change 2.')
  await setTrimOut(dialog, '1.5')
  await expect(warning).toHaveText('Trimming here shortens Zoom 1, shortens Volume change 1 and removes Volume change 2.')
  // A change cut to nothing has no mark.
  await expect(changeMarks).toHaveCount(1)
  await expectWithin(changeMarks, strip, { what: "volume change 1's mark, shortened" })
  await dialog.screenshot({ path: testInfo.outputPath('trim-window-entry-volume-change.png') })

  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(entryChangeField(page, 1, 'length')).toHaveValue('1.5')
  // Removed is kept at length zero at the new end, as the entry's other effects are.
  await expect(entryChangeField(page, 2, 'start')).toHaveValue('1.5')
  await expect(entryChangeField(page, 2, 'length')).toHaveValue('0')
})

test("the export plays a video entry's volume change at its level: 0.25 is −12 dB against the clip's sound outside it (#1026)", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')
  // A click gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  // The entry alone, so the mix is its own sound: no track beside it.
  const webm = await recordWebm(page, 4000, true)
  await page.getByTestId('clip-file-input').setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await chooseEffect(page, ENTRY, 'Volume change')
  // 1.5 s to 3 s into the entry, which starts the sequence, at Level 0.25.
  // Its ramps run 1.25 to 1.5 s and 3 to 3.25 s, so [1.9, 2.6] is well
  // inside and [0.5, 1.0] well clear, and late enough for the recording's
  // tone to have begun.
  await setField(entryChangeField(page, 1, 'start'), '1.5')
  await setField(entryChangeField(page, 1, 'length'), '1.5')
  await setField(entryChangeField(page, 1, 'level'), '0.25')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  const outside = await peakIn(page, exported, 0.5, 1.0)
  const inside = await peakIn(page, exported, 1.9, 2.6)
  const db = 20 * Math.log10(inside / outside)
  console.log(
    `entry volume change export: outside ${outside.toFixed(4)}, inside ${inside.toFixed(4)}, ${db.toFixed(2)} dB`,
  )
  // Loud enough outside to be the tone, not codec noise.
  expect(outside).toBeGreaterThan(0.05)
  expect(Math.abs(db - 20 * Math.log10(0.25))).toBeLessThanOrEqual(LEVEL_TOLERANCE_DB)
})

for (const [width, height] of [
  [1280, 720],
  [360, 800],
] as const) {
  test(`a video entry's volume change rows lie inside the entry's row, and the page does not scroll sideways, at ${width}×${height} (#1026)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height })
    // Populated (development.md): the entry also carries a zoom and a
    // speed segment, so its change rows sit among the rows they follow.
    await clipAndTone(page)
    await chooseEffect(page, ENTRY, 'Zoom')
    await chooseEffect(page, ENTRY, 'Speed segment')
    await chooseEffect(page, ENTRY, 'Volume change')
    await chooseEffect(page, ENTRY, 'Volume change')
    const rows = page.getByTestId('entry-volume-change')
    await expect(rows).toHaveCount(2)
    const entryRow = rows.first().locator('xpath=ancestor::li[1]')
    for (let index = 0; index < 2; index++) {
      const row = rows.nth(index)
      const n = index + 1
      await expectWithin(row, entryRow, { axis: 'x', what: `volume change ${n}'s row` })
      for (const [what, control] of [
        ['start', entryChangeField(page, n, 'start')],
        ['length', entryChangeField(page, n, 'length')],
        ['level', entryChangeField(page, n, 'level')],
        [
          'level slider',
          page.getByRole('slider', { name: `Volume change ${n} level of ${ENTRY} (0 to 4) slider`, exact: true }),
        ],
        ['remove button', page.getByRole('button', { name: `Remove volume change ${n} from ${ENTRY}`, exact: true })],
      ] as const) {
        await expectWithin(control, row, { axis: 'x', what: `volume change ${n}'s ${what}` })
      }
    }
    await expectNoHorizontalScroll(page, 'an entry with two volume changes')
    await entryRow.screenshot({ path: testInfo.outputPath(`entry-volume-change-${width}.png`) })
  })
}

/** The video overlay `clipAndOverlay` adds (#1027, step 1b). */
const OVERLAY = 'overlay clip.webm at position 1'

const overlayChangeField = (page: Page, n: number, what: 'start' | 'length' | 'level') =>
  page.getByRole('spinbutton', {
    name:
      what === 'level'
        ? `Volume change ${n} level of ${OVERLAY} (0 to 4)`
        : `Volume change ${n} ${what} of ${OVERLAY} in seconds`,
    exact: true,
  })

/** Populated: `clipAndTone`'s clip and track, and the clip again as an overlay from 0 s. */
async function clipAndOverlay(page: Page) {
  await clipAndTone(page)
  await chooseClipAction(page, 'clip.webm', 'Add as overlay')
  await expect(page.getByTestId('preview-overlay-0')).toBeAttached()
}

test("the preview plays a video overlay's volume change at its level, on its ramp, away from it, and on its source seconds behind a speed segment (#1027)", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000)
  await clipAndOverlay(page)
  await chooseEffect(page, OVERLAY, 'Volume change')
  // The default (#1025): 2 s at Level 0.5 from the start of the trimmed range.
  await expect(overlayChangeField(page, 1, 'start')).toHaveValue('0')
  await expect(overlayChangeField(page, 1, 'length')).toHaveValue('2')
  await expect(overlayChangeField(page, 1, 'level')).toHaveValue('0.5')
  // 1 s to 2 s into the overlay (which appears at 0 s), at Level 0.25.
  await setField(overlayChangeField(page, 1, 'start'), '1')
  await setField(overlayChangeField(page, 1, 'length'), '1')
  await setField(overlayChangeField(page, 1, 'level'), '0.25')

  const element = page.getByTestId('preview-overlay-0')
  const seek = page.getByRole('slider', { name: 'Seek within sequence' })
  const expectGains = async (gains: readonly (readonly [string, number])[], where: string) => {
    for (const [time, gain] of gains) {
      await seek.fill(time)
      await expect
        .poll(() => element.evaluate((video: HTMLVideoElement) => video.volume), {
          message: `the overlay's element volume at ${time} s, ${where}`,
        })
        .toBeCloseTo(gain, 3)
    }
  }
  // The track's rule, worked out here rather than read from gain.ts: the
  // level from start to start + length, a linear 0.25 s ramp either side,
  // 1 beyond. At 0.9 s the ramp in is 0.1 s from the change: 0.25 + 0.75 × 0.4.
  await expectGains(
    [
      ['0.5', 1],
      ['0.9', 0.55],
      ['1.5', 0.25],
      ['2.1', 0.55],
      ['3', 1],
    ],
    'with no speed segment',
  )

  // A speed segment before the change: the default, source 0 to 2 s at 0.5×,
  // so source s < 2 shows 2 × s seconds after the overlay appears. The change,
  // now source 1 to 1.5 s, plays from 2 s to 3 s on screen. Unmapped, 2.5 s
  // would be source 2.5 (full volume) and 1.9 s source 1.9 (also full).
  await chooseEffect(page, OVERLAY, 'Speed segment')
  await expect(
    page.getByRole('spinbutton', { name: `Speed segment 1 factor of ${OVERLAY}`, exact: true }),
  ).toHaveValue('0.5')
  await setField(overlayChangeField(page, 1, 'length'), '0.5')
  await expectGains(
    [
      // Source 0.5: before the ramp in, which starts at 0.75.
      ['1', 1],
      // Source 0.95, 0.05 s before the change: 0.25 + 0.75 × 0.2.
      ['1.9', 0.4],
      // Source 1.25, inside the change.
      ['2.5', 0.25],
      // Source 1.8, past the ramp out, which ends at 1.75.
      ['3.6', 1],
    ],
    'behind a 0.5× speed segment',
  )

  // Above 1: Volume 1 × Level 2 is a gain of 2. The element holds 1 and,
  // where the preview routes (#692; not Firefox, #611), its boost the rest.
  await setField(overlayChangeField(page, 1, 'level'), '2')
  await seek.fill('2.5')
  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(() => element.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false)
  await expect.poll(() => element.evaluate((video: HTMLVideoElement) => video.volume)).toBe(1)
  if (browserName !== 'firefox') await expect(element).toHaveAttribute('data-boost', '2')
  await page.getByRole('button', { name: 'Pause preview' }).click()
})

test("a video overlay's volume change is one undo step to add, to edit and to remove (#1027)", async ({ page }) => {
  test.setTimeout(60_000)
  await clipAndOverlay(page)
  const rows = page.getByTestId('video-overlay-volume-change')
  await chooseEffect(page, OVERLAY, 'Volume change')
  await expect(rows).toHaveCount(1)
  await setField(overlayChangeField(page, 1, 'level'), '0.25')
  await page.getByRole('button', { name: `Remove volume change 1 from ${OVERLAY}`, exact: true }).click()
  await expect(rows).toHaveCount(0)

  // Undo walks back one action at a time: the removal, the edit, the add.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(1)
  await expect(overlayChangeField(page, 1, 'level')).toHaveValue('0.25')
  await page.keyboard.press('Control+z')
  await expect(overlayChangeField(page, 1, 'level')).toHaveValue('0.5')
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(0)
})

for (const [width, height] of [
  [1280, 720],
  [360, 800],
] as const) {
  test(`a video overlay's volume change rows lie inside the overlay's row, and the page does not scroll sideways, at ${width}×${height} (#1027)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height })
    // Populated (development.md): the overlay also carries a zoom and a
    // speed segment, so its change rows sit among the rows they follow.
    await clipAndOverlay(page)
    await chooseEffect(page, OVERLAY, 'Zoom')
    await chooseEffect(page, OVERLAY, 'Speed segment')
    await chooseEffect(page, OVERLAY, 'Volume change')
    await chooseEffect(page, OVERLAY, 'Volume change')
    const rows = page.getByTestId('video-overlay-volume-change')
    await expect(rows).toHaveCount(2)
    const overlayRow = rows.first().locator('xpath=ancestor::li[1]')
    for (let index = 0; index < 2; index++) {
      const row = rows.nth(index)
      const n = index + 1
      await expectWithin(row, overlayRow, { axis: 'x', what: `volume change ${n}'s row` })
      for (const [what, control] of [
        ['start', overlayChangeField(page, n, 'start')],
        ['length', overlayChangeField(page, n, 'length')],
        ['level', overlayChangeField(page, n, 'level')],
        [
          'level slider',
          page.getByRole('slider', { name: `Volume change ${n} level of ${OVERLAY} (0 to 4) slider`, exact: true }),
        ],
        ['remove button', page.getByRole('button', { name: `Remove volume change ${n} from ${OVERLAY}`, exact: true })],
      ] as const) {
        await expectWithin(control, row, { axis: 'x', what: `volume change ${n}'s ${what}` })
      }
    }
    await expectNoHorizontalScroll(page, 'an overlay with two volume changes')
    await overlayRow.screenshot({ path: testInfo.outputPath(`overlay-volume-change-${width}.png`) })
  })
}

test("the Trim window marks a video overlay's volume changes beside its zoom and names the ones a trim would cut into; Apply does that (#1027)", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await clipAndOverlay(page)
  // Populated: a zoom (0 to 2 s by default), then Volume change 1 at 0 to
  // 2 s and Volume change 2 from 2 s to the end of the 4 s overlay.
  await chooseEffect(page, OVERLAY, 'Zoom')
  await chooseEffect(page, OVERLAY, 'Volume change')
  await chooseEffect(page, OVERLAY, 'Volume change')
  await expect(overlayChangeField(page, 2, 'start')).toHaveValue('2')

  await page.getByRole('button', { name: `Trim ${OVERLAY} in the Trim window` }).click()
  const dialog = page.getByRole('dialog', { name: `Trim ${OVERLAY}` })
  await expect(dialog).toBeVisible()
  const warning = dialog.getByTestId('trim-warning')
  const strip = dialog.getByTestId('trim-strip')
  const changeMarks = dialog.locator('[data-testid="trim-effect-mark"][data-kind="volume-change"]')

  // Untrimmed: both changes marked beside the zoom, inside the strip, and nothing cut.
  await expect(dialog.locator('[data-testid="trim-effect-mark"][data-kind="zoom"]')).toHaveCount(1)
  await expect(changeMarks).toHaveCount(2)
  for (let index = 0; index < 2; index++) {
    await expect(changeMarks.nth(index)).toHaveAttribute('title', `Volume change ${index + 1}`)
    await expectWithin(changeMarks.nth(index), strip, { what: `volume change ${index + 1}'s mark` })
  }
  await expect(warning).toHaveText('')
  // Zoom 1 and Volume change 1 span the same seconds, 0 to 2: the change's
  // lane (#1026) keeps its bar off the zoom's on an overlay's strip too,
  // read in one page read.
  const lanes = await dialog.evaluate((element) => {
    const box = (kind: string) =>
      element.querySelector(`[data-testid="trim-effect-mark"][data-kind="${kind}"]`)!.getBoundingClientRect()
    return { zoomTop: box('zoom').top, changeBottom: box('volume-change').bottom }
  })
  expect(
    lanes.changeBottom,
    `Volume change 1's mark (bottom ${lanes.changeBottom}px) overlaps Zoom 1's (top ${lanes.zoomTop}px)`,
  ).toBeLessThanOrEqual(lanes.zoomTop)

  await setTrimOut(dialog, '3')
  await expect(warning).toHaveText('Trimming here shortens Volume change 2.')
  await setTrimOut(dialog, '1.5')
  await expect(warning).toHaveText('Trimming here shortens Zoom 1, shortens Volume change 1 and removes Volume change 2.')
  // A change cut to nothing has no mark.
  await expect(changeMarks).toHaveCount(1)
  await expectWithin(changeMarks, strip, { what: "volume change 1's mark, shortened" })
  await dialog.screenshot({ path: testInfo.outputPath('trim-window-overlay-volume-change.png') })

  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(overlayChangeField(page, 1, 'length')).toHaveValue('1.5')
  // Removed is kept at length zero at the new end, as the overlay's other effects are.
  await expect(overlayChangeField(page, 2, 'start')).toHaveValue('1.5')
  await expect(overlayChangeField(page, 2, 'length')).toHaveValue('0')
})

test("the export plays a video overlay's volume change at its level: 0.25 is −12 dB against the overlay's sound outside it (#1027)", async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('./')
  // A click gives the page the user activation an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  // A silent entry under an overlay recorded with the tone, so the mix is
  // the overlay's own sound: no track beside it.
  const silent = await recordWebm(page, 4000, false)
  const toned = await recordWebm(page, 4000, true)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: silent },
    { name: 'cam.webm', mimeType: 'video/webm', buffer: toned },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await chooseClipAction(page, 'cam.webm', 'Add as overlay')
  const cam = 'overlay cam.webm at position 1'
  const field = (what: 'start' | 'length' | 'level') =>
    page.getByRole('spinbutton', {
      name: what === 'level' ? `Volume change 1 level of ${cam} (0 to 4)` : `Volume change 1 ${what} of ${cam} in seconds`,
      exact: true,
    })
  await chooseEffect(page, cam, 'Volume change')
  // 1.5 s to 3 s into the overlay, which appears at 0 s, at Level 0.25. Its
  // ramps run 1.25 to 1.5 s and 3 to 3.25 s, so [1.9, 2.6] is well inside
  // and [0.5, 1.0] well clear, and late enough for the tone to have begun.
  await setField(field('start'), '1.5')
  await setField(field('length'), '1.5')
  await setField(field('level'), '0.25')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exported = await readFile(await (await downloadPromise).path())

  const outside = await peakIn(page, exported, 0.5, 1.0)
  const inside = await peakIn(page, exported, 1.9, 2.6)
  const db = 20 * Math.log10(inside / outside)
  console.log(
    `overlay volume change export: outside ${outside.toFixed(4)}, inside ${inside.toFixed(4)}, ${db.toFixed(2)} dB`,
  )
  // Loud enough outside to be the tone, not codec noise.
  expect(outside).toBeGreaterThan(0.05)
  expect(Math.abs(db - 20 * Math.log10(0.25))).toBeLessThanOrEqual(LEVEL_TOLERANCE_DB)
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
