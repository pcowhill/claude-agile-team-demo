import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { withFakeMedia } from './fakeMedia'

/**
 * MEASUREMENT ONLY (#789, #788) — not for merge. Logs, for a fake-device
 * recording made through the app, what the import probe's media element
 * fires and what the recorded file holds, then probes the same bytes in
 * several ways. Output is console.log lines prefixed `M789`.
 */
withFakeMedia(test)

declare global {
  interface Window {
    __m789: { media: unknown[]; recorder: unknown[]; blobs: Blob[]; t0: number }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const t0 = performance.now()
    const log = { media: [] as unknown[], recorder: [] as unknown[], blobs: [] as Blob[], t0 }
    window.__m789 = log
    const now = () => Math.round(performance.now() - t0)
    const ranges = (r: TimeRanges) => {
      const out: string[] = []
      for (let i = 0; i < r.length; i++) out.push(`${r.start(i)}-${r.end(i)}`)
      return out.join(',')
    }
    const EVENTS = [
      'loadstart', 'loadedmetadata', 'loadeddata', 'durationchange', 'seeking', 'seeked',
      'timeupdate', 'canplay', 'canplaythrough', 'ended', 'error', 'suspend', 'stalled',
      'emptied', 'abort', 'waiting', 'progress',
    ]
    let nextId = 0
    const watch = (el: HTMLMediaElement, tag: string) => {
      const id = `${tag}#${nextId++}`
      for (const type of EVENTS) {
        el.addEventListener(type, () => {
          log.media.push({
            id, t: now(), type, src: el.currentSrc.slice(-12),
            duration: el.duration, currentTime: el.currentTime, readyState: el.readyState,
            networkState: el.networkState, seekable: ranges(el.seekable), buffered: ranges(el.buffered),
            error: el.error?.code, msg: el.error?.message,
          })
        })
      }
    }
    const create = Document.prototype.createElement
    Document.prototype.createElement = function (this: Document, name: string, options?: ElementCreationOptions) {
      const el = create.call(this, name, options)
      if (el instanceof HTMLMediaElement) watch(el, name)
      return el
    } as typeof Document.prototype.createElement
    const ct = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return ct.get!.call(this) },
      set(v: number) {
        log.media.push({ t: now(), type: 'SET currentTime', value: v, duration: (this as HTMLMediaElement).duration })
        ct.set!.call(this, v)
      },
    })
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
        this.addEventListener('start', () => log.recorder.push({ t: now(), type: 'start', mimeType: this.mimeType }))
        this.addEventListener('stop', () => {
          log.recorder.push({ t: now(), type: 'stop' })
          log.blobs.push(new Blob(chunks, { type: this.mimeType }))
        })
      }
    }
    window.MediaRecorder = Wrapped as typeof MediaRecorder
  })
})

/** EBML walk of the recorded file: Info, Tracks, and each cluster's timecodes. */
function describeWebm(bytes: Buffer): string[] {
  const out: string[] = []
  const vint = (pos: number, keepMarker: boolean) => {
    const first = bytes[pos]
    let len = 1
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
    let value = keepMarker ? first : first & (0xff >> len)
    let allOnes = (first & (0xff >> len)) === (0xff >> len)
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
  const uint = (s: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[s + i]; return v }
  const float = (s: number, n: number) => (n === 4 ? bytes.readFloatBE(s) : bytes.readDoubleBE(s))
  const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1043a770, 0x1254c367])
  const seg = header(header(0).data + header(0).size)
  out.push(`file ${bytes.length} bytes; segment size ${seg.size}`)
  let pos = seg.data
  const clusters: string[] = []
  while (pos < bytes.length) {
    const h = header(pos)
    let end = h.size < 0 ? bytes.length : h.data + h.size
    if (h.id === 0x1549a966) {
      for (let p = h.data; p < end;) {
        const c = header(p)
        if (c.id === 0x2ad7b1) out.push(`Info TimecodeScale ${uint(c.data, c.size)}`)
        if (c.id === 0x4489) out.push(`Info Duration ${float(c.data, c.size)}`)
        if (c.id === 0x4d80) out.push(`Info MuxingApp ${bytes.subarray(c.data, c.data + c.size).toString()}`)
        p = c.data + c.size
      }
    } else if (h.id === 0x1654ae6b) {
      out.push(`Tracks: ${bytes.subarray(h.data, end).toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 200)}`)
    } else if (h.id === 0x1f43b675) {
      let tc = -1
      const blocks: number[] = []
      let p = h.data
      while (p < bytes.length) {
        const c = header(p)
        if (h.size < 0 && LEVEL1.has(c.id)) { end = p; break }
        if (c.id === 0xe7) tc = uint(c.data, c.size)
        if (c.id === 0xa3) {
          const track = vint(c.data, false)
          blocks.push(bytes.readInt16BE(c.data + track.len))
        }
        p = c.data + c.size
        if (h.size >= 0 && p >= end) break
      }
      if (h.size < 0) end = p
      clusters.push(`tc=${tc} blocks=${blocks.length} rel=[${blocks[0]}..${blocks[blocks.length - 1]}]${h.size < 0 ? ' unknown-size' : ''}`)
    } else {
      out.push(`level1 0x${h.id.toString(16)} size ${h.size}`)
    }
    if (end <= pos) break
    pos = end
  }
  out.push(`clusters (${clusters.length}): ${clusters.join(' | ')}`)
  return out
}

/** Probes the last recorded blob several ways in the page, at once. */
async function experiments(page: Page) {
  return page.evaluate(async () => {
    const log = window.__m789
    const blob = log.blobs[log.blobs.length - 1]
    const isAudio = blob.type.startsWith('audio')
    const t0 = performance.now()
    const at = () => Math.round(performance.now() - t0)
    const run = (name: string, tag: 'audio' | 'video', seekTo: number | null, preload: string) =>
      new Promise<unknown>((resolve) => {
        const events: string[] = []
        const el = document.createElement(tag)
        el.muted = true
        el.preload = preload
        const url = URL.createObjectURL(blob)
        for (const type of ['loadedmetadata', 'durationchange', 'seeked', 'ended', 'error', 'canplaythrough']) {
          el.addEventListener(type, () => events.push(`${at()} ${type} d=${el.duration} t=${el.currentTime} seekable=${el.seekable.length ? el.seekable.end(0) : '-'} buffered=${el.buffered.length ? el.buffered.end(el.buffered.length - 1) : '-'}`))
        }
        el.addEventListener('loadedmetadata', () => { if (seekTo !== null) el.currentTime = seekTo }, { once: true })
        el.src = url
        setTimeout(() => {
          resolve({ name, events, final: { duration: el.duration, currentTime: el.currentTime } })
          el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url)
        }, 10_000)
      })
    const decode = async () => {
      try {
        const ctx = new OfflineAudioContext(1, 1, 48000)
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
        return { name: 'decodeAudioData', duration: buffer.duration, ms: at() }
      } catch (e) { return { name: 'decodeAudioData', error: String(e) } }
    }
    const probe = async () => {
      const started = performance.now()
      try {
        const mod = await import('/claude-agile-team-demo/src/lib/probeMedia.ts' as string)
        const file = new File([blob], isAudio ? 'x.webm' : 'y.webm', { type: blob.type })
        const r = await mod.probeMediaFile(file)
        return { name: 'probeMediaFile', duration: r.duration, ms: Math.round(performance.now() - started) }
      } catch (e) { return { name: 'probeMediaFile', error: String(e), ms: Math.round(performance.now() - started) } }
    }
    const tag = isAudio ? 'audio' : 'video'
    return Promise.all([
      run(`${tag} MAX_SAFE_INTEGER`, tag, Number.MAX_SAFE_INTEGER, 'metadata'),
      run(`${tag} 1e101`, tag, 1e101, 'metadata'),
      run(`${tag} 86400`, tag, 86400, 'metadata'),
      run(`${tag} no seek, preload auto`, tag, null, 'auto'),
      run(`${tag} MAX, preload auto`, tag, Number.MAX_SAFE_INTEGER, 'auto'),
      run(`${isAudio ? 'video' : 'audio'} element, MAX`, isAudio ? 'video' : 'audio', Number.MAX_SAFE_INTEGER, 'metadata'),
      decode(),
      probe(),
    ])
  })
}

async function dump(page: Page, label: string) {
  const state = await page.evaluate(async () => {
    const log = window.__m789
    const blob = log.blobs[log.blobs.length - 1]
    let b64 = ''
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      b64 = btoa(binary)
    }
    return {
      media: log.media, recorder: log.recorder, blobType: blob?.type, b64,
      library: document.querySelector('[aria-label="Imported clips"]')?.textContent ?? null,
      errors: document.querySelector('.import-errors')?.textContent ?? null,
    }
  })
  console.log(`M789 ${label} recorder ${JSON.stringify(state.recorder)}`)
  for (const entry of state.media) console.log(`M789 ${label} media ${JSON.stringify(entry)}`)
  console.log(`M789 ${label} library ${JSON.stringify(state.library)} errors ${JSON.stringify(state.errors)}`)
  if (state.b64) {
    const bytes = Buffer.from(state.b64, 'base64')
    try {
      for (const line of describeWebm(bytes)) console.log(`M789 ${label} webm ${line}`)
    } catch (e) {
      console.log(`M789 ${label} webm parse failed ${String(e)}`)
    }
    if (state.b64.length < 120_000) console.log(`M789 ${label} b64 ${state.blobType} ${state.b64}`)
  }
  for (const result of await experiments(page)) console.log(`M789 ${label} exp ${JSON.stringify(result)}`)
}

for (const seconds of [1, 3]) {
  test(`M789 voice-over ${seconds}s`, async ({ page, browserName }) => {
    test.setTimeout(120_000)
    await page.goto('./')
    await page.getByRole('button', { name: 'Record' }).click()
    await page.getByRole('menuitem', { name: 'Microphone' }).click()
    await expect(page.getByRole('dialog', { name: 'Recording voice-over' })).toBeVisible()
    await expect(page.getByTestId('record-elapsed')).toHaveText(new RegExp(`0:0${seconds}`), { timeout: 15_000 })
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await page.waitForTimeout(17_000)
    await dump(page, `${browserName} voice ${seconds}s`)
  })

  test(`M789 webcam ${seconds}s`, async ({ page, browserName }) => {
    test.setTimeout(120_000)
    await page.goto('./')
    await page.getByRole('button', { name: 'Record' }).click()
    await page.getByRole('menuitem', { name: 'Webcam' }).click()
    await expect(page.getByRole('dialog', { name: 'Recording webcam' })).toBeVisible()
    await expect(page.getByTestId('record-elapsed')).toHaveText(new RegExp(`0:0${seconds}`), { timeout: 15_000 })
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await page.waitForTimeout(17_000)
    await dump(page, `${browserName} webcam ${seconds}s`)
  })
}
