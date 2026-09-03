import {
  ExportUnsupportedError,
  activeVideoOverlays,
  canvasSupportsColorFilter,
  createFrameComposer,
  timelineHasColorAdjustments,
} from './exportVideo'
import type { LayerFrame, OverlayFrame } from './exportVideo'
import { automaticExportFrame } from './exportSettings'
import { audioTrackPlaybackAt, locateInSequence } from './playback'
import { isStillEntry } from './timeline'
import type { TimelineState } from './timeline'
import type { SourceDimensions } from './frameSize'
import type { VideoOverlay } from './videoOverlay'

/**
 * Save frame (#237): the exact frame under the playhead, fully composed at
 * the output resolution, as a PNG — the "grab a thumbnail without exporting
 * the whole video" job.
 *
 * The composition is the export's, not a re-derivation (#66): the snapshot
 * builds the same `createFrameComposer` the real-time export loop draws
 * through, so transitions mid-overlap, zooms, color adjustments (#192),
 * orientation (#232/#233), video overlays, and text render exactly as an
 * export of that instant would. Where the export *plays* its replay
 * elements, the snapshot *cues* them: each visible source is loaded and
 * seeked to the source time the shared playback rule (`locateInSequence`,
 * remap-aware) resolves for the requested sequence time, and the draw waits
 * for the seek to settle — never a stale or black frame.
 *
 * The refusal rules are the export's too: an empty timeline has no frame,
 * and a browser whose canvas cannot apply filters refuses to snapshot a
 * color-adjusted timeline rather than silently saving it unadjusted.
 */

/** Download filename for a frame snapshot, derived from the sequence time. */
export function frameFileName(sequenceTime: number): string {
  return `sequence-frame-${Math.max(0, sequenceTime).toFixed(2)}s.png`
}

export interface SnapshotOptions {
  /**
   * Output frame override — the export modal's rule (#179). Absent means the
   * automatic rule: `automaticExportFrame`, the exact frame an export of
   * this timeline would derive (per-entry, oriented).
   */
  frame?: SourceDimensions
  /** Injectable for tests (jsdom never fires media events). */
  createVideo?: () => HTMLVideoElement
  /** Injectable for tests (jsdom never fires image load events). */
  createImage?: () => HTMLImageElement
  /** Injectable for tests (jsdom has no canvas rendering). */
  createCanvas?: () => HTMLCanvasElement
}

/**
 * Arms a wait for the element's next PRESENTED frame (#276). `seeked` and
 * `loadeddata` fire when the seek/load completes, which is before the frame
 * has necessarily been presented — and drawing a not-yet-presented frame
 * intermittently rasterizes black (the save-frame flake's mechanism).
 * `requestVideoFrameCallback` is the presentation signal, so the callback
 * must be registered BEFORE the action that presents the frame (after a
 * paused cue's frame is presented, no further callback ever comes); a
 * pre-seek presentation racing in re-arms rather than settling, since the
 * seek is always already issued when a callback can first run. Returns an
 * awaiter that bounds the wait: presentation normally follows within a
 * frame or two, and the bound means an engine that never presents a
 * detached element's frames degrades to the pre-#276 behavior (a rare
 * stale/black frame) instead of hanging the snapshot forever. Without
 * `requestVideoFrameCallback` the awaiter resolves immediately — exactly
 * the pre-#276 behavior.
 */
const armPresentedFrame = (element: HTMLVideoElement): (() => Promise<void>) => {
  if (typeof element.requestVideoFrameCallback !== 'function') {
    return () => Promise.resolve()
  }
  let presented = false
  let settle = () => {
    presented = true
  }
  const onFrame = () => {
    if (element.seeking) element.requestVideoFrameCallback(onFrame)
    else settle()
  }
  element.requestVideoFrameCallback(onFrame)
  return () =>
    new Promise<void>((resolve) => {
      if (presented) {
        resolve()
        return
      }
      const timer = setTimeout(() => resolve(), 300)
      settle = () => {
        presented = true
        clearTimeout(timer)
        resolve()
      }
    })
}

/** Resolves after `arm` triggers `name` on the element; rejects on error. */
const afterEvent = (element: HTMLMediaElement | HTMLImageElement, name: string, arm: () => void) =>
  new Promise<void>((resolve, reject) => {
    const settle = (error?: Error) => {
      element.removeEventListener(name, onDone)
      element.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onDone = () => settle()
    const onError = () => settle(new Error('A source clip failed to load for the frame snapshot.'))
    element.addEventListener(name, onDone, { once: true })
    element.addEventListener('error', onError, { once: true })
    arm()
  })

/**
 * Composes the timeline's frame at `sequenceTime` and returns it as a PNG
 * blob at the output resolution. Throws on an empty timeline, on the
 * color-filter refusal (above), and when a source fails to load.
 */
export async function snapshotTimelineFrame(
  timeline: TimelineState,
  sequenceTime: number,
  options: SnapshotOptions = {},
): Promise<Blob> {
  const location = locateInSequence(timeline, sequenceTime)
  if (location === null) {
    throw new Error('The timeline is empty — add clips before saving a frame.')
  }
  const createVideo = options.createVideo ?? (() => document.createElement('video'))
  const createImage = options.createImage ?? (() => new Image())
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))

  const { width, height } = options.frame ?? (await automaticExportFrame(timeline))
  const canvas = createCanvas()
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new ExportUnsupportedError('This browser cannot draw canvas graphics.')
  }
  // The export's color-adjustment refusal (#195): a frame the preview shows
  // adjusted must never save unadjusted — fail loudly instead, and only when
  // the timeline actually carries an adjustment.
  if (timelineHasColorAdjustments(timeline) && !canvasSupportsColorFilter(context)) {
    throw new ExportUnsupportedError(
      'This browser cannot render color adjustments when saving a frame (canvas filters are ' +
        'unsupported). Reset the color adjustments, or save from a browser that supports canvas filters.',
    )
  }

  const videos: HTMLVideoElement[] = []
  /** Loads a video and settles it on `sourceTime` — the export's cue, awaited. */
  const cueVideo = async (url: string, sourceTime: number): Promise<HTMLVideoElement> => {
    const element = createVideo()
    element.preload = 'auto'
    element.muted = true
    element.playsInline = true
    videos.push(element)
    // Armed before src is set so the load's first presentation cannot be
    // missed (#276) — the no-seek path's presentation signal.
    const firstFramePresented = armPresentedFrame(element)
    await afterEvent(element, 'loadedmetadata', () => {
      element.src = url
    })
    if (Math.abs(element.currentTime - sourceTime) > 0.001) {
      // Armed immediately before the seek is issued: the awaited frame is
      // the sought one, presented — `seeked` alone fires before
      // presentation, the window where the draw could rasterize black.
      const soughtFramePresented = armPresentedFrame(element)
      await afterEvent(element, 'seeked', () => {
        element.currentTime = sourceTime
      })
      await soughtFramePresented()
      return element
    }
    if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Cued to its existing position (e.g. 0): no seek fires, but the first
      // frame may not be decoded yet — wait for it rather than drawing black.
      await afterEvent(element, 'loadeddata', () => {})
    }
    await firstFramePresented()
    return element
  }
  const loadStill = async (url: string): Promise<HTMLImageElement> => {
    const image = createImage()
    await afterEvent(image, 'load', () => {
      image.src = url
    })
    return image
  }
  const release = () => {
    for (const element of videos) {
      element.removeAttribute('src')
      element.load()
    }
  }

  try {
    // Every layer visible at this instant, cued to the source time the
    // shared playback rule resolves (remap-aware; a transition overlap
    // exposes the incoming entry with its own source time and progress).
    const stillSources = new Map<string, HTMLImageElement>()
    const cueEntryLayer = async (
      entry: (typeof timeline.entries)[number],
      sourceTime: number,
    ): Promise<'still' | HTMLVideoElement> => {
      if (isStillEntry(entry)) {
        if (entry.kind === 'image' && !stillSources.has(entry.url)) {
          stillSources.set(entry.url, await loadStill(entry.url))
        }
        return 'still'
      }
      return await cueVideo(entry.url, sourceTime)
    }

    const baseCued = await cueEntryLayer(location.entry, location.sourceTime)
    const incomingCued =
      location.transition !== undefined
        ? await cueEntryLayer(location.transition.entry, location.transition.sourceTime)
        : null

    // Overlay video layers active now (#146), each settled on its own
    // sequence-anchored source time — the same mapping the export's
    // per-frame sync drives its replay elements to.
    const overlayReplays: { overlay: VideoOverlay; element: HTMLVideoElement }[] = []
    for (const overlay of activeVideoOverlays(timeline, sequenceTime)) {
      overlayReplays.push({
        overlay,
        element: await cueVideo(overlay.url, audioTrackPlaybackAt(overlay, sequenceTime).sourceTime),
      })
    }

    const { drawFrame, videoFrame, stillFrame } = createFrameComposer({
      context,
      width,
      height,
      timeline,
      stillSources,
      overlayReplays,
      // The blur backdrop's buffer (#260) rides the same injectable.
      createCanvas,
    })
    const baseLayer: LayerFrame =
      baseCued === 'still' ? stillFrame(location.entry, location.sourceTime) : videoFrame(baseCued)
    let overlayFrame: OverlayFrame | null = null
    if (location.transition !== undefined && incomingCued !== null) {
      overlayFrame = {
        layer:
          incomingCued === 'still'
            ? stillFrame(location.transition.entry, location.transition.sourceTime)
            : videoFrame(incomingCued),
        index: location.transition.index,
        type: location.transition.type,
        progress: location.transition.progress,
      }
    }
    drawFrame(baseLayer, location.index, sequenceTime, overlayFrame)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob !== null
            ? resolve(blob)
            : reject(new ExportUnsupportedError('This browser could not encode the frame as a PNG.')),
        'image/png',
      )
    })
  } finally {
    release()
  }
}
