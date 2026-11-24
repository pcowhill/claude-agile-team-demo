import type { ExportFrameSink } from '../../lib/exportVideo'
import { APNG_FRAME_RATE, APNG_MAX_DIMENSION } from '../moreFormatsLimits'
import { muxApng, pngFrameData } from './apngMux'
import type { PngAnimationFrame } from './apngMux'
import { webpFrameDurations, webpOutputSize, webpTickAt } from './webpSink'

/**
 * The Animated PNG frame sink (#864). It receives every frame the shared
 * export pipeline composes (`ExportFrameSink`, exportVideo.ts) and keeps
 * one per tick of a fixed frame-rate grid. Each kept frame is encoded as a
 * still PNG by the browser's own encoder, and the stills are muxed into an
 * APNG (`apngMux.ts`).
 *
 * It samples exactly as the Animated WebP sink does, through that sink's
 * grid, size and duration rules (`webpSink.ts`): the first frame on or
 * after each tick, scaled down to the cap, and lasting until the next kept
 * tick. Only the still encoder and the muxer differ. The numbers, and why,
 * are in `moreFormatsLimits.ts`.
 */

/** The sink's parameters; the defaults are the plugin's stated limits. */
export interface ApngSinkOptions {
  frameRate?: number
  maxDimension?: number
}

/** The still PNG of a canvas, or a rejection when the browser cannot make one. */
function encodeStill(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null || blob.type !== 'image/png') {
        reject(new Error('This browser did not encode the frame as PNG.'))
        return
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}

/**
 * A sink that keeps the first frame on or after each grid tick, draws it
 * scaled into a canvas of its own and starts that canvas's PNG encode at
 * once. The pipeline's canvas is reused for the next frame as soon as
 * `frame` returns, so the frame is copied before the asynchronous encode
 * begins. `finish` waits for every encode and muxes the stills in order.
 */
export function createApngFrameSink(options: ApngSinkOptions = {}): ExportFrameSink {
  const frameRate = options.frameRate ?? APNG_FRAME_RATE
  const cap = options.maxDimension ?? APNG_MAX_DIMENSION
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
      const still = encodeStill(copy)
      // Settled later by `finish`; marked handled now so a failed encode is
      // reported there, once, rather than as an unhandled rejection too.
      still.catch(() => {})
      stills.push(still)
    },
    async finish() {
      if (size === null) throw new Error('The export produced no frames.')
      const durations = webpFrameDurations(ticks, frameRate)
      const encoded = await Promise.all(stills)
      const frames: PngAnimationFrame[] = encoded.map((bytes, index) => ({
        data: pngFrameData(bytes),
        durationMs: durations[index],
      }))
      // Typed `image/png`, not `image/apng`: Firefox reconciles a download's
      // extension with its type and saved `sequence-export.png` as `.apng`
      // (CI run 45463920668). An APNG is a valid PNG, which is why it is
      // saved as `.png` at all (index.ts).
      return new Blob([muxApng(frames)], { type: 'image/png' })
    },
  }
}
