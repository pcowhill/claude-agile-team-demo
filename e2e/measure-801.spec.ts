import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'

/**
 * MEASUREMENT ONLY (#801) — not for merge. A voice-over paused and resumed
 * decodes to about half its recorded length in CI's Firefox. This logs, for
 * a paused take, what the raw recorder blob holds and what the imported
 * clip's bytes hold (after #789's Cues rewrite), as EBML listings, plus what
 * decodeAudioData and an <audio> element report for each. Output lines are
 * prefixed `M801`.
 */
withFakeMedia(test)

declare global {
  interface Window {
    __m801: { recorder: unknown[]; blobs: Blob[]; t0: number }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const t0 = performance.now()
    const log = { recorder: [] as unknown[], blobs: [] as Blob[], t0 }
    window.__m801 = log
    const now = () => Math.round(performance.now() - t0)
    const Native = window.MediaRecorder
    class Wrapped extends Native {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        const tracks = stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, settings: t.getSettings() }))
        log.recorder.push({ t: now(), type: 'new', options, mimeType: this.mimeType, tracks })
        const chunks: Blob[] = []
        this.addEventListener('dataavailable', (e) => {
          chunks.push((e as BlobEvent).data)
          log.recorder.push({ t: now(), type: 'data', size: (e as BlobEvent).data.size, state: this.state })
        })
        for (const type of ['start', 'pause', 'resume', 'error']) {
          this.addEventListener(type, () => log.recorder.push({ t: now(), type, state: this.state }))
        }
        this.addEventListener('stop', () => {
          log.recorder.push({ t: now(), type: 'stop' })
          log.blobs.push(new Blob(chunks, { type: this.mimeType }))
        })
      }
      pause() {
        log.recorder.push({ t: now(), type: 'CALL pause', state: this.state })
        super.pause()
      }
      resume() {
        log.recorder.push({ t: now(), type: 'CALL resume', state: this.state })
        super.resume()
      }
    }
    window.MediaRecorder = Wrapped as typeof MediaRecorder
  })
})

/**
 * EBML walk: Info, Tracks, Cues count, and for each cluster its timecode,
 * block count, first and last absolute block time, and every step between
 * consecutive blocks (absolute) that is not the usual frame step.
 */
function describeWebm(bytes: Buffer): string[] {
  const out: string[] = []
  const vint = (pos: number, keepMarker: boolean) => {
    const first = bytes[pos]
    let len = 1
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
    let value = keepMarker ? first : first & (0xff >> len)
    let allOnes = (first & (0xff >> len)) === 0xff >> len
    for (let i = 1; i < len; i++) {
      value = value * 256 + bytes[pos + i]
      if (bytes[pos + i] !== 0xff) allOnes = false
    }
    return { value, len, unknown: !keepMarker && allOnes }
  }
  const header = (pos: number) => {
    const id = vint(pos, true)
    const size = vint(pos + id.len, false)
    return { id: id.value, data: pos + id.len + size.len, size: size.unknown ? -1 : size.value }
  }
  const uint = (s: number, n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) v = v * 256 + bytes[s + i]
    return v
  }
  const float = (s: number, n: number) => (n === 4 ? bytes.readFloatBE(s) : bytes.readDoubleBE(s))
  const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1043a770, 0x1254c367])
  const seg = header(header(0).data + header(0).size)
  out.push(`file ${bytes.length} bytes; segment size ${seg.size}`)
  let pos = seg.data
  const clusters: string[] = []
  const all: number[] = []
  while (pos < bytes.length) {
    const h = header(pos)
    let end = h.size < 0 ? bytes.length : h.data + h.size
    if (h.id === 0x1549a966) {
      for (let p = h.data; p < end; ) {
        const c = header(p)
        if (c.id === 0x2ad7b1) out.push(`Info TimecodeScale ${uint(c.data, c.size)}`)
        if (c.id === 0x4489) out.push(`Info Duration ${float(c.data, c.size)}`)
        if (c.id === 0x4d80) out.push(`Info MuxingApp ${bytes.subarray(c.data, c.data + c.size).toString()}`)
        if (c.id === 0x5741) out.push(`Info WritingApp ${bytes.subarray(c.data, c.data + c.size).toString()}`)
        p = c.data + c.size
      }
    } else if (h.id === 0x1654ae6b) {
      out.push(`Tracks: ${bytes.subarray(h.data, end).toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 240)}`)
    } else if (h.id === 0x1c53bb6b) {
      let points = 0
      for (let p = h.data; p < end; ) {
        const c = header(p)
        if (c.id === 0xbb) points++
        p = c.data + c.size
      }
      out.push(`Cues ${points} points`)
    } else if (h.id === 0x1f43b675) {
      let tc = -1
      const rel: number[] = []
      let groups = 0
      let p = h.data
      while (p < bytes.length) {
        const c = header(p)
        if (h.size < 0 && LEVEL1.has(c.id)) {
          end = p
          break
        }
        if (c.id === 0xe7) tc = uint(c.data, c.size)
        if (c.id === 0xa3) {
          const track = vint(c.data, false)
          rel.push(bytes.readInt16BE(c.data + track.len))
        }
        if (c.id === 0xa0) {
          groups++
          for (let q = c.data; q < c.data + c.size; ) {
            const g = header(q)
            if (g.id === 0xa1) {
              const track = vint(g.data, false)
              rel.push(bytes.readInt16BE(g.data + track.len))
            }
            q = g.data + g.size
          }
        }
        p = c.data + c.size
        if (h.size >= 0 && p >= end) break
      }
      if (h.size < 0) end = p
      for (const r of rel) all.push(tc + r)
      clusters.push(
        `tc=${tc} blocks=${rel.length}${groups ? ` (groups ${groups})` : ''} abs=[${tc + rel[0]}..${tc + rel[rel.length - 1]}]${h.size < 0 ? ' unknown-size' : ''}`,
      )
    } else {
      out.push(`level1 0x${h.id.toString(16)} size ${h.size}`)
    }
    if (end <= pos) break
    pos = end
  }
  out.push(`clusters (${clusters.length}): ${clusters.join(' | ')}`)
  const steps = new Map<number, number>()
  const odd: string[] = []
  for (let i = 1; i < all.length; i++) {
    const d = all[i] - all[i - 1]
    steps.set(d, (steps.get(d) ?? 0) + 1)
  }
  const usual = [...steps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  for (let i = 1; i < all.length; i++) {
    const d = all[i] - all[i - 1]
    if (d !== usual) odd.push(`#${i}: ${all[i - 1]}→${all[i]} (${d})`)
  }
  out.push(`blocks ${all.length}, first ${all[0]}, last ${all[all.length - 1]}, usual step ${usual}`)
  out.push(`steps ${JSON.stringify([...steps.entries()])}`)
  out.push(`unusual steps (${odd.length}): ${odd.slice(0, 40).join(' ; ')}`)
  return out
}

/** decodeAudioData (at 44.1 and 48 kHz) and an <audio> element's durations, for a blob URL. */
async function probes(page: Page, url: string) {
  return page.evaluate(async (src) => {
    const bytes = await (await fetch(src)).arrayBuffer()
    const decode = async (rate: number) => {
      try {
        const buffer = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.slice(0))
        // Where the decoded sound is silent vs. not: the fraction of 10 ms
        // windows with any sample above 1e-4, and the first/last such window.
        const data = buffer.getChannelData(0)
        const win = Math.round(rate / 100)
        let loud = 0
        let first = -1
        let last = -1
        const windows = Math.floor(data.length / win)
        for (let w = 0; w < windows; w++) {
          let any = false
          for (let k = w * win; k < (w + 1) * win; k++) {
            if (Math.abs(data[k]) > 1e-4) {
              any = true
              break
            }
          }
          if (any) {
            loud++
            if (first < 0) first = w
            last = w
          }
        }
        return { rate, duration: buffer.duration, loudWindows: loud, windows, firstLoud: first / 100, lastLoud: last / 100 }
      } catch (e) {
        return { rate, error: String(e) }
      }
    }
    const element = await new Promise<unknown>((resolve) => {
      const el = document.createElement('audio')
      el.muted = true
      el.preload = 'metadata'
      const events: string[] = []
      for (const type of ['loadedmetadata', 'durationchange', 'seeked', 'error']) {
        el.addEventListener(type, () =>
          events.push(`${type} d=${el.duration} t=${el.currentTime} seekable=${el.seekable.length ? el.seekable.end(0) : '-'}`),
        )
      }
      el.addEventListener('loadedmetadata', () => (el.currentTime = Number.MAX_SAFE_INTEGER), { once: true })
      el.src = src
      setTimeout(() => {
        resolve({ events, duration: el.duration })
        el.removeAttribute('src')
        el.load()
      }, 6_000)
    })
    return { decode44: await decode(44100), decode48: await decode(48000), element }
  }, url)
}

async function bytesOf(page: Page, url: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (src) => {
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, url)
  return Buffer.from(b64, 'base64')
}

async function report(page: Page, label: string, importedUrl: string | null) {
  const recorder = await page.evaluate(() => window.__m801.recorder)
  console.log(`M801 ${label} recorder ${JSON.stringify(recorder)}`)
  const rawUrl = await page.evaluate(() => {
    const blobs = window.__m801.blobs
    return URL.createObjectURL(blobs[blobs.length - 1])
  })
  const sources: [string, string][] = [['raw', rawUrl]]
  if (importedUrl !== null) sources.push(['imported', importedUrl])
  for (const [which, url] of sources) {
    const bytes = await bytesOf(page, url)
    try {
      for (const line of describeWebm(bytes)) console.log(`M801 ${label} ${which} webm ${line}`)
    } catch (e) {
      console.log(`M801 ${label} ${which} webm parse failed ${String(e)}`)
    }
    console.log(`M801 ${label} ${which} probes ${JSON.stringify(await probes(page, url))}`)
  }
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const elapsed = (page: Page) => page.getByTestId('record-elapsed')

async function importedUrl(page: Page): Promise<string> {
  const library = page.getByRole('list', { name: 'Imported clips' })
  await expect(library.getByRole('listitem')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('button', { name: 'Preview Voice-over 1.webm' }).click()
  const media = page.locator('[data-testid="source-video"], [data-testid="source-audio"]').first()
  await expect(media).toBeAttached()
  return (await media.getAttribute('src'))!
}

async function startVoiceOver(page: Page) {
  await page.goto('./')
  await button(page, 'Record').click()
  await page.getByRole('menuitem', { name: 'Microphone' }).click()
  await expect(page.getByRole('dialog', { name: 'Recording voice-over' })).toBeVisible()
  await button(page, 'Start now').click()
}

for (let run = 1; run <= 3; run++) {
  test(`M801 app: the spec's sequence, run ${run}`, async ({ page, browserName }) => {
    test.setTimeout(120_000)
    await startVoiceOver(page)
    const dialog = page.getByRole('dialog', { name: 'Recording voice-over' })
    await expect(elapsed(page)).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
    await button(page, 'Pause recording').click()
    await expect(dialog.getByTestId('record-phase')).toContainText('Paused')
    await page.waitForTimeout(1_200)
    await button(page, 'Stop recording').focus()
    await page.keyboard.press('Space')
    await expect(dialog.getByTestId('record-phase')).toContainText('Recording')
    await page.keyboard.press('Space')
    await expect(dialog.getByTestId('record-phase')).toContainText('Paused')
    await button(page, 'Resume recording').click()
    await expect(elapsed(page)).toHaveText(/0:0[2-9]/, { timeout: 15_000 })
    await button(page, 'Stop recording').click()
    await report(page, `${browserName} spec-seq ${run}`, await importedUrl(page))
  })
}

test('M801 app: one pause, one resume', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await startVoiceOver(page)
  const dialog = page.getByRole('dialog', { name: 'Recording voice-over' })
  await expect(elapsed(page)).toHaveText(/0:0[1-9]/, { timeout: 15_000 })
  await button(page, 'Pause recording').click()
  await expect(dialog.getByTestId('record-phase')).toContainText('Paused')
  await page.waitForTimeout(1_200)
  await button(page, 'Resume recording').click()
  await expect(elapsed(page)).toHaveText(/0:0[2-9]/, { timeout: 15_000 })
  await button(page, 'Stop recording').click()
  await report(page, `${browserName} single`, await importedUrl(page))
})

test('M801 app: no pause, to 0:02 (control)', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  await startVoiceOver(page)
  await expect(elapsed(page)).toHaveText(/0:0[2-9]/, { timeout: 15_000 })
  await button(page, 'Stop recording').click()
  await report(page, `${browserName} control`, await importedUrl(page))
})

for (const timeslice of [null, 250]) {
  test(`M801 bare MediaRecorder, pause 1.2 s, timeslice ${timeslice}`, async ({ page, browserName }) => {
    test.setTimeout(60_000)
    await page.goto('./')
    await page.evaluate(async (slice) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {})
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const stopped = new Promise((r) => recorder.addEventListener('stop', r, { once: true }))
      if (slice === null) recorder.start()
      else recorder.start(slice)
      await wait(1_000)
      recorder.pause()
      await wait(1_200)
      recorder.resume()
      await wait(1_000)
      recorder.stop()
      await stopped
      for (const t of stream.getTracks()) t.stop()
    }, timeslice)
    await report(page, `${browserName} bare slice=${timeslice}`, null)
  })
}
