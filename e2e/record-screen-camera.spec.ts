import { chromium, expect, test } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'

type Page = import('@playwright/test').Page

/**
 * Screen + camera in one take (#388): the "Screen + camera" source records
 * both streams from one gesture and the stopped take arrives placed — the
 * screen capture appended to the sequence, the camera capture as a video
 * overlay starting exactly with it. The flags combine the suite's two
 * existing capture fakes: `getDisplayMedia` auto-selects the editor's own
 * tab (record-screen.spec.ts) and `getUserMedia` serves Chromium's fake
 * camera and microphone (record-webcam.spec.ts) — the capture pipeline runs
 * for real, only the devices are synthetic. Every pre-stop wait anchors on
 * media the streams actually delivered, never the wall clock (#373/#377),
 * and every poll anchors on states load cannot fake (#362).
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: [
      '--auto-select-tab-capture-source-by-title=Browser Video Editor',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

/** Records a ~1 s solid-color WebM to seed the timeline, so the placement
 * lands at a nonzero start the test can hold against the overlay's offset. */
async function recordBaseWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = 'rgb(0, 120, 205)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1000) resolve()
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

/** Reads a SecondsField's numeric value by accessible name. */
async function fieldValue(page: Page, name: string): Promise<number> {
  return Number(await page.getByRole('spinbutton', { name }).inputValue())
}

test('one take records screen and camera, placed as entry plus corner overlay (#388)', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000)
  await page.goto('./')

  // Seed the sequence with a ~1 s clip so the placement's start is nonzero:
  // the overlay's offset must equal the appended entry's start, not zero.
  const base = await recordBaseWebm(page)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'base.webm', mimeType: 'video/webm', buffer: base }])
  await page.getByRole('button', { name: 'Add base.webm to timeline' }).click()
  await expect(
    page.getByRole('spinbutton', { name: 'Trim out point of base.webm at position 1 in seconds' }),
  ).toBeVisible()
  const baseLength =
    (await fieldValue(page, 'Trim out point of base.webm at position 1 in seconds')) -
    (await fieldValue(page, 'Trim in point of base.webm at position 1 in seconds'))
  expect(baseLength).toBeGreaterThan(0.3)

  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen + camera' }).click()
  const dialog = page.getByRole('dialog', { name: 'Recording screen + camera' })
  await expect(dialog).toBeVisible()

  // Both live previews decode real frames from their own streams: nonzero
  // intrinsic width is a decoded frame, not a styled box.
  for (const testId of ['record-preview', 'record-preview-camera']) {
    await expect
      .poll(() => page.getByTestId(testId).evaluate((el: HTMLVideoElement) => el.videoWidth))
      .toBeGreaterThan(0)
  }

  // Geometry (new visible surface): both previews and the routing note sit
  // inside the dialog (+1 px border tolerance, as the suite's containment
  // checks state), nothing overflows its own box, and the page gained no
  // sideways scroll.
  const dialogBox = (await dialog.boundingBox())!
  for (const testId of ['record-preview', 'record-preview-camera']) {
    const box = (await page.getByTestId(testId).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(dialogBox.x - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(dialogBox.y - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1)
  }
  const note = page.locator('.record-note')
  await expect(note).toContainText('microphone records with the camera clip')
  const noteOverflow = await note.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(noteOverflow.scrollWidth).toBeLessThanOrEqual(noteOverflow.clientWidth)
  const pageScroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(pageScroll.scrollWidth).toBeLessThanOrEqual(pageScroll.clientWidth)
  // The human check for the PR's rendered evidence, re-taken every run.
  await page.screenshot({ path: testInfo.outputPath('record-screen-camera-dialog.png') })

  // "Captured at least a second" anchored on delivered media (#373/#377):
  // the screen preview plays the tab capture itself, which only emits on
  // repaints — the dialog's pulsing indicator keeps those coming. The
  // camera's fake device delivers continuously, so the screen span is the
  // binding constraint for both recorders, which attached to these same
  // streams before the previews started playing.
  await page.getByTestId('record-preview').evaluate((el: HTMLVideoElement) => {
    const probe = { first: -1, span: 0 }
    ;(window as unknown as { __captureSpanProbe: typeof probe }).__captureSpanProbe = probe
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (probe.first < 0) probe.first = metadata.mediaTime
      probe.span = metadata.mediaTime - probe.first
      el.requestVideoFrameCallback(onFrame)
    }
    el.requestVideoFrameCallback(onFrame)
  })
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __captureSpanProbe: { span: number } }).__captureSpanProbe
              .span,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(1.2)
  await page.getByRole('button', { name: 'Stop recording' }).click()

  // Both captures land as ordinary library clips under their own names.
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem').filter({ hasText: 'Screen recording 1.webm' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(library.getByRole('listitem').filter({ hasText: 'Webcam recording 1.webm' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The arrival is placed: the screen capture is the sequence's second
  // entry, and the camera capture is an overlay layer whose start equals
  // the entry's start — the base clip's trimmed length (SecondsField shows
  // two decimals, hence the 0.05 tolerance).
  const screenOut = page.getByRole('spinbutton', {
    name: 'Trim out point of Screen recording 1.webm at position 2 in seconds',
  })
  await expect(screenOut).toBeVisible()
  const overlays = page.getByRole('list', { name: 'Overlay layers' })
  await expect(overlays).toContainText('Webcam recording 1.webm')
  const overlayStart = await fieldValue(
    page,
    'Start time of overlay Webcam recording 1.webm at position 1 in seconds',
  )
  expect(Math.abs(overlayStart - baseLength)).toBeLessThanOrEqual(0.05)

  // Sync, evidenced as duration agreement (#388's stated proxy): both
  // recorders started from the one gesture and stopped together, so the two
  // probed durations differ only by recorder startup/teardown skew. 1.25 s
  // is far below the failure mode this guards (a pairing broken enough that
  // one clip is a sliver or one recorder ran on without the other), while
  // leaving room for tab capture's repaint-driven delivery under load.
  const screenDuration = await fieldValue(
    page,
    'Trim out point of Screen recording 1.webm at position 2 in seconds',
  )
  const cameraDuration = await fieldValue(
    page,
    'Trim out point of overlay Webcam recording 1.webm at position 1 in seconds',
  )
  expect(screenDuration).toBeGreaterThan(0.6)
  expect(cameraDuration).toBeGreaterThan(0.6)
  expect(Math.abs(screenDuration - cameraDuration)).toBeLessThanOrEqual(1.25)

  // The camera overlay renders as a corner bubble: its card sits inside the
  // preview frame's bottom-right quadrant (the default rect starts at 62%),
  // with the +1 px border tolerance.
  const frameBox = (await page.getByTestId('preview-frame').boundingBox())!
  const cardBox = (await page.getByTestId('preview-overlay-card-0').boundingBox())!
  expect(cardBox.x).toBeGreaterThanOrEqual(frameBox.x + frameBox.width * 0.5)
  expect(cardBox.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height * 0.5)
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1)
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height + 1)

  // One undo removes the placed pair together — entry and overlay — while
  // the library keeps both captures: the take is a deliverable of its own.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(overlays).not.toBeAttached()
  await expect(screenOut).not.toBeAttached()
  await expect(
    page.getByRole('spinbutton', { name: 'Trim out point of base.webm at position 1 in seconds' }),
  ).toBeVisible()
  await expect(library.getByRole('listitem').filter({ hasText: 'Screen recording 1.webm' })).toBeVisible()
  await expect(library.getByRole('listitem').filter({ hasText: 'Webcam recording 1.webm' })).toBeVisible()
})

test('cancel discards a screen + camera take without touching the library (#388)', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen + camera' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording screen + camera' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No clips yet', { exact: false })).toBeVisible()
})
