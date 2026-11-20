import { expect, test } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'

/** MEASUREMENT ONLY (#789) — not for merge. */
withFakeMedia(test)

test('M789b cued voice-over in this browser', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const blobs: Blob[] = []
    ;(window as unknown as { __blobs: Blob[] }).__blobs = blobs
    const Native = window.MediaRecorder
    class Wrapped extends Native {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        const chunks: Blob[] = []
        this.addEventListener('dataavailable', (e) => chunks.push((e as BlobEvent).data))
        this.addEventListener('stop', () => blobs.push(new Blob(chunks, { type: this.mimeType })))
      }
    }
    window.MediaRecorder = Wrapped as typeof MediaRecorder
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Record' }).click()
  await page.getByRole('menuitem', { name: 'Microphone' }).click()
  await expect(page.getByTestId('record-elapsed')).toHaveText(/0:03/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await page.waitForTimeout(2000)
  const result = await page.evaluate(async () => {
    const blob = (window as unknown as { __blobs: Blob[] }).__blobs[0]
    const mod = await import('/claude-agile-team-demo/src/lib/webmCues.ts' as string)
    const file = new File([blob], 'Voice-over 1.webm', { type: blob.type })
    const cued: Blob = await mod.withWebmCues(file)
    const t0 = performance.now()
    const at = () => Math.round(performance.now() - t0)
    const run = (name: string, source: Blob, act: (el: HTMLAudioElement) => void) =>
      new Promise((resolve) => {
        const events: string[] = []
        const el = document.createElement('audio')
        el.muted = true
        const r = (el2: HTMLMediaElement) => {
          const parts: string[] = []
          for (let i = 0; i < el2.seekable.length; i++) parts.push(`${el2.seekable.start(i)}-${el2.seekable.end(i)}`)
          return parts.join(',')
        }
        for (const type of ['loadedmetadata', 'durationchange', 'seeking', 'seeked', 'playing', 'ended', 'error']) {
          el.addEventListener(type, () => events.push(`${at()} ${type} d=${el.duration} t=${el.currentTime} seekable=${r(el)}`))
        }
        el.addEventListener('loadedmetadata', () => act(el), { once: true })
        el.src = URL.createObjectURL(source)
        setTimeout(() => {
          resolve({ name, events, final: `d=${el.duration} t=${el.currentTime} paused=${el.paused}` })
          el.pause()
        }, 6000)
      })
    return {
      sizes: [blob.size, cued.size, cued === file],
      runs: await Promise.all([
        run('cued: none', cued, () => {}),
        run('cued: far seek', cued, (el) => { el.currentTime = Number.MAX_SAFE_INTEGER }),
        run('cued: seek 1.0 then play', cued, (el) => { el.currentTime = 1; void el.play() }),
        run('cued: play from 0', cued, (el) => { void el.play() }),
        run('raw: seek 1.0 then play', file, (el) => { el.currentTime = 1; void el.play() }),
        run('raw: play from 0', file, (el) => { void el.play() }),
      ]),
    }
  })
  console.log(`M789b ${browserName} sizes ${JSON.stringify(result.sizes)}`)
  for (const run of result.runs) console.log(`M789b ${browserName} ${JSON.stringify(run)}`)
})
