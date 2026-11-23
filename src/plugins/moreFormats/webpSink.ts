import type { ExportFrameSink } from '../../lib/exportVideo'
import { WEBP_FRAME_RATE, WEBP_MAX_DIMENSION, WEBP_QUALITY } from '../moreFormatsLimits'
import { muxAnimatedWebp, webpFrameData } from './webpMux'
import type { WebpAnimationFrame } from './webpMux'

/**
 * The Animated WebP frame sink (#858): receives every frame the shared
 * export pipeline composes (`ExportFrameSink`, exportVideo.ts), keeps one
 * per tick of a fixed frame-rate grid, encodes each kept frame as a still
 * WebP with the browser's own encoder, and muxes the stills into an
 * animated WebP (`webpMux.ts`). The numbers, and why, are in
 * `moreFormatsLimits.ts`.
 */

/** The sink's parameters; the defaults are the plugin's stated limits. */
export interface WebpSinkOptions {
  frameRate?: number
  maxDimension?: number
  quality?: number
}

/**
 * The encoded size for a composed frame: scaled down so the longer side is
 * at most `cap`, never up, never below 1 px — the GIF plugin's rule.
 */
export function webpOutputSize(
  width: number,
  height: number,
  cap: number = WEBP_MAX_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, cap / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * The grid tick a frame at `sequenceTime` falls on, at `frameRate`. The
 * epsilon keeps a time that lands exactly on a tick, such as 0.7 s at
 * 20 fps (0.7 × 20 = 13.999…), on that tick.
 */
export function webpTickAt(sequenceTime: number, frameRate: number = WEBP_FRAME_RATE): number {
  return Math.floor(sequenceTime * frameRate + 1e-6)
}

/**
 * Each kept frame's duration in milliseconds, from the grid ticks the
 * frames were kept on (strictly increasing). A frame lasts until the next
 * kept frame's tick, so a tick the real-time pipeline skipped holds the
 * frame before it rather than shortening the animation: the WebP plays for
 * as long as the exported stretch did. The last frame lasts one tick.
 * Times are rounded on the grid's running clock, not per frame, so a rate
 * that does not divide 1000 ms still keeps exact time overall.
 */
export function webpFrameDurations(ticks: readonly number[], frameRate: number = WEBP_FRAME_RATE): number[] {
  const at = (tick: number) => Math.round((tick * 1000) / frameRate)
  return ticks.map((tick, index) => {
    const next = index + 1 < ticks.length ? ticks[index + 1] : tick + 1
    return at(next) - at(tick)
  })
}

/** The still WebP of a canvas, or a rejection when the browser cannot make one. */
function encodeStill(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null || blob.type !== 'image/webp') {
          reject(new Error('This browser did not encode the frame as WebP.'))
          return
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
      },
      'image/webp',
      quality,
    )
  })
}

/**
 * A sink that keeps the first frame on or after each grid tick, draws it
 * scaled into a canvas of its own and starts that canvas's WebP encode at
 * once. The pipeline's canvas is reused for the next frame as soon as
 * `frame` returns, so the frame is copied before the asynchronous encode
 * begins, and each kept frame gets its own canvas until its encode is done.
 * `finish` waits for every encode and muxes the stills in order.
 */
export function createWebpFrameSink(options: WebpSinkOptions = {}): ExportFrameSink {
  const frameRate = options.frameRate ?? WEBP_FRAME_RATE
  const cap = options.maxDimension ?? WEBP_MAX_DIMENSION
  const quality = options.quality ?? WEBP_QUALITY
  const ticks: number[] = []
  const stills: Promise<Uint8Array>[] = []
  let size: { width: number; height: number } | null = null

  return {
    frame(canvas, sequenceTime) {
      const last = ticks.length > 0 ? ticks[ticks.length - 1] : -Infinity
      const tick = webpTickAt(sequenceTime, frameRate)
      if (tick <= last) return
      size ??= webpOutputSize(canvas.width, canvas.height, cap)
      const copy = document.createElement('canvas')
      copy.width = size.width
      copy.height = size.height
      const context = copy.getContext('2d')
      if (context === null) return
      context.drawImage(canvas, 0, 0, size.width, size.height)
      ticks.push(tick)
      const still = encodeStill(copy, quality)
      // Settled later by `finish`; marked handled now so a failed encode is
      // reported there, once, rather than as an unhandled rejection too.
      still.catch(() => {})
      stills.push(still)
    },
    async finish() {
      if (size === null) throw new Error('The export produced no frames.')
      const durations = webpFrameDurations(ticks, frameRate)
      const encoded = await Promise.all(stills)
      const frames: WebpAnimationFrame[] = encoded.map((bytes, index) => ({
        data: webpFrameData(bytes),
        durationMs: durations[index],
      }))
      const file = muxAnimatedWebp(size.width, size.height, frames)
      return new Blob([file], { type: 'image/webp' })
    },
  }
}
