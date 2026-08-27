import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

interface RecordOptions {
  durationMs?: number
  /**
   * Mixes a 440 Hz tone into the recording, starting this many ms in (0 for
   * the whole clip). Omit for a video-only source with no audio track.
   */
  toneFromMs?: number
}

/**
 * Records a real WebM in-browser (as in the other specs) so the export
 * pipeline has genuinely decodable video to replay and re-encode.
 *
 * With `toneFromMs`, the recording also carries a real Opus audio track —
 * canvas captures alone have none, so audio assertions need this.
 */
async function recordWebm(
  page: import('@playwright/test').Page,
  options: RecordOptions = {},
): Promise<Buffer> {
  const webmBase64 = await page.evaluate(async ({ durationMs = 1500, toneFromMs }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(30)

    let audio: AudioContext | null = null
    if (toneFromMs !== undefined) {
      audio = new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      if (audio.state !== 'running') {
        throw new Error(`AudioContext did not start (state: ${audio.state})`)
      }
      const destination = audio.createMediaStreamDestination()
      // Silence until toneFromMs, then a steady tone — so a trim that should
      // exclude the tone is distinguishable from one that should include it.
      const gain = audio.createGain()
      gain.gain.setValueAtTime(0, audio.currentTime)
      gain.gain.setValueAtTime(0.5, audio.currentTime + toneFromMs / 1000)
      const oscillator = audio.createOscillator()
      oscillator.frequency.value = 440
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()
      stream.addTrack(destination.stream.getAudioTracks()[0])
    }

    const mimeType = toneFromMs === undefined ? 'video/webm' : 'video/webm;codecs=vp8,opus'
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
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > durationMs) resolve()
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

interface AudioMeasurement {
  peak: number
  duration: number
  channels: number
}

/**
 * Decodes a WebM's audio and reports the loudest sample in a time window.
 * Rejects if the file carries no decodable audio at all.
 */
async function measureAudio(
  page: import('@playwright/test').Page,
  webm: Buffer,
  window: { fromSeconds?: number; toSeconds?: number } = {},
): Promise<AudioMeasurement> {
  return await page.evaluate(
    async ({ base64, fromSeconds, toSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const context = new AudioContext()
      try {
        const buffer = await context.decodeAudioData(bytes.buffer)
        const samples = buffer.getChannelData(0)
        const start = Math.max(0, Math.floor((fromSeconds ?? 0) * buffer.sampleRate))
        const end = Math.min(
          samples.length,
          Math.ceil((toSeconds ?? buffer.duration) * buffer.sampleRate),
        )
        let peak = 0
        for (let index = start; index < end; index++) {
          peak = Math.max(peak, Math.abs(samples[index]))
        }
        return { peak, duration: buffer.duration, channels: buffer.numberOfChannels }
      } finally {
        await context.close()
      }
    },
    {
      base64: webm.toString('base64'),
      fromSeconds: window.fromSeconds,
      toSeconds: window.toSeconds,
    },
  )
}

/** Loud enough to be audible; comfortably above codec noise in silence. */
const AUDIBLE_PEAK = 0.05
const SILENT_PEAK = 0.01

test('exporting a trimmed 2-entry sequence downloads a playable WebM of the right length', async ({
  page,
}) => {
  await page.goto('./')

  // No export before any timeline entries exist.
  await expect(page.getByRole('button', { name: 'Export Project…' })).toBeDisabled()

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'second.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add second.webm to timeline' }).click()

  // Trim both entries so the export exercises in- AND out-points:
  // entry 1 plays [0, 1.0), entry 2 plays [0.5, 1.2) → total 1.7 s.
  const out1 = page.getByRole('spinbutton', {
    name: 'Trim out point of first.webm at position 1 in seconds',
  })
  await out1.fill('1')
  await out1.blur()
  const in2 = page.getByRole('spinbutton', {
    name: 'Trim in point of second.webm at position 2 in seconds',
  })
  await in2.fill('0.5')
  await in2.blur()
  const out2 = page.getByRole('spinbutton', {
    name: 'Trim out point of second.webm at position 2 in seconds',
  })
  await out2.fill('1.2')
  await out2.blur()

  // The preview's seek slider max is the trimmed sequence total — the same
  // number the exported file's duration must come close to.
  const expectedTotal = Number(
    await page.getByRole('slider', { name: 'Seek within sequence' }).getAttribute('max'),
  )
  expect(expectedTotal).toBeCloseTo(1.7, 1)

  // Export: progress appears, and the download lands without another click.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: 'Export progress' })).toBeVisible()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('sequence-export.webm')

  const path = await download.path()
  const exported = await readFile(path)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Decode the exported file back in the browser: it must be a playable
  // video whose duration reflects the trimmed sequence. Recording happens in
  // real time, so allow slack for clip-switch overhead (longer) and for the
  // out-point epsilon (marginally shorter) — but a file that ignored the
  // trims would be ~3 s and fail the upper bound.
  const probed = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    return await new Promise<{ duration: number; width: number; height: number }>(
      (resolve, reject) => {
        const settleIfKnown = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            resolve({
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
            })
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
      },
    )
  }, exported.toString('base64'))

  expect(probed.width).toBe(320)
  expect(probed.height).toBe(180)
  expect(probed.duration).toBeGreaterThan(expectedTotal * 0.6)
  expect(probed.duration).toBeLessThan(expectedTotal + 1)

  // The finished export closed the dialog — back to the main view (#164).
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

/** Clicking first gives the page the user activation an AudioContext needs. */
async function activate(page: import('@playwright/test').Page) {
  await page.getByRole('heading', { name: 'Browser Video Editor' }).click()
}

test("the exported file carries the source clip's audio", async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await activate(page)

  const webm = await recordWebm(page, { durationMs: 1500, toneFromMs: 0 })

  // Guard against a vacuous pass: if the fixture were silent, an export that
  // dropped audio entirely would still satisfy the assertions below.
  const source = await measureAudio(page, webm)
  expect(source.peak).toBeGreaterThan(AUDIBLE_PEAK)

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'tone.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add tone.webm to timeline' }).click()

  // The MVP caveat is gone from the UI now that audio is exported.
  await expect(page.getByText(/audio is not included/i)).toHaveCount(0)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile(await download.path())

  const exportedAudio = await measureAudio(page, exported)
  expect(exportedAudio.channels).toBeGreaterThan(0)
  expect(exportedAudio.peak).toBeGreaterThan(AUDIBLE_PEAK)
})

test('trims apply to audio, not just to video', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await activate(page)

  // A source that is silent for its first ~1.3 s and then plays a tone, so
  // the two trims below have opposite expected outcomes.
  const webm = await recordWebm(page, { durationMs: 2400, toneFromMs: 1300 })
  expect((await measureAudio(page, webm, { toSeconds: 0.9 })).peak).toBeLessThan(SILENT_PEAK)
  expect((await measureAudio(page, webm, { fromSeconds: 1.7 })).peak).toBeGreaterThan(AUDIBLE_PEAK)

  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'split.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add split.webm to timeline' }).click()

  const inPoint = page.getByRole('spinbutton', {
    name: 'Trim in point of split.webm at position 1 in seconds',
  })
  const outPoint = page.getByRole('spinbutton', {
    name: 'Trim out point of split.webm at position 1 in seconds',
  })
  // Trims clamp to the clip's probed duration, so the windows above are only
  // reachable if the source really is ~2.4 s long.
  expect(Number(await outPoint.getAttribute('max'))).toBeGreaterThan(2)

  const exportOnce = async () => {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    return await readFile(await download.path())
  }

  // Keeping only the tone tail: the export is audible.
  await inPoint.fill('1.7')
  await inPoint.blur()
  expect((await measureAudio(page, await exportOnce())).peak).toBeGreaterThan(AUDIBLE_PEAK)

  // Keeping only the silent head: no audio from beyond the out-point leaks in.
  await inPoint.fill('0')
  await inPoint.blur()
  await outPoint.fill('0.9')
  await outPoint.blur()
  expect((await measureAudio(page, await exportOnce())).peak).toBeLessThan(SILENT_PEAK)
})

test('canceling an export returns to idle without an error or download', async ({ page }) => {
  await page.goto('./')

  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'first.webm', mimeType: 'video/webm', buffer: webm },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Add first.webm to timeline' }).click()

  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Canceling closed the dialog without an error or a download.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export Project…' })).toBeEnabled()
  await expect(page.getByRole('alert')).not.toBeVisible()
  await expect(page.getByTestId('export-download')).toHaveCount(0)
})
