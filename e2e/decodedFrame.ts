import type { Page } from '@playwright/test'

/**
 * Shared decoded-frame sampling for the export specs (#276): decode an
 * exported WebM in-page, seek near its end, and average the pixels of a
 * region of the presented frame. One implementation because the previous
 * per-spec copies shared a flake: they waited on
 * `!seeking && |currentTime − target| < 0.25 && readyState >= 2` and then
 * drew immediately — but that predicate can pass before the sought frame
 * has been PRESENTED, and `drawImage` of a not-yet-presented frame
 * intermittently rasterizes all black (the issue's evidence: the same
 * black-sample failure moving between unrelated specs, passing on re-run).
 *
 * The presentation signal is `requestVideoFrameCallback`: it fires when a
 * frame has actually been presented for composition, with the frame's own
 * `mediaTime`. Two measured properties (#276) shape the wait below: the
 * callback must be registered BEFORE the seek is issued (a paused seek
 * presents exactly one frame — a late registration waits forever), and the
 * sought frame's presentation can arrive while `seeking` is still true
 * (presentation precedes the `seeked` event on mid-file seeks), so the
 * presentation is matched by the frame's `mediaTime` alone and combined
 * with the seek-settled predicate rather than gated on it. A bounded grace
 * (well beyond the ~10ms presentation lag measured) keeps an unmatched
 * presentation — e.g. a recording with a frame gap wider than the match
 * tolerance — from turning into a hard timeout: after it, the wait falls
 * back to the settled predicate alone, the pre-#276 behavior.
 */

/** A sampling region as fractions of the decoded frame. */
export interface SampleRect {
  x: number
  y: number
  width: number
  height: number
}

/** Per-channel averages of one sampled band of one scanned frame. */
export interface BandAverage {
  r: number
  g: number
  b: number
}

export interface ScannedFrame {
  /** The grid time (seconds into the file) this frame was sought at. */
  time: number
  bands: Record<string, BandAverage>
}

export interface ExportScan {
  duration: number
  width: number
  height: number
  /** One entry per grid step, in time order. */
  frames: ScannedFrame[]
}

export interface FrameSample {
  r: number
  g: number
  b: number
  duration: number
  width: number
  height: number
}

/**
 * Decodes the exported WebM, seeks to `fromEndSeconds` before its end, and
 * averages the pixels of a fractional region of that frame once it has been
 * presented. Sampling anchors to the end of the file, as the export specs
 * always have, because export overhead pads the front. The decoded
 * dimensions come back so reshaped frames (crop, orientation) stay
 * checkable.
 */
export async function sampleExportedFrame(
  page: Page,
  webm: Buffer,
  fromEndSeconds: number,
  rect: SampleRect,
): Promise<FrameSample> {
  return await page.evaluate(
    async ({ base64, fromEndSeconds, rect }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const settleIfKnown = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve()
              return true
            }
            return false
          }
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (settleIfKnown()) return
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => settleIfKnown()
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        const duration = video.duration
        const target = Math.max(0, duration - fromEndSeconds)
        // Wait for the seek to settle AND the sought frame to be PRESENTED
        // (#276). The settle poll alone (the pre-#276 predicate) can pass
        // before presentation — the window where drawImage rasterized
        // black. The presentation is matched by mediaTime, registered
        // before the seek is issued; a settled seek whose presentation
        // never matches (a frame gap wider than the tolerance) proceeds
        // after the grace instead of failing — a presented frame is then
        // not guaranteed, exactly the pre-#276 behavior.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now()
          let presented = false
          const onFrame = (_now: number, metadata: { mediaTime: number }) => {
            if (Math.abs(metadata.mediaTime - target) < 0.25) presented = true
            else video.requestVideoFrameCallback(onFrame)
          }
          video.requestVideoFrameCallback(onFrame)
          video.currentTime = target
          let settledAt: number | null = null
          const check = () => {
            if (
              !video.seeking &&
              Math.abs(video.currentTime - target) < 0.25 &&
              video.readyState >= 2
            ) {
              settledAt ??= performance.now()
              if (presented || performance.now() - settledAt > 1500) {
                resolve()
                return
              }
            }
            if (performance.now() - started > 10_000) {
              reject(new Error('seeking the exported file timed out'))
            } else {
              requestAnimationFrame(check)
            }
          }
          check()
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)
        const x = Math.floor(rect.x * canvas.width)
        const y = Math.floor(rect.y * canvas.height)
        const w = Math.max(1, Math.floor(rect.width * canvas.width))
        const h = Math.max(1, Math.floor(rect.height * canvas.height))
        const data = ctx.getImageData(x, y, w, h).data
        let r = 0
        let g = 0
        let b = 0
        const pixels = data.length / 4
        for (let index = 0; index < data.length; index += 4) {
          r += data[index]
          g += data[index + 1]
          b += data[index + 2]
        }
        return {
          r: r / pixels,
          g: g / pixels,
          b: b / pixels,
          duration,
          width: video.videoWidth,
          height: video.videoHeight,
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), fromEndSeconds, rect },
  )
}

/**
 * Decodes the exported WebM once and walks it end to end with paused seeks
 * on a fixed grid, sampling the given bands of every visited frame (#370).
 *
 * Why a scan exists: the phase-sampling export specs used to compute sample
 * times from the NOMINAL timeline (fixed offsets from the file's end), but
 * the export is a real-time recording whose phases stretch and shift under
 * CPU load — a stall mid-export stretches one phase, not all of them
 * proportionally, so no fixed offset (and no uniform rescaling) is safe.
 * The scan lets a spec locate each phase by its own color signature in the
 * exported file and assert at positions measured within it.
 *
 * Presentation discipline is #276's: a persistent
 * `requestVideoFrameCallback` chain is registered before any seeking, and
 * each step waits for a presentation that arrives after its seek. A step
 * whose grid time falls inside the same encoded frame as the previous step
 * presents nothing new — the settle-plus-grace fallback then proceeds,
 * which is sound because the previously presented frame is still the right
 * one for this grid time.
 */
export async function scanExportedFrames(
  page: Page,
  webm: Buffer,
  bands: Record<string, SampleRect>,
  stepSeconds = 1 / 30,
): Promise<ExportScan> {
  return await page.evaluate(
    async ({ base64, bands, stepSeconds }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const settleIfKnown = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
              resolve()
              return true
            }
            return false
          }
          video.onerror = () => reject(new Error('exported file failed to decode'))
          video.onloadedmetadata = () => {
            if (settleIfKnown()) return
            // MediaRecorder WebMs may report Infinity until forced to scan.
            video.ondurationchange = () => settleIfKnown()
            video.currentTime = Number.MAX_SAFE_INTEGER
          }
          video.src = url
        })
        const duration = video.duration

        // The presentation counter (#276: registered before any seek below).
        let presentations = 0
        const onFrame = () => {
          presentations += 1
          video.requestVideoFrameCallback(onFrame)
        }
        video.requestVideoFrameCallback(onFrame)

        // Drain the duration dance: its own end-seek may still present a
        // frame after the counter registers, and that stray bump must not
        // pass for the first grid step's presentation.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now()
          let settledAt: number | null = null
          const check = () => {
            if (!video.seeking && video.readyState >= 2) {
              settledAt ??= performance.now()
              if (performance.now() - settledAt > 200) {
                resolve()
                return
              }
            }
            if (performance.now() - started > 10_000) {
              reject(new Error('the exported file never settled after decoding'))
            } else {
              requestAnimationFrame(check)
            }
          }
          check()
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        const sampleBand = (rect: { x: number; y: number; width: number; height: number }) => {
          const x = Math.floor(rect.x * canvas.width)
          const y = Math.floor(rect.y * canvas.height)
          const w = Math.max(1, Math.floor(rect.width * canvas.width))
          const h = Math.max(1, Math.floor(rect.height * canvas.height))
          const data = ctx.getImageData(x, y, w, h).data
          let r = 0
          let g = 0
          let b = 0
          const pixels = data.length / 4
          for (let index = 0; index < data.length; index += 4) {
            r += data[index]
            g += data[index + 1]
            b += data[index + 2]
          }
          return { r: r / pixels, g: g / pixels, b: b / pixels }
        }

        const frames: {
          time: number
          bands: Record<string, { r: number; g: number; b: number }>
        }[] = []
        for (let time = 0; time < duration - stepSeconds / 2; time += stepSeconds) {
          const before = presentations
          await new Promise<void>((resolve, reject) => {
            const started = performance.now()
            let settledAt: number | null = null
            video.currentTime = time
            const check = () => {
              if (presentations > before) {
                resolve()
                return
              }
              if (
                !video.seeking &&
                Math.abs(video.currentTime - time) < 0.1 &&
                video.readyState >= 2
              ) {
                // Settled without a new presentation: the grid time lies in
                // the frame already presented by the previous step. A short
                // grace covers a presentation still in flight.
                settledAt ??= performance.now()
                if (performance.now() - settledAt > 150) {
                  resolve()
                  return
                }
              }
              if (performance.now() - started > 10_000) {
                reject(new Error(`scanning the exported file stalled at ${time.toFixed(2)}s`))
              } else {
                requestAnimationFrame(check)
              }
            }
            check()
          })
          ctx.drawImage(video, 0, 0)
          const sampled: Record<string, { r: number; g: number; b: number }> = {}
          for (const [name, rect] of Object.entries(bands)) sampled[name] = sampleBand(rect)
          frames.push({ time, bands: sampled })
        }
        return { duration, width: video.videoWidth, height: video.videoHeight, frames }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { base64: webm.toString('base64'), bands, stepSeconds },
  )
}

/**
 * The first scanned frame matching the predicate. Throws with the given
 * description when none does — a phase whose signature never appears is a
 * real failure and should say which signature.
 */
export function firstFrame(
  scan: ExportScan,
  predicate: (frame: ScannedFrame) => boolean,
  what: string,
): ScannedFrame {
  const frame = scan.frames.find(predicate)
  if (frame === undefined) throw new Error(`no scanned frame matches: ${what}`)
  return frame
}

/** The last scanned frame matching the predicate; throws like `firstFrame`. */
export function lastFrame(
  scan: ExportScan,
  predicate: (frame: ScannedFrame) => boolean,
  what: string,
): ScannedFrame {
  for (let index = scan.frames.length - 1; index >= 0; index--) {
    if (predicate(scan.frames[index])) return scan.frames[index]
  }
  throw new Error(`no scanned frame matches: ${what}`)
}

/** The scanned frame nearest to the given time. */
export function frameAt(scan: ExportScan, time: number): ScannedFrame {
  if (scan.frames.length === 0) throw new Error('the scan holds no frames')
  let nearest = scan.frames[0]
  for (const frame of scan.frames) {
    if (Math.abs(frame.time - time) < Math.abs(nearest.time - time)) nearest = frame
  }
  return nearest
}
