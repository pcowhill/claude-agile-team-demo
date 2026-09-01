import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { ExportFrameSink } from '../../lib/exportVideo'

/**
 * The GIF plugin's frame sink (#198): receives every frame the shared export
 * pipeline composes (`ExportFrameSink`, exportVideo.ts) and encodes an
 * animated GIF with `gifenc`. Lives in the plugin's lazy chunk — gifenc must
 * never be reachable from the entry bundle (`npm run check:bundle` enforces
 * it, ADR 0003).
 *
 * The defaults below are the plugin's stated limits (shown in the export
 * modal via the format `note`):
 *
 * - **10 fps.** GIF frame delays are stored in centiseconds, so 10 fps is
 *   exactly 10 cs per frame — timing stays exact, files stay a third of a
 *   30 fps recording, and 10 fps is the conventional screen-capture GIF
 *   rate. The pipeline plays in real time; the sink samples down to this
 *   rate by sequence time, whatever the modal's frame-rate setting says.
 * - **480 px dimension cap.** GIF is palette-mapped and LZW-compressed —
 *   costs grow with area, and a 4K GIF would be enormous and slow to
 *   encode in-tab. The composed frame (whatever resolution the modal
 *   requested — composition coordinates stay exact) is scaled down
 *   proportionally so its longer side is at most 480 px.
 * - **256-color palette per frame** (GIF's maximum), quantized from that
 *   frame's own pixels, so a scene change re-quantizes rather than smearing
 *   one global palette across unrelated shots.
 */
export const GIF_FRAME_RATE = 10
export const GIF_MAX_DIMENSION = 480
/** GIF frame delay for the sampling rate, in milliseconds (10 cs exactly). */
export const GIF_FRAME_DELAY_MS = 1000 / GIF_FRAME_RATE
/** GIF's palette-size ceiling. */
export const GIF_MAX_COLORS = 256

/**
 * The encoded GIF's dimensions for a composed frame (#198): scaled down
 * proportionally so the longer side is at most `cap`, never scaled up, and
 * never below 1 px. Exported for the plugin's unit tests — this is the
 * parameter mapping between the modal's resolution settings and the GIF.
 */
export function gifOutputSize(
  width: number,
  height: number,
  cap: number = GIF_MAX_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, cap / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * When the next frame is kept, given that one was just kept at
 * `sequenceTime` (#198): the next tick of the fixed `GIF_FRAME_RATE` grid.
 * Anchoring to the grid rather than to the kept frame's exact time keeps
 * real-time jitter from drifting the GIF's clock. Exported for unit tests.
 */
export function nextGifSampleAt(sequenceTime: number): number {
  return (Math.floor(sequenceTime * GIF_FRAME_RATE) + 1) / GIF_FRAME_RATE
}

/**
 * A sink that samples the pipeline's real-time frames down to
 * `GIF_FRAME_RATE` by sequence time and encodes each kept frame: scale into
 * an offscreen canvas at the capped size, quantize that frame's pixels to a
 * palette, map, and write with the fixed delay. `finish` returns the
 * assembled bytes as an `image/gif` Blob.
 */
export function createGifFrameSink(): ExportFrameSink {
  const encoder = GIFEncoder()
  let scaled: HTMLCanvasElement | null = null
  let scaledContext: CanvasRenderingContext2D | null = null
  /** Sequence time at or past which the next frame is kept. */
  let nextSampleAt = 0

  return {
    frame(canvas, sequenceTime) {
      if (sequenceTime < nextSampleAt) return
      nextSampleAt = nextGifSampleAt(sequenceTime)
      if (scaled === null) {
        const size = gifOutputSize(canvas.width, canvas.height)
        scaled = document.createElement('canvas')
        scaled.width = size.width
        scaled.height = size.height
        scaledContext = scaled.getContext('2d', { willReadFrequently: true })
      }
      if (scaledContext === null || scaled === null) return
      scaledContext.drawImage(canvas, 0, 0, scaled.width, scaled.height)
      const { data } = scaledContext.getImageData(0, 0, scaled.width, scaled.height)
      // The composition draws on an opaque black stage — no transparency to
      // preserve — so quantize in the palette format without alpha.
      const palette = quantize(data, GIF_MAX_COLORS, { format: 'rgb444' })
      const indexed = applyPalette(data, palette, 'rgb444')
      encoder.writeFrame(indexed, scaled.width, scaled.height, {
        palette,
        delay: GIF_FRAME_DELAY_MS,
      })
    },
    finish() {
      encoder.finish()
      // Copy the encoder's view into a fresh buffer: BlobPart wants a plain
      // ArrayBuffer-backed array, and the copy detaches the Blob from the
      // encoder's growing internal buffer.
      const bytes = Uint8Array.from(encoder.bytesView())
      return Promise.resolve(new Blob([bytes], { type: 'image/gif' }))
    },
  }
}
