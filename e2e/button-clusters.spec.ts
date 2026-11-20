import { expect, test } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { expectAlignedLines } from './layout'
import { openPicture } from './pictureDisclosure'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * Every other cluster of adjacent buttons in the app (#793, from the
 * customer's #787 — #792 did the library row and the timeline row, in
 * adjacent-buttons.spec.ts) shares one height with its tops and bottoms
 * aligned, on a populated project, at 1280×720 and 360px.
 *
 * Each cluster is measured again with every glyph-bearing control's font
 * enlarged by half. The glyphs (↺ ↻ ▲ ▼ ▾ ⏮ ◀ ▶ ⏭ ✕ …) come from fallback
 * symbol fonts that differ by platform (#470/#472), so a cluster that lines
 * up on CI's fonts need not on the customer's: the enlargement is what a
 * taller platform font does to a line box, and the height must not move,
 * because it belongs to the rule.
 *
 * Clusters measured and found aligned already, with no CSS change, are
 * kept here so a later change cannot regress them silently: the selection
 * bar, the source preview's actions and the confirm dialog's footer.
 */

const STILL = 'still.png at position 2'

/** Records a short solid-colour WebM, so the library holds a real video. */
async function recordWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
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
        ctx.fillStyle = 'rgb(0, 0, 205)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1500) resolve()
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
  })
  return Buffer.from(base64, 'base64')
}

/** A 64×64 PNG, so the library holds an image. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    canvas.getContext('2d')!.fillRect(0, 0, 64, 64)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

/** A video, an audio and an image clip, each on the timeline, two of them selected. */
async function populate(page: Page) {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav() },
    { name: 'still.png', mimeType: 'image/png', buffer: await makePng(page) },
  ])
  for (const name of ['clip.webm', 'tone.wav', 'still.png']) {
    await page.getByRole('button', { name: `Add ${name} to timeline` }).click()
  }
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('checkbox', { name: 'Select clip.webm' }).check()
  await page.getByRole('checkbox', { name: 'Select tone.wav' }).check()
}

/** A cluster's controls: its buttons and selects, menus' items excluded by the helper. */
const controlsOf = (page: Page, cluster: string): Locator =>
  page.locator(`${cluster} button, ${cluster} select`)

/**
 * The cluster lines up, and still does — at the same height — with every
 * glyph-bearing control's font enlarged by half.
 */
async function expectCluster(page: Page, cluster: string, what: string) {
  const clean = await expectAlignedLines(controlsOf(page, cluster), what)
  await page.evaluate((selector) => {
    for (const node of Array.from(document.querySelectorAll(`${selector} button, ${selector} select`))) {
      // Anything beyond printable ASCII is a glyph a fallback font may draw.
      if (/[^ -~\s]/.test(node.textContent ?? '')) node.setAttribute('data-taller-glyph', '')
    }
  }, cluster)
  const style = await page.addStyleTag({ content: '[data-taller-glyph] { font-size: 150% !important; }' })
  const tall = await expectAlignedLines(controlsOf(page, cluster), `${what}, taller glyphs`)
  expect(
    Math.abs(tall - clean),
    `${what}: a taller glyph font changed the height from ${clean} to ${tall}`,
  ).toBeLessThanOrEqual(1)
  await style.evaluate((node) => (node as Element).remove())
  await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll('[data-taller-glyph]'))) {
      node.removeAttribute('data-taller-glyph')
    }
  })
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  test(`at ${viewport.width}px, every other cluster of adjacent buttons shares one height, tops and bottoms aligned (#793)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize(viewport)
    await populate(page)
    const at = `at ${viewport.width}px`

    // The main surfaces.
    await expectCluster(page, '.library-header', `the library header ${at}`)
    await expectCluster(page, '.clip-selection-bar', `the selection bar ${at}`)
    await expectCluster(page, '.preview-controls', `the preview transport ${at}`)
    await expectCluster(page, '.timeline-header', `the timeline header ${at}`)
    if (viewport.width === 1280) {
      await page.locator('.timeline-header').screenshot({ path: testInfo.outputPath('timeline-header.png') })
      await page.locator('.library-header').screenshot({ path: testInfo.outputPath('library-header.png') })
    }

    // The source preview's actions.
    await page.getByRole('button', { name: 'Preview clip.webm' }).click()
    await expectCluster(page, '.source-preview-actions', `the source preview's actions ${at}`)
    await page.getByTestId('source-back').click()

    // A confirm dialog's footer.
    await chooseClipAction(page, 'tone.wav', 'Remove')
    const confirm = page.getByRole('dialog')
    await expect(confirm).toBeVisible()
    await expectCluster(page, '.dialog-actions', `the confirm dialog's footer ${at}`)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()

    // The Trim window's rows.
    await page.getByRole('button', { name: 'Trim clip.webm at position 1 in the Trim window' }).click()
    const trim = page.getByRole('dialog', { name: 'Trim clip.webm at position 1' })
    await expect(trim).toBeVisible()
    await expectCluster(page, '.trim-transport', `the Trim window's transport ${at}`)
    await expectCluster(page, '.trim-set', `the Trim window's Set In / Set Out ${at}`)
    await expectCluster(page, '.trim-footer', `the Trim window's footer ${at}`)
    if (viewport.width === 1280) await trim.screenshot({ path: testInfo.outputPath('trim-window.png') })
    await page.keyboard.press('Escape')
    await expect(trim).toBeHidden()

    // A visual editor's header: the crop editor's is the one with two
    // buttons, Reset beside ✕; the other editors' headers hold ✕ alone.
    await openPicture(page, STILL)
    await page.getByRole('button', { name: `Adjust the crop of ${STILL} visually` }).click()
    const editor = page.getByRole('dialog', { name: `Adjust the crop of ${STILL}` })
    await expect(editor).toBeVisible()
    await expectCluster(page, '.effect-editor-header', `the crop editor's header ${at}`)
    if (viewport.width === 1280) {
      await editor.locator('.effect-editor-header').screenshot({ path: testInfo.outputPath('crop-editor-header.png') })
    }
  })
}
