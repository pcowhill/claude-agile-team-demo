import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

type Page = import('@playwright/test').Page

/**
 * The Shaped wipes transitions pack (#199): the transition registry's first
 * plugin, exercised through the real chain — the manager enables the lazy
 * chunk, the pack's transitions appear in the timeline's type picker, a pack
 * transition renders in the preview (CSS clip-path) and in an exported file
 * (canvas clip), a saved project records the plugin dependency, and opening
 * that file prompt-and-enables (#197's mechanism, exercised for real).
 *
 * The core 18 names are pinned where the disabled state is asserted, so a
 * pack id leaking into the stock picker (or a core type vanishing) fails
 * loudly.
 */

/** Records a real solid-color WebM so preview and export decode real video. */
async function recordWebm(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ color }) => {
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
          ctx.fillStyle = color
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > 1500) resolve()
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
    },
    { color },
  )
  return Buffer.from(base64, 'base64')
}

/** Two 1s-trimmed solid clips (green then blue) with a transition between
 * them: the 1s default overlap spans the whole sequence, so seek position
 * equals transition progress and every frame of an export is mid-overlap. */
async function buildOverlapSequence(page: Page) {
  const green = await recordWebm(page, 'rgb(0, 205, 0)')
  const blue = await recordWebm(page, 'rgb(0, 0, 205)')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'green.webm', mimeType: 'video/webm', buffer: green },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add green.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add blue.webm to timeline' }).click()
  for (const [position, name] of [
    [1, 'green'],
    [2, 'blue'],
  ] as const) {
    const out = page.getByRole('spinbutton', {
      name: `Trim out point of ${name}.webm at position ${position} in seconds`,
    })
    await out.fill('1')
    await out.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()
  await expect(page.getByTestId('timeline-total')).toHaveText('0:01')
  return { green, blue }
}

/** Opens the manager and toggles the Shaped wipes plugin to the wanted state. */
async function setShapedWipes(page: Page, enabled: boolean) {
  await page.getByRole('button', { name: 'Plugins…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page
    .getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Shaped wipes` })
    .click()
  // The toggle flips only after the chunk loads and activate ran (or the
  // deactivate unregistered) — this wait is the real proof of the chain.
  await expect(
    page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Shaped wipes` }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** The core transition names, in registration (= picker) order. Pinned: a
 * disabled pack must leave this list exactly as core shipped it. */
const CORE_NAMES = [
  'Crossfade',
  'Slide from above',
  'Slide from below',
  'Slide from left',
  'Slide from right',
  'Wipe from left',
  'Wipe from right',
  'Wipe from above',
  'Wipe from below',
  'Push from left',
  'Push from right',
  'Push from above',
  'Push from below',
  'Fade through black',
  'Fade through white',
  'Iris open',
  'Iris close',
  'Cross-zoom',
]

const PACK_NAMES = [
  'Box open',
  'Barn doors open',
  'Letterbox open',
  'Wipe from top left',
  'Wipe from top right',
  'Wipe from bottom left',
  'Wipe from bottom right',
]

test('the pack extends the type picker when enabled and leaves it stock when disabled', async ({
  page,
}) => {
  await page.goto('./')
  await buildOverlapSequence(page)
  const select = page.getByRole('combobox', { name: 'Transition type between position 1 and 2' })

  // Disabled (the default): exactly the core options, in order.
  await expect(select.locator('option')).toHaveText(CORE_NAMES)

  // Enable → the pack's seven join the picker, after the core set, live.
  await setShapedWipes(page, true)
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, ...PACK_NAMES])

  // Disable → the picker is stock again, and the stored type survives as a
  // named unavailable option instead of the select lying with option one.
  await select.selectOption('box-open')
  await setShapedWipes(page, false)
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, 'box-open (unavailable)'])
  await expect(select).toHaveValue('box-open')
  await setShapedWipes(page, true)
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, ...PACK_NAMES])
})

test('a pack transition previews: the incoming card is cut to the box reveal', async ({
  page,
}) => {
  await page.goto('./')
  await buildOverlapSequence(page)
  await setShapedWipes(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('box-open')

  // Seek to the overlap midpoint: progress 0.5, so the reveal is the centred
  // half-size box — inset(25% 25% 25% 25%) on the incoming card. A geometry
  // claim a browser can measure, per development.md's rendered-evidence rule.
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('0.5')
  await expect(page.getByTestId('preview-video-incoming')).toBeVisible()
  const card = page.getByTestId('preview-video-incoming-card')
  // Chromium normalizes the equal-sided inset to its shorthand.
  await expect(card).toHaveCSS('clip-path', 'inset(25%)')

  // The readout names the pack transition by its registered name.
  await expect(page.getByTestId('preview-now-playing')).toContainText(
    'green.webm → blue.webm (box open)',
  )
})

test('a pack transition exports: the box carries the incoming clip over the outgoing frame', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await buildOverlapSequence(page)
  await setShapedWipes(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('box-open')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exported = await readFile((await download.path())!)
  expect(exported.byteLength).toBeGreaterThan(1000)

  // Decode the exported file and sample its middle frame. The whole 1s
  // export is the overlap, so the file's own midpoint sits near progress
  // 0.5 even if load stretched the real-time recording uniformly (#370's
  // lesson: sample by the file's own timeline, not nominal seconds). At any
  // progress in the middle half the box covers the centre and no corner:
  // centre = incoming blue, corner = outgoing green.
  const probed = await page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    const video = document.createElement('video')
    video.muted = true
    try {
      await new Promise<void>((resolve, reject) => {
        video.onerror = () => reject(new Error('exported file failed to decode'))
        video.onloadedmetadata = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) resolve()
          else {
            video.ondurationchange = () => {
              if (Number.isFinite(video.duration) && video.duration > 0) resolve()
            }
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
        }
        video.src = url
      })
      const duration = video.duration
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = duration / 2
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      const sample = (xFraction: number, yFraction: number) => {
        const data = ctx.getImageData(
          Math.floor(canvas.width * xFraction),
          Math.floor(canvas.height * yFraction),
          1,
          1,
        ).data
        return { r: data[0], g: data[1], b: data[2] }
      }
      return {
        duration,
        centre: sample(0.5, 0.5),
        topLeft: sample(0.03, 0.03),
        bottomRight: sample(0.97, 0.97),
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, exported.toString('base64'))

  // Real-time recording of a 1s sequence: overhead above, epsilon below.
  expect(probed.duration).toBeGreaterThan(0.6)
  expect(probed.duration).toBeLessThan(2.5)
  // Centre: inside the box → the incoming clip's blue, not green or black.
  expect(probed.centre.b).toBeGreaterThan(120)
  expect(probed.centre.g).toBeLessThan(80)
  // Corners: outside the box → the outgoing clip's green at full strength
  // (a wipe never dims the outgoing layer), not blue and not black.
  for (const corner of [probed.topLeft, probed.bottomRight]) {
    expect(corner.g).toBeGreaterThan(120)
    expect(corner.b).toBeLessThan(80)
  }
}, )

test('a saved project records the pack dependency; opening prompt-and-enables (#197)', async ({
  page,
}) => {
  // Force the anchor-download save path (as save.spec.ts does): with the
  // File System Access picker present, no 'download' event would fire.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  const { green, blue } = await buildOverlapSequence(page)
  await setShapedWipes(page, true)
  await page
    .getByRole('combobox', { name: 'Transition type between position 1 and 2' })
    .selectOption('box-open')

  // Save references-only and keep the bytes.
  await page.getByRole('button', { name: 'Save As…' }).click()
  const modeDialog = page.getByRole('dialog', { name: 'Save project' })
  await modeDialog.getByRole('radio', { name: 'Store references only' }).check()
  const downloadPromise = page.waitForEvent('download')
  await modeDialog.getByRole('button', { name: 'Save…' }).click()
  const projectBytes = await readFile((await (await downloadPromise).path())!)

  // Back to a disabled plugin, so the open must prompt.
  await setShapedWipes(page, false)

  await page
    .getByTestId('project-file-input')
    .setInputFiles([{ name: 'boxed.bvep', mimeType: 'application/gzip', buffer: projectBytes }])
  const prompt = page.getByRole('dialog', { name: 'Enable plugins to open?' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Shaped wipes')
  await prompt.getByRole('button', { name: 'Enable and open' }).click()

  // References file: re-link both clips, then open.
  const relink = page.getByRole('dialog', { name: 'Open boxed.bvep' })
  await expect(relink).toBeVisible()
  await page.getByTestId('relink-file-input').setInputFiles([
    { name: 'green.webm', mimeType: 'video/webm', buffer: green },
    { name: 'blue.webm', mimeType: 'video/webm', buffer: blue },
  ])
  const openButton = relink.getByRole('button', { name: 'Open project' })
  await expect(openButton).toBeEnabled()
  await openButton.click()

  // The transition came back as the pack type, with the plugin now enabled.
  const select = page.getByRole('combobox', { name: 'Transition type between position 1 and 2' })
  await expect(select).toHaveValue('box-open')
  await expect(select.locator('option')).toHaveText([...CORE_NAMES, ...PACK_NAMES])
  await expect(page.getByTestId('timeline-total')).toHaveText('0:01')
})
