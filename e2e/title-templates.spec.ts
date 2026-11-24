import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { expectNoHorizontalScroll, expectNoWrap, expectWithin } from './layout'
import { ADD_SLATE, addMenu, addMenuTrigger, chooseFromAddMenu, openAddMenu } from './timelineMenu'

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/**
 * The Title templates plugin (#860): Add ▾ › Title template… opens a
 * gallery, and the chosen template is placed as ordinary text overlays and
 * a shape group. Exercised through the real chain: the manager loads the
 * lazy chunk, the item joins Add ▾, the dialog places elements the timeline
 * shows as rows, one undo removes them, the preview draws them inside the
 * frame at both aspects, and an exported frame carries the bar and its text.
 */

const CORE_ITEMS = ['Color slate', 'Text overlay', 'Shape group', 'Subtitles from .srt file…']
const ITEM = 'Title template…'
const LONG_NAME = 'Maximiliana Montgomery-Ashford' // 30 characters

async function setTitleTemplates(page: Page, enabled: boolean) {
  await chooseFromFileMenu(page, 'Plugins…')
  const dialog = page.getByRole('dialog', { name: 'Plugins' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: `${enabled ? 'Enable' : 'Disable'} Title templates` }).click()
  // The toggle flips only once the chunk has loaded and activate ran.
  await expect(
    page.getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Title templates` }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

const textRows = (page: Page): Locator =>
  page.getByRole('textbox', { name: /^Content of text overlay at position \d+$/ })

async function addMenuLabels(page: Page): Promise<string[]> {
  const menu = await openAddMenu(page)
  const labels = await menu.getByRole('menuitem').allTextContents()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return labels
}

/** A slate long enough for every template, so the preview has a frame to draw. */
async function addSlate(page: Page, seconds: number) {
  await chooseFromAddMenu(page, ADD_SLATE)
  const duration = page.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' })
  await duration.fill(String(seconds))
  await duration.blur()
}

async function openGallery(page: Page): Promise<Locator> {
  await chooseFromAddMenu(page, ITEM)
  const dialog = page.getByRole('dialog', { name: 'Title template' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Add ▾ offers Title template… only while the plugin is enabled, and disabling keeps what it placed', async ({
  page,
}) => {
  await page.goto('./')
  expect(await addMenuLabels(page)).toEqual(CORE_ITEMS)
  await setTitleTemplates(page, true)
  expect(await addMenuLabels(page)).toEqual([...CORE_ITEMS, ITEM])

  await addSlate(page, 6)
  const dialog = await openGallery(page)
  await dialog.getByRole('button', { name: 'Place' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(textRows(page)).toHaveCount(2)

  await setTitleTemplates(page, false)
  expect(await addMenuLabels(page)).toEqual(CORE_ITEMS)
  await expect(textRows(page)).toHaveCount(2)
  await expect(textRows(page).first()).toHaveValue('Alex Morgan')
})

test('the gallery works from the keyboard alone, one undo removes a placed template, and Escape cancels', async ({
  page,
}) => {
  await page.goto('./')
  await setTitleTemplates(page, true)
  await addSlate(page, 6)

  // Add ▾ from its trigger: ArrowDown opens on the first item, ArrowUp
  // wraps to the last, which is the plugin's.
  await addMenuTrigger(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(addMenu(page)).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: ITEM })).toBeFocused()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Title template' })
  await expect(dialog).toBeVisible()

  // The first template's radio has focus; the arrows move between them.
  const radios = dialog.getByRole('radio')
  await expect(radios.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(radios.nth(1)).toBeChecked()
  await expect(radios.nth(1)).toBeFocused()
  // Tab moves on to the chapter card's fields; Enter in a field places.
  await page.keyboard.press('Tab')
  const title = dialog.getByRole('textbox', { name: 'Title', exact: true })
  await expect(title).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Part two')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(textRows(page)).toHaveCount(2)
  await expect(textRows(page).nth(0)).toHaveValue('Part two')
  await expect(textRows(page).nth(1)).toHaveValue('Getting started')

  // One undo takes the whole template away: both texts and its group.
  await page.getByRole('button', { name: 'Undo last timeline edit' }).click()
  await expect(textRows(page)).toHaveCount(0)
  await expect(page.getByText('Chapter card', { exact: true })).toHaveCount(0)

  // Escape cancels and places nothing.
  await openGallery(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Title template' })).toHaveCount(0)
  await expect(textRows(page)).toHaveCount(0)
})

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 360, height: 740 },
]) {
  test(`the gallery fits the viewport at ${viewport.width}px: cards apart, previews inside them, labels on one line`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    await setTitleTemplates(page, true)
    await addSlate(page, 6)
    const dialog = await openGallery(page)
    const where = `at ${viewport.width}px`

    // Sideways the dialog must fit; it may scroll vertically by design.
    await expectWithin(dialog, page.locator('body'), { axis: 'x', what: `the dialog ${where}` })
    await expectNoHorizontalScroll(page, `with the gallery open ${where}`)

    const cards = dialog.locator('.title-template-option')
    await expect(cards).toHaveCount(3)
    const boxes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      }),
    )
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const overlap =
          Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left) > 0.5 &&
          Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top) > 0.5
        expect(overlap, `template cards ${a + 1} and ${b + 1} overlap ${where}: ${JSON.stringify([boxes[a], boxes[b]])}`).toBe(false)
      }
    }
    for (let index = 0; index < 3; index++) {
      await expectWithin(cards.nth(index).locator('canvas'), cards.nth(index), {
        what: `preview ${index + 1} ${where}`,
      })
      await expectWithin(cards.nth(index), dialog, { axis: 'x', what: `template card ${index + 1} ${where}` })
    }
    for (const index of [0, 1, 2]) {
      await dialog.getByRole('radio').nth(index).check()
      await expectNoWrap(dialog.locator('.title-templates-field label'), `a field label ${where}`)
      await expectWithin(dialog.locator('.title-templates-fields'), dialog, { axis: 'x', what: `the fields ${where}` })
    }
    await dialog.getByRole('radio').nth(0).check()
    await dialog.screenshot({ path: testInfo.outputPath(`title-templates-${viewport.width}.png`) })
  })
}

for (const preset of ['16:9', '9:16'] as const) {
  test(`at ${preset}, every template's lines stay inside the preview frame, a 30-character first line included`, async ({
    page,
  }) => {
    await page.goto('./')
    await setTitleTemplates(page, true)
    await page.getByRole('combobox', { name: 'Canvas aspect' }).selectOption(preset)
    await addSlate(page, 6)
    const frame = page.getByTestId('preview-frame')

    for (const [index, field] of [
      [0, 'Name'],
      [1, 'Title'],
      [2, 'Closing line'],
    ] as const) {
      const dialog = await openGallery(page)
      await dialog.getByRole('radio').nth(index).check()
      await dialog.getByRole('textbox', { name: field, exact: true }).fill(LONG_NAME)
      await dialog.getByRole('button', { name: 'Place' }).click()
      await expect(dialog).toHaveCount(0)
    }
    const texts = page.locator('.preview-text')
    // Lower third 2 lines, chapter card 2, end card 2: all active at 0 s.
    await expect(texts).toHaveCount(6)
    for (let index = 0; index < 6; index++) {
      const text = texts.nth(index)
      const content = await text.textContent()
      // The text's own extent, not its block: a centred <p> may be wider.
      const range = await text.evaluate((node) => {
        const r = document.createRange()
        r.selectNodeContents(node)
        const box = r.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      })
      const outer = await frame.boundingBox()
      if (outer === null) throw new Error('no preview frame')
      const what = `"${content}" at ${preset}: ${JSON.stringify(range)} in ${JSON.stringify(outer)}`
      // 1px for sub-pixel rounding between the canvas measure and the DOM's.
      expect(range.left, what).toBeGreaterThanOrEqual(outer.x - 1)
      expect(range.right, what).toBeLessThanOrEqual(outer.x + outer.width + 1)
      expect(range.top, what).toBeGreaterThanOrEqual(outer.y - 1)
      expect(range.bottom, what).toBeLessThanOrEqual(outer.y + outer.height + 1)
    }
  })
}

/** Exports the project and returns the file. */
async function exportOnce(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  return await readFile(await download.path())
}

/**
 * One decoded frame of the exported WebM, `fromEndSeconds` before its end:
 * the colour at a point, and the count of whitish pixels inside a box, both
 * in frame fractions.
 */
async function sampleExport(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  point: { x: number; y: number },
  box: { left: number; top: number; right: number; bottom: number },
): Promise<{ rgb: number[]; whitish: number }> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, point, box }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve(video.duration)
              return
            }
            video.ondurationchange = () => {
              if (Number.isFinite(video.duration) && video.duration > 0) resolve(video.duration)
            }
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        // Firefox drops a seek issued before the first frame has loaded (#615).
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }))
        }
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = Math.max(0, duration - fromEndSeconds)
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')!
        context.drawImage(video, 0, 0)
        const at = context.getImageData(
          Math.round(point.x * canvas.width),
          Math.round(point.y * canvas.height),
          1,
          1,
        ).data
        const x0 = Math.round(box.left * canvas.width)
        const y0 = Math.round(box.top * canvas.height)
        const region = context.getImageData(
          x0,
          y0,
          Math.round(box.right * canvas.width) - x0,
          Math.round(box.bottom * canvas.height) - y0,
        ).data
        let whitish = 0
        for (let index = 0; index < region.length; index += 4) {
          if (region[index] > 180 && region[index + 1] > 180 && region[index + 2] > 180) whitish++
        }
        return { rgb: [at[0], at[1], at[2]], whitish }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, point, box },
  )
}

test('a placed lower third exports as it previews: the dark bar over the slate, with its white name on it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await setTitleTemplates(page, true)
  // A 5 s red slate, the template's own 5 s: mid-way, every fade is done.
  await addSlate(page, 5)
  const dialog = await openGallery(page)
  await dialog.getByRole('button', { name: 'Place' }).click()
  await expect(dialog).toHaveCount(0)

  // The bar spans x 0.028–0.328 and y 0.80–0.95 of a 16:9 frame (the
  // template's own layout: 5% margins, a bar 30% of the frame wide). The
  // name sits in its upper half, starting near its left edge.
  const exported = await exportOnce(page)
  expect(exported.byteLength).toBeGreaterThan(1000)
  const bar = { x: 0.3, y: 0.83 }
  const nameBox = { left: 0.03, top: 0.8, right: 0.27, bottom: 0.88 }
  const mid = await sampleExport(page, exported, 2.5, bar, nameBox)
  // #111827 at 85% over #ff0000: (53, 20, 33). Encoding moves colours a little.
  const expected = [53, 20, 33]
  mid.rgb.forEach((channel, index) => {
    expect(Math.abs(channel - expected[index]), `bar colour ${JSON.stringify(mid.rgb)}`).toBeLessThan(30)
  })
  expect(mid.whitish, 'white name pixels on the bar').toBeGreaterThan(200)

  // The preview draws the same: the bar, and the name inside it. Its box is
  // the text's line box, half a leading taller than the glyphs the export
  // count found, so it is held to the bar's upper part rather than to
  // `nameBox` exactly.
  const shapes = page.getByTestId('preview-shapes').first()
  await expect(shapes).toBeVisible()
  const name = page.locator('.preview-text').first()
  await expect(name).toHaveText('Alex Morgan')
  const frame = await page.getByTestId('preview-frame').boundingBox()
  const nameBounds = await name.evaluate((node) => {
    const r = document.createRange()
    r.selectNodeContents(node)
    const box = r.getBoundingClientRect()
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
  })
  if (frame === null) throw new Error('no preview frame')
  const fraction = {
    left: (nameBounds.left - frame.x) / frame.width,
    right: (nameBounds.right - frame.x) / frame.width,
    top: (nameBounds.top - frame.y) / frame.height,
    bottom: (nameBounds.bottom - frame.y) / frame.height,
  }
  const upperBar = { left: 0.03, top: 0.8, right: 0.27, bottom: 0.9 }
  const what = `preview name at ${JSON.stringify(fraction)} vs the bar's upper part ${JSON.stringify(upperBar)}`
  expect(fraction.left, what).toBeGreaterThanOrEqual(upperBar.left)
  expect(fraction.right, what).toBeLessThanOrEqual(upperBar.right)
  expect(fraction.top, what).toBeGreaterThanOrEqual(upperBar.top)
  expect(fraction.bottom, what).toBeLessThanOrEqual(upperBar.bottom)
})
