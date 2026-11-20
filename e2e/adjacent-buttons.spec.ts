import { expect, test } from '@playwright/test'
import { chooseView } from './clipMenu'
import { expectAlignedRow } from './layout'
import { sineWav } from './sineWav'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The customer's two clusters of adjacent buttons (#792, from #787): a
 * library entry's ▶ / Add / ⋯, in both the list and the thumbnail view,
 * and a timeline row's ↑ / ↓ / ⋯ / ✕ (or ⋯ / ✕ on rows that cannot move).
 * Each cluster shares one height with its tops and bottoms aligned
 * (`expectAlignedRow`), on a populated project, at 1280×720 and 360 px.
 *
 * The glyphs come from fallback symbol fonts, which differ by platform
 * (#470/#472), so the cluster is measured again under a style that
 * enlarges every glyph button's font: the height must not move, because
 * the height belongs to the rule rather than to whatever font draws the
 * glyph.
 */

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
        if (performance.now() - start > 500) resolve()
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

/** A video, an audio and an image clip in the library, each added to the timeline. */
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
  // The video and the still are sequence entries (↑ ↓ ⋯ ✕); the tone is
  // an audio track (⋯ ✕).
  await expect(page.getByRole('list', { name: 'Sequence' }).getByRole('listitem')).toHaveCount(2)
}

/** A cluster's buttons: its own, and its ⋯ menu's trigger rather than the wrapper. */
const buttonsOf = (cluster: Locator) =>
  cluster.locator(':scope > button, :scope > .menu > .menu-trigger')

const TALLER_GLYPHS = `
  .clip-preview, .clip-more > .menu-trigger,
  .timeline-row-actions > button, .timeline-row-more > .menu-trigger { font-size: 150% !important; }
`

/**
 * Every cluster matched by `selector` is aligned, cleanly and under taller
 * glyphs, and the taller glyphs leave each cluster's height where it was.
 */
async function expectClustersAligned(page: Page, selector: string, what: string) {
  const clusters = await page.locator(selector).all()
  expect(clusters.length, `no ${what}`).toBeGreaterThan(0)
  const clean: number[] = []
  for (const [index, cluster] of clusters.entries()) {
    clean.push(await expectAlignedRow(buttonsOf(cluster), `${what} ${index + 1}`))
  }
  const style = await page.addStyleTag({ content: TALLER_GLYPHS })
  for (const [index, cluster] of clusters.entries()) {
    const tall = await expectAlignedRow(buttonsOf(cluster), `${what} ${index + 1}, taller glyphs`)
    expect(
      Math.abs(tall - clean[index]),
      `${what} ${index + 1}: a taller glyph font changed the height from ${clean[index]} to ${tall}`,
    ).toBeLessThanOrEqual(1)
  }
  await style.evaluate((node) => (node as Element).remove())
}

/** Each ⋯ wrapper is exactly its trigger's height, so the row centres the button. */
async function expectWrapperFitsTrigger(page: Page, selector: string, what: string) {
  const menus = await page.locator(selector).all()
  expect(menus.length, `no ${what}`).toBeGreaterThan(0)
  for (const [index, menu] of menus.entries()) {
    const heights = await menu.evaluate((node) => ({
      wrapper: node.getBoundingClientRect().height,
      trigger: node.querySelector(':scope > .menu-trigger')!.getBoundingClientRect().height,
    }))
    expect(
      Math.abs(heights.wrapper - heights.trigger),
      `${what} ${index + 1}: wrapper ${heights.wrapper} px around a ${heights.trigger} px trigger`,
    ).toBeLessThanOrEqual(1)
  }
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 800 },
]) {
  test(`at ${viewport.width}px, each library entry's ▶ / Add / ⋯ share one height in both views, and each timeline row's ↑ / ↓ / ⋯ / ✕ (#792)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await populate(page)

    await expectClustersAligned(page, '.clip-actions', 'library row actions')
    await expectWrapperFitsTrigger(page, '.clip-actions > .clip-more', 'library row ⋯')
    await expectClustersAligned(page, '.timeline-row-actions', 'timeline row actions')
    await expectWrapperFitsTrigger(page, '.timeline-row-actions > .timeline-row-more', 'timeline row ⋯')
    if (viewport.width === 1280) {
      await page.locator('.clip-item').first().screenshot({ path: testInfo.outputPath('library-row.png') })
      await page
        .getByRole('list', { name: 'Sequence' })
        .getByRole('listitem')
        .first()
        .screenshot({ path: testInfo.outputPath('timeline-row.png') })
    }

    await chooseView(page, 'Thumbnails')
    await expectClustersAligned(page, '.clip-card-actions', 'library card actions')
    await expectWrapperFitsTrigger(page, '.clip-card-actions > .clip-more', 'library card ⋯')
    if (viewport.width === 1280) {
      // The card's body, scrolled into the library's list: a whole card is
      // taller than the list shows at once.
      const body = page.locator('.clip-card-body').first()
      await body.scrollIntoViewIfNeeded()
      await body.screenshot({ path: testInfo.outputPath('library-card.png') })
    }
  })
}
