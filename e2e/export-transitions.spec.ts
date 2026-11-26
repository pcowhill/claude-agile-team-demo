import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { firstFrame, frameAt, lastFrame, scanExportedFrames } from './decodedFrame'
import type { ExportScan, SampleRect, ScannedFrame } from './decodedFrame'

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

/**
 * Named bands of the decoded frame, sampled by scanning every grid frame of
 * the exported file (#370). Sample positions are measured from the file's
 * own phases rather than computed from the nominal timeline: the export is
 * a real-time recording whose phases stretch and shift under CPU load, so
 * the old fixed offsets from the file's end landed in the wrong phase on a
 * loaded machine (this spec's margin ladders were two of #370's recorded
 * failures). Each test locates the overlap by the transition's own color
 * signature and asserts at positions measured within it, expressing anchor
 * thresholds against the solo levels the scan itself measures ("half the
 * solo level"), so they hold whatever the codec made of the fixture's
 * colors. The margin bands are left-margin
 * sub-bands for the slide card ladder (#74): x is the fifth of the frame a
 * pillarboxed square incoming clip never reaches; y picks a strip the
 * card's edge passes at a known progress (upper: 10%-30%, covered once
 * progress >= 0.3; lower: 60%-75%, covered once progress >= 0.75).
 */
const BANDS = {
  full: { x: 0, y: 0, width: 1, height: 1 },
  'top-quarter': { x: 0, y: 0, width: 1, height: 0.25 },
  'bottom-quarter': { x: 0, y: 0.75, width: 1, height: 0.25 },
  'left-fifth': { x: 0, y: 0, width: 0.2, height: 1 },
  'right-fifth': { x: 0.8, y: 0, width: 0.2, height: 1 },
  'center-fifth': { x: 0.4, y: 0, width: 0.2, height: 1 },
  'margin-upper': { x: 0, y: 0.1, width: 0.2, height: 0.2 },
  'margin-lower': { x: 0, y: 0.6, width: 0.2, height: 0.15 },
} satisfies Record<string, SampleRect>

type BandName = keyof typeof BANDS

/** The largest value a channel reaches in a band anywhere in the scan —
 * the measured solo level that phase anchors are expressed against. */
const maxOf = (scan: ExportScan, band: BandName, channel: 'r' | 'g' | 'b') =>
  Math.max(...scan.frames.map((frame) => frame.bands[band][channel]))

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

  const scan = await scanExportedFrames(page, exported, BANDS)
  // Duration honors the overlap-aware total (1.5 s), with the same relative
  // slack the plain export test uses for real-time recording overhead.
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the incoming blue first
  // appearing and the outgoing red last surviving bound the crossfade. The
  // appearance threshold (above chroma bleed, far below any real presence)
  // crosses a little way into the true window, so the measured window sits
  // inside it — every position sampled below moves toward the overlap's
  // middle, where each claim holds with the widest margin.
  const APPEAR = 40
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands.full.r > DOMINANT,
    'the red clip starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands.full.b > APPEAR,
    'the incoming blue appearing',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands.full.r > APPEAR,
    'the outgoing red surviving',
  ).time

  // Mid-overlap the frame is a blend: substantially red AND substantially
  // blue — neither pure clip A, nor pure clip B, nor a black gap.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands.full
  expect(mid.r).toBeGreaterThan(BLENDED)
  expect(mid.b).toBeGreaterThan(BLENDED)

  // Control samples either side of the overlap prove the encode separates
  // the clips cleanly (so the blend above cannot be a decoding artifact) and
  // that the boundary region is where the mixing happens.
  const soloRed = frameAt(scan, (contentStart + overlapStart) / 2).bands.full
  expect(soloRed.r).toBeGreaterThan(DOMINANT)
  expect(soloRed.b).toBeLessThan(ABSENT)
  const soloBlue = frameAt(scan, (overlapEnd + scan.duration) / 2).bands.full
  expect(soloBlue.b).toBeGreaterThan(DOMINANT)
  expect(soloBlue.r).toBeLessThan(ABSENT)

  // Audio keeps sounding through the measured overlap — no dropout. Checked
  // in three abutting sub-windows so a brief gap cannot hide behind one
  // loud peak. The measured window sits inside the true overlap, so this
  // covers the overlap's middle — the region where both tones must mix —
  // exactly as the old nominal sub-windows covered [0.05, 0.45] of the
  // nominal 0.5 s overlap rather than its outermost edges.
  const overlapSpan = overlapEnd - overlapStart
  for (const [from, to] of [
    [0, 1 / 3],
    [1 / 3, 2 / 3],
    [2 / 3, 1],
  ] as const) {
    const peak = await measureAudioPeak(page, exported, {
      fromSeconds: overlapStart + from * overlapSpan,
      toSeconds: overlapStart + to * overlapSpan,
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

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370), on the center fifth
  // (which both clips cover). The ladder below asserts tight brightness
  // bands at specific progress values, so the threshold anchors are
  // extrapolated back to the true window: a linear dissolve's channel
  // crosses a threshold at fraction (threshold / solo level) of the window,
  // which is exactly the inward bias of each measured edge. Solving both
  // edges out again recovers the true window within a frame — exact for
  // the linear dissolve under test; were the dissolve not linear, the
  // ladder's own monotonicity assertions are what would catch it.
  const APPEAR = 40
  const soloRedCenter = maxOf(scan, 'center-fifth', 'r')
  const soloBlueCenter = maxOf(scan, 'center-fifth', 'b')
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['center-fifth'].r > soloRedCenter * 0.6,
    'the red clip starting',
  ).time
  const measuredStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands['center-fifth'].b > APPEAR,
    'the incoming blue appearing in the center',
  ).time
  const measuredEnd = lastFrame(
    scan,
    (frame) => frame.bands['center-fifth'].r > APPEAR,
    'the outgoing red surviving in the center',
  ).time
  const startBias = APPEAR / soloBlueCenter
  const endBias = APPEAR / soloRedCenter
  const trueSpan = (measuredEnd - measuredStart) / (1 - startBias - endBias)
  const overlapStart = measuredStart - startBias * trueSpan

  // The ladder's frames are picked by the progress each one shows, not by
  // its time (#748). The export is a real-time recording that repeats
  // frames, three or four identical pairs inside this 0.5 s overlap in a
  // local Firefox run, so the frame nearest a time can show a composition a
  // frame or two older. That is 15 to 25 levels of red against a step of
  // about 60 between the samples, and twice in CI's Firefox it shrank the
  // early-to-mid step under 20. The centre fifth, which both clips cover,
  // shows the dissolve itself: its red is the outgoing clip's,
  // (1 - progress) x solo, on the same frame as the margin it is read with.
  const shown = scan.frames
    .filter((frame) => frame.time >= contentStart)
    .map((frame) => ({ frame, progress: 1 - frame.bands['center-fifth'].r / soloRedCenter }))
  const atProgress = (progress: number) =>
    shown.reduce((nearest, entry) =>
      Math.abs(entry.progress - progress) < Math.abs(nearest.progress - progress) ? entry : nearest,
    ).frame.bands['left-fifth'].r

  // Margin ladder: solo red, progress 0.2, 0.5, 0.9, then past the handover
  // (solo blue).
  const solo = frameAt(scan, (contentStart + overlapStart) / 2).bands['left-fifth'].r
  const early = atProgress(0.2)
  const mid = atProgress(0.5)
  const late = atProgress(0.9)
  const after = frameAt(scan, (overlapStart + trueSpan + scan.duration) / 2).bands['left-fifth'].r

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

  // #66 on every frame, repeated or not: the margin fades with the outgoing
  // clip, so it reads what the centre's outgoing red reads on the same
  // frame. A margin that popped would hold solo while the centre fell. The
  // two read within 2 levels of each other on every frame of six local
  // Firefox runs; 12 leaves room for the codec and is still far below the
  // 60-level steps a pop would make.
  for (const { frame } of shown) {
    const margin = frame.bands['left-fifth'].r
    const outgoing = frame.bands['center-fifth'].r
    const at = `margin ${margin} vs centre ${outgoing} at ${frame.time.toFixed(3)} s`
    expect(Math.abs(margin - outgoing), at).toBeLessThan(12)
  }

  // Where the clips do overlap, mid-crossfade still carries both families.
  const centerMid = frameAt(scan, overlapStart + 0.5 * trueSpan).bands['center-fifth']
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

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Read each frame's phase from the frame itself (#674), not from its
  // time. The incoming clip covers the centre fifth from the top down as
  // the card slides, so the centre's blue, as a fraction of its solo
  // level, is how far the card's edge has come in that frame. That band is
  // disjoint from the margin bands the assertions read, so it measures the
  // phase without presuming the margins' answer.
  //
  // Interpolating a phase from a time window, as this test did until #674,
  // assumed the file holds a frame every 1/30 s. Firefox's recording holds
  // frames instead: the edge advanced up to 0.198 of the slide between one
  // file frame and the next (measured on 10 local runs), so the window's
  // anchors landed up to a held frame early, and the frame sampled "at 0.95"
  // was a frame whose own edge stood at 0.70. Its margin read exactly what
  // a correct slide at 0.70 shows.
  const soloTop = maxOf(scan, 'top-quarter', 'r')
  const soloBlueCenter = maxOf(scan, 'center-fifth', 'b')
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['top-quarter'].r > soloTop * 0.8,
    'the red clip starting',
  ).time
  const progressOf = (frame: ScannedFrame) => frame.bands['center-fifth'].b / soloBlueCenter
  // The slide's frames: the card's edge on screen, the handover not yet
  // reached. The 0.99 excludes the incoming clip's solo frames, whose blue
  // is the solo level itself.
  const sliding = scan.frames.filter(
    (frame) =>
      frame.time > contentStart &&
      frame.bands['center-fifth'].b > ABSENT &&
      progressOf(frame) < 0.99,
  )
  expect(sliding.length, 'frames of the slide in the exported file').toBeGreaterThan(3)
  const firstSliding = sliding[0]
  const lastSliding = sliding[sliding.length - 1]

  const soloFrame = frameAt(scan, (contentStart + firstSliding.time) / 2).bands
  const soloUpper = soloFrame['margin-upper'].r
  const soloLower = soloFrame['margin-lower'].r
  expect(soloUpper).toBeGreaterThan(120)
  expect(soloLower).toBeGreaterThan(120)

  // Every frame of the slide, against its own edge: a margin band behind
  // the edge is the card's black backing, a band ahead of it the outgoing
  // clip at full brightness, and a band the edge crosses is in proportion.
  // The upper band is covered once progress >= 0.3, the lower once >= 0.75
  // (BANDS). A card without its black backing would leave a margin the
  // outgoing red behind the edge, up to the solo level (~200) away from
  // this; a correct slide read within 0.7 of it on all 10 runs above, so 20
  // is a codec allowance, not a fudge.
  const MARGIN_TOLERANCE = 20
  const ahead = (band: SampleRect, edge: number) =>
    Math.min(1, Math.max(0, (band.y + band.height - Math.max(edge, band.y)) / band.height))
  const wrong: string[] = []
  for (const frame of sliding) {
    const edge = progressOf(frame)
    for (const [name, solo] of [
      ['margin-upper', soloUpper],
      ['margin-lower', soloLower],
    ] as const) {
      const expected = solo * ahead(BANDS[name], edge)
      const { r, b } = frame.bands[name]
      if (Math.abs(r - expected) > MARGIN_TOLERANCE || b > ABSENT) {
        wrong.push(
          `${frame.time.toFixed(3)}s, edge at ${edge.toFixed(2)}: ${name} r ${r.toFixed(1)} (want ${expected.toFixed(1)}), b ${b.toFixed(1)}`,
        )
      }
    }
  }
  expect(wrong, 'margin bands that disagree with the card edge of their own frame').toEqual([])

  // The check above must have seen both halves of the ladder, or it could
  // pass having read only frames where the answer is trivial. Each range is
  // wider than the largest jump between file frames measured above (0.198),
  // so a held frame cannot step over it.
  //
  // Mid-slide: the upper band behind the edge, the lower band ahead of it.
  const mid = sliding.reduce((best, frame) =>
    Math.abs(progressOf(frame) - 0.45) < Math.abs(progressOf(best) - 0.45) ? frame : best,
  )
  const between = 'a frame of the slide with its edge between the two margin bands'
  expect(progressOf(mid), between).toBeGreaterThanOrEqual(0.3)
  expect(progressOf(mid), between).toBeLessThanOrEqual(0.6)
  // Behind the card's edge: the card's black backing, not the outgoing clip
  // dimmed or still bright.
  expect(mid.bands['margin-upper'].r).toBeLessThan(ABSENT)
  expect(mid.bands['margin-upper'].b).toBeLessThan(ABSENT)
  // Ahead of the card's edge: the outgoing clip at full, undimmed brightness.
  expect(mid.bands['margin-lower'].r).toBeGreaterThan(soloLower * 0.85)
  // Late in the slide: the edge past the lower band's middle, so the check
  // above read the card's black over most of that band too.
  expect(
    progressOf(lastSliding),
    "a frame of the slide with its edge past the lower band's middle",
  ).toBeGreaterThan(0.675)

  const after = frameAt(scan, (lastSliding.time + scan.duration) / 2).bands
  expect(after['margin-upper'].r).toBeLessThan(ABSENT)
  expect(after['margin-lower'].r).toBeLessThan(ABSENT)

  // Where the card has arrived, its clip shows: mid-slide the center-fifth
  // carries the incoming blue (top half) and the outgoing red (bottom half).
  const centerMid = mid.bands['center-fifth']
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

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the incoming card enters
  // from above, so its blue first appears in the top quarter, and the
  // outgoing red last survives in the bottom quarter.
  const APPEAR = 40
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['top-quarter'].r > DOMINANT,
    'the red clip starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands['top-quarter'].b > APPEAR,
    'the incoming blue entering the top quarter',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands['bottom-quarter'].r > APPEAR,
    'the outgoing red surviving in the bottom quarter',
  ).time

  // Mid-slide the incoming (blue) clip covers the top of the frame while the
  // outgoing (red) clip still shows underneath at the bottom.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands
  expect(mid['top-quarter'].b).toBeGreaterThan(DOMINANT)
  expect(mid['top-quarter'].r).toBeLessThan(ABSENT)
  expect(mid['bottom-quarter'].r).toBeGreaterThan(DOMINANT)
  expect(mid['bottom-quarter'].b).toBeLessThan(ABSENT)
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

  const scan = await scanExportedFrames(page, exported, BANDS)
  expect(scan.duration).toBeGreaterThan(1.5 * 0.6)
  expect(scan.duration).toBeLessThan(1.5 + 1)

  // Locate the overlap in the file itself (#370): the incoming card enters
  // from the left, so its blue first appears in the left fifth, and the
  // outgoing red last survives in the right fifth.
  const APPEAR = 40
  const contentStart = firstFrame(
    scan,
    (frame) => frame.bands['left-fifth'].r > DOMINANT,
    'the red clip starting',
  ).time
  const overlapStart = firstFrame(
    scan,
    (frame) => frame.time >= contentStart && frame.bands['left-fifth'].b > APPEAR,
    'the incoming blue entering the left fifth',
  ).time
  const overlapEnd = lastFrame(
    scan,
    (frame) => frame.bands['right-fifth'].r > APPEAR,
    'the outgoing red surviving in the right fifth',
  ).time

  // Mid-slide the incoming (blue) clip covers the left of the frame while
  // the outgoing (red) clip still shows on the right — the horizontal twin
  // of the slide-from-above evidence above.
  const mid = frameAt(scan, (overlapStart + overlapEnd) / 2).bands
  expect(mid['left-fifth'].b).toBeGreaterThan(DOMINANT)
  expect(mid['left-fifth'].r).toBeLessThan(ABSENT)
  expect(mid['right-fifth'].r).toBeGreaterThan(DOMINANT)
  expect(mid['right-fifth'].b).toBeLessThan(ABSENT)
})
