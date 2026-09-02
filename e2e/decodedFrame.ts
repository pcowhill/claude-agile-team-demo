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
