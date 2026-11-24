import { EXPORT_FRAME_RATE } from '../../lib/exportVideo'
import type { ExportFrameSink } from '../../lib/exportVideo'
import { webpTickAt } from './webpSink'
import { ZIP_MAX_ENTRIES, zipCrc32, zipStore, zipStoreLimitError } from './zipStore'
import type { ZipStoreEntry } from './zipStore'

/**
 * The PNG image sequence frame sink (#865). It receives every frame the
 * shared export pipeline composes (`ExportFrameSink`, exportVideo.ts) and
 * writes one lossless PNG per tick of the export's own **Frame rate**, at
 * the export's own **Frame size**, into a store-only ZIP (`zipStore.ts`).
 * The frames are named in order, `frame-00001.png` onwards, for handing to
 * another tool.
 *
 * **One file per tick, always.** The pipeline runs in real time and
 * composes a frame per animation frame of the page, which need not land on
 * every tick: a 60 fps export on a 60 Hz display skips some, and any rate
 * above the display's skips many. A frame sequence has no durations to hold
 * a frame longer, as the Animated WebP does (`webpFrameDurations`). So a
 * skipped tick repeats the frame before it, as a held frame would show, and
 * the archive always holds one file per tick: `frame rate × duration`.
 * A repeat stores the same PNG again and encodes nothing new. The same
 * holds at the tail: the pipeline's last frame lands about one display
 * refresh before the window ends, so `finish` repeats it for every tick
 * left before `end` (measured on #904's review: 119 files for 2 s at
 * 60 fps, and 238 at 120 fps, without it).
 *
 * **Kept as encoded PNGs.** Each kept frame is copied out of the reused
 * pipeline canvas at once and encoded by the browser's PNG encoder. Only
 * the encoder's Blob is kept, never raw pixels, and the copy is released
 * when its encode settles. The CRC-32 the ZIP needs is taken from the
 * bytes once, then the bytes are dropped, so the archive is built from the
 * Blobs themselves.
 */

/** The sink's parameters. */
export interface PngSequenceSinkOptions {
  /** Frames per second: the export's Frame rate setting (`EXPORT_FRAME_RATE` when absent). */
  frameRate?: number
  /**
   * The exported window's end, in sequence seconds. Every tick before it
   * gets a file, the ones after the last composed frame holding that
   * frame, and a frame on a tick at or after it gets none. Absent, the
   * archive ends at the last composed frame's tick.
   */
  end?: number
  /** The time written into the ZIP's headers; now when absent. */
  modified?: () => Date
}

/** The archive name of the 1-based `index`th frame: `frame-00001.png`. */
export function pngSequenceFrameName(index: number): string {
  return `frame-${String(index).padStart(5, '0')}.png`
}

interface EncodedFrame {
  data: Blob
  crc32: number
}

/** A canvas's PNG and its CRC-32, or a rejection when the browser cannot make one. */
function encodeFrame(canvas: HTMLCanvasElement): Promise<EncodedFrame> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null || blob.type !== 'image/png') {
        reject(new Error('This browser did not encode the frame as PNG.'))
        return
      }
      resolve(blob)
    }, 'image/png')
  }).then(async (data) => ({ data, crc32: zipCrc32(new Uint8Array(await data.arrayBuffer())) }))
}

/**
 * The last tick of `frameRate`'s grid that starts before `end`: the window
 * `[start, end)` is half-open, so a tick exactly at `end` is not in it. The
 * epsilon is `webpTickAt`'s, so 0.7 s at 20 fps ends on tick 13.
 */
export function lastTickBefore(end: number, frameRate: number): number {
  return Math.ceil(end * frameRate - 1e-6) - 1
}

/**
 * A sink that writes one PNG per tick of `frameRate` from the first frame
 * it receives, repeating the previous PNG for any tick the pipeline did not
 * compose, up to the last tick before `end` when given, and zips them in
 * order on `finish`.
 */
export function createPngSequenceFrameSink(options: PngSequenceSinkOptions = {}): ExportFrameSink {
  const frameRate = options.frameRate ?? EXPORT_FRAME_RATE
  const frames: Promise<EncodedFrame>[] = []
  let lastTick: number | null = null
  const lastDue = options.end === undefined ? null : lastTickBefore(options.end, frameRate)
  let overflow = false

  return {
    frame(canvas, sequenceTime) {
      const tick = webpTickAt(sequenceTime, frameRate)
      if (lastTick !== null && tick <= lastTick) return
      // A range export's pipeline can compose one frame past the window's
      // end (1.517 s for a range ending at 1.5 s, measured on #904's
      // review); its tick is outside the window, so it gets no file.
      if (lastDue !== null && tick > lastDue) return
      // Past the ZIP's file count nothing more is encoded: `finish` refuses
      // the export, so holding more frames would only cost memory.
      const ticks = lastTick === null ? 1 : tick - lastTick
      if (frames.length + ticks > ZIP_MAX_ENTRIES) {
        overflow = true
        lastTick = tick
        return
      }
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      const context = copy.getContext('2d')
      if (context === null) return
      context.drawImage(canvas, 0, 0)
      // Ticks the pipeline skipped hold the frame before them.
      const previous = frames.at(-1)
      if (previous !== undefined) for (let skipped = 1; skipped < ticks; skipped += 1) frames.push(previous)
      const encoded = encodeFrame(copy)
      // Release the copy's pixels once its PNG exists, so the frames
      // waiting on the encoder are the only ones held as pixels.
      const release = () => {
        copy.width = 0
        copy.height = 0
      }
      encoded.then(release, release)
      // Settled later by `finish`; marked handled now so a failed encode is
      // reported there, once, rather than as an unhandled rejection too.
      encoded.catch(() => {})
      frames.push(encoded)
      lastTick = tick
    },
    async finish() {
      if (frames.length === 0) throw new Error('The export produced no frames.')
      // The ticks after the last composed frame hold it, as skipped ones do.
      const tail = lastDue === null || lastTick === null ? 0 : Math.max(0, lastDue - lastTick)
      if (frames.length + tail > ZIP_MAX_ENTRIES) overflow = true
      if (overflow) {
        throw new Error(
          `A ZIP holds at most ${ZIP_MAX_ENTRIES.toLocaleString('en-US')} files. Export a shorter range or a lower frame rate.`,
        )
      }
      const last = frames.at(-1)!
      for (let held = 0; held < tail; held += 1) frames.push(last)
      const encoded = await Promise.all(frames)
      const entries: ZipStoreEntry[] = encoded.map(({ data, crc32 }, index) => ({
        name: pngSequenceFrameName(index + 1),
        data,
        crc32,
      }))
      const limit = zipStoreLimitError(entries.map(({ name, data }) => ({ name, size: data.size })))
      if (limit !== null) throw new Error(limit)
      return zipStore(entries, options.modified?.() ?? new Date())
    },
  }
}
