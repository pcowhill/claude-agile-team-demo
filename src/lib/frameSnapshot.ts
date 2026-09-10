import {
  ExportUnsupportedError,
  activeVideoOverlays,
  canvasSupportsColorFilter,
  createFrameComposer,
  timelineHasColorAdjustments,
} from './exportVideo'
import type { LayerFrame, OverlayFrame } from './exportVideo'
import { automaticExportFrame, probeSourceDimensions } from './exportSettings'
import { audioTrackPlaybackAt, locateInSequence } from './playback'
import { isImageOverlay, isStillEntry } from './timeline'
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
 *
 * One call loads, cues, draws and releases — right for Save frame, which
 * asks once. The visual editors (#413) ask once per slider stop, and paid
 * for it (#458: 1–2 s a frame, every source reloaded from scratch each
 * time). A caller like that opens a `SnapshotSession` and passes it in
 * `options.session`: the session keeps every element it loaded and the
 * probed output frame across calls, so a later instant is a seek on an
 * already-loaded element rather than a load, and releases them all at once
 * when the caller is done. Renders sharing a session run one at a time,
 * because they share its elements.
 */

/** Download filename for a frame snapshot, derived from the sequence time. */
export function frameFileName(sequenceTime: number): string {
  return `sequence-frame-${Math.max(0, sequenceTime).toFixed(2)}s.png`
}

export interface SnapshotOptions {
  /**
   * Output frame override — the export modal's rule (#179). Absent means the
   * automatic rule: `automaticExportFrame`, the exact frame an export of
   * this timeline would derive (per-entry, oriented, composed with the
   * project's canvas preset #274).
   */
  frame?: SourceDimensions
  /**
   * A session to draw from and load into (#458). Elements the render loads
   * stay loaded in the session for the next call instead of being released
   * when the frame is drawn; see `createSnapshotSession`. Absent means the
   * one-shot behaviour: load, draw, release.
   */
  session?: SnapshotSession
  /** Injectable for tests (jsdom never fires media events). */
  createVideo?: () => HTMLVideoElement
  /** Injectable for tests (jsdom never fires image load events). */
  createImage?: () => HTMLImageElement
  /** Injectable for tests (jsdom has no canvas rendering). */
  createCanvas?: () => HTMLCanvasElement
}

/**
 * What a run of snapshots shares (#458): the elements loaded so far, the
 * dimensions probed so far, and the canvas. Opaque to callers — they create
 * one, pass it in `options.session`, and release it.
 */
export interface SnapshotSession {
  /**
   * Releases every element the session loaded and forgets what it probed.
   * A render passed a released session behaves as a one-shot: it loads what
   * it needs and releases it again when drawn.
   */
  release(): void
}

interface SessionState {
  /**
   * Loaded videos by source URL. A list, not one element, because one frame
   * can draw the same source twice — a transition between two entries cut
   * from one clip — and a cued element cannot be at two times at once.
   */
  videos: Map<string, HTMLVideoElement[]>
  /** Decoded stills by URL — the composer's `stillSources`, kept across calls. */
  images: Map<string, HTMLImageElement>
  /** `probeSourceDimensions` results by URL; a source's size does not change. */
  probes: Map<string, Promise<SourceDimensions | null>>
  canvas: HTMLCanvasElement | null
  /** The render in progress: the next one waits for it, since they share elements. */
  queue: Promise<unknown>
  released: boolean
}

const sessionStates = new WeakMap<SnapshotSession, SessionState>()

const releaseVideo = (element: HTMLVideoElement) => {
  element.removeAttribute('src')
  element.load()
}

/** Opens a snapshot session (#458); see `SnapshotOptions.session`. */
export function createSnapshotSession(): SnapshotSession {
  const state: SessionState = {
    videos: new Map(),
    images: new Map(),
    probes: new Map(),
    canvas: null,
    queue: Promise.resolve(),
    released: false,
  }
  const session: SnapshotSession = {
    release() {
      state.released = true
      for (const pool of state.videos.values()) {
        for (const element of pool) releaseVideo(element)
      }
      state.videos.clear()
      state.images.clear()
      state.probes.clear()
      state.canvas = null
    },
  }
  sessionStates.set(session, state)
  return session
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
 *
 * With `options.session`, renders queue behind one another — the session's
 * elements are shared, and a seek issued while another render awaits its
 * own would settle the wrong one.
 */
export function snapshotTimelineFrame(
  timeline: TimelineState,
  sequenceTime: number,
  options: SnapshotOptions = {},
): Promise<Blob> {
  const state = options.session === undefined ? undefined : sessionStates.get(options.session)
  if (state === undefined || state.released) {
    return renderFrame(timeline, sequenceTime, options, null)
  }
  const run = state.queue.then(() => renderFrame(timeline, sequenceTime, options, state))
  // The queue only sequences; a failed render must not fail the ones after.
  state.queue = run.catch(() => undefined)
  return run
}

async function renderFrame(
  timeline: TimelineState,
  sequenceTime: number,
  options: SnapshotOptions,
  state: SessionState | null,
): Promise<Blob> {
  const location = locateInSequence(timeline, sequenceTime)
  if (location === null) {
    throw new Error('The timeline is empty — add clips before saving a frame.')
  }
  const createVideo = options.createVideo ?? (() => document.createElement('video'))
  const createImage = options.createImage ?? (() => new Image())
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))

  // The probe is per source and a source's size never changes, so a session
  // answers it once per URL; the composition over the probes stays live, so
  // a crop, turn or preset changed while the session is open still counts.
  const probe: typeof probeSourceDimensions =
    state === null
      ? probeSourceDimensions
      : (url, still) => {
          let probed = state.probes.get(url)
          if (probed === undefined) {
            probed = probeSourceDimensions(url, still)
            state.probes.set(url, probed)
          }
          return probed
        }
  const { width, height } = options.frame ?? (await automaticExportFrame(timeline, probe))
  const canvas = state?.canvas ?? createCanvas()
  if (state !== null) state.canvas = canvas
  // Assigning the size clears the bitmap, which a reused canvas needs.
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

  /** Elements this render loaded for itself — released when it is drawn. */
  const owned: HTMLVideoElement[] = []
  /** How many elements of each URL this render has taken from the session. */
  const taken = new Map<string, number>()
  /**
   * The element to cue for `url`: a fresh one when there is no session, or
   * the session's next unused one for that URL — the second layer drawing
   * the same source in one frame gets a second element, loaded then and kept
   * like the first.
   */
  const acquireVideo = (url: string): { element: HTMLVideoElement; fresh: boolean } => {
    if (state === null) {
      const element = createVideo()
      owned.push(element)
      return { element, fresh: true }
    }
    const pool = state.videos.get(url) ?? []
    const index = taken.get(url) ?? 0
    taken.set(url, index + 1)
    if (index < pool.length) return { element: pool[index], fresh: false }
    const element = createVideo()
    pool.push(element)
    state.videos.set(url, pool)
    return { element, fresh: true }
  }
  /** A source that failed leaves the session, so the next render retries with a fresh load. */
  const evictVideo = (url: string, element: HTMLVideoElement) => {
    if (state === null) return
    const pool = state.videos.get(url)
    if (pool === undefined) return
    const index = pool.indexOf(element)
    if (index !== -1) pool.splice(index, 1)
    if (pool.length === 0) state.videos.delete(url)
    releaseVideo(element)
  }
  /** Loads a video and settles it on `sourceTime` — the export's cue, awaited. */
  const cueVideo = async (url: string, sourceTime: number): Promise<HTMLVideoElement> => {
    const { element, fresh } = acquireVideo(url)
    try {
      let firstFramePresented: (() => Promise<void>) | null = null
      if (fresh) {
        element.preload = 'auto'
        element.muted = true
        element.playsInline = true
        // Armed before src is set so the load's first presentation cannot be
        // missed (#276) — the no-seek path's presentation signal.
        firstFramePresented = armPresentedFrame(element)
        await afterEvent(element, 'loadedmetadata', () => {
          element.src = url
        })
      }
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
      // A session element already at this instant with its frame decoded and
      // presented on an earlier render has nothing to wait for.
      if (firstFramePresented !== null) await firstFramePresented()
      return element
    } catch (error) {
      evictVideo(url, element)
      throw error
    }
  }
  const loadStill = async (url: string): Promise<HTMLImageElement> => {
    const image = createImage()
    await afterEvent(image, 'load', () => {
      image.src = url
    })
    return image
  }
  const release = () => {
    for (const element of owned) releaseVideo(element)
  }

  try {
    // Every layer visible at this instant, cued to the source time the
    // shared playback rule resolves (remap-aware; a transition overlap
    // exposes the incoming entry with its own source time and progress).
    //
    // The still map is the session's own when there is one, so a decoded
    // image is decoded once per session; the composer looks stills up by
    // URL, so an image not drawn this time costs it nothing.
    const stillSources = state?.images ?? new Map<string, HTMLImageElement>()
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

    // Overlay layers active now (#146), each settled on its own
    // sequence-anchored source time — the same mapping the export's
    // per-frame sync drives its replay elements to.
    //
    // A still overlay (#294/#295) has no source time and no element: it
    // decodes into the shared `stillSources` map instead, exactly as a still
    // entry does above. Cueing one as a <video> would hang the snapshot on a
    // source that can never load, which is why the kind is branched here and
    // not left to the composer.
    const overlayReplays: { overlay: VideoOverlay; element: HTMLVideoElement }[] = []
    for (const overlay of activeVideoOverlays(timeline, sequenceTime)) {
      if (isImageOverlay(overlay)) {
        if (!stillSources.has(overlay.url)) {
          stillSources.set(overlay.url, await loadStill(overlay.url))
        }
        continue
      }
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
