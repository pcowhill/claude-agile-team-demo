import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sineWav } from './sineWav'

/**
 * The audio track's gain row, measured (#441). Its styling rule was written
 * for the row's number fields but selected every `input` in the row, so the
 * "Duck others" checkbox (#241) was given a 4.5 rem box for a 13 px control
 * and its own label sat some 60 px away from it. jsdom has no layout, so
 * only a real browser can say what any of these controls is actually the
 * size of — which is why the fix is pinned here and not in a component test.
 *
 * The row also holds the number fields and the range sliders #426 added, and
 * scoping a selector is exactly the kind of change that fixes one control by
 * quietly resizing its neighbours. So this measures **every** control in the
 * row, not only the one that was wrong.
 */

/** Records a real WebM in-browser, as audio-gain.spec.ts and preview.spec.ts do. */
async function recordWebm(page: Page): Promise<Buffer> {
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
        ctx.fillStyle = `hsl(${((performance.now() - start) / 5) % 360}, 70%, 50%)`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (performance.now() - start > 1200) resolve()
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

const track = 'audio track tone.wav at position 1'
const entry = 'clip.webm at position 1'

test('the gain row sizes every control it holds: the Duck checkbox intrinsic, the rest untouched (#441)', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(4) },
  ])
  await expect(
    page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem'),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()

  const duck = page.getByRole('checkbox', { name: `Duck other audio while ${track} plays` })
  const mute = page.getByRole('checkbox', { name: `Mute ${entry}` })
  await expect(duck).toBeVisible()
  await expect(mute).toBeVisible()

  // The defect: a 13 px control in a 72 px box. It is now its intrinsic size,
  // and the sequence entry's own Mute checkbox — which was never caught by
  // the unscoped rule, and is what made this one look wrong beside it — is
  // the reference for what intrinsic means in this app.
  const duckBox = (await duck.boundingBox())!
  const muteBox = (await mute.boundingBox())!
  expect(duckBox.width, `the Duck checkbox is ${duckBox.width}px wide`).toBeLessThan(30)
  expect(
    Math.abs(duckBox.width - muteBox.width),
    `Duck ${duckBox.width}px vs Mute ${muteBox.width}px`,
  ).toBeLessThanOrEqual(2)
  expect(Math.abs(duckBox.height - muteBox.height)).toBeLessThanOrEqual(2)
  // Nor is it merely narrow: the number field's dark fill is gone too, so it
  // paints as a checkbox rather than as an empty text box. (Border width is
  // deliberately not asserted — measured, it reads the same either way in
  // Chromium, so it would prove nothing here.)
  expect(await duck.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    await mute.evaluate((node) => getComputedStyle(node).backgroundColor),
  )

  // The label needs no assertion of its own, and this is worth saying rather
  // than leaving a reader to wonder why the issue's "its label adrift" half
  // is unchecked. `.timeline-mute` is a flex box with a 0.3 rem gap, so the
  // text always sits 0.3 rem from the checkbox's *border box* — what drifted
  // was the painted glyph inside a 72 px box, which no bounding rect can
  // see. A check on the text's own left edge passes with the defect present,
  // measured: it would be a test that manufactures confidence rather than
  // evidence. The width above is the whole of it, because once the box is
  // intrinsic the box *is* the glyph.

  // Everything below guards the issue's "no other control changes
  // appearance" criterion rather than proving the fix: scoping a selector is
  // exactly the kind of change that repairs one control by quietly resizing
  // its neighbours. The number fields keep the 4.5 rem bordered box the rule
  // was written for…
  const volume = page.getByRole('spinbutton', { name: `Volume of ${track} (0 to 1)` })
  const volumeBox = (await volume.boundingBox())!
  expect(volumeBox.width).toBeGreaterThan(64)
  expect(volumeBox.width).toBeLessThan(80)
  expect(await volume.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px')

  // …and the sliders #426 added keep theirs, which is the assertion that
  // matters most here: they were reachable by the rule being scoped only
  // through a workaround that out-specified it, so a careless fix could have
  // handed them the number field's box.
  const slider = page.getByRole('slider', { name: `Volume of ${track} (0 to 1) slider` })
  const sliderBox = (await slider.boundingBox())!
  expect(sliderBox.width).toBeGreaterThan(60)
  expect(sliderBox.width).toBeLessThan(100)
  expect(await slider.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px')

  // Every control in the row lies inside it, so nothing was pushed out by
  // the resize.
  const row = page.locator('.audio-track-gain').first()
  const rowBox = (await row.boundingBox())!
  for (const [name, box] of [
    ['the Duck checkbox', duckBox],
    ['the volume field', volumeBox],
    ['the volume slider', sliderBox],
  ] as const) {
    expect(box.x, `${name} starts left of its row`).toBeGreaterThanOrEqual(rowBox.x - 1)
    expect(box.x + box.width, `${name} runs past its row`).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 1,
    )
  }


  await row.scrollIntoViewIfNeeded()
  await row.screenshot({ path: testInfo.outputPath('audio-track-gain-row.png') })
})
