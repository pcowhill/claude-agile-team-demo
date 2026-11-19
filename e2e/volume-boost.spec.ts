import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectWithin } from './layout'

/**
 * Volume above 1 (#692): a Volume goes to 4 (+12 dB). The part above 1
 * cannot be a media element's `volume`, so it is a Web Audio gain after the
 * element — in the export always, in the preview once an element first
 * needs it (`src/lib/mediaGain.ts`).
 *
 * The export is measured from the decoded file, in the page. The preview's
 * boost is read from the element's `data-boost`, which the gain module
 * writes beside the GainNode it sets (a GainNode is not reachable from the
 * page). Firefox's preview does not route — its routed elements ignore
 * `playbackRate` (#611) — so there the criterion's other branch holds: the
 * element's volume stays at most 1.
 */

const RATE = 48000

/** A mono 16-bit WAV of a 440 Hz tone at `amplitude` of full scale, built in Node. */
function toneWav(amplitude: number, seconds: number): Buffer {
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
    const sample = amplitude * Math.sin((2 * Math.PI * 440 * index) / RATE)
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2)
  }
  return buffer
}

/** A silent WebM recorded in the page, so the export's sound is the track's alone. */
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

/** The RMS level, in dB of full scale, of the decoded file's audio between two times. */
async function rmsDb(page: Page, media: Buffer, from: number, to: number): Promise<number> {
  return await page.evaluate(
    async ({ base64, from, to }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(bytes.buffer)
        let sum = 0
        let count = 0
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel)
          const end = Math.min(samples.length, Math.floor(to * buffer.sampleRate))
          for (let index = Math.floor(from * buffer.sampleRate); index < end; index++) {
            sum += samples[index] * samples[index]
            count++
          }
        }
        return 10 * Math.log10(sum / count)
      } finally {
        await context.close()
      }
    },
    { base64: media.toString('base64'), from, to },
  )
}

const TRACK = 'audio track tone.wav at position 1'
const trackVolume = (page: Page) =>
  page.getByRole('spinbutton', { name: `Volume of ${TRACK} (0 to 4)` })

async function setVolume(page: Page, value: string) {
  const field = trackVolume(page)
  await field.fill(value)
  await field.blur()
  await expect(field).toHaveValue(value)
}

/** A silent clip and a 0.2-amplitude tone track — quiet enough that Volume 2 stays clear of full scale. */
async function clipAndTone(page: Page) {
  await page.goto('./')
  // A click first: the page's user activation, which an AudioContext needs.
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
  const webm = await silentWebm(page, 2600)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav(0.2, 4) },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
}

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

test('an exported tone at Volume 2 is about 6 dB louder than at Volume 1 (#692)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  await clipAndTone(page)
  // Measured inside the tone, clear of the recorder's first and last moments.
  const atOne = await rmsDb(page, await exportOnce(page), 0.5, 2)
  await setVolume(page, '2')
  const atTwo = await rmsDb(page, await exportOnce(page), 0.5, 2)
  const louder = atTwo - atOne
  console.log(`[${browserName}] export: Volume 1 ${atOne.toFixed(2)} dB, Volume 2 ${atTwo.toFixed(2)} dB, +${louder.toFixed(2)} dB`)
  // 20·log10(2) = 6.02 dB.
  expect(Math.abs(louder - 6.02), `Volume 2 measured ${louder.toFixed(2)} dB louder`).toBeLessThan(1)
})

test('the preview plays a Volume of 2 without an error, its boost carrying what the element cannot (#692)', async ({
  page,
  browserName,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await clipAndTone(page)
  await setVolume(page, '2')
  await page.getByRole('button', { name: 'Play preview' }).click()
  const track = page.getByTestId('preview-audio-0')
  await expect.poll(() => track.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false)
  if (browserName === 'firefox') {
    // No route in Firefox (#611): the element plays at most at full volume.
    await expect(track).not.toHaveAttribute('data-boost')
  } else {
    await expect(track).toHaveAttribute('data-boost', '2')
  }
  // The element itself never goes past 1, which is what would throw.
  const volume = await track.evaluate((element: HTMLAudioElement) => element.volume)
  expect(volume).toBeLessThanOrEqual(1)
  expect(volume).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause preview' }).click()
  expect(errors).toEqual([])
})

for (const width of [1280, 360]) {
  test(`a Volume above 100 % shows in its field and slider, and the slider's mark sits at 1, at ${width}px (#692)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    // Populated (development.md): a clip in the sequence and a track.
    await clipAndTone(page)
    await setVolume(page, '2.5')
    const slider = page.getByRole('slider', { name: `Volume of ${TRACK} (0 to 4) slider` })
    await expect(slider).toHaveValue('2.5')
    const row = page.locator('.audio-track-gain').first()
    const mark = row.locator('.timeline-slider-mark')
    await expect(mark).toHaveCount(1)
    // The gain row, the field, the slider and its mark all lie inside the
    // track's row, and the page does not scroll sideways.
    const trackRow = row.locator('xpath=ancestor::li[1]')
    await expectWithin(row, trackRow, { axis: 'x', what: 'the track gain row' })
    await expectWithin(slider, trackRow, { axis: 'x', what: 'the Volume slider' })
    await expectWithin(mark, slider, { axis: 'x', what: 'the 100 % mark' })
    await expectNoHorizontalScroll(page, 'with a Volume above 100 %')
    await row.screenshot({ path: testInfo.outputPath(`volume-boost-${width}.png`) })

    // The mark is where 1 is: a click on it sets the slider to 1, within one
    // 0.05 step.
    const box = await mark.boundingBox()
    const sliderBox = await slider.boundingBox()
    expect(box).not.toBeNull()
    expect(sliderBox).not.toBeNull()
    await page.mouse.click(box!.x + box!.width / 2, sliderBox!.y + sliderBox!.height / 2)
    await expect
      .poll(async () => Math.abs(Number(await trackVolume(page).inputValue()) - 1))
      .toBeLessThanOrEqual(0.05 + 1e-9)
  })
}
