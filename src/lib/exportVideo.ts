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

/**
 * The same preference order for recordings that carry an audio track. Naming
 * only a video codec makes some browsers drop the audio track, so the codec
 * list has to spell out Opus — the only audio codec WebM carries in practice.
 */
export const EXPORT_MIME_CANDIDATES_WITH_AUDIO: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
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
  /** Injectable for tests (jsdom has no Web Audio). */
  createAudioContext?: () => AudioContext | null
}

/** An audio track to record, plus the teardown for the graph behind it. */
export interface AudioCapture {
  track: MediaStreamTrack
  dispose: () => Promise<void>
}

function defaultAudioContext(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : new AudioContext()
}

/**
 * Routes the replay element's audio into a MediaStream track that can be
 * recorded alongside the canvas video.
 *
 * The graph is deliberately *not* connected to `context.destination`: taking
 * the element's audio into Web Audio detaches it from the speakers, and
 * leaving it that way is what keeps a 30-second export from playing the whole
 * sequence out loud. A source without audio still yields a track — a silent
 * one — so exports stay uniform whether or not the clips have sound.
 *
 * Returns null when Web Audio is unavailable or refuses the element, which
 * the caller treats as "export video only" rather than as a failure.
 */
export async function createAudioCapture(
  video: HTMLVideoElement,
  createContext: () => AudioContext | null = defaultAudioContext,
): Promise<AudioCapture | null> {
  let context: AudioContext | null = null
  try {
    context = createContext()
    if (context === null) return null
    const source = context.createMediaElementSource(video)
    const destination = context.createMediaStreamDestination()
    source.connect(destination)
    // Autoplay policy starts contexts suspended; a suspended context feeds
    // the recorder nothing.
    if (context.state === 'suspended') await context.resume()
    const track = destination.stream.getAudioTracks()[0] ?? null
    if (track === null) throw new Error('No audio track was produced.')
    const owned = context
    return {
      track,
      dispose: async () => {
        track.stop()
        try {
          await owned.close()
        } catch {
          // A context that is already closed needs no teardown.
        }
      },
    }
  } catch {
    try {
      await context?.close()
    } catch {
      // Ignore: we are already on the video-only fallback path.
    }
    return null
  }
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
 * Approach: replay the sequence through an off-DOM <video>, draw each frame
 * onto a canvas, and record the canvas stream with MediaRecorder. The
 * element's audio is captured through Web Audio and recorded as a second
 * track, so trims apply to sound and picture alike — both come from the same
 * playback between the entry's in- and out-points. This re-encodes in real
 * time (a ~30 s sequence takes ~30 s) but works entirely client-side with
 * broadly supported APIs.
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

  const { onProgress, signal, frameRate = EXPORT_FRAME_RATE } = options
  const video = (options.createVideo ?? (() => document.createElement('video')))()
  video.playsInline = true
  video.preload = 'auto'

  const audioCapture = await createAudioCapture(video, options.createAudioContext)
  // Muting an element silences its Web Audio output too, so the replay can
  // only stay muted when there is no audio to capture. Nothing reaches the
  // speakers either way: createAudioCapture leaves the graph unconnected.
  video.muted = audioCapture === null

  const mimeType = pickExportMimeType(
    (type) => MediaRecorder.isTypeSupported(type),
    audioCapture === null ? EXPORT_MIME_CANDIDATES : EXPORT_MIME_CANDIDATES_WITH_AUDIO,
  )
  if (mimeType === null) {
    await audioCapture?.dispose()
    throw new ExportUnsupportedError('This browser cannot encode WebM video.')
  }

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

  /** Tears down the replay element and the audio graph feeding the recorder. */
  const releaseAll = async () => {
    releaseVideo()
    await audioCapture?.dispose()
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
    await releaseAll()
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
    await releaseAll()
    throw new ExportUnsupportedError('This browser cannot capture canvas video.')
  }

  /**
   * Autoplay policy can still refuse unmuted playback. Falling back to a
   * muted replay costs the audio (the graph goes silent with the element) but
   * keeps the export itself working.
   */
  const playReplay = async () => {
    try {
      await video.play()
    } catch (error) {
      if (video.muted) throw error
      video.muted = true
      await video.play()
    }
  }

  const drawFrame = () => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const rect = fitRect(video.videoWidth, video.videoHeight, width, height)
    context.drawImage(video, rect.x, rect.y, rect.width, rect.height)
  }

  const total = totalDuration(timeline)
  const stream = canvas.captureStream(frameRate)
  if (audioCapture !== null) stream.addTrack(audioCapture.track)
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType })
  } catch (error) {
    // A rejected track combination must not strand the audio context, which
    // holds a rendering thread until it is closed.
    await releaseAll()
    throw error
  }
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
      await playReplay()
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
    // After the recorder has flushed, so the tail of the audio survives.
    await audioCapture?.dispose()
  }

  onProgress?.(1)
  return new Blob(chunks, { type: mimeType })
}
