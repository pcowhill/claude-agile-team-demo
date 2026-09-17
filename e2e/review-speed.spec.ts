import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { scanExportedFrames } from './decodedFrame'
import type { SampleRect } from './decodedFrame'
import { chooseFromFileMenu } from './fileMenu'
import { chooseFromFrameMenu } from './frameMenu'
import { expectNoHorizontalScroll } from './layout'
import { sineWav } from './sineWav'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'
import { chooseEffect } from './timelineRowMenu'

type Page = import('@playwright/test').Page

/**
 * Review speed (#522, from the customer-approved suggestion #515) in real
 * Chromium: a preview-only rate for finding a moment in a long take.
 *
 * What only a browser can answer is here — that the *media* really plays at
 * the rate, that everything sharing the clock keeps up with it, and that
 * none of it reaches a file. The rate's own arithmetic (the four values, the
 * wrap, the formatting) is unit-tested in `src/lib/reviewSpeed.test.ts`, the
 * key mapping in `src/lib/transport.test.ts`, and the control's rendering in
 * `src/components/PreviewPlayer.test.tsx`.
 *
 * Four subsystems carry the rate and each is asserted below, because three
 * of them are not `playbackRate` assignments at all: the video elements, the
 * audio tracks and video overlays (which correct by *seeking*, so an
 * un-scaled element re-seeks every frame instead of drifting quietly), and
 * the wall clocks a still entry and a pause plateau advance on.
 */

const FULL: Record<string, SampleRect> = { full: { x: 0, y: 0, width: 1, height: 1 } }

const reviewSpeed = (page: Page) => page.getByRole('combobox', { name: 'Review speed' })
const seekSlider = (page: Page) => page.getByRole('slider', { name: 'Seek within sequence' })
const video = (page: Page) => page.getByTestId('preview-video')

/** Records a short animated WebM, the idiom every preview spec uses. */
async function recordWebm(page: Page, ms = 1500): Promise<Buffer> {
  const base64 = await page.evaluate(async (ms) => {
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
        if (performance.now() - start > ms) resolve()
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
  }, ms)
  return Buffer.from(base64, 'base64')
}

async function importClip(page: Page, name = 'clip.webm'): Promise<void> {
  const webm = await recordWebm(page)
  await page.getByTestId('clip-file-input').setInputFiles([{ name, mimeType: 'video/webm', buffer: webm }])
  await expect(page.getByRole('button', { name: `Add ${name} to timeline` })).toBeVisible()
  await page.getByRole('button', { name: `Add ${name} to timeline` }).click()
}

/** Picks a rate on the control and waits for the readout to agree. */
async function setReviewSpeed(page: Page, rate: string): Promise<void> {
  await reviewSpeed(page).selectOption(rate)
  await expect(reviewSpeed(page)).toHaveValue(rate)
  if (rate === '1') await expect(page.getByTestId('preview-review-rate')).toHaveCount(0)
  else await expect(page.getByTestId('preview-review-rate')).toHaveText(`· ${rate}×`)
}

test('the media plays at the review rate, multiplied by the clip’s own speed segment (#522)', async ({
  page,
}) => {
  await page.goto('./')
  await importClip(page)
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await out.fill('1')
  await out.blur()

  // A 2× speed segment over the whole entry: the product the guide states.
  await chooseEffect(page, 'clip.webm at position 1', 'Speed segment')
  const factor = page.getByRole('spinbutton', {
    name: 'Speed segment 1 factor of clip.webm at position 1',
  })
  await factor.fill('2')
  await factor.blur()

  // R is inert while a field has the keys — the guard every transport key
  // goes through (`targetClaimsKeys`), asserted here for this one because
  // the issue asks for it by name.
  await out.focus()
  await page.keyboard.press('r')
  await expect(reviewSpeed(page)).toHaveValue('1')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

  await page.getByRole('button', { name: 'Play preview' }).click()
  await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(2)

  // And live once nothing claims them: R steps 1× → 1.5× → 2×. The blur is
  // not incidental — the Play button that was just clicked holds focus, and
  // a focused button claims the keys exactly as the field above did.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('r')
  await expect(reviewSpeed(page)).toHaveValue('1.5')
  await page.keyboard.press('r')
  await expect(reviewSpeed(page)).toHaveValue('2')
  await expect(page.getByTestId('preview-review-rate')).toHaveText('· 2×')

  await setReviewSpeed(page, '2')
  await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(4)

  // And back down: the element returns to the timeline's own rate.
  await setReviewSpeed(page, '0.5')
  await expect.poll(() => video(page).evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(1)
})

test('R reaches the cheat sheet and the guide\'s generated table (#522)', async ({ page }) => {
  // Both render `shortcutsFor` (#477 s6), so one registration should reach
  // them both — this asserts the registration happened at all, rather than
  // the key being wired only into the handler.
  await page.goto('./')
  // The key handler belongs to the player, so wait for it to be on the page.
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
  await page.keyboard.press('?')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Step the review speed')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await page.goto('./#guide/keyboard-shortcuts')
  const guide = page.getByRole('complementary', { name: 'User guide' })
  await expect(guide).toBeVisible()
  await expect(guide).toContainText('Step the review speed')
})

test('the playhead keeps up with the picture at 2×, and so does an audio track (#522)', async ({
  page,
}) => {
  await page.goto('./')
  // A longer take than the other tests use: at 2× a 1.5 s clip is gone in
  // 0.75 s of wall time, and a measurement window that runs past the end
  // would average the rate with a stopped clock.
  const webm = await recordWebm(page, 4000)
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'clip.webm', mimeType: 'video/webm', buffer: webm }])
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page
    .getByTestId('clip-file-input')
    .setInputFiles([{ name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(5) }])
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  const track = page.getByTestId('preview-audio-0')

  await setReviewSpeed(page, '2')
  await page.getByRole('button', { name: 'Play preview' }).click()

  // The published position and the element's own clock agree — read inside
  // one poll so both come from the same render (`quality-and-ci.md`, #449).
  // One entry from 0 with no effects, so the two are the same number; the
  // tolerance is two frames of the 30 fps source plus the slider's own 0.01
  // step.
  await expect
    .poll(
      async () => {
        const sample = await page.evaluate(() => {
          const element = document.querySelector<HTMLVideoElement>('[data-testid="preview-video"]')!
          const slider = document.querySelector<HTMLInputElement>(
            '[aria-label="Seek within sequence"]',
          )!
          return { elementTime: element.currentTime, published: Number(slider.value) }
        })
        if (sample.elementTime < 0.3) return null
        return Math.abs(sample.published - sample.elementTime)
      },
      { message: 'the playhead and the element clock agree at 2×', timeout: 10_000 },
    )
    .toBeLessThan(0.08)

  // The audio track carries the rate rather than being dragged along by
  // re-seeks: its own clock advances at about twice wall time.
  expect(await track.evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(2)
  const before = await track.evaluate((el: HTMLAudioElement) => el.currentTime)
  const wallStart = Date.now()
  await page.waitForTimeout(600)
  const after = await track.evaluate((el: HTMLAudioElement) => el.currentTime)
  const wall = (Date.now() - wallStart) / 1000
  // The measurement is only meaningful while the sequence was playing the
  // whole time — a window that ran past the end would average in a stopped
  // clock, which is how this reads 1× for the wrong reason.
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeVisible()
  // Generous either side: this is a real-time measurement under whatever
  // load the suite is carrying (#365). At 1× — the bug this catches — the
  // ratio would be 1, less than half of the lower bound.
  expect((after - before) / wall).toBeGreaterThan(1.4)
  expect((after - before) / wall).toBeLessThan(2.6)
})

test('a still’s wall clock takes the review rate too (#522)', async ({ page }) => {
  // The clock a still advances on is `performance.now()`, not a media
  // element, so nothing about `playbackRate` reaches it: unscaled, a slate
  // would hold for the same wall seconds while the video either side of it
  // played twice as fast, and the playhead would jump at every boundary.
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  await expect(page.getByTestId('timeline-total')).toHaveText('0:05')

  await setReviewSpeed(page, '2')
  await page.getByRole('button', { name: 'Play preview' }).click()
  const wallStart = Date.now()
  await expect.poll(async () => Number(await seekSlider(page).inputValue())).toBeGreaterThan(1.2)
  const wall = (Date.now() - wallStart) / 1000
  const published = Number(await seekSlider(page).inputValue())
  // The slate's own seconds advanced faster than wall time did — at 1× the
  // ratio is 1, and 1.2 s of slate would take at least 1.2 s of wall.
  expect(published / wall).toBeGreaterThan(1.4)
})

test('the review rate reaches the incoming element of a transition (#522)', async ({ page }) => {
  await page.goto('./')
  await importClip(page)
  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  for (const position of [1, 2]) {
    const out = page.getByRole('spinbutton', {
      name: `Trim out point of clip.webm at position ${position} in seconds`,
    })
    await out.fill('1')
    await out.blur()
  }
  await page.getByRole('button', { name: 'Add transition between position 1 and 2' }).click()

  await setReviewSpeed(page, '2')
  // Loop, so the overlap comes round again: at 2× it is on screen for well
  // under a second of wall time, and a sample that misses it under suite
  // load would otherwise have no second chance (#365).
  await page.getByTestId('preview-loop').click()
  await page.getByRole('button', { name: 'Play preview' }).click()

  // Inside the overlap both elements are on screen; neither may be left at
  // 1×, which is what a rate applied only to the primary would do. Both
  // rates are read inside one poll, so they come from the same render and
  // the poll retries across passes rather than reading once and hoping
  // (`quality-and-ci.md`, #449).
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const primary = document.querySelector<HTMLVideoElement>('[data-testid="preview-video"]')
          const incoming = document.querySelector<HTMLVideoElement>(
            '[data-testid="preview-video-incoming"]',
          )
          if (primary === null || incoming === null) return null
          return { primary: primary.playbackRate, incoming: incoming.playbackRate }
        }),
      { message: 'both sides of the overlap run at the review rate', timeout: 20_000 },
    )
    .toEqual({ primary: 2, incoming: 2 })
})

test('nothing reaches a file, and a reload is back at 1× (#522)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')
  await importClip(page)
  const out = page.getByRole('spinbutton', {
    name: 'Trim out point of clip.webm at position 1 in seconds',
  })
  await out.fill('1')
  await out.blur()

  /** Exports the whole project and returns the file. */
  const exportProject = async (): Promise<Buffer> => {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Project…' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    return await readFile((await (await downloading).path())!)
  }
  /** Saves the project, references-only, and returns the file. */
  const saveProject = async (): Promise<Buffer> => {
    const downloading = page.waitForEvent('download')
    await chooseFromFileMenu(page, 'Save As…')
    const dialog = page.getByRole('dialog', { name: 'Save project' })
    await dialog.getByRole('radio', { name: 'Store references only', exact: true }).check()
    await dialog.getByRole('button', { name: 'Save…', exact: true }).click()
    return await readFile((await (await downloading).path())!)
  }
  /** Saves the playhead's frame as a PNG and returns the file. */
  const saveFrame = async (): Promise<Buffer> => {
    const downloading = page.waitForEvent('download')
    await chooseFromFrameMenu(page, 'preview-save-frame')
    return await readFile((await (await downloading).path())!)
  }

  const atOne = { exported: await exportProject(), project: await saveProject(), frame: await saveFrame() }

  await setReviewSpeed(page, '2')
  const atTwo = { exported: await exportProject(), project: await saveProject(), frame: await saveFrame() }

  // The project and the frame are byte-for-byte what they were: the rate is
  // in neither the file format nor the composer.
  expect(atTwo.project.equals(atOne.project), 'the project file changed at 2×').toBe(true)
  expect(atTwo.frame.equals(atOne.frame), 'the saved frame changed at 2×').toBe(true)

  // The export is a real-time recording, so its bytes differ run to run;
  // its *duration* is the thing the rate would have halved.
  const [one, two] = [
    await scanExportedFrames(page, atOne.exported, FULL),
    await scanExportedFrames(page, atTwo.exported, FULL),
  ]
  expect(one.duration).toBeGreaterThan(0.5)
  expect(
    Math.abs(two.duration - one.duration),
    `exported ${two.duration}s at 2× against ${one.duration}s at 1×`,
  ).toBeLessThan(0.3)

  // Session-only: a reload is back at 1×, with no readout. The timeline
  // does not survive a reload either, so a slate brings the transport back
  // — the rate is what is being read, not what the project remembered.
  await page.reload()
  await chooseFromAddMenu(page, ADD_SLATE)
  await expect(reviewSpeed(page)).toHaveValue('1')
  await expect(page.getByTestId('preview-review-rate')).toHaveCount(0)
})

test('the control fits the transport at both widths, at 1× and at 2× (#522)', async ({ page }) => {
  await page.goto('./')
  await importClip(page)

  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 })
    for (const rate of ['1', '2']) {
      await setReviewSpeed(page, rate)
      const where = `${width}px at ${rate}×`

      // The control's own text is not wrapped or clipped.
      const fit = await reviewSpeed(page).evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }))
      expect(fit.scrollWidth, `Review speed overflows its box (${where})`).toBeLessThanOrEqual(
        fit.clientWidth,
      )

      // It sits on the row rather than stepping out of it: a `select` left
      // to the browser's own metrics is ~3px taller than the buttons beside
      // it, which reads as a kink in a row #395 was already raised about.
      const loopBox = (await page.getByTestId('preview-loop').boundingBox())!
      const controlBox = (await reviewSpeed(page).boundingBox())!
      expect(
        Math.abs(controlBox.height - loopBox.height),
        `Review speed is ${controlBox.height}px tall against the Loop toggle's ${loopBox.height}px (${where})`,
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          controlBox.y + controlBox.height / 2 - (loopBox.y + loopBox.height / 2),
        ),
        `Review speed's centre line is off the transport's (${where})`,
      ).toBeLessThanOrEqual(1)

      // It sits inside the preview region with the rest of the transport,
      // and the readout — which is what makes the row longer at 2× — does
      // not push anything out of it.
      const region = (await page.getByRole('region', { name: 'Preview' }).boundingBox())!
      for (const [what, locator] of [
        ['the Review speed control', reviewSpeed(page)],
        ['the Loop toggle', page.getByTestId('preview-loop')],
        ['the position readout', page.getByTestId('preview-position')],
      ] as const) {
        const box = (await locator.boundingBox())!
        expect(box.x, `${what} starts outside the preview (${where})`).toBeGreaterThanOrEqual(
          region.x - 1,
        )
        expect(
          box.x + box.width,
          `${what} ends outside the preview (${where})`,
        ).toBeLessThanOrEqual(region.x + region.width + 1)
      }
      await expectNoHorizontalScroll(page, where)
    }
  }
})
