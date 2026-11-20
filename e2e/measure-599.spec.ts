import { test } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'

/**
 * Measurement only (#599), not for merge. Logs what Firefox does where the
 * voice-over and screen specs fail: the recorder's container support, what
 * the page shows after Stop, console errors, and getDisplayMedia's outcome.
 */
withFakeMedia(test, ['--auto-select-tab-capture-source-by-title=Browser Video Editor'])

const log = (browserName: string, what: string, value: unknown) =>
  console.log(`[measure-599 ${browserName}] ${what}: ${JSON.stringify(value)}`)

test('measure: voice-over after Stop, and getDisplayMedia', async ({ page, browserName }) => {
  test.setTimeout(60_000)
  const consoleLines: string[] = []
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`))
  await page.goto('./')

  log(
    browserName,
    'isTypeSupported',
    await page.evaluate(() =>
      Object.fromEntries(
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'video/webm'].map(
          (t) => [t, MediaRecorder.isTypeSupported(t)],
        ),
      ),
    ),
  )

  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Microphone' }).click()
  await page.getByTestId('record-elapsed').waitFor({ timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  log(browserName, 'elapsed before stop', await page.getByTestId('record-elapsed').textContent().catch(() => null))
  await page.getByRole('button', { name: 'Stop recording' }).click().catch((e) => log(browserName, 'stop click', String(e)))
  for (const ms of [500, 2000, 6000]) {
    await page.waitForTimeout(ms)
    log(browserName, `after stop +${ms}ms dialogs`, await page.getByRole('dialog').allInnerTexts())
    log(browserName, `after stop +${ms}ms statuses`, await page.getByRole('status').allInnerTexts())
    log(browserName, `after stop +${ms}ms alerts`, await page.getByRole('alert').allInnerTexts())
    log(
      browserName,
      `after stop +${ms}ms library`,
      await page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem').allInnerTexts().catch(() => null),
    )
  }

  // The recorder on its own, outside the app: what an audio-only capture
  // of the fake microphone produces.
  log(
    browserName,
    'raw audio recorder',
    await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      const stopped = new Promise((resolve) => (recorder.onstop = resolve))
      recorder.start()
      await new Promise((r) => setTimeout(r, 1500))
      recorder.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: recorder.mimeType })
      const url = URL.createObjectURL(blob)
      const audio = document.createElement('audio')
      audio.src = url
      const meta = await new Promise<string>((resolve) => {
        audio.onloadedmetadata = () => resolve(`duration ${audio.duration}`)
        audio.onerror = () => resolve(`error ${audio.error?.code} ${audio.error?.message}`)
        setTimeout(() => resolve('no metadata in 5 s'), 5000)
      })
      return { mimeType: recorder.mimeType, bytes: blob.size, chunks: chunks.length, meta }
    }),
  )

  log(
    browserName,
    'getDisplayMedia',
    await page.evaluate(async () => {
      try {
        const stream = await Promise.race([
          navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer in 8 s')), 8000)),
        ])
        const tracks = stream.getTracks().map((t) => `${t.kind}:${t.label}`)
        stream.getTracks().forEach((t) => t.stop())
        return { ok: tracks }
      } catch (error) {
        return { error: `${(error as Error).name}: ${(error as Error).message}` }
      }
    }),
  )
  // The app's own path, from a real click (getDisplayMedia needs a gesture).
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Screen', exact: true }).click()
  for (const ms of [1000, 4000]) {
    await page.waitForTimeout(ms)
    log(browserName, `screen +${ms}ms dialogs`, await page.getByRole('dialog').allInnerTexts())
    log(browserName, `screen +${ms}ms statuses`, await page.getByRole('status').allInnerTexts())
    log(browserName, `screen +${ms}ms alerts`, await page.getByRole('alert').allInnerTexts())
  }
  log(browserName, 'console', consoleLines.slice(-30))
})
