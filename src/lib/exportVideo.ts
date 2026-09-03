import type {
  AudioTrack,
  ColorAdjustments,
  RemapEffect,
  TextOverlay,
  TimelineEntry,
  TimelineState,
  TransitionType,
  VideoOverlay,
} from './timeline'
import { colorFilterFor } from './colorAdjustments'
import {
  audioTracksOf,
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  isSlateEntry,
  isStillEntry,
  remapsForEntry,
  remapsOf,
  textsOf,
  totalDuration,
  videoOverlaysOf,
} from './timeline'
import { TEXT_LINE_HEIGHT, textActiveAt, textFontStack, textOpacityAt } from './textOverlay'
import { outputTimeAtSource, rateAtSourceTime, remapPlaybackAt } from './remap'
import { audioTrackPlaybackAt, entryStartTime } from './playback'
import {
  audioTrackGainAt,
  duckFactorAt,
  duckWindows,
  trackDuckFactorAt,
  videoEntryGain,
  videoEntryGainAt,
  videoOverlayGainAt,
} from './gain'
import { orientationTransform, orientedDimensions } from './orientation'
import type { Orientation } from './orientation'
import { croppedDimensions, cropSourceRect } from './crop'
import type { Crop } from './crop'
import { BACKDROP_BUFFER_WIDTH, backdropBlurRadius, backdropRect } from './backgroundFill'
import type { BackgroundFill } from './backgroundFill'
import { transitionLayerSpec } from './transitionRender'
import { outputFrameSize } from './frameSize'
import type { SourceDimensions } from './frameSize'
import { zoomAt } from './zoom'
import type { ZoomState } from './zoom'

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

/**
 * MP4 preference order (#114): H.264 (avc1) is the mainstream plays-anywhere
 * codec, with AAC (mp4a) then Opus audio. The bare container type comes last
 * so browsers that record MP4 but not H.264 (Chromium builds without
 * proprietary codecs record VP9/Opus into the MP4 container) still export a
 * genuine MP4 rather than none at all.
 */
export const EXPORT_MP4_MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
]

export const EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4',
]

/**
 * The container an export records into: the MIME candidates the recorder
 * may use and the label failures name. The registered export formats
 * (`exportFormats.ts`, #196) supply one per format; the pipeline itself
 * knows no format list.
 */
export interface ExportContainer {
  /** Human-readable name, used in error messages. */
  label: string
  candidates: readonly string[]
  candidatesWithAudio: readonly string[]
}

/** The default container: WebM, the one MediaRecorder records everywhere. */
export const WEBM_CONTAINER: ExportContainer = {
  label: 'WebM',
  candidates: EXPORT_MIME_CANDIDATES,
  candidatesWithAudio: EXPORT_MIME_CANDIDATES_WITH_AUDIO,
}

/**
 * Audio-only preference order (#245): Opus in WebM — the audio half of the
 * default video container, recordable wherever WebM video is. The recording
 * always carries audio (an audio-only export without audio is refused), so
 * both candidate roles use this one list.
 */
export const EXPORT_AUDIO_MIME_CANDIDATES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
]

/** The audio-only container (#245): the project's mixed soundtrack alone. */
export const AUDIO_WEBM_CONTAINER: ExportContainer = {
  label: 'WebM audio',
  candidates: EXPORT_AUDIO_MIME_CANDIDATES,
  candidatesWithAudio: EXPORT_AUDIO_MIME_CANDIDATES,
}

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

/**
 * Maps a frame-space rectangle through a zoom (#65): scale about the zoom's
 * centre so that the visible region — the frame divided by `scale`, centred
 * on (`centerX`, `centerY`) — lands exactly on the frame edges. Formally each
 * frame fraction p maps to 0.5 + scale·(p − centre) per axis: the same
 * mapping the preview's CSS transform applies (#64), with all easing already
 * baked into the ZoomState by zoomAt (#63). One uniform scale multiplies
 * both axes, so the rectangle's aspect ratio is preserved by construction,
 * and because the reducer clamps the centre to keep the region inside the
 * frame, mapping the full frame always covers the full frame — nothing
 * beyond a frame edge is ever pulled into view.
 */
export function zoomRect(
  rect: FitRect,
  zoom: ZoomState,
  frameWidth: number,
  frameHeight: number,
): FitRect {
  const { scale, centerX, centerY } = zoom
  return {
    x: frameWidth / 2 + scale * (rect.x - centerX * frameWidth),
    y: frameHeight / 2 + scale * (rect.y - centerY * frameHeight),
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/**
 * Scales a frame-space rectangle about the frame centre (#181): a cross-zoom
 * magnifies a whole transition layer — card and fitted clip together — the
 * way the preview's outermost CSS `scale()` (transform-origin centre) does.
 * Scale 1 returns the rect unchanged (same object), so every non-cross-zoom
 * draw is untouched.
 */
export function scaleRectAboutCenter(
  rect: FitRect,
  scale: number,
  frameWidth: number,
  frameHeight: number,
): FitRect {
  if (scale === 1) return rect
  return {
    x: frameWidth / 2 + scale * (rect.x - frameWidth / 2),
    y: frameHeight / 2 + scale * (rect.y - frameHeight / 2),
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/**
 * Where an overlay video layer's frame lands on the export canvas (#146),
 * in pixels. The placement rectangle resolves exactly as the preview's
 * stage positioning (#145): `x`/`y`/`width`/`height` are fractions of the
 * whole output frame. The clip then letterboxes *within* that rectangle
 * (aspect preserved — the preview's `object-fit: contain`), so the returned
 * rect is the drawn picture itself; the gutters are simply not drawn,
 * leaving the base composition visible — the transparent-gutter rule.
 */
export function overlayDestRect(
  overlay: VideoOverlay,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): FitRect {
  const left = overlay.x * frameWidth
  const top = overlay.y * frameHeight
  const fitted = fitRect(
    sourceWidth,
    sourceHeight,
    overlay.width * frameWidth,
    overlay.height * frameHeight,
  )
  return { x: left + fitted.x, y: top + fitted.y, width: fitted.width, height: fitted.height }
}

/**
 * The overlay video layers covering `sequenceTime`, in add order — the
 * stacking order (#145): a later overlay draws on top of an earlier one,
 * exactly as the preview's later DOM sibling paints on top. The window
 * math is the audio-track helper the preview uses (offset + trim,
 * half-open), applied structurally.
 */
export function activeVideoOverlays(
  timeline: TimelineState,
  sequenceTime: number,
): VideoOverlay[] {
  return videoOverlaysOf(timeline).filter(
    (overlay) => audioTrackPlaybackAt(overlay, sequenceTime).shouldPlay,
  )
}

/**
 * One text overlay resolved against a concrete canvas resolution (#142) —
 * everything `fillText` needs, in pixels. The resolution rules are the
 * preview's exactly (#139): the type size is the overlay's `size` fraction of
 * the frame **height** (width plays no part), the block's centre sits on
 * (`x`·width, `y`·height), only explicit newlines break lines, each line is
 * centred horizontally, and lines are TEXT_LINE_HEIGHT type-sizes apart —
 * so the same overlay occupies the same frame fractions over the preview
 * stage and the export canvas, whatever their pixel sizes.
 */
export interface TextDraw {
  /** The content, split on its explicit newlines — one fillText call each. */
  lines: readonly string[]
  /** Canvas font shorthand: style, weight, px size, the curated stack. */
  font: string
  color: string
  /** Canvas x of every line's centre, px (lines centre horizontally). */
  x: number
  /** Canvas y of the first line's centre, px (textBaseline 'middle'). */
  firstLineY: number
  /** Distance between adjacent line centres, px. */
  lineHeight: number
  /** Fade envelope value at the draw's instant (#177) — the globalAlpha. */
  opacity: number
}

/**
 * Resolves one overlay's draw parameters against a frame size (#142) at a
 * sequence instant — the instant feeds the fade envelope (#177), computed by
 * the same `textOpacityAt` the preview sets as CSS opacity.
 */
export function textDraw(
  text: TextOverlay,
  frameWidth: number,
  frameHeight: number,
  sequenceTime: number,
): TextDraw {
  const size = text.size * frameHeight
  const lineHeight = size * TEXT_LINE_HEIGHT
  const lines = text.content.split('\n')
  return {
    lines,
    // The weight is always spelled out: canvas font parsing rejects partial
    // shorthands in some engines, and an explicit string is deterministic.
    font: `${text.italic ? 'italic ' : ''}${text.bold ? 700 : 400} ${size}px ${textFontStack(text.font)}`,
    color: text.color,
    x: text.x * frameWidth,
    // The block of n lines is centred on y: its height is n·lineHeight, and
    // the first line's centre sits half of (n−1) line steps above the middle.
    firstLineY: text.y * frameHeight - ((lines.length - 1) * lineHeight) / 2,
    lineHeight,
    opacity: textOpacityAt(text, sequenceTime),
  }
}

/**
 * The overlays to draw on the frame at `sequenceTime`, resolved to draw
 * parameters, in add order — the stacking order (#139): a later overlay's
 * fillText lands on top of an earlier one's, exactly as the preview's later
 * DOM sibling paints on top.
 */
export function activeTextDraws(
  timeline: TimelineState,
  sequenceTime: number,
  frameWidth: number,
  frameHeight: number,
): TextDraw[] {
  return textsOf(timeline)
    .filter((text) => textActiveAt(text, sequenceTime))
    .map((text) => textDraw(text, frameWidth, frameHeight, sequenceTime))
}

/**
 * Whether any entry or video overlay carries color adjustments (#195) —
 * the condition under which the export needs canvas `filter` support at
 * all. An adjustment-free timeline must export exactly as before #195,
 * filter-capable browser or not.
 */
export function timelineHasColorAdjustments(timeline: TimelineState): boolean {
  return (
    timeline.entries.some((entry) => entry.colorAdjustments !== undefined) ||
    videoOverlaysOf(timeline).some((overlay) => overlay.colorAdjustments !== undefined)
  )
}

/**
 * Feature check for canvas 2D `filter` (#195): browsers without support
 * (canvas filters are newer than the rest of the 2D API) expose no `filter`
 * property, and a set that does not stick is equally unusable. Probed by
 * assigning a known-valid filter and reading it back; the context's prior
 * value is restored either way.
 */
export function canvasSupportsColorFilter(context: CanvasRenderingContext2D): boolean {
  if (typeof context.filter !== 'string') return false
  const previous = context.filter
  context.filter = 'grayscale(100%)'
  const supported = context.filter !== 'none' && context.filter !== ''
  context.filter = previous
  return supported
}

/**
 * Runs `draw` with the layer's color adjustments (#195) set as the
 * context's `filter` — the same canonical string the preview sets as the
 * element's CSS filter (`colorFilterFor`, #192/#66 pattern) — and resets
 * the filter afterwards, so the next layer never inherits it. The identity
 * set draws with the context untouched: an unadjusted layer's draw calls
 * are byte-for-byte the pre-#195 ones, whether or not the browser supports
 * canvas filters at all.
 */
export function withLayerColorFilter(
  context: CanvasRenderingContext2D,
  adjustments: ColorAdjustments | undefined,
  draw: () => void,
): void {
  const filter = colorFilterFor(adjustments)
  if (filter === 'none') {
    draw()
    return
  }
  context.filter = filter
  try {
    draw()
  } finally {
    context.filter = 'none'
  }
}

/**
 * Runs `draw` with the context transformed for the layer's orientation
 * (#233) — the same shared rule (`orientationTransform`, #232) the preview
 * maps to a CSS transform, mapped here to the equivalent canvas transform.
 * `dest` is where the *oriented* picture lands on the canvas: the fit of
 * the oriented dimensions after zoom/transition mapping — the preview's
 * layer-card media box. `draw` receives the rectangle to paint the
 * unrotated source pixels into: centred on `dest` and transposed for a
 * quarter turn (the preview's swapped media box — the two letterbox ratios
 * are the same two numbers, so contain-of-rotated equals rotate-of-contained).
 *
 * The transforms compose so the flip applies in the source's own space
 * first, then the rotation — the shared rule's fixed order (a canvas
 * `translate`·`rotate`·`scale` maps drawn content scale-first, exactly as
 * CSS `rotate() scale()` applies right-to-left).
 *
 * The identity orientation calls `draw` with `dest` itself and the context
 * untouched, so an orientation-free layer's draw calls are byte-for-byte
 * the pre-#233 ones.
 */
export function withLayerOrientation(
  context: CanvasRenderingContext2D,
  orientation: Orientation | undefined,
  dest: FitRect,
  draw: (drawRect: FitRect) => void,
): void {
  if (orientation === undefined) {
    draw(dest)
    return
  }
  const { rotation, scaleX, scaleY } = orientationTransform(orientation)
  const swaps = rotation === 90 || rotation === 270
  const drawWidth = swaps ? dest.height : dest.width
  const drawHeight = swaps ? dest.width : dest.height
  context.save()
  try {
    context.translate(dest.x + dest.width / 2, dest.y + dest.height / 2)
    if (rotation !== 0) context.rotate((rotation * Math.PI) / 180)
    if (scaleX !== 1 || scaleY !== 1) context.scale(scaleX, scaleY)
    draw({ x: -drawWidth / 2, y: -drawHeight / 2, width: drawWidth, height: drawHeight })
  } finally {
    context.restore()
  }
}

/**
 * Draws a layer's source pixels into `drawRect`, honoring the layer's crop
 * (#256): a cropped layer draws only its kept source rectangle
 * (`cropSourceRect` — the shared rule from #255, the same geometry the
 * preview clips to), scaled to fill the destination box, whose shape the
 * cropped dimensions already determined upstream of the fit. A crop-free
 * layer keeps the 5-argument draw, so its calls are byte-for-byte the
 * pre-#256 ones.
 */
export function drawLayerSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  crop: Crop | undefined,
  sourceWidth: number,
  sourceHeight: number,
  drawRect: FitRect,
): void {
  if (crop === undefined) {
    context.drawImage(source, drawRect.x, drawRect.y, drawRect.width, drawRect.height)
    return
  }
  const src = cropSourceRect(crop, { width: sourceWidth, height: sourceHeight })
  context.drawImage(
    source,
    src.x,
    src.y,
    src.width,
    src.height,
    drawRect.x,
    drawRect.y,
    drawRect.width,
    drawRect.height,
  )
}

/**
 * One layer of a composited frame: what to draw (a playing <video> replay
 * or a still's <img>, #140), its intrinsic size, and the layer's current
 * source-clip time (the element clock for video, the export's wall clock
 * for a still) — which is what its zoom is evaluated at.
 */
export interface LayerFrame {
  source: CanvasImageSource
  sourceWidth: number
  sourceHeight: number
  time: number
}

/** The incoming clip's frame to composite over the outgoing one, if any. */
export interface OverlayFrame {
  layer: LayerFrame
  /** Timeline index of the incoming entry (owns any zoom on this layer). */
  index: number
  type: TransitionType
  progress: number
}

/**
 * The single-frame composition, factored (#237): everything that turns "the
 * timeline at a sequence time, with these decoded sources" into pixels on
 * the shared canvas — base layer fit/zoom/crop/orientation/color, transition
 * compositing, overlay video layers, text. `exportTimeline` builds one for
 * its real-time loop and the frame snapshot (`frameSnapshot.ts`) builds one
 * for a single instant, so the two can never re-derive composition
 * independently (#66).
 */
export interface FrameComposerOptions {
  context: CanvasRenderingContext2D
  /** Output frame dimensions — the canvas size. */
  width: number
  height: number
  timeline: TimelineState
  /** Decoded <img> per still entry URL (#140). */
  stillSources: ReadonlyMap<string, HTMLImageElement>
  /** One replay element per overlay video layer (#146), in add order. */
  overlayReplays: readonly { overlay: VideoOverlay; element: HTMLVideoElement }[]
  /** Injectable for tests (jsdom has no canvas rendering) — creates the
   * composition's off-screen buffers: the blur backdrop's downscaled buffer
   * (#260) and an overlay layer's last-frame stand-in (#319). */
  createCanvas?: () => HTMLCanvasElement
}

export interface FrameComposer {
  drawFrame: (
    layer: LayerFrame,
    entryIndex: number,
    sequenceTime: number,
    overlay?: OverlayFrame | null,
  ) => void
  videoFrame: (element: HTMLVideoElement) => LayerFrame
  stillFrame: (entry: TimelineEntry, time: number) => LayerFrame
}

export function createFrameComposer(options: FrameComposerOptions): FrameComposer {
  const { context, width, height, timeline, stillSources, overlayReplays } = options
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))

  const videoFrame = (element: HTMLVideoElement): LayerFrame => ({
    source: element,
    sourceWidth: element.videoWidth,
    sourceHeight: element.videoHeight,
    time: element.currentTime,
  })

  /**
   * A full-frame canvas per slate color (#143), created on first use. Sized
   * to the output frame so fitRect fills it edge to edge — a slate is the
   * whole picture, never letterboxed — while flowing through the same
   * LayerFrame draw path (transitions, slides, zooms) as every other source.
   */
  const slateSources = new Map<string, HTMLCanvasElement>()
  const slateSource = (color: string): HTMLCanvasElement => {
    const existing = slateSources.get(color)
    if (existing !== undefined) return existing
    const slate = document.createElement('canvas')
    slate.width = width
    slate.height = height
    const slateContext = slate.getContext('2d')
    if (slateContext === null) {
      // The main canvas's 2d context was already verified above; a browser
      // that granted one and refuses another is not a real case, but never
      // draw nothing silently.
      throw new ExportUnsupportedError('This browser cannot draw canvas graphics.')
    }
    slateContext.fillStyle = color
    slateContext.fillRect(0, 0, width, height)
    slateSources.set(color, slate)
    return slate
  }

  const stillFrame = (entry: TimelineEntry, time: number): LayerFrame => {
    if (isSlateEntry(entry)) {
      return { source: slateSource(entry.color as string), sourceWidth: width, sourceHeight: height, time }
    }
    const image = stillSources.get(entry.url) as HTMLImageElement
    return {
      source: image,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      time,
    }
  }

  /**
   * The blur backdrop's downscaled scratch buffer (#260), created on first
   * use — a fill-free timeline never touches it. The same fixed buffer
   * width the preview samples into (#259, `BACKDROP_BUFFER_WIDTH`), so both
   * renderers blur a copy of identical resolution; the buffer mirrors the
   * frame's aspect, so stretching it over the card never distorts.
   */
  let backdropBuffer: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null =
    null
  /**
   * Whether this context's `filter` works, probed on the first blur draw
   * (canvas filter support is one feature — the #195 color probe answers
   * for blur too). Where it doesn't, the backdrop degrades visibly to the
   * unblurred downscaled copy (#260) — its 192px buffer stretched over the
   * frame is already soft — rather than refusing or silently drawing wrong
   * geometry; the picture and placement stay the preview's.
   */
  let backdropBlurSupported: boolean | null = null

  /**
   * An entry's background-fill backdrop (#260): what the preview renders as
   * the layer card's first child (#259), drawn here under the fitted media.
   * The backdrop is the card's own face — the full frame mapped through the
   * same zoom and transition scale/offset chain the fitted media rides — so
   * it moves, scales, and fades with its entry exactly as the preview's
   * card-child backdrop does. A fitted picture already covering the frame
   * leaves no bars to fill: matching-aspect entries draw no backdrop at
   * all, keeping their frames byte-identical to fill-free ones.
   */
  const drawLayerBackdrop = (
    fill: BackgroundFill | undefined,
    layer: LayerFrame,
    crop: Crop | undefined,
    orientation: Orientation | undefined,
    fitted: FitRect,
    zoom: ZoomState,
    transitionScale: number,
    offsetX: number,
    offsetY: number,
  ) => {
    if (fill === undefined) return
    if (fitted.width >= width - 0.001 && fitted.height >= height - 0.001) return
    const frameRect = { x: 0, y: 0, width, height }
    const zoomedCard = zoom.scale === 1 ? frameRect : zoomRect(frameRect, zoom, width, height)
    const card = scaleRectAboutCenter(zoomedCard, transitionScale, width, height)
    const dest = { x: card.x + offsetX, y: card.y + offsetY, width: card.width, height: card.height }
    if (fill.kind === 'color') {
      context.fillStyle = fill.color
      context.fillRect(dest.x, dest.y, dest.width, dest.height)
      return
    }
    // A source with no decodable dimensions has no picture to blur; the
    // frame's own black stays, exactly as the preview's not-ready skip.
    if (layer.sourceWidth <= 0 || layer.sourceHeight <= 0) return
    if (backdropBuffer === null) {
      const buffer = createCanvas()
      const bufferContext = buffer.getContext('2d')
      if (bufferContext === null) {
        // The main canvas's 2d context was already verified; a browser that
        // granted one and refuses another is not a real case, but never
        // draw nothing silently.
        throw new ExportUnsupportedError('This browser cannot draw canvas graphics.')
      }
      backdropBuffer = { canvas: buffer, context: bufferContext }
    }
    const { canvas: buffer, context: bufferContext } = backdropBuffer
    const bufferHeight = Math.max(1, Math.round((BACKDROP_BUFFER_WIDTH * height) / width))
    if (buffer.width !== BACKDROP_BUFFER_WIDTH) buffer.width = BACKDROP_BUFFER_WIDTH
    if (buffer.height !== bufferHeight) buffer.height = bufferHeight
    // The buffer composes exactly as the preview's backdrop canvas (#259):
    // the shared crop rule then orientation, into the shared cover-fit
    // overscan rectangle — the same picture, at the same buffer resolution.
    const dims = orientedDimensions(
      croppedDimensions({ width: layer.sourceWidth, height: layer.sourceHeight }, crop),
      orientation,
    )
    const rect = backdropRect(dims, { width: BACKDROP_BUFFER_WIDTH, height: bufferHeight })
    withLayerOrientation(bufferContext, orientation, rect, (drawRect) => {
      drawLayerSource(
        bufferContext,
        layer.source,
        crop,
        layer.sourceWidth,
        layer.sourceHeight,
        drawRect,
      )
    })
    if (backdropBlurSupported === null) {
      backdropBlurSupported = canvasSupportsColorFilter(context)
    }
    if (backdropBlurSupported) {
      // The shared strength (#259): the blur fraction of the drawn card's
      // shorter side — the frame's when unzoomed, scaling with the card
      // under zooms and cross-zooms exactly as the preview's CSS transform
      // scales its rendered blur. An incoming transition layer's backdrop
      // draws inside its entry's color filter (#218): the blur composes
      // BEFORE that filter (canvas filter lists apply left to right — the
      // preview's card filter wraps the already-blurred backdrop child),
      // and the active filter is restored afterwards, never wiped — the
      // media drawn next still carries its color adjustments.
      const previous = context.filter
      const blur = `blur(${backdropBlurRadius({ width: dest.width, height: dest.height })}px)`
      context.filter = previous === 'none' || previous === '' ? blur : `${blur} ${previous}`
      try {
        context.drawImage(buffer, dest.x, dest.y, dest.width, dest.height)
      } finally {
        context.filter = previous
      }
    } else {
      context.drawImage(buffer, dest.x, dest.y, dest.width, dest.height)
    }
  }

  /**
   * The last picture each overlay replay element supplied (#319).
   *
   * `drawImage` of a media element below `HAVE_CURRENT_DATA` draws nothing,
   * so the export used to skip such a layer for that frame — deleting it
   * from the output and letting the base show through, which is what the
   * customer saw as a color slate covering an overlay for a frame (#317).
   * The preview cannot exhibit that: its overlay is a real <video> in the
   * DOM, and a browser keeps displaying the last decoded frame while an
   * element seeks or re-buffers. Holding a copy of that same last frame is
   * what makes the canvas composition behave the way the DOM already does.
   *
   * Keyed by element, so a layer's stand-in follows its own replay element
   * and is re-made if the source's intrinsic size ever changes.
   */
  const overlayStandIns = new Map<
    HTMLVideoElement,
    { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
  >()

  /**
   * What to draw for an overlay layer this frame, with the intrinsic size to
   * measure its crop and placement against: the element itself while it can
   * supply a picture, otherwise the last one it did. Null only for an
   * element that has never decoded a frame — there is nothing truthful to
   * draw then, and skipping remains right.
   */
  const overlayPicture = (
    element: HTMLVideoElement,
  ): { source: CanvasImageSource; width: number; height: number } | null => {
    if (
      element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      element.videoWidth > 0 &&
      element.videoHeight > 0
    ) {
      // Refresh the stand-in from the frame about to be drawn, so the next
      // frame the element cannot supply one has the true previous picture
      // rather than a stale or empty one.
      let standIn = overlayStandIns.get(element)
      if (
        standIn === undefined ||
        standIn.canvas.width !== element.videoWidth ||
        standIn.canvas.height !== element.videoHeight
      ) {
        const canvas = createCanvas()
        canvas.width = element.videoWidth
        canvas.height = element.videoHeight
        const standInContext = canvas.getContext('2d')
        // A browser that granted the output canvas a 2d context and refuses
        // another is not a real case; draw the live element and carry no
        // stand-in rather than failing an export over the fallback path.
        if (standInContext === null) {
          return {
            source: element,
            width: element.videoWidth,
            height: element.videoHeight,
          }
        }
        standIn = { canvas, context: standInContext }
        overlayStandIns.set(element, standIn)
      }
      standIn.context.drawImage(element, 0, 0, standIn.canvas.width, standIn.canvas.height)
      return { source: element, width: element.videoWidth, height: element.videoHeight }
    }
    const standIn = overlayStandIns.get(element)
    if (standIn === undefined) return null
    return {
      source: standIn.canvas,
      width: standIn.canvas.width,
      height: standIn.canvas.height,
    }
  }

  const drawFrame = (
    layer: LayerFrame,
    entryIndex: number,
    sequenceTime: number,
    overlay: OverlayFrame | null = null,
  ) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const spec = overlay !== null ? transitionLayerSpec(overlay.type, overlay.progress) : null
    // The entry's orientation (#233): the fit sees the oriented shape — a
    // quarter-turned clip letterboxes like a portrait source — and the draw
    // below rotates/flips the source pixels into that box, exactly the
    // preview's card/media split (#232). Slates never carry one (#232).
    const outgoingOrientation = timeline.entries[entryIndex]?.orientation
    // The entry's crop (#256): the fit sees the kept region's shape — crop
    // before orientation, the shared rule's fixed order (#255) — and the
    // draw below paints only the kept source rectangle into that box.
    const outgoingCrop = timeline.entries[entryIndex]?.crop
    const outgoingDims = orientedDimensions(
      croppedDimensions({ width: layer.sourceWidth, height: layer.sourceHeight }, outgoingCrop),
      outgoingOrientation,
    )
    const rect = fitRect(outgoingDims.width, outgoingDims.height, width, height)
    // Each layer's zoom (#65) at its own source time: applied per layer,
    // before the transition compositing, so a zoomed clip can be either side
    // of a transition. The identity zoom leaves the fitted rect untouched —
    // a zoomless timeline draws exactly as before.
    const zoom = zoomAt(timeline, entryIndex, layer.time)
    const zoomed = zoom.scale === 1 ? rect : zoomRect(rect, zoom, width, height)
    // Cross-zoom (#181) scales the outgoing layer about the frame centre —
    // the same outermost scale the preview's transform applies. Scale 1 (all
    // other types) leaves the rect untouched.
    const dest = scaleRectAboutCenter(zoomed, spec?.outgoingScale ?? 1, width, height)
    context.globalAlpha = spec?.outgoingAlpha ?? 1
    // The entry's background fill (#260) draws under its fitted media,
    // outside the color filter below — the preview's base-layer filter
    // applies to the media element alone, not its backdrop sibling (#259).
    drawLayerBackdrop(
      timeline.entries[entryIndex]?.backgroundFill,
      layer,
      outgoingCrop,
      outgoingOrientation,
      rect,
      zoom,
      spec?.outgoingScale ?? 1,
      (spec?.outgoingOffsetXFraction ?? 0) * width,
      (spec?.outgoingOffsetYFraction ?? 0) * height,
    )
    // Pushes (#181) move the outgoing layer off the frame; every other type
    // has zero outgoing offsets, drawing exactly as before.
    // The entry's color adjustments (#195): the same canonical filter string
    // the preview sets as the element's CSS filter (#192), applied to
    // exactly this layer's draw.
    withLayerColorFilter(context, timeline.entries[entryIndex]?.colorAdjustments, () => {
      withLayerOrientation(
        context,
        outgoingOrientation,
        {
          x: dest.x + (spec?.outgoingOffsetXFraction ?? 0) * width,
          y: dest.y + (spec?.outgoingOffsetYFraction ?? 0) * height,
          width: dest.width,
          height: dest.height,
        },
        (drawRect) => {
          drawLayerSource(
            context,
            layer.source,
            outgoingCrop,
            layer.sourceWidth,
            layer.sourceHeight,
            drawRect,
          )
        },
      )
    })
    if (overlay !== null && spec !== null) {
      // The incoming entry's orientation (#233) and crop (#256), exactly as
      // the outgoing's.
      const incomingOrientation = timeline.entries[overlay.index]?.orientation
      const incomingCrop = timeline.entries[overlay.index]?.crop
      const incomingDims = orientedDimensions(
        croppedDimensions(
          { width: overlay.layer.sourceWidth, height: overlay.layer.sourceHeight },
          incomingCrop,
        ),
        incomingOrientation,
      )
      const incoming = fitRect(incomingDims.width, incomingDims.height, width, height)
      const incomingZoom = zoomAt(timeline, overlay.index, overlay.layer.time)
      const incomingZoomed =
        incomingZoom.scale === 1 ? incoming : zoomRect(incoming, incomingZoom, width, height)
      // Cross-zoom's incoming scale (#181), about the frame centre, applied
      // outside the entry's own zoom — the preview composes its transforms
      // the same way. The card (backing, reveal clip, ellipse) scales with
      // its content, so every card-space region below maps through the same
      // scale-then-offset the fitted clip does.
      const incomingScale = spec.incomingScale
      const incomingDest = scaleRectAboutCenter(incomingZoomed, incomingScale, width, height)
      const card = scaleRectAboutCenter(
        { x: 0, y: 0, width, height },
        incomingScale,
        width,
        height,
      )
      context.globalAlpha = spec.incomingAlpha
      // `lighter` sums the two layers, making the crossfade a true dissolve
      // over the black stage (see transitionLayerSpec).
      context.globalCompositeOperation = spec.additive ? 'lighter' : 'source-over'
      // A zoomed rect reaches beyond the frame; on a backed card that spill
      // must not cover the outgoing clip outside the card's own slice of the
      // frame, so clip to the card region — the same region the preview cuts
      // with clip-path (#64). Unbacked (crossfade) layers spill only past the
      // canvas edges, which clip by themselves.
      const clipToCard = incomingZoom.scale !== 1 && spec.incomingBacking
      // A wipe's reveal rectangle (#181), in the card's own space (equal to
      // frame space while the card is unoffset, travelling with it
      // otherwise) — the same region the preview cuts with clip-path.
      const clipToReveal = spec.incomingClip !== null
      // An iris's reveal ellipse (#181), likewise card-space — the same
      // region the preview masks with a radial gradient.
      const clipToEllipse = spec.incomingEllipse !== null
      if (clipToCard || clipToReveal || clipToEllipse) context.save()
      if (clipToCard) {
        context.beginPath()
        context.rect(
          card.x + spec.incomingOffsetXFraction * width,
          card.y + spec.incomingOffsetYFraction * height,
          card.width,
          card.height,
        )
        context.clip()
      }
      if (spec.incomingClip !== null) {
        // Successive clips intersect, exactly as the preview folds the
        // reveal into the zoom's inset.
        const reveal = scaleRectAboutCenter(
          {
            x: spec.incomingClip.x * width,
            y: spec.incomingClip.y * height,
            width: spec.incomingClip.width * width,
            height: spec.incomingClip.height * height,
          },
          incomingScale,
          width,
          height,
        )
        context.beginPath()
        context.rect(
          reveal.x + spec.incomingOffsetXFraction * width,
          reveal.y + spec.incomingOffsetYFraction * height,
          reveal.width,
          reveal.height,
        )
        context.clip()
      }
      if (spec.incomingEllipse !== null) {
        // The iris (#181): the incoming card paints only inside the centred
        // ellipse (or, inverted, only outside it — the full-frame rect plus
        // the ellipse under the even-odd rule). Radii are fractions of the
        // frame dimensions, matching the preview's radial-gradient mask.
        const { radiusFraction, invert } = spec.incomingEllipse
        context.beginPath()
        if (invert) context.rect(0, 0, width, height)
        context.ellipse(
          width / 2 + spec.incomingOffsetXFraction * width,
          height / 2 + spec.incomingOffsetYFraction * height,
          radiusFraction * incomingScale * width,
          radiusFraction * incomingScale * height,
          0,
          0,
          2 * Math.PI,
        )
        context.clip(invert ? 'evenodd' : 'nonzero')
      }
      // The incoming entry's own color adjustments (#195) cover its whole
      // card — backing included — exactly as the preview's CSS filter covers
      // the element's background along with its pixels (#192/#218).
      withLayerColorFilter(context, timeline.entries[overlay.index]?.colorAdjustments, () => {
        if (spec.incomingBacking) {
          // The incoming layer is a full-frame card (#74): black backing the
          // size of the whole frame, moving with the clip fitted inside it.
          context.fillStyle = '#000'
          context.fillRect(
            card.x + spec.incomingOffsetXFraction * width,
            card.y + spec.incomingOffsetYFraction * height,
            card.width,
            card.height,
          )
        }
        // The incoming entry's background fill (#260), over the backing and
        // under the fitted media — the preview's card stacking (#259). It
        // sits inside this color filter because the preview's incoming
        // filter covers the whole card, children included (#218).
        drawLayerBackdrop(
          timeline.entries[overlay.index]?.backgroundFill,
          overlay.layer,
          incomingCrop,
          incomingOrientation,
          incoming,
          incomingZoom,
          incomingScale,
          spec.incomingOffsetXFraction * width,
          spec.incomingOffsetYFraction * height,
        )
        withLayerOrientation(
          context,
          incomingOrientation,
          {
            x: incomingDest.x + spec.incomingOffsetXFraction * width,
            y: incomingDest.y + spec.incomingOffsetYFraction * height,
            width: incomingDest.width,
            height: incomingDest.height,
          },
          (drawRect) => {
            drawLayerSource(
              context,
              overlay.layer.source,
              incomingCrop,
              overlay.layer.sourceWidth,
              overlay.layer.sourceHeight,
              drawRect,
            )
          },
        )
      })
      if (clipToCard || clipToReveal || clipToEllipse) context.restore()
      context.globalCompositeOperation = 'source-over'
    }
    if (spec !== null && spec.veil !== null) {
      // A fade-through-color's veil (#181): a full-frame color layer above
      // the transition's two clips, beneath overlay video layers and text —
      // the same stacking the preview's veil element has.
      context.globalAlpha = spec.veil.alpha
      context.fillStyle = spec.veil.color
      context.fillRect(0, 0, width, height)
    }
    context.globalAlpha = 1
    // Overlay video layers (#146) composite above the fully composed base
    // frame — the preview's stacking order (#145): base video/still layers
    // (transitions and zooms apply to those), then overlay layers in add
    // order, then text. Each clip letterboxes within its placement rectangle
    // and the gutters are simply not drawn (the base stays visible — the
    // transparent-gutter rule). An element that has never supplied a frame
    // is skipped rather than drawn black, matching the late-engage rule
    // above; one that supplied a frame earlier repeats it (#319).
    const activeOverlays = activeVideoOverlays(timeline, sequenceTime)
    if (activeOverlays.length > 0) {
      for (const { overlay: layer, element } of overlayReplays) {
        if (!activeOverlays.includes(layer)) continue
        // An element that momentarily cannot supply a frame draws the last
        // one it did (#319), so a seek, a re-buffer or a decode stall costs
        // the layer a repeated frame instead of deleting it from the output.
        const picture = overlayPicture(element)
        if (picture === null) continue
        // The overlay's orientation (#233): the oriented shape letterboxes
        // within the placement rectangle — the preview's swapped media box
        // at rectangle scale — and the draw rotates/flips into that box.
        // Its crop (#256) shapes the box first, crop before orientation
        // (#255), and the draw paints only the kept source rectangle.
        const layerDims = orientedDimensions(
          croppedDimensions({ width: picture.width, height: picture.height }, layer.crop),
          layer.orientation,
        )
        const dest = overlayDestRect(layer, layerDims.width, layerDims.height, width, height)
        // The overlay's own color adjustments (#195), independent of the
        // base layers' — exactly the preview's per-element filter (#192).
        withLayerColorFilter(context, layer.colorAdjustments, () => {
          withLayerOrientation(context, layer.orientation, dest, (drawRect) => {
            drawLayerSource(
              context,
              picture.source,
              layer.crop,
              picture.width,
              picture.height,
              drawRect,
            )
          })
        })
      }
    }
    // Text overlays (#142) draw last, above the composed frame — the
    // preview's documented stacking order (#139): video/still layers first
    // (transitions and zooms apply to those), then overlays in add order.
    // An overlay annotates the output frame; it never zooms or slides with a
    // clip, so it is deliberately outside every transform above.
    const texts = activeTextDraws(timeline, sequenceTime, width, height)
    if (texts.length > 0) {
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      for (const text of texts) {
        context.font = text.font
        context.fillStyle = text.color
        // The fade envelope (#177): the same textOpacityAt value the preview
        // sets as CSS opacity, applied as the draw's alpha.
        context.globalAlpha = text.opacity
        text.lines.forEach((line, lineIndex) => {
          context.fillText(line, text.x, text.firstLineY + lineIndex * text.lineHeight)
        })
      }
      context.globalAlpha = 1
    }
  }

  return { drawFrame, videoFrame, stillFrame }
}

/**
 * An alternative destination for the composed frames (#198, ADR 0003): a
 * format that does not encode through MediaRecorder — the GIF plugin is the
 * concrete case — receives every frame the shared pipeline draws, from
 * exactly the same composition (`drawFrame`: transitions, zooms, remaps,
 * overlay layers, text) the WebM/MP4 recording captures, and produces the
 * finished Blob itself. The playback still runs in real time; the sink
 * decides which frames to keep (e.g. sampling down to a GIF-friendly rate).
 * A sink-driven export is soundless by definition — audio capture is
 * skipped — because no sink-based format with sound exists; growing sound
 * support here without a concrete format would violate the ADR 0003
 * scope-creep guard.
 */
export interface ExportFrameSink {
  /**
   * Called once per composed frame with the shared canvas and the frame's
   * sequence time in output seconds. The canvas is reused — read it now,
   * never keep a reference across calls.
   */
  frame: (canvas: HTMLCanvasElement, sequenceTime: number) => void
  /** Called after the sequence has fully played; produces the export. */
  finish: () => Promise<Blob>
}

export interface ExportOptions {
  /** Target container; MIME candidates are picked within it only (#114). */
  container?: ExportContainer
  /**
   * Record only the mixed audio (#245): the recorder gets the audio capture
   * track alone — no canvas video track — so the file is the project's
   * soundtrack in an audio container. The replay/composition loop runs
   * unchanged (it is what drives the mix's gains and timing), and audio
   * capture becomes a requirement: where Web Audio is unavailable the
   * export refuses rather than falling back to video-only.
   */
  audioOnly?: boolean
  /**
   * Frame sink replacing the MediaRecorder capture (#198): when present the
   * pipeline records nothing itself — it hands every composed frame to the
   * sink and returns `sink.finish()`. See {@link ExportFrameSink}.
   */
  sink?: ExportFrameSink
  /** Called with overall progress in [0, 1] while the sequence records. */
  onProgress?: (fraction: number) => void
  /** Aborting rejects the export with ExportCanceledError. */
  signal?: AbortSignal
  /** Frames per second for the recording; EXPORT_FRAME_RATE when absent. */
  frameRate?: number
  /**
   * Output frame override (#179). Absent means the automatic rule — the
   * sources' largest dimensions via `outputFrameSize`. When present, sources
   * letterbox/pillarbox into this frame through the same `fitRect` path, and
   * everything fractional (overlay rectangles, text positions and sizes,
   * zoom centres) resolves against it unchanged.
   */
  frame?: SourceDimensions
  /** Injectable for tests (jsdom never fires media events). */
  createVideo?: () => HTMLVideoElement
  /** Injectable for tests (jsdom never fires media events). */
  createAudio?: () => HTMLAudioElement
  /** Injectable for tests (jsdom never fires image load events). */
  createImage?: () => HTMLImageElement
  /** Injectable for tests (jsdom has no Web Audio). */
  createAudioContext?: () => AudioContext | null
}

/** An audio track to record, plus the teardown for the graph behind it. */
export interface AudioCapture {
  track: MediaStreamTrack
  dispose: () => Promise<void>
}

/**
 * The stream the recorder records (#245), as a pure decision: an audio-only
 * export records the mixed audio track alone — the canvas is never captured,
 * so the file carries no video track — while a video export records the
 * canvas stream with the audio track added when one was captured. The
 * audio-only caller guarantees a track exists (the pipeline refuses an
 * audio-only export without audio capture before reaching here).
 */
export function recorderStream(
  audioOnly: boolean,
  captureCanvas: () => MediaStream,
  audioTrack: MediaStreamTrack | null,
  createStream: (tracks: MediaStreamTrack[]) => MediaStream = (tracks) => new MediaStream(tracks),
): MediaStream {
  if (audioOnly) {
    if (audioTrack === null) {
      throw new ExportUnsupportedError('An audio-only export requires captured audio.')
    }
    return createStream([audioTrack])
  }
  const stream = captureCanvas()
  if (audioTrack !== null) stream.addTrack(audioTrack)
  return stream
}

function defaultAudioContext(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : new AudioContext()
}

/**
 * Routes the replay elements' audio — the video replays and one <audio>
 * element per timeline audio track (#105) — into one MediaStream track that
 * can be recorded alongside the canvas video. All elements feed the same
 * destination, so everything playing at once — two video replays inside a
 * transition overlap, audio tracks over either — reaches the recorder mixed;
 * each element's `volume` attribute still applies on its way into the graph,
 * which is what the export's gain control (crossfades, track fades, mutes)
 * rides on.
 *
 * The graph is deliberately *not* connected to `context.destination`: taking
 * an element's audio into Web Audio detaches it from the speakers, and
 * leaving it that way is what keeps a 30-second export from playing the whole
 * sequence out loud. A source without audio still yields a track — a silent
 * one — so exports stay uniform whether or not the clips have sound.
 *
 * Returns null when Web Audio is unavailable or refuses an element, which
 * the caller treats as "export video only" rather than as a failure.
 */
export async function createAudioCapture(
  elements: readonly HTMLMediaElement[],
  createContext: () => AudioContext | null = defaultAudioContext,
): Promise<AudioCapture | null> {
  let context: AudioContext | null = null
  try {
    context = createContext()
    if (context === null) return null
    const destination = context.createMediaStreamDestination()
    for (const element of elements) {
      context.createMediaElementSource(element).connect(destination)
    }
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
 * How far an audio track element's clock may drift from the export clock
 * before it is snapped back, in seconds — the same tolerance the preview
 * player uses (#103): element clocks wander a few tens of milliseconds, and
 * re-seeking every frame would stutter the very audio being recorded.
 */
export const AUDIO_DRIFT_EPSILON = 0.25

/** The element surface syncTrackReplay drives (an HTMLAudioElement in production). */
export interface TrackReplayElement {
  volume: number
  currentTime: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
}

/**
 * Aligns one audio track's replay element with the export clock (#105) —
 * the export-side counterpart of the preview's per-frame track sync (#103),
 * driven from the same shared helpers so the two renders cannot drift: the
 * element's volume is set to `audioTrackGainAt` (volume × fade envelope, 0
 * outside the window) every call, which is what renders fades as continuous
 * ramps in the recording, and `audioTrackPlaybackAt` decides playing state
 * and source position. Elements are cued exactly when their window starts;
 * while playing they keep their own clock unless it drifts audibly.
 * `duckFactor` is the shared duck factor at this instant (#241) — 1 when no
 * ducking applies; the caller exempts duck-enabled tracks via
 * `trackDuckFactorAt`, exactly as the preview does.
 */
export function syncTrackReplay(
  track: AudioTrack,
  element: TrackReplayElement,
  sequenceTime: number,
  duckFactor = 1,
): void {
  const { shouldPlay, sourceTime } = audioTrackPlaybackAt(track, sequenceTime)
  element.volume = audioTrackGainAt(track, sequenceTime) * duckFactor
  alignReplayClock(element, shouldPlay, sourceTime)
}

/**
 * Aligns an overlay video layer's replay element with the export clock
 * (#146) — the export-side counterpart of the preview's `syncVideoOverlays`
 * (#145), and the same clock discipline as the audio tracks above: the
 * shared window helper decides playing state and source position, and the
 * element free-runs within the drift tolerance. Gain is the overlay's own
 * volume × mute × fade envelope (`videoOverlayGainAt`, #220 — applied
 * every frame, as the preview does, so fades record as continuous ramps),
 * ducked with the rest of the mix by `duckFactor` (#241).
 */
export function syncOverlayReplay(
  overlay: VideoOverlay,
  element: TrackReplayElement,
  sequenceTime: number,
  duckFactor = 1,
): void {
  const { shouldPlay, sourceTime } = audioTrackPlaybackAt(overlay, sequenceTime)
  element.volume = videoOverlayGainAt(overlay, sequenceTime) * duckFactor
  alignReplayClock(element, shouldPlay, sourceTime)
}

/** The shared clock discipline of syncTrackReplay and syncOverlayReplay. */
function alignReplayClock(
  element: TrackReplayElement,
  shouldPlay: boolean,
  sourceTime: number,
): void {
  if (shouldPlay) {
    if (element.paused) {
      element.currentTime = sourceTime
      // play() rejects (AbortError) when interrupted by pause — an expected
      // outcome, matching the video replay elements.
      element.play().catch(() => {})
    } else if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
      element.currentTime = sourceTime
    }
  } else {
    if (!element.paused) element.pause()
    // Keep the paused element cued to the position (its in-point while the
    // clock is before the window) so starting is only ever a play().
    if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
      element.currentTime = sourceTime
    }
  }
}

/**
 * Matches the preview player's boundary tolerance: the video clock advances
 * in discrete steps, so an exact out-point comparison would record frames
 * past the trim.
 */
export const OUT_POINT_EPSILON = 0.02

/**
 * Tolerance (seconds) between the incoming replay element's clock and the
 * source position the remapped mapping expects during a transition overlap
 * (#144) — the export-side twin of the preview's constant (#141): with the
 * playback rate driven every frame the drift stays tiny, so only visible
 * strays re-seek.
 */
export const VIDEO_DRIFT_EPSILON = 0.25

/**
 * A pause plateau in progress on the replaying entry (#144): the element is
 * frozen on `at` while the export's wall clock advances the entry's output
 * position from `outputNow` to `outputEnd` — the same still-clock pattern the
 * preview uses for holds (#141). All fields are seconds; `at` is relative to
 * the entry's in-point, the output fields are into the entry.
 */
export interface RemapHoldState {
  at: number
  outputEnd: number
  outputNow: number
}

/** Per-entry replay state the remap driver advances frame by frame (#144). */
export interface RemapReplayState {
  hold: RemapHoldState | null
  /**
   * The last observed source position relative to the in-point, for
   * detecting that the element's clock crossed a pause instant between
   * frames — the preview's detection (#141), shared semantics.
   */
  lastRelSource: number
}

/** What the replay element should do this frame (#144). */
export type RemapReplayAction =
  /** Keep playing; carry this playback rate (1 outside every segment). */
  | { kind: 'play'; rate: number }
  /** Stay paused, frozen on `relSource` (relative to the in-point). */
  | { kind: 'freeze'; relSource: number }
  /** A hold just ended mid-entry: resume playing from the frozen instant. */
  | { kind: 'resume'; rate: number }
  /** The entry has fully played out — source consumed, no hold pending. */
  | { kind: 'finished' }

export interface RemapReplayFrame {
  state: RemapReplayState
  /** Output seconds into the entry this frame represents. */
  outputInto: number
  action: RemapReplayAction
}

/**
 * The replay state an entry starts from `outputInto` output seconds in
 * (#144): entry start (0) or however far a transition overlap already
 * carried it. Inside a pause plateau the element belongs frozen on the
 * returned `relSource` with a hold pending; otherwise it belongs playing
 * from there at `rate`.
 */
export function initialRemapReplay(
  trimmed: number,
  effects: readonly RemapEffect[],
  outputInto: number,
): { state: RemapReplayState; relSource: number; rate: number } {
  const at = remapPlaybackAt(trimmed, effects, outputInto)
  return {
    state: {
      hold: at.hold
        ? {
            at: at.sourceTime,
            outputEnd: at.hold.outputEnd,
            outputNow: Math.min(Math.max(outputInto, at.hold.outputStart), at.hold.outputEnd),
          }
        : null,
      lastRelSource: at.sourceTime,
    },
    relSource: at.sourceTime,
    rate: at.rate,
  }
}

/**
 * Advances one entry's remapped replay by one frame (#144) — the pure
 * schedule the export loop drives its element with, mirroring the preview's
 * tick (#141): outside a pause the element clock is authoritative and maps
 * to output through the entry's effects (the active segment's factor as its
 * playback rate); crossing a pause instant between frames freezes the
 * element on that exact instant while wall time (`dt` per frame) advances
 * the output position through the hold; when a plateau ends the position is
 * re-resolved, so back-to-back plateaus (two pauses at one instant) chain
 * into their combined hold rather than being skipped. An entry with no
 * effects reduces exactly to the pre-remap math: rate 1, output = source,
 * finished at the trimmed length.
 *
 * `elementRelSource` is the element clock relative to the entry's in-point
 * (ignored while a hold freezes the element); `dt` is wall seconds since the
 * previous frame (only consumed by holds). Effects must be normalized, as
 * everywhere else.
 */
export function advanceRemapReplay(
  trimmed: number,
  effects: readonly RemapEffect[],
  state: RemapReplayState,
  elementRelSource: number,
  elementEnded: boolean,
  dt: number,
): RemapReplayFrame {
  if (state.hold !== null) {
    const outputNow = state.hold.outputNow + Math.max(0, dt)
    if (outputNow < state.hold.outputEnd) {
      return {
        state: { hold: { ...state.hold, outputNow }, lastRelSource: state.lastRelSource },
        outputInto: outputNow,
        action: { kind: 'freeze', relSource: state.hold.at },
      }
    }
    // Plateau over. Re-resolve rather than assume playback: a second pause
    // at the same instant plateaus again immediately (#153 documents the
    // preview skipping this; the export renders the model's combined hold).
    const done = state.hold.outputEnd
    const resolved = remapPlaybackAt(trimmed, effects, done)
    if (resolved.hold !== null && resolved.hold.outputEnd > done) {
      return {
        state: {
          hold: { at: resolved.sourceTime, outputEnd: resolved.hold.outputEnd, outputNow: done },
          lastRelSource: resolved.sourceTime,
        },
        outputInto: done,
        action: { kind: 'freeze', relSource: resolved.sourceTime },
      }
    }
    const ended = { hold: null, lastRelSource: state.hold.at }
    if (state.hold.at >= trimmed - OUT_POINT_EPSILON || elementEnded) {
      // An end-of-entry pause: the source is consumed, nothing to resume.
      return { state: ended, outputInto: done, action: { kind: 'finished' } }
    }
    return {
      state: ended,
      outputInto: done,
      action: { kind: 'resume', rate: rateAtSourceTime(effects, state.hold.at) },
    }
  }
  const relSource = elementRelSource
  const sourceDone = relSource >= trimmed - OUT_POINT_EPSILON || elementEnded
  // Crossing a pause instant between frames starts its hold. An
  // end-of-entry pause is reached through `sourceDone` — element clocks
  // stop just short of the exact out-point.
  const crossed = effects.find(
    (effect) =>
      effect.kind === 'pause' &&
      effect.at > state.lastRelSource &&
      (effect.at <= relSource || sourceDone),
  )
  if (crossed !== undefined && crossed.kind === 'pause') {
    const outputStart = outputTimeAtSource(trimmed, effects, crossed.at)
    return {
      state: {
        hold: { at: crossed.at, outputEnd: outputStart + crossed.hold, outputNow: outputStart },
        lastRelSource: crossed.at,
      },
      outputInto: outputStart,
      action: { kind: 'freeze', relSource: crossed.at },
    }
  }
  const outputInto = outputTimeAtSource(trimmed, effects, relSource)
  if (sourceDone) {
    return { state: { hold: null, lastRelSource: relSource }, outputInto, action: { kind: 'finished' } }
  }
  return {
    state: { hold: null, lastRelSource: relSource },
    outputInto,
    action: { kind: 'play', rate: rateAtSourceTime(effects, relSource) },
  }
}


/**
 * Exports the timeline — each entry from its in-point to its out-point, in
 * order, with transitions blending adjacent entries — to a single video Blob
 * in the requested container format (WebM by default, #114).
 *
 * Approach: replay the sequence through off-DOM <video> elements, draw each
 * frame onto a canvas, and record the canvas stream with MediaRecorder. The
 * elements' audio is captured through Web Audio and recorded as a second
 * track, so trims apply to sound and picture alike — both come from the same
 * playback between the entry's in- and out-points. A transition overlap
 * (#41) plays two entries at once, so a timeline with transitions uses two
 * replay elements: during the overlap the incoming clip's frame is
 * composited over the outgoing one per the effect, the two audio streams
 * crossfade via the elements' volumes, and at the boundary the elements swap
 * roles so the incoming clip never has to be re-cued (the same handover the
 * preview player performs). Timeline audio tracks replay through one
 * off-DOM <audio> element each, mixed into the same capture (#105); every
 * element volume — entry volume/mute, transition ramps, track volume and
 * fades — comes from the shared gain functions (#104), so the recording
 * carries the same mix the preview plays. This re-encodes in real time (a
 * ~30 s sequence takes ~30 s) but works entirely client-side with broadly
 * supported APIs.
 */
export async function exportTimeline(
  timeline: TimelineState,
  options: ExportOptions = {},
): Promise<Blob> {
  const { entries } = timeline
  if (entries.length === 0) {
    throw new Error('The timeline is empty — add clips before exporting.')
  }
  // A sink-driven export (#198) records nothing itself, so it does not need
  // MediaRecorder at all — its requirement is the canvas, checked below.
  const sink = options.sink
  if (sink === undefined && typeof MediaRecorder === 'undefined') {
    throw new ExportUnsupportedError('This browser does not support recording video (MediaRecorder).')
  }

  const {
    onProgress,
    signal,
    frameRate = EXPORT_FRAME_RATE,
    container = WEBM_CONTAINER,
    audioOnly = false,
  } = options
  const boundaries = boundaryTransitions(timeline)
  const createVideo = options.createVideo ?? (() => document.createElement('video'))
  const createImage = options.createImage ?? (() => new Image())
  // The second replay element exists only when a transition will need it; a
  // transition-free timeline keeps the single-element pipeline unchanged.
  const replays = boundaries.some((transition) => transition !== undefined)
    ? [createVideo(), createVideo()]
    : [createVideo()]
  for (const replay of replays) {
    replay.playsInline = true
    replay.preload = 'auto'
  }

  // One replay element per timeline audio track (#105), mixed into the same
  // capture as the video replays. Created before the capture because an
  // element can join the graph only at construction time.
  const createAudio = options.createAudio ?? (() => document.createElement('audio'))
  const trackReplays = audioTracksOf(timeline).map((track) => {
    const element = createAudio()
    element.preload = 'auto'
    return { track, element }
  })

  // One replay element per overlay video layer (#146): its picture is drawn
  // onto the canvas each frame and its audio joins the same capture as
  // everything else, honoring the overlay's volume/mute via the per-frame
  // sync below. Unlike the audio tracks, overlays must play even without
  // Web Audio — the picture is the point — so they follow the base replays'
  // mute rule rather than the tracks' skip rule.
  const overlayReplays = videoOverlaysOf(timeline).map((overlay) => {
    const element = createVideo()
    element.playsInline = true
    element.preload = 'auto'
    return { overlay, element }
  })

  // A sink-driven export (#198) is soundless (see ExportFrameSink): no audio
  // graph is built, which also leaves the replays muted below — the export
  // never sounds from the speakers.
  const audioCapture = sink !== undefined
    ? null
    : await createAudioCapture(
        [
          ...replays,
          ...overlayReplays.map(({ element }) => element),
          ...trackReplays.map(({ element }) => element),
        ],
        options.createAudioContext,
      )
  // An audio-only export (#245) exists to carry the mix: without Web Audio
  // there is nothing to record, so it refuses rather than silently falling
  // back to the video-only path (which for this format would be an empty
  // recording).
  if (audioOnly && audioCapture === null) {
    throw new ExportUnsupportedError(
      'This browser cannot capture audio for an audio-only export (Web Audio is unavailable).',
    )
  }
  for (const replay of [...replays, ...overlayReplays.map(({ element }) => element)]) {
    // Muting an element silences its Web Audio output too, so the replays can
    // only stay muted when there is no audio to capture. Nothing reaches the
    // speakers either way: createAudioCapture leaves the graph unconnected.
    replay.muted = audioCapture === null
  }
  // Without Web Audio there is nothing to record the tracks into — and,
  // unconnected to any graph, playing them would sound from the speakers —
  // so the video-only fallback leaves them untouched.
  const recordedTracks = audioCapture === null ? [] : trackReplays

  // The sink is its own encoder (#198): no recorder MIME type to negotiate.
  const mimeType = sink !== undefined
    ? null
    : pickExportMimeType(
        (type) => MediaRecorder.isTypeSupported(type),
        audioCapture === null ? container.candidates : container.candidatesWithAudio,
      )
  if (sink === undefined && mimeType === null) {
    await audioCapture?.dispose()
    throw new ExportUnsupportedError(`This browser cannot encode ${container.label} video.`)
  }

  const canceled = () => new ExportCanceledError()
  const throwIfAborted = () => {
    if (signal?.aborted) throw canceled()
  }

  /** Resolves on `name`; rejects on the element erroring or the signal aborting. */
  const waitForEvent = (element: HTMLMediaElement, name: string) =>
    new Promise<void>((resolve, reject) => {
      const settle = (result?: Error) => {
        element.removeEventListener(name, onDone)
        element.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        if (result) reject(result)
        else resolve()
      }
      const onDone = () => settle()
      const onError = () => settle(new Error('A source clip failed to load during export.'))
      const onAbort = () => settle(canceled())
      element.addEventListener(name, onDone, { once: true })
      element.addEventListener('error', onError, { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
    })

  const loadSource = async (element: HTMLMediaElement, url: string) => {
    if (element.src !== url) {
      const loaded = waitForEvent(element, 'loadedmetadata')
      element.src = url
      await loaded
    }
  }

  const cueTo = async (element: HTMLVideoElement, url: string, sourceTime: number) => {
    await loadSource(element, url)
    if (Math.abs(element.currentTime - sourceTime) > 0.001) {
      const seeked = waitForEvent(element, 'seeked')
      element.currentTime = sourceTime
      await seeked
    }
  }

  const releaseVideos = () => {
    for (const replay of [
      ...replays,
      ...overlayReplays.map(({ element }) => element),
      ...trackReplays.map(({ element }) => element),
    ]) {
      replay.pause()
      replay.removeAttribute('src')
      replay.load()
    }
  }

  /** Tears down the replay elements and the audio graph feeding the recorder. */
  const releaseAll = async () => {
    releaseVideos()
    await audioCapture?.dispose()
  }

  /** Decoded <img> per still entry's URL (#140), loaded before recording. */
  const stillSources = new Map<string, HTMLImageElement>()
  const loadStill = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = createImage()
      const settle = (error?: Error) => {
        image.onload = null
        image.onerror = null
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(image)
      }
      const onAbort = () => settle(canceled())
      image.onload = () => settle()
      image.onerror = () => settle(new Error('A source clip failed to load during export.'))
      signal?.addEventListener('abort', onAbort, { once: true })
      image.src = url
    })

  // Output frame size: the shared rule (frameSize.ts, #176) over every real
  // source in the sequence — the same rule the preview sizes its stage by,
  // so fractional overlay/text/zoom coordinates resolve identically in both
  // renderers. Loading every source here also validates that each one is
  // decodable before the recorder starts. Image stills (#140) load through
  // an <img> — a <video> cannot decode them — and keep it for the draw loop.
  // Slates (#143) have no media at all: nothing to load, no intrinsic size —
  // they fill whatever frame the real sources (or the fallback) decide.
  // Dimensions are probed once per URL but contributed once per *entry*,
  // cropped (#255/#256) then oriented (#232/#233): a cropped entry presents
  // its kept region and a quarter-turned entry swapped dimensions to the
  // frame rule, exactly as the preview computes its stage.
  const urlDims = new Map<string, SourceDimensions>()
  try {
    for (const url of new Set(
      entries.filter((entry) => !isStillEntry(entry)).map((entry) => entry.url),
    )) {
      throwIfAborted()
      await loadSource(replays[0], url)
      urlDims.set(url, { width: replays[0].videoWidth, height: replays[0].videoHeight })
    }
    for (const url of new Set(
      entries.filter((entry) => entry.kind === 'image').map((entry) => entry.url),
    )) {
      throwIfAborted()
      const image = await loadStill(url)
      stillSources.set(url, image)
      urlDims.set(url, { width: image.naturalWidth, height: image.naturalHeight })
    }
    // Load the track sources up front too: it validates each one is
    // decodable before the recorder starts, and makes starting a track
    // mid-record a plain play() rather than a load.
    for (const { track, element } of recordedTracks) {
      throwIfAborted()
      await loadSource(element, track.url)
    }
    // Overlay layers (#146) load and cue to their in-point up front: it
    // validates each source decodes, and the element holds the right first
    // frame from the very first draw. Overlay dimensions deliberately play
    // no part in the output frame size — placement is fractional (#145).
    for (const { overlay, element } of overlayReplays) {
      throwIfAborted()
      await cueTo(element, overlay.url, overlay.inPoint)
    }
  } catch (error) {
    await releaseAll()
    throw error
  }
  const sourceDims = entries.flatMap((entry) => {
    if (isSlateEntry(entry)) return []
    const dims = urlDims.get(entry.url)
    return dims === undefined
      ? []
      : [orientedDimensions(croppedDimensions(dims, entry.crop), entry.orientation)]
  })
  const { width, height } = options.frame ?? outputFrameSize(sourceDims)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  // A sink reads the canvas directly (#198), and an audio-only export never
  // captures the canvas (#245); only the video recorder path needs the
  // canvas to be capturable as a stream.
  if (
    context === null ||
    (sink === undefined && !audioOnly && typeof canvas.captureStream !== 'function')
  ) {
    await releaseAll()
    throw new ExportUnsupportedError('This browser cannot capture canvas video.')
  }
  // Per-clip color adjustments (#195) render through the context's `filter`,
  // probed once up front. The rule: an export must never silently produce
  // unadjusted frames the preview showed adjusted (#66 parity) — a browser
  // whose canvas cannot filter fails loudly instead, and only when the
  // timeline actually carries an adjustment.
  if (timelineHasColorAdjustments(timeline) && !canvasSupportsColorFilter(context)) {
    await releaseAll()
    throw new ExportUnsupportedError(
      'This browser cannot render color adjustments when exporting (canvas filters are unsupported). ' +
        'Reset the color adjustments, or export from a browser that supports canvas filters.',
    )
  }

  /**
   * Autoplay policy can still refuse unmuted playback. Falling back to a
   * muted replay costs that element's audio (the graph goes silent with the
   * element) but keeps the export itself working.
   */
  const playReplay = async (element: HTMLVideoElement) => {
    try {
      await element.play()
    } catch (error) {
      if (element.muted) throw error
      element.muted = true
      await element.play()
    }
  }

  const { drawFrame, videoFrame, stillFrame } = createFrameComposer({
    context,
    width,
    height,
    timeline,
    stillSources,
    overlayReplays,
  })

  // Duck windows (#241), resolved once — the timeline is fixed for the
  // export's duration. Every gain assignment below multiplies in the shared
  // duck factor, exactly as the preview's rAF loop does, so the recording
  // ducks identically to what the preview played.
  const ducking = duckWindows(timeline)

  /**
   * Starts the incoming clip mid-overlap without blocking the draw loop. The
   * target position is computed at the moment playback can actually start
   * (metadata permitting), compensating for however far the outgoing entry
   * has advanced past the overlap's start by then (`elapsedInOverlap` reads
   * the outgoing clock — element or wall, #140, in *output* seconds, #144) —
   * so a slow metadata load degrades sync gracefully instead of drifting the
   * whole overlap. The incoming entry's remap effects resolve that elapsed
   * output to a source instant and rate; inside a pause plateau the element
   * is cued to the frozen frame and left paused — the per-frame overlap sync
   * plays it when the plateau ends.
   */
  const engageIncoming = (
    element: HTMLVideoElement,
    elapsedInOverlap: () => number,
    next: TimelineEntry,
  ) => {
    const start = () => {
      const into = remapPlaybackAt(
        effectiveDuration(next),
        remapsForEntry(timeline, next.id),
        Math.max(0, elapsedInOverlap()),
      )
      element.currentTime = next.inPoint + into.sourceTime
      if (into.hold === null) {
        element.playbackRate = into.rate
        playReplay(element).catch(() => {})
      }
    }
    if (element.src === next.url && element.readyState > 0) {
      start()
    } else {
      element.addEventListener('loadedmetadata', start, { once: true })
      if (element.src !== next.url) element.src = next.url
    }
  }

  const total = totalDuration(timeline)
  // The recorder exists only without a sink (#198): a sink-driven export
  // takes its frames straight from the shared canvas below.
  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []
  let stopped: Promise<void> = Promise.resolve()
  if (sink === undefined) {
    // The audio-only decision is the shared pure rule (#245): the recorder
    // gets just the mixed audio track, or the canvas stream plus audio.
    const stream = recorderStream(
      audioOnly,
      () => canvas.captureStream(frameRate),
      audioCapture?.track ?? null,
    )
    try {
      recorder = new MediaRecorder(stream, { mimeType: mimeType as string })
    } catch (error) {
      // A rejected track combination must not strand the audio context, which
      // holds a rendering thread until it is closed.
      await releaseAll()
      throw error
    }
    const started = recorder
    started.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    stopped = new Promise<void>((resolve) => {
      started.onstop = () => resolve()
    })
    started.start()
  }

  // A handover can leave the raw fraction a hair behind where the outgoing
  // clip left off (the two elements are never perfectly in sync); publish a
  // monotonic value so the progress bar never steps backwards.
  let reported = 0
  const reportProgress = (fraction: number) => {
    reported = Math.max(reported, Math.min(fraction, 1))
    onProgress?.(reported)
  }

  let primary = replays[0]
  let secondary: HTMLVideoElement | null = replays[1] ?? null

  try {
    // True while `primary` is already playing the entry, carried over from
    // the previous boundary's transition handover.
    let continuing = false
    // Seconds of the upcoming still already shown inside the previous
    // boundary's overlap (#140) — its wall clock starts that far in.
    let stillCarryover = 0
    // Replay state carried across a transition handover into a remapped
    // entry (#144): where the incoming element landed in the mapping, and
    // any pause plateau it landed inside of.
    let carriedState: RemapReplayState = { hold: null, lastRelSource: 0 }
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]
      const still = isStillEntry(entry)
      const overlap = boundaries[index]
      const next = overlap !== undefined ? entries[index + 1] : undefined
      // The entry's remap effects (#144). Stills carry none by the model's
      // invariant (#138), so their pre-remap wall-clock path is untouched.
      const effects = still ? [] : remapsForEntry(timeline, entry.id)
      const trimmed = effectiveDuration(entry)
      // Where entry `index` begins in the sequence, and how much output the
      // entry occupies — both remap-aware since #150.
      const startTime = entryStartTime(timeline, index)
      const outDuration = entryOutputDuration(entry, remapsOf(timeline))
      // A still has no element clock (#140): the export's own wall clock
      // stands in for it, starting where the entry starts (or however far
      // into it the previous overlap already showed it). The recording is
      // real-time either way — the canvas stream captures as time passes —
      // so wall time is exactly the rate the still must advance at.
      const stillStartedAt = performance.now()
      const stillBase = entry.inPoint + (continuing ? stillCarryover : 0)
      const sourceTimeNow = () =>
        still ? stillBase + (performance.now() - stillStartedAt) / 1000 : primary.currentTime
      let replayState: RemapReplayState = continuing ? carriedState : { hold: null, lastRelSource: 0 }
      if (!continuing && !still) {
        const initial = initialRemapReplay(trimmed, effects, 0)
        replayState = initial.state
        await cueTo(primary, entry.url, entry.inPoint + initial.relSource)
        throwIfAborted()
        // The entry's gain at its start (#104/#220): volume × mute × fade
        // envelope at output 0, no ramp outside a transition. The draw loop
        // below re-applies it every frame, which is what records a fade-in
        // as a continuous ramp.
        primary.volume = videoEntryGainAt(entry, 0, outDuration) * duckFactorAt(ducking, startTime)
        // The cue point is output 0 into the entry: sequence time startTime.
        drawFrame(videoFrame(primary), index, startTime)
        sink?.frame(canvas, startTime)
        if (replayState.hold === null) {
          // The rate at the cue point (#144): 1 for an unremapped entry,
          // the segment's factor when the entry starts inside one.
          primary.playbackRate = initial.rate
          await playReplay(primary)
        } else if (!primary.paused) {
          // The entry opens on a pause plateau: hold the frozen first frame;
          // the draw loop advances the hold and resumes playback after it.
          primary.pause()
        }
      }
      // Preload the incoming clip's metadata while the outgoing entry plays,
      // so engaging the overlap is a quick seek rather than a full load.
      // Assigning src is non-blocking — the frames keep drawing below.
      // (An incoming still needs no element: its <img> is already decoded.)
      if (
        next !== undefined &&
        !isStillEntry(next) &&
        secondary !== null &&
        secondary.src !== next.url
      ) {
        secondary.src = next.url
      }
      // The overlap opens where the entry's remaining *output* equals the
      // transition's duration (#144) — for an entry without effects, exactly
      // the old source-time math.
      const overlapStartOut = overlap !== undefined ? outDuration - overlap.duration : Infinity
      let engaged = false
      // The frame loop's latest output position into the entry, read by the
      // engage closure below (it fires on a later metadata load).
      let lastOutputInto = 0
      // Draw every frame until the entry has played out its remapped output
      // (or the source's actual end), compositing the incoming clip once the
      // overlap window opens.
      await new Promise<void>((resolve, reject) => {
        let lastNow = performance.now()
        const tick = () => {
          if (signal?.aborted) {
            reject(canceled())
            return
          }
          const now = performance.now()
          const dt = (now - lastNow) / 1000
          lastNow = now
          // The entry's position this frame, in output seconds into it —
          // what the sequence position and transition progress are measured
          // in (#144). For an effect-free entry it equals the source elapsed.
          let outputInto: number
          let finished: boolean
          if (still) {
            const sourceTime = sourceTimeNow()
            outputInto = sourceTime - entry.inPoint
            finished = sourceTime >= entry.outPoint - OUT_POINT_EPSILON
          } else {
            const frame = advanceRemapReplay(
              trimmed,
              effects,
              replayState,
              primary.currentTime - entry.inPoint,
              primary.ended,
              dt,
            )
            replayState = frame.state
            outputInto = frame.outputInto
            finished = frame.action.kind === 'finished'
            switch (frame.action.kind) {
              case 'play':
                if (primary.playbackRate !== frame.action.rate) {
                  primary.playbackRate = frame.action.rate
                }
                // A handover can land exactly on a plateau's end, leaving the
                // element frozen there — playing is always right outside a hold.
                if (primary.paused) playReplay(primary).catch(() => {})
                break
              case 'freeze': {
                // Entering (or holding) a pause plateau: freeze the element on
                // the exact configured instant. Setting currentTime reflects
                // synchronously, so this seeks once, not every frame.
                if (!primary.paused) primary.pause()
                const at = entry.inPoint + frame.action.relSource
                if (Math.abs(primary.currentTime - at) > 0.001) primary.currentTime = at
                break
              }
              case 'resume':
                primary.playbackRate = frame.action.rate
                playReplay(primary).catch(() => {})
                break
            }
          }
          lastOutputInto = outputInto
          const sequenceTime = startTime + outputInto
          // The shared duck factor at this frame (#241): every gain set in
          // this tick — entry audio, the transition's incoming side, overlay
          // layers, audio tracks — rides it, exactly as the preview does.
          const duck = duckFactorAt(ducking, sequenceTime)
          // The entry's own gain every frame (#220): its fade envelope
          // records as a continuous ramp, exactly as the preview renders it.
          // Inside a transition overlap the branches below re-set it with
          // the crossfade ramp.
          if (!still) primary.volume = videoEntryGainAt(entry, outputInto, outDuration) * duck
          let overlayFrame: OverlayFrame | null = null
          if (overlap !== undefined && next !== undefined && outputInto >= overlapStartOut) {
            const progress = Math.min((outputInto - overlapStartOut) / overlap.duration, 1)
            if (isStillEntry(next)) {
              // An incoming still is always ready (#140): compose its <img>
              // per the effect. It has no audio, so only the outgoing
              // entry's gain ramps. (A still carries no remaps, so output
              // elapsed is exactly its source elapsed.)
              if (!still) {
                primary.volume =
                  videoEntryGainAt(entry, outputInto, outDuration, 1 - progress) * duck
              }
              overlayFrame = {
                layer: stillFrame(next, next.inPoint + (outputInto - overlapStartOut)),
                index: index + 1,
                type: overlap.type,
                progress,
              }
            } else if (secondary !== null) {
              if (!engaged) {
                engaged = true
                // The incoming entry starts at the foot of its ramp — which is
                // 0 whatever its volume, and stays 0 throughout if it is muted.
                secondary.volume = videoEntryGain(next, 0)
                engageIncoming(secondary, () => lastOutputInto - overlapStartOut, next)
              }
              // Until the incoming element has a decodable frame, keep drawing
              // (and sounding) the outgoing clip alone — a late engage shortens
              // the effect rather than blending against black or dropping audio.
              if (secondary.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                // The incoming entry's remap state this far into the overlap
                // (#144): where its source should stand, at what rate — or
                // frozen inside a pause plateau. Its element free-runs between
                // frames; the mapping is authoritative, so a clock that strays
                // visibly is snapped back — the preview's drift correction
                // (#141), against the remapped mapping.
                const inState = remapPlaybackAt(
                  effectiveDuration(next),
                  remapsForEntry(timeline, next.id),
                  outputInto - overlapStartOut,
                )
                const expected = next.inPoint + inState.sourceTime
                if (inState.hold !== null) {
                  if (!secondary.paused) secondary.pause()
                  if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                    secondary.currentTime = expected
                  }
                } else {
                  if (secondary.playbackRate !== inState.rate) {
                    secondary.playbackRate = inState.rate
                  }
                  if (secondary.paused) {
                    secondary.currentTime = expected
                    playReplay(secondary).catch(() => {})
                  } else if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                    secondary.currentTime = expected
                  }
                }
                // The transition crossfade rides each entry's own gain (#104),
                // so a muted or half-volume entry stays that way mid-effect —
                // fade envelopes included (#220), each over its own window.
                if (!still) {
                  primary.volume =
                    videoEntryGainAt(entry, outputInto, outDuration, 1 - progress) * duck
                }
                secondary.volume =
                  videoEntryGainAt(
                    next,
                    outputInto - overlapStartOut,
                    entryOutputDuration(next, remapsOf(timeline)),
                    progress,
                  ) * duck
                overlayFrame = {
                  layer: videoFrame(secondary),
                  index: index + 1,
                  type: overlap.type,
                  progress,
                }
              }
            }
          }
          // Overlay layers align with the export clock before the frame is
          // drawn (#146), the way the preview syncs them before painting
          // (#145): windows open and close on time, drifted clocks snap
          // back, and gain applies every frame. Sequence-anchored like the
          // audio tracks below, so pause holds and remaps never move them.
          for (const replay of overlayReplays) {
            syncOverlayReplay(replay.overlay, replay.element, sequenceTime, duck)
          }
          // A still's layer time is its clock read above (inPoint + output
          // elapsed — stills carry no remaps); a video draws its element.
          drawFrame(
            still ? stillFrame(entry, entry.inPoint + outputInto) : videoFrame(primary),
            index,
            sequenceTime,
            overlayFrame,
          )
          // A frame sink (#198) sees exactly what the recorder would have:
          // the same canvas, right after the same composition.
          sink?.frame(canvas, sequenceTime)
          // Every frame re-syncs the audio tracks against the export clock,
          // exactly as the preview's rAF loop does (#105): windows open and
          // close on time and fades record as continuous ramps — the clock
          // keeps advancing through pause holds (#144), so sequence-anchored
          // tracks are unaffected by remaps, matching the #141 decision.
          for (const recorded of recordedTracks) {
            syncTrackReplay(
              recorded.track,
              recorded.element,
              sequenceTime,
              trackDuckFactorAt(recorded.track, ducking, sequenceTime),
            )
          }
          reportProgress(sequenceTime / total)
          if (finished) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      if (overlap !== undefined && next !== undefined && isStillEntry(next)) {
        // Handover into a still (#140): nothing plays the incoming entry —
        // its wall clock simply starts however far the overlap carried it.
        if (!still) primary.pause()
        stillCarryover = overlap.duration
        continuing = true
      } else if (overlap !== undefined && next !== undefined && secondary !== null) {
        // Transition handover: the incoming entry keeps playing in what
        // becomes the primary element; the outgoing element is freed for the
        // next boundary. (The clamp in timeline.ts guarantees overlaps never
        // chain, so the freed element is always idle when next needed.)
        if (!still) primary.pause()
        // The incoming entry leaves its ramp for its own gain at the
        // handover point — overlap.duration output seconds in (#220); the
        // paused outgoing element's volume is set again when it is next cued.
        secondary.volume =
          videoEntryGainAt(next, overlap.duration, entryOutputDuration(next, remapsOf(timeline))) *
          duckFactorAt(ducking, startTime + outDuration)
        const incoming = secondary
        secondary = primary
        primary = incoming
        // Where the handover lands in the incoming entry's mapping (#144):
        // `overlap.duration` output seconds in. For an unremapped entry this
        // is the identity — source elapsed equals output elapsed, no hold.
        const landing = initialRemapReplay(
          effectiveDuration(next),
          remapsForEntry(timeline, next.id),
          overlap.duration,
        )
        if (!engaged) {
          // The overlap was shorter than a frame: cue the incoming clip
          // directly to where the handover lands.
          await cueTo(primary, next.url, next.inPoint + landing.relSource)
          if (landing.state.hold === null) {
            primary.playbackRate = landing.rate
            await playReplay(primary)
          } else if (!primary.paused) {
            // The handover lands inside a pause plateau: stay frozen; the
            // next entry's draw loop advances the hold and resumes after it.
            primary.pause()
          }
        }
        carriedState = landing.state
        stillCarryover = 0
        continuing = true
      } else {
        if (!still) primary.pause()
        stillCarryover = 0
        continuing = false
      }
    }
  } finally {
    releaseVideos()
    recorder?.stop()
    await stopped
    // After the recorder has flushed, so the tail of the audio survives.
    await audioCapture?.dispose()
  }

  onProgress?.(1)
  // A sink is its own encoder (#198): the export is whatever it produces.
  if (sink !== undefined) return sink.finish()
  // The recorder may refine the requested type (a bare `video/mp4` request
  // comes back with the codecs it actually chose), so the saved Blob carries
  // what was really encoded (#114).
  const finished = recorder as MediaRecorder
  return new Blob(chunks, { type: finished.mimeType || (mimeType as string) })
}
