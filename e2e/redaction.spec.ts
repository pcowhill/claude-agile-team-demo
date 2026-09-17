import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll, expectWithin } from './layout'
import { openPicture, appliedPictureGroups } from './pictureDisclosure'

type Page = import('@playwright/test').Page

/**
 * Redaction regions in the app (#492): the fields, the undo behaviour, what
 * the preview shows, and the two other surfaces that render through the
 * same shared rule — a saved frame and an Animated GIF.
 *
 * The fixture is a colour slate wherever a slate will do, because a slate's
 * pixels are exactly known: a red frame with a black region over part of it
 * is unambiguous in a decoded PNG or GIF, and needs no recording to settle.
 * The export's own decoded-frame evidence, on a real recording with a sharp
 * edge, lives in `export-redaction.spec.ts`.
 */

/**
 * A still image clip: a slate carries no redaction (it has nothing to
 * hide), so the image is what the fields are exercised on. Solid red, 240×160.
 */
async function importRedImage(page: Page): Promise<void> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 160
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(220, 20, 20)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    )
    const buffer = await blob.arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }])
  await page.getByRole('button', { name: 'Add red.png to timeline' }).click()
}

const IMAGE = 'red.png at position 1'

const field = (page: Page, position: string, index: number, label: string, unit: string) =>
  page.getByRole('spinbutton', {
    name: `Redaction region ${index} ${label} of ${position} ${unit}`,
    exact: true,
  })

test('add, edit and remove a region — each one undo step, and the summary says Redact (#492)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)

  // Nothing yet: the summary does not name Redact, and the placeholder says so.
  expect(await appliedPictureGroups(page, IMAGE)).not.toContain('Redact')
  await expect(page.getByText('Nothing hidden')).toBeVisible()

  // 1. Add.
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  const style = page.getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` })
  await expect(style).toBeVisible()
  // A new region is a Pixelate, per the issue's decision, and its window is
  // the element's own trim.
  await expect(style).toHaveValue('pixelate')
  await expect(field(page, IMAGE, 1, 'start', 'in seconds')).toHaveValue('0')
  await expect(field(page, IMAGE, 1, 'end', 'in seconds')).toHaveValue('5')
  expect(await appliedPictureGroups(page, IMAGE)).toContain('Redact')

  // 2. Edit: one field.
  const left = field(page, IMAGE, 1, 'left', '(percent)')
  await left.fill('10')
  await left.blur()
  await expect(left).toHaveValue('10')

  // 3. Remove.
  await page.getByRole('button', { name: `Remove redaction region 1 of ${IMAGE}` }).click()
  await expect(style).toHaveCount(0)
  expect(await appliedPictureGroups(page, IMAGE)).not.toContain('Redact')

  // Undo × 3 walks back through exactly those three commits.
  await page.keyboard.press('Control+z')
  await expect(style).toBeVisible()
  await expect(field(page, IMAGE, 1, 'left', '(percent)')).toHaveValue('10')

  await page.keyboard.press('Control+z')
  // The edit is undone, the region is still there — so the edit really was
  // its own step rather than riding on the add.
  await expect(field(page, IMAGE, 1, 'left', '(percent)')).toHaveValue('35')

  await page.keyboard.press('Control+z')
  await expect(style).toHaveCount(0)
  expect(await appliedPictureGroups(page, IMAGE)).not.toContain('Redact')
})

test('switching style swaps in that style’s own parameter and drops the others (#492)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  const style = page.getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` })

  // Pixelate to start: a block size, no strength, no colour.
  await expect(field(page, IMAGE, 1, 'block size', 'in pixels')).toBeVisible()
  await expect(field(page, IMAGE, 1, 'blur strength', 'in pixels')).toHaveCount(0)

  await style.selectOption('Blur')
  await expect(field(page, IMAGE, 1, 'blur strength', 'in pixels')).toBeVisible()
  await expect(field(page, IMAGE, 1, 'block size', 'in pixels')).toHaveCount(0)
  const strength = field(page, IMAGE, 1, 'blur strength', 'in pixels')
  await strength.fill('40')
  await strength.blur()

  await style.selectOption('Solid')
  await expect(page.getByLabel(`Redaction region 1 colour of ${IMAGE}`)).toHaveValue('#000000')
  await expect(field(page, IMAGE, 1, 'blur strength', 'in pixels')).toHaveCount(0)

  // Back to Blur: the 40 is gone, because a stale parameter must not
  // survive a trip through another style and reappear.
  await style.selectOption('Blur')
  await expect(field(page, IMAGE, 1, 'blur strength', 'in pixels')).toHaveValue('12')
})

test('the preview hides the region where the export does, and the fields fit their group (#492)', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  await page
    .getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` })
    .selectOption('Solid')
  // The left quarter-ish of the frame, for the whole clip.
  for (const [label, value] of [
    ['left', '10'],
    ['top', '20'],
    ['width', '30'],
    ['height', '40'],
  ] as const) {
    const input = field(page, IMAGE, 1, label, '(percent)')
    await input.fill(value)
    await input.blur()
  }

  // The canvas exists only while regions do, and it covers the layer card.
  const canvas = page.getByTestId('preview-redactions-still')
  await expect(canvas).toBeVisible()

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(viewport)
    const card = page.getByTestId('preview-image-card')
    // Geometry a browser can measure: the overlay fills its card, so the
    // region's own fractions land where the picture's do.
    const cardBox = (await card.boundingBox())!
    const canvasBox = (await canvas.boundingBox())!
    expect(
      Math.abs(canvasBox.width - cardBox.width),
      `redaction canvas spans its card at ${viewport.width}px`,
    ).toBeLessThan(2)
    expect(Math.abs(canvasBox.height - cardBox.height)).toBeLessThan(2)

    // The black region is really painted, at the fractions asked for: read
    // the canvas back and find the extent of its opaque pixels.
    const painted = await canvas.evaluate((element) => {
      const source = element as HTMLCanvasElement
      const context = source.getContext('2d')!
      const { width, height } = source
      const data = context.getImageData(0, 0, width, height).data
      let minX = width
      let maxX = -1
      let minY = height
      let maxY = -1
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3] > 200) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return { minX, maxX, minY, maxY, width, height }
    })
    expect(painted.maxX, 'the region is painted at all').toBeGreaterThan(0)
    // The picture is 240×160 in a card of the frame's aspect, so it fills
    // the card and the region's fractions are the canvas's own.
    expect(
      Math.abs(painted.minX / painted.width - 0.1),
      `region left at ${viewport.width}px`,
    ).toBeLessThan(0.02)
    expect(Math.abs((painted.maxX + 1) / painted.width - 0.4)).toBeLessThan(0.02)
    expect(Math.abs(painted.minY / painted.height - 0.2)).toBeLessThan(0.02)
    expect(Math.abs((painted.maxY + 1) / painted.height - 0.6)).toBeLessThan(0.02)

    // The fields stay inside the Picture group, nothing wraps mid-label,
    // and the page never scrolls sideways.
    const group = page.locator('.timeline-picture')
    await expectWithin(page.locator('.timeline-redaction'), group, {
      what: `redaction fields at ${viewport.width}px`,
      tolerance: 2,
    })
    for (const label of ['Area', 'Shows from', 'Style']) {
      const span = page.locator('.timeline-redaction span', { hasText: new RegExp(`^${label}$`) })
      const fits = await span.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      expect(fits, `"${label}" does not wrap at ${viewport.width}px`).toBe(true)
    }
    await expectNoHorizontalScroll(page, `with redaction fields at ${viewport.width}px`)
  }

  // A screenshot of each surface, inspected and described in the PR — jsdom
  // has no layout, so this is the half a component test cannot see.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page
    .locator('.timeline-redaction')
    .screenshot({ path: testInfo.outputPath('redaction-fields.png') })
  await page
    .getByTestId('preview-frame')
    .screenshot({ path: testInfo.outputPath('redaction-preview.png') })
})

test('a region survives the autosave and a reload (#492)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  await page
    .getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` })
    .selectOption('Solid')
  const left = field(page, IMAGE, 1, 'left', '(percent)')
  await left.fill('12')
  await left.blur()

  // The debounced snapshot lands — autosave writes through the same
  // serializer a project file does, so this is the file format's own
  // round-trip taken through the crash path.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open('bvep-autosave')
              request.onerror = () => resolve(false)
              request.onsuccess = () => {
                const db = request.result
                if (!db.objectStoreNames.contains('structure')) {
                  db.close()
                  resolve(false)
                  return
                }
                const store = db.transaction('structure', 'readonly').objectStore('structure')
                const count = store.count()
                count.onsuccess = () => {
                  db.close()
                  resolve(count.result > 0)
                }
                count.onerror = () => {
                  db.close()
                  resolve(false)
                }
              }
            }),
        ),
      { timeout: 20_000 },
    )
    .toBe(true)

  await page.reload()
  await page.getByRole('button', { name: 'Restore' }).click()

  await openPicture(page, IMAGE)
  await expect(
    page.getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` }),
  ).toHaveValue('solid')
  await expect(field(page, IMAGE, 1, 'left', '(percent)')).toHaveValue('12')
  await expect(page.getByTestId('preview-redactions-still')).toBeVisible()
})

test('a saved frame and an Animated GIF carry the region too (#492)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('./')
  // The GIF plugin, enabled first so both surfaces are reachable.
  await chooseFromFileMenu(page, 'Plugins…')
  await page.getByRole('button', { name: 'Enable GIF export' }).click()
  await expect(page.getByRole('button', { name: 'Disable GIF export' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Plugins' }).getByRole('button', { name: 'Close' }).click()

  await importRedImage(page)
  await openPicture(page, IMAGE)
  await page.getByRole('button', { name: `Add a redaction region on ${IMAGE}` }).click()
  await page
    .getByRole('combobox', { name: `Redaction region 1 style of ${IMAGE}` })
    .selectOption('Solid')
  await page.getByLabel(`Redaction region 1 colour of ${IMAGE}`).fill('#0000ff')
  // The whole frame, so neither surface needs a placement argument.
  for (const [label, value] of [
    ['left', '0'],
    ['top', '0'],
    ['width', '100'],
    ['height', '100'],
  ] as const) {
    const input = field(page, IMAGE, 1, label, '(percent)')
    await input.fill(value)
    await input.blur()
  }

  // Save frame: the PNG is blue, not the red image underneath it.
  const framePromise = page.waitForEvent('download')
  await chooseFromFrameMenu(page, 'preview-save-frame')
  const png = await readFile(await (await framePromise).path())
  const sampled = await page.evaluate(async (base64) => {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('saved frame failed to decode'))
      image.src = `data:image/png;base64,${base64}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const data = context.getImageData(
      Math.floor(canvas.width * 0.4),
      Math.floor(canvas.height * 0.4),
      Math.max(1, Math.floor(canvas.width * 0.2)),
      Math.max(1, Math.floor(canvas.height * 0.2)),
    ).data
    let r = 0
    let b = 0
    const pixels = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      r += data[index]
      b += data[index + 2]
    }
    return { r: r / pixels, b: b / pixels }
  }, png.toString('base64'))
  expect(sampled.b).toBeGreaterThan(150)
  expect(sampled.r).toBeLessThan(90)

  // Animated GIF: its global palette carries the region's blue and not the
  // image's red — the plugin renders through the same frame composer.
  const gifPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('radio', { name: 'Animated GIF' }).check()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const gif = await readFile(await (await gifPromise).path())
  expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  const packed = gif[10]
  expect(packed & 0x80, 'the GIF carries a global colour table').toBeGreaterThan(0)
  const colours = 2 ** ((packed & 0x07) + 1)
  let blue = 0
  let red = 0
  for (let index = 0; index < colours; index += 1) {
    const at = 13 + index * 3
    const [r, g, b] = [gif[at], gif[at + 1], gif[at + 2]]
    if (b > 150 && r < 90 && g < 90) blue += 1
    if (r > 150 && b < 90 && g < 90) red += 1
  }
  expect(blue, 'the redaction’s blue is in the GIF palette').toBeGreaterThan(0)
  expect(red, 'the hidden red is not').toBe(0)
})
