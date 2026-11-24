import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'
import { expectNoWrap, expectWithin } from './layout'

/**
 * Record ▾ › System audio (#878, from customer feedback #874), against
 * Chromium's fake display capture. The flags auto-select a surface with no
 * picker UI and grant permission. On #878's measurement the capture is a
 * `monitor` surface carrying one "Fake audio" track, which stands in for
 * the system audio a real share would carry. The pipeline runs for real
 * (getDisplayMedia → MediaRecorder → import path), and that is the proxy
 * for the customer-verifiable criterion: recording real system audio on
 * the customer's own machine.
 *
 * The evidence about the recorded bytes is gathered **test-side**, not
 * from the app's code: an init script wraps `MediaRecorder`, noting the
 * track kinds each recorder was given and collecting what it delivers. The
 * page's own `decodeAudioData` then decodes those bytes.
 */
withFakeMedia(test, ['--auto-select-tab-capture-source-by-title=Browser Video Editor'])

interface RecorderProbe {
  /** The kinds of the tracks each recorder was constructed with, in order. */
  kinds: string[][]
  chunks: Blob[]
  /** Every track any getDisplayMedia share returned, to check the release. */
  sharedTracks: MediaStreamTrack[]
}

/** Installs the test-side MediaRecorder / getDisplayMedia probes before the app loads. */
async function installProbes(page: Page, options: { stripSharedAudio?: boolean } = {}) {
  await page.addInitScript((stripSharedAudio) => {
    const probe: RecorderProbe = { kinds: [], chunks: [], sharedTracks: [] }
    ;(window as unknown as { __recorderProbe: RecorderProbe }).__recorderProbe = probe
    const Original = window.MediaRecorder
    class ProbedRecorder extends Original {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        probe.kinds.push(stream.getTracks().map((track) => track.kind))
        this.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) probe.chunks.push(event.data)
        })
      }
    }
    window.MediaRecorder = ProbedRecorder as typeof MediaRecorder
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      const stream = await getDisplayMedia(constraints)
      probe.sharedTracks.push(...stream.getTracks())
      if (stripSharedAudio) {
        // The share-audio box left unticked: the share carries no sound.
        for (const track of stream.getAudioTracks()) {
          track.stop()
          stream.removeTrack(track)
        }
      }
      return stream
    }
  }, options.stripSharedAudio === true)
}

const chooseSystemAudio = async (page: Page) => {
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'System audio' }).click()
}

test('Record ▾ offers System audio where the browser can share display audio (#878)', async ({
  page,
  browserName,
}) => {
  await page.goto('./')
  // The probe the source is gated on, read straight from the browser.
  const probe = await page.evaluate(
    () =>
      (navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, unknown> | undefined)
        ?.suppressLocalAudioPlayback ?? null,
  )
  console.log(`[${browserName}] getSupportedConstraints().suppressLocalAudioPlayback: ${probe}`)
  await page.getByRole('button', { name: 'Record' }).click()
  const menu = page.getByRole('menu', { name: 'Recording sources' })
  await expect(menu).toBeVisible()
  // Chromium shares display audio; Firefox's screen capture never carries
  // any (#579), so there the source is absent rather than failing every time.
  await expect(menu.getByRole('menuitem', { name: 'System audio' })).toHaveCount(
    browserName === 'chromium' ? 1 : 0,
  )
  if (browserName !== 'chromium') return

  // The new item's geometry, at the menu spec's two viewports (#412): its
  // label on one line (counted from its text's client rects, not by
  // comparing boxes, #605) and the item inside the open panel.
  await page.keyboard.press('Escape')
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Record' }).click()
    const item = menu.getByRole('menuitem', { name: 'System audio' })
    await expectNoWrap(item, `the System audio item at ${viewport.width}px`)
    await expectWithin(item, menu, { what: `System audio item at ${viewport.width}px` })
    await page.keyboard.press('Escape')
  }
})

test('a System audio take lands in the library as an audio clip of the shared sound (#878)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await installProbes(page)
  await page.goto('./')

  await chooseSystemAudio(page)
  const dialog = page.getByRole('dialog', { name: 'Recording system audio' })
  await expect(dialog).toBeVisible()
  // Audio only: no live view of the shared picture.
  await expect(dialog.getByTestId('record-preview')).toHaveCount(0)
  // Through the countdown, then a reading of 0:03. The readout rounds
  // (formatDuration), so 0:03 is 2.5 s to 3.5 s of recorded time, and Stop
  // lands while it still reads that.
  await expect(page.getByTestId('record-elapsed')).toHaveText('0:03', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Stop recording' }).click()

  const library = page.getByRole('list', { name: 'Imported clips' })
  const recording = library.getByRole('listitem').filter({ hasText: 'System audio 1.webm' })
  await expect(recording).toBeVisible()
  await expect(recording).toContainText('Audio')
  // The library's own probe of the file reads the same take.
  await expect(recording).toContainText(/0:0[2-4]/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The recorder was given the shared audio track alone: the picture was
  // shared, as Chromium requires, and never recorded.
  const evidence = await page.evaluate(async () => {
    const probe = (window as unknown as { __recorderProbe: RecorderProbe }).__recorderProbe
    const bytes = await new Blob(probe.chunks).arrayBuffer()
    const context = new AudioContext()
    const decoded = await context.decodeAudioData(bytes)
    const samples = decoded.getChannelData(0)
    let sum = 0
    for (const sample of samples) sum += sample * sample
    await context.close()
    return {
      kinds: probe.kinds,
      duration: decoded.duration,
      rms: Math.sqrt(sum / samples.length),
      released: probe.sharedTracks.map((track) => `${track.kind}:${track.readyState}`).sort(),
    }
  })
  console.log(`[system audio] ${JSON.stringify(evidence)}`)
  expect(evidence.kinds).toEqual([['audio']])
  // Within 0.5 s of the recorded time (2.5 s to 3.5 s, above); none of the
  // countdown is in it.
  expect(evidence.duration).toBeGreaterThanOrEqual(2.0)
  expect(evidence.duration).toBeLessThanOrEqual(4.0)
  // Chromium's fake audio is an audible tone, not silence: three local runs
  // on #878 measured RMS 0.0935 to 0.0952. The bar sits about 90× under
  // that, and a silent take reads 0.
  expect(evidence.rms).toBeGreaterThan(0.001)
  // Every shared track, picture included, was released at the end.
  expect(evidence.released).toEqual(['audio:ended', 'video:ended'])

  // And it is an ordinary library clip, placeable on the timeline.
  await expect(page.getByRole('button', { name: 'Add System audio 1.webm to timeline' })).toBeVisible()
})

test('a share without audio fails before the countdown and releases the share (#878)', async ({
  page,
}) => {
  await installProbes(page, { stripSharedAudio: true })
  await page.goto('./')

  await chooseSystemAudio(page)
  await expect(page.getByRole('alert')).toContainText(
    'System audio recording failed: no audio was shared.',
  )
  // No dialog and no countdown: the take never began.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __recorderProbe: RecorderProbe }).__recorderProbe.sharedTracks.map(
          (track) => `${track.kind}:${track.readyState}`,
        ).sort(),
      ),
    )
    .toEqual(['audio:ended', 'video:ended'])
  const recorders = await page.evaluate(
    () => (window as unknown as { __recorderProbe: RecorderProbe }).__recorderProbe.kinds.length,
  )
  expect(recorders).toBe(0)
})
