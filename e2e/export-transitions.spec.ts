import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * Export of transitions (#43): the exported WebM must blend the two clips
 * through the overlap instead of hard-cutting, honor the overlap-aware
 * total duration, and mix the audio of both clips through the overlap.
 *
 * Fixtures are color-coded — the outgoing clip stays in the red family, the
 * incoming clip in the blue family, both with animated brightness so the
 * clips are visibly in motion — which lets a decoded frame attribute its
 * pixels to either clip unambiguously. Tones at distinct frequencies (so a
 * linear crossfade cannot phase-cancel) make the audio mix measurable.
 */

interface FixtureOptions {
  family: 'red' | 'blue'
  /** Frequency of a steady tone mixed in from the start; omit for silence. */
  toneHz?: number
  /** Frame size; defaults to 320×180. Differing sizes exercise #66. */
  width?: number
  height?: number
  /**
   * false = constant brightness (rgb 205 on the family channel), so pixel
   * levels compare exactly across sample times (#66's margin ladder).
   */
  animate?: boolean
}

/** Records a real ~2 s WebM in-browser, color-coded and optionally with audio. */
async function recordFixtureWebm(page: Page, options: FixtureOptions): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ family, toneHz, width, height, animate }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width ?? 320
    canvas.height = height ?? 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)

    let audio: AudioContext | null = null
    if (toneHz !== undefined) {
      audio = new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      if (audio.state !== 'running') {
        throw new Error(`AudioContext did not start (state: ${audio.state})`)
      }
      const destination = audio.createMediaStreamDestination()
      const gain = audio.createGain()
      gain.gain.value = 0.5
      const oscillator = audio.createOscillator()
      oscillator.frequency.value = toneHz
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()
      stream.addTrack(destination.stream.getAudioTracks()[0])
    }

    const mimeType = toneHz === undefined ? 'video/webm' : 'video/webm;codecs=vp8,opus'
    const recorder = new MediaRecorder(stream, { mimeType })
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
        // Brightness pulses (the clip is in motion) while the hue stays in
        // its family, so per-channel averages identify the clip regardless
        // of which exact frame a sample lands on. Non-animated fixtures hold
        // the pulse's midpoint so levels compare exactly across samples.
        const pulse =
          animate === false
            ? 50
            : Math.round(50 * (1 + Math.sin((performance.now() - start) / 100)))
        ctx.fillStyle =
          family === 'red' ? `rgb(${155 + pulse}, 0, 0)` : `rgb(0, 0, ${155 + pulse})`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 2000) resolve()
        else requestAnimationFrame(draw)
      }
      draw()
    })
    recorder.stop()
    await stopped
    await audio?.close()
    const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, options)
  return Buffer.from(webmBase64, 'base64')
}

/** Clicking first gives the page the user activation an AudioContext needs. */
async function activate(page: Page) {
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
}

/**
 * Imports the two fixtures, adds both to the timeline, trims each entry to
 * exactly 1 s, and adds a 0.5 s transition at the boundary — so the overlap
 * covers sequence time [0.5, 1.0) of a 1.5 s total, with solo regions on
 * both sides.
 */
async function buildTransitionSequence(page: Page, red: Buffer, blue: Buffer) {
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'red.webm', mimeType: 'video/webm', buffer: red },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add red.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add blue.webm to timeline' }).click()
  for (const [position, name] of [
    [1, 'red'],
    [2, 'blue'],
  ] as const) {
    const outField = page.getByRole('spinbutton', {
      name: `Trim out point of ${name}.webm at position ${position} in seconds`,
    })
    await outField.fill('1')
    await outField.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  const duration = page.getByRole('spinbutton', {
    name: 'Transition duration between position 1 and 2 in seconds',
  })
  await duration.fill('0.5')
  await duration.blur()
  // The overlap-aware total the exported duration is measured against.
  await expect(page.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
    'max',
    '1.5',
  )
}

async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

interface FrameSample {
  r: number
  g: number
  b: number
  duration: number
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * averages the pixels of a horizontal band of that frame.
 *
 * Sample times anchor to the END of the file because export overhead (the
 * initial cue before real-time recording) pads the front: the final entry
 * always occupies the file's last second, so the overlap is exactly
 * [end - 1.0, end - 0.5] regardless of how large the front padding was.
 */
async function sampleExportedFrame(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  band:
    | 'full'
    | 'top-quarter'
    | 'bottom-quarter'
    | 'left-fifth'
    | 'right-fifth'
    | 'center-fifth'
    | 'margin-upper'
    | 'margin-lower',
): Promise<FrameSample> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, band }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const settleIfKnown = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve()
              return true
            }
            return false
          }
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (settleIfKnown()) return
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => settleIfKnown()
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        const duration = video.duration
        const target = Math.max(0, duration - fromEndSeconds)
        video.currentTime = target
        // Poll instead of listening for `seeked`: the duration scan above may
        // still have a seek in flight, and its events would race a listener.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now()
          const check = () => {
            if (!video.seeking && Math.abs(video.currentTime - target) < 0.25 && video.readyState >= 2) {
              resolve()
            } else if (performance.now() - started > 10_000) {
              reject(new Error('seeking the exported file timed out'))
            } else {
              requestAnimationFrame(check)
            }
          }
          check()
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)
        let bandX = 0
        let bandWidth = canvas.width
        let bandTop = 0
        let bandHeight = canvas.height
        if (band === 'top-quarter' || band === 'bottom-quarter') {
          bandHeight = Math.max(1, Math.floor(canvas.height / 4))
          bandTop = band === 'bottom-quarter' ? canvas.height - bandHeight : 0
        } else if (band === 'left-fifth' || band === 'right-fifth' || band === 'center-fifth') {
          bandWidth = Math.max(1, Math.floor(canvas.width / 5))
          bandX =
            band === 'center-fifth'
              ? Math.floor((canvas.width - bandWidth) / 2)
              : band === 'right-fifth'
                ? canvas.width - bandWidth
                : 0
        } else if (band === 'margin-upper' || band === 'margin-lower') {
          // Left-margin sub-bands for the slide card ladder (#74): x is the
          // fifth of the frame a pillarboxed square incoming clip never
          // reaches; y picks a strip the card's edge passes at a known
          // progress (upper: 10%-30%, covered once progress ≥ 0.3; lower:
          // 60%-75%, covered once progress ≥ 0.75).
          bandWidth = Math.max(1, Math.floor(canvas.width / 5))
          bandTop = Math.floor(canvas.height * (band === 'margin-upper' ? 0.1 : 0.6))
          bandHeight = Math.max(
            1,
            Math.floor(canvas.height * (band === 'margin-upper' ? 0.2 : 0.15)),
          )
        }
        const data = ctx.getImageData(bandX, bandTop, bandWidth, bandHeight).data
        let r = 0
        let g = 0
        let b = 0
        const pixels = data.length / 4
        for (let index = 0; index < data.length; index += 4) {
          r += data[index]
          g += data[index + 1]
          b += data[index + 2]
        }
        return { r: r / pixels, g: g / pixels, b: b / pixels, duration }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, band },
  )
}

/** Peak amplitude of the exported file's audio within a time window. */
async function measureAudioPeak(
  page: Page,
  webm: Buffer,
  window: { fromSeconds: number; toSeconds: number },
): Promise<number> {
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
        for (let index = start; index < end; index++) {
          peak = Math.max(peak, Math.abs(samples[index]))
        }
        return peak
      } finally {
        await context.close()
      }
    },
    { base64: webm.toString('base64'), ...window },
  )
}

/** Strong presence of a clip's own color channel in a frame average. */
const DOMINANT = 80
/** A blended frame must show both channels well above codec noise. */
const BLENDED = 40
/** Channel level attributable to codec noise/chroma bleed alone. */
const ABSENT = 25
/** Loud enough to be audible; comfortably above codec noise. */
const AUDIBLE_PEAK = 0.05

test('a crossfade exports as a blended overlap with mixed, gapless audio', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('./')
  await activate(page)

  // Distinct tone frequencies: a linear crossfade of two *identical* tones
  // could phase-cancel mid-overlap and fake a dropout.
  const red = await recordFixtureWebm(page, { family: 'red', toneHz: 440 })
  const blue = await recordFixtureWebm(page, { family: 'blue', toneHz: 660 })
  await buildTransitionSequence(page, red, blue)

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Duration honors the overlap-aware total (1.5 s), with the same relative
  // slack the plain export test uses for real-time recording overhead.
  const mid = await sampleExportedFrame(page, exported, 0.75, 'full')
  expect(mid.duration).toBeGreaterThan(1.5 * 0.6)
  expect(mid.duration).toBeLessThan(1.5 + 1)

  // Mid-overlap the frame is a blend: substantially red AND substantially
  // blue — neither pure clip A, nor pure clip B, nor a black gap.
  expect(mid.r).toBeGreaterThan(BLENDED)
  expect(mid.b).toBeGreaterThan(BLENDED)

  // Control samples either side of the overlap prove the encode separates
  // the clips cleanly (so the blend above cannot be a decoding artifact) and
  // that the boundary region is where the mixing happens.
  const soloRed = await sampleExportedFrame(page, exported, 1.25, 'full')
  expect(soloRed.r).toBeGreaterThan(DOMINANT)
  expect(soloRed.b).toBeLessThan(ABSENT)
  const soloBlue = await sampleExportedFrame(page, exported, 0.25, 'full')
  expect(soloBlue.b).toBeGreaterThan(DOMINANT)
  expect(soloBlue.r).toBeLessThan(ABSENT)

  // Audio keeps sounding through the whole overlap — no dropout. Checked in
  // sub-windows so a brief gap cannot hide behind one loud peak.
  const overlapStart = mid.duration - 1.0
  for (const [from, to] of [
    [0.05, 0.2],
    [0.2, 0.35],
    [0.35, 0.45],
  ] as const) {
    const peak = await measureAudioPeak(page, exported, {
      fromSeconds: overlapStart + from,
      toSeconds: overlapStart + to,
    })
    expect(peak).toBeGreaterThan(AUDIBLE_PEAK)
  }
})

test('a crossfade between different aspect ratios exports margins fading to black, not popping (#66)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  // Solid-brightness fixtures (no pulse) so margin levels compare exactly
  // across sample times; different frame sizes so the incoming clip leaves
  // uncovered margins. The export canvas takes the largest source (320×180)
  // and pillarboxes the square incoming clip to x ∈ [70, 250], so the left
  // fifth of the frame (x < 64) is margin the incoming clip never covers.
  const red = await recordFixtureWebm(page, { family: 'red', animate: false })
  const blue = await recordFixtureWebm(page, {
    family: 'blue',
    animate: false,
    width: 180,
    height: 180,
  })
  await buildTransitionSequence(page, red, blue)

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // The overlap occupies [end − 1.0, end − 0.5]. Margin ladder: solo red,
  // progress 0.2, 0.5, 0.9, then past the handover (solo blue).
  const solo = (await sampleExportedFrame(page, exported, 1.25, 'left-fifth')).r
  const early = (await sampleExportedFrame(page, exported, 0.9, 'left-fifth')).r
  const mid = (await sampleExportedFrame(page, exported, 0.75, 'left-fifth')).r
  const late = (await sampleExportedFrame(page, exported, 0.55, 'left-fifth')).r
  const after = (await sampleExportedFrame(page, exported, 0.25, 'left-fifth')).r

  // Mid-overlap the margin is the outgoing clip blended toward black in
  // proportion to progress — not the outgoing clip at full brightness.
  expect(solo).toBeGreaterThan(120)
  expect(mid).toBeGreaterThan(solo * 0.3)
  expect(mid).toBeLessThan(solo * 0.7)

  // The ladder decreases monotonically across the overlap into black after
  // the handover — no frame steps the margin from bright to black at once.
  expect(early).toBeLessThan(solo + 6)
  expect(early).toBeGreaterThan(solo * 0.6)
  expect(mid).toBeLessThan(early - 20)
  expect(late).toBeLessThan(mid - 20)
  expect(late).toBeLessThan(solo * 0.3)
  expect(after).toBeLessThan(ABSENT)

  // Where the clips do overlap, mid-crossfade still carries both families.
  const centerMid = await sampleExportedFrame(page, exported, 0.75, 'center-fifth')
  expect(centerMid.r).toBeGreaterThan(BLENDED)
  expect(centerMid.b).toBeGreaterThan(BLENDED)
})

test('a slide between different aspect ratios exports a black card sliding over the margins (#74)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  // Solid-brightness fixtures (no pulse) so margin levels compare exactly
  // across sample times; the square incoming clip pillarboxes to
  // x ∈ [70, 250] of the 320×180 canvas, so the left fifth (x < 64) is
  // margin its fitted box never reaches. The card, though, is the whole
  // frame: black backing sliding down with the clip (#74).
  const red = await recordFixtureWebm(page, { family: 'red', animate: false })
  const blue = await recordFixtureWebm(page, {
    family: 'blue',
    animate: false,
    width: 180,
    height: 180,
  })
  await buildTransitionSequence(page, red, blue)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-above')

  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // The overlap occupies [end − 1.0, end − 0.5]; the card's leading edge is
  // at y = progress·height. Ladder: solo, then progress 0.5 (upper margin
  // band passed at 0.3 → black; lower band, reached at 0.75, still ahead of
  // the edge → undimmed red), then progress 0.9 (lower band passed → black),
  // then past the handover.
  const soloUpper = (await sampleExportedFrame(page, exported, 1.25, 'margin-upper')).r
  const soloLower = (await sampleExportedFrame(page, exported, 1.25, 'margin-lower')).r
  expect(soloUpper).toBeGreaterThan(120)
  expect(soloLower).toBeGreaterThan(120)

  const midUpper = await sampleExportedFrame(page, exported, 0.75, 'margin-upper')
  const midLower = await sampleExportedFrame(page, exported, 0.75, 'margin-lower')
  // Behind the card's edge: the card's black backing, not the outgoing clip
  // dimmed or still bright.
  expect(midUpper.r).toBeLessThan(ABSENT)
  expect(midUpper.b).toBeLessThan(ABSENT)
  // Ahead of the card's edge: the outgoing clip at full, undimmed brightness.
  expect(midLower.r).toBeGreaterThan(soloLower * 0.85)

  const lateLower = (await sampleExportedFrame(page, exported, 0.55, 'margin-lower')).r
  expect(lateLower).toBeLessThan(ABSENT)

  const afterUpper = (await sampleExportedFrame(page, exported, 0.25, 'margin-upper')).r
  const afterLower = (await sampleExportedFrame(page, exported, 0.25, 'margin-lower')).r
  expect(afterUpper).toBeLessThan(ABSENT)
  expect(afterLower).toBeLessThan(ABSENT)

  // Where the card has arrived, its clip shows: mid-slide the center-fifth
  // carries the incoming blue (top half) and the outgoing red (bottom half).
  const centerMid = await sampleExportedFrame(page, exported, 0.75, 'center-fifth')
  expect(centerMid.b).toBeGreaterThan(BLENDED)
  expect(centerMid.r).toBeGreaterThan(BLENDED)
})

test('a slide-from-above exports with the incoming clip covering from the top', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordFixtureWebm(page, { family: 'red' })
  const blue = await recordFixtureWebm(page, { family: 'blue' })
  await buildTransitionSequence(page, red, blue)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-above')

  const exported = await exportOnce(page)

  const top = await sampleExportedFrame(page, exported, 0.75, 'top-quarter')
  const bottom = await sampleExportedFrame(page, exported, 0.75, 'bottom-quarter')
  expect(top.duration).toBeGreaterThan(1.5 * 0.6)
  expect(top.duration).toBeLessThan(1.5 + 1)

  // Mid-slide the incoming (blue) clip covers the top of the frame while the
  // outgoing (red) clip still shows underneath at the bottom.
  expect(top.b).toBeGreaterThan(DOMINANT)
  expect(top.r).toBeLessThan(ABSENT)
  expect(bottom.r).toBeGreaterThan(DOMINANT)
  expect(bottom.b).toBeLessThan(ABSENT)
})

test('a slide-from-left exports with the incoming clip covering from the left (#62)', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.goto('./')

  const red = await recordFixtureWebm(page, { family: 'red' })
  const blue = await recordFixtureWebm(page, { family: 'blue' })
  await buildTransitionSequence(page, red, blue)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('slide-from-left')

  const exported = await exportOnce(page)

  const left = await sampleExportedFrame(page, exported, 0.75, 'left-fifth')
  const right = await sampleExportedFrame(page, exported, 0.75, 'right-fifth')
  expect(left.duration).toBeGreaterThan(1.5 * 0.6)
  expect(left.duration).toBeLessThan(1.5 + 1)

  // Mid-slide the incoming (blue) clip covers the left of the frame while
  // the outgoing (red) clip still shows on the right — the horizontal twin
  // of the slide-from-above evidence above.
  expect(left.b).toBeGreaterThan(DOMINANT)
  expect(left.r).toBeLessThan(ABSENT)
  expect(right.r).toBeGreaterThan(DOMINANT)
  expect(right.b).toBeLessThan(ABSENT)
})
