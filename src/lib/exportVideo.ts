import type { TimelineEntry, TimelineState } from './timeline'
import { totalDuration } from './timeline'
import { sequenceTimeAt } from './playback'

/**
 * Recorder MIME types in preference order. WebM is the only container
 * MediaRecorder produces across browsers; VP9 beats VP8 where available.
 */
export const EXPORT_MIME_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export const EXPORT_FRAME_RATE = 30

/** Thrown when the browser lacks the APIs the export needs. */
export class ExportUnsupportedError extends Error {}

/** Thrown when the export is aborted via its AbortSignal. */
export class ExportCanceledError extends Error {
  constructor() {
    super('Export canceled.')
  }
}

/** First supported candidate MIME type, or null when none is. */
export function pickExportMimeType(
  isSupported: (type: string) => boolean,
  candidates: readonly string[] = EXPORT_MIME_CANDIDATES,
): string | null {
  return candidates.find((type) => isSupported(type)) ?? null
}

export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Aspect-fit rectangle for drawing a source frame centered inside a target
 * (letterboxing/pillarboxing). A degenerate source fills the whole target.
 */
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): FitRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight }
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height }
}

export interface ExportOptions {
  /** Called with overall progress in [0, 1] while the sequence records. */
  onProgress?: (fraction: number) => void
  /** Aborting rejects the export with ExportCanceledError. */
  signal?: AbortSignal
  frameRate?: number
  /** Injectable for tests (jsdom never fires media events). */
  createVideo?: () => HTMLVideoElement
}

/**
 * Matches the preview player's boundary tolerance: the video clock advances
 * in discrete steps, so an exact out-point comparison would record frames
 * past the trim.
 */
const OUT_POINT_EPSILON = 0.02

/** Fallback canvas size when no source reports its dimensions. */
const FALLBACK_WIDTH = 640
const FALLBACK_HEIGHT = 360

/**
 * Exports the timeline — each entry from its in-point to its out-point, in
 * order — to a single WebM Blob.
 *
 * Approach: replay the sequence through an off-DOM muted <video>, draw each
 * frame onto a canvas, and record the canvas stream with MediaRecorder. This
 * re-encodes in real time (a ~30 s sequence takes ~30 s) but works entirely
 * client-side with broadly supported APIs. Audio is not captured.
 */
export async function exportTimeline(
  timeline: TimelineState,
  options: ExportOptions = {},
): Promise<Blob> {
  const { entries } = timeline
  if (entries.length === 0) {
    throw new Error('The timeline is empty — add clips before exporting.')
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new ExportUnsupportedError('This browser does not support recording video (MediaRecorder).')
  }
  const mimeType = pickExportMimeType((type) => MediaRecorder.isTypeSupported(type))
  if (mimeType === null) {
    throw new ExportUnsupportedError('This browser cannot encode WebM video.')
  }

  const { onProgress, signal, frameRate = EXPORT_FRAME_RATE } = options
  const video = (options.createVideo ?? (() => document.createElement('video')))()
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  const canceled = () => new ExportCanceledError()
  const throwIfAborted = () => {
    if (signal?.aborted) throw canceled()
  }

  /** Resolves on `name`; rejects on the video erroring or the signal aborting. */
  const waitForEvent = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const settle = (result?: Error) => {
        video.removeEventListener(name, onDone)
        video.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        if (result) reject(result)
        else resolve()
      }
      const onDone = () => settle()
      const onError = () => settle(new Error('A source clip failed to load during export.'))
      const onAbort = () => settle(canceled())
      video.addEventListener(name, onDone, { once: true })
      video.addEventListener('error', onError, { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
    })

  const loadSource = async (url: string) => {
    if (video.src !== url) {
      const loaded = waitForEvent('loadedmetadata')
      video.src = url
      await loaded
    }
  }

  const cueEntry = async (entry: TimelineEntry) => {
    await loadSource(entry.url)
    if (Math.abs(video.currentTime - entry.inPoint) > 0.001) {
      const seeked = waitForEvent('seeked')
      video.currentTime = entry.inPoint
      await seeked
    }
  }

  const releaseVideo = () => {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }

  // Output frame size: the largest source dimensions in the sequence, so no
  // clip is downscaled; differently-sized clips are letterboxed into it.
  let width = 0
  let height = 0
  try {
    for (const url of new Set(entries.map((entry) => entry.url))) {
      throwIfAborted()
      await loadSource(url)
      width = Math.max(width, video.videoWidth)
      height = Math.max(height, video.videoHeight)
    }
  } catch (error) {
    releaseVideo()
    throw error
  }
  if (width === 0 || height === 0) {
    width = FALLBACK_WIDTH
    height = FALLBACK_HEIGHT
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null || typeof canvas.captureStream !== 'function') {
    releaseVideo()
    throw new ExportUnsupportedError('This browser cannot capture canvas video.')
  }

  const drawFrame = () => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const rect = fitRect(video.videoWidth, video.videoHeight, width, height)
    context.drawImage(video, rect.x, rect.y, rect.width, rect.height)
  }

  const total = totalDuration(timeline)
  const recorder = new MediaRecorder(canvas.captureStream(frameRate), { mimeType })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start()

  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]
      await cueEntry(entry)
      throwIfAborted()
      drawFrame()
      await video.play()
      // Draw every frame until the entry's out-point (or the source's actual
      // end, whichever comes first).
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (signal?.aborted) {
            reject(canceled())
            return
          }
          drawFrame()
          onProgress?.(Math.min(sequenceTimeAt(timeline, index, video.currentTime) / total, 1))
          if (video.currentTime >= entry.outPoint - OUT_POINT_EPSILON || video.ended) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      video.pause()
    }
  } finally {
    releaseVideo()
    recorder.stop()
    await stopped
  }

  onProgress?.(1)
  return new Blob(chunks, { type: mimeType })
}
