import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { TimelineEntry, TimelineState } from '../lib/timeline'
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
  isImageOverlay,
  videoOverlaysOf,
} from '../lib/timeline'
import { textActiveAt, textFontStack, textOpacityAt } from '../lib/textOverlay'
import { outputTimeAtSource, rateAtSourceTime, remapPlaybackAt } from '../lib/remap'
import {
  audioTrackPlaybackAt,
  entryStartTime,
  frontedLocation,
  isTransitionOverlayActive,
  locateInSequence,
  sequenceTimeAt,
  splitTargetAt,
} from '../lib/playback'
import type { PlaybackLocation, TransitionOverlap } from '../lib/playback'
import {
  audioTrackGainAt,
  duckFactorAt,
  duckWindows,
  trackDuckFactorAt,
  videoEntryGainAt,
  videoOverlayGainAt,
} from '../lib/gain'
import { colorFilterFor } from '../lib/colorAdjustments'
import type { ColorAdjustments } from '../lib/colorAdjustments'
import { orientationTransform, orientedDimensions } from '../lib/orientation'
import type { Orientation } from '../lib/orientation'
import { croppedDimensions, cropMediaPlacement } from '../lib/crop'
import type { Crop } from '../lib/crop'
import {
  BACKDROP_BLUR_FRACTION,
  BACKDROP_BUFFER_WIDTH,
  backdropRect,
} from '../lib/backgroundFill'
import { maskClipPath } from '../lib/shapeMask'
import { drawLayerSource, withLayerOrientation } from '../lib/exportVideo'
import { transitionLabel, transitionLayerSpec } from '../lib/transitionRender'
import type { TransitionClipRect, TransitionEllipse } from '../lib/transitionRender'
import { canvasFrameSize, frameAspect } from '../lib/frameSize'
import type { SourceDimensions } from '../lib/frameSize'
import { IDENTITY_ZOOM, zoomAt } from '../lib/zoom'
import type { ZoomState } from '../lib/zoom'
import { formatDuration } from '../lib/mediaLibrary'
import { frameFileName, snapshotTimelineFrame } from '../lib/frameSnapshot'
import { automaticExportFrame } from '../lib/exportSettings'
import { freezeTargetAt } from '../lib/freezeFrame'
import type { FreezePlacementMode, FreezeTarget } from '../lib/freezeFrame'
import {
  modalDialogOpen,
  stepTarget,
  targetClaimsKeys,
  transportActionForKey,
} from '../lib/transport'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'
import './PreviewPlayer.css'

interface PreviewPlayerProps {
  timeline: TimelineState
  /** Whether the panel spans the full content width (#128). Owned by App —
   * the expansion rearranges the app grid, not just this panel. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /**
   * Split the entry at the playhead (#190). The preview owns the playhead,
   * so the razor lives here; the split itself is App's dispatch. Optional so
   * the player renders without editing wiring (tests, read-only embeds).
   */
  onSplit?: (entryId: string, atSourceTime: number) => void
  /**
   * Freeze frame (#379): the captured PNG of the playhead's composed frame,
   * with the output frame it was composed at, the sequence time it holds,
   * and the resolved placement. The preview owns the playhead and the
   * capture (the same snapshot path as Save frame); turning the blob into a
   * library clip and the one-step timeline change is App's dispatch.
   * Optional like `onSplit` — without it the control disables.
   */
  onFreezeFrame?: (
    blob: Blob,
    frame: SourceDimensions,
    sequenceTime: number,
    target: FreezeTarget,
  ) => void
  /**
   * How far ← / → and Shift + ← / → move the playhead, in seconds — user
   * settings (#286). Optional so every existing caller and test keeps
   * today's behaviour without passing anything.
   */
  stepSeconds?: number
  largeStepSeconds?: number
}

/**
 * Tolerance (seconds) when comparing a <video>'s clock against an entry's
 * out-point: currentTime advances in discrete steps, so an exact match would
 * overshoot into the next clip's source material before switching.
 */
const BOUNDARY_EPSILON = 0.02

/**
 * Tolerance (seconds) between an audio track element's clock and the
 * position the sequence publishes (#103). Element clocks drift a few tens of
 * milliseconds apart; re-seeking on every frame would stutter the audio, so
 * a track is only snapped back when it strays audibly far.
 */
const AUDIO_DRIFT_EPSILON = 0.25

/**
 * Tolerance (seconds) between the incoming (secondary) element's clock and
 * the source position the remapped mapping expects for the published
 * sequence time (#141). Same reasoning as AUDIO_DRIFT_EPSILON: with the
 * playback rate driven every frame the drift stays tiny, so only visible
 * strays re-seek.
 */
const VIDEO_DRIFT_EPSILON = 0.25

// The now-playing transition label comes from the registry (#199) via
// `transitionLabel` — core plus whatever enabled plugins contribute.

/**
 * Styles for the two stacked video elements mid-transition, mapped from the
 * shared layer spec (transitionRender.ts) that also drives the exporter, so
 * preview and export render the same effect (#66). For a crossfade the
 * outgoing element fades to black at `1 − progress` while the incoming one
 * is ADDED at `progress` (`plus-lighter`): covered regions blend exactly as
 * a plain opacity crossfade did, and any margin only one clip reaches fades
 * to/from the stage's black instead of popping at the handover. Slides move
 * the incoming element as a full-frame card — the element's own opaque black
 * background fills whatever its fitted clip does not (#74) — over an
 * undimmed outgoing clip, so margins are covered by sliding black instead of
 * popping at the handover. Pushes (#181) add the same translate to the
 * outgoing element; wipes (#181) pass the spec's clip rectangle through to
 * `withZoom`, which cuts the incoming card to it; irises (#181) pass the
 * spec's ellipse the same way, becoming a mask on the incoming element;
 * cross-zoom (#181) adds a scale about the element centre to each layer;
 * fades through a color (#181) put a full-frame veil above both elements.
 */
function transitionLayerStyles(overlap: TransitionOverlap): {
  outgoing: CSSProperties
  incoming: CSSProperties
  incomingClip: TransitionClipRect | null
  incomingEllipse: TransitionEllipse | null
  veil: CSSProperties | null
} {
  const spec = transitionLayerSpec(overlap.type, overlap.progress)
  // A push's translate and a cross-zoom's scale never co-occur today, but
  // composing them in this order (translate outermost, matching the export's
  // scale-about-centre-then-offset) keeps any future combination drift-free.
  const outgoingTransforms = [
    ...(spec.outgoingOffsetXFraction !== 0 || spec.outgoingOffsetYFraction !== 0
      ? [
          `translate(${spec.outgoingOffsetXFraction * 100}%, ${spec.outgoingOffsetYFraction * 100}%)`,
        ]
      : []),
    ...(spec.outgoingScale !== 1 ? [`scale(${spec.outgoingScale})`] : []),
  ]
  return {
    outgoing: {
      opacity: spec.outgoingAlpha,
      // Only pushes and cross-zoom transform the outgoing layer; every other
      // type keeps the exact pre-#181 style object (no identity transform).
      ...(outgoingTransforms.length > 0 ? { transform: outgoingTransforms.join(' ') } : {}),
    },
    incoming: {
      opacity: spec.incomingAlpha,
      transform: `translate(${spec.incomingOffsetXFraction * 100}%, ${spec.incomingOffsetYFraction * 100}%)${spec.incomingScale !== 1 ? ` scale(${spec.incomingScale})` : ''}`,
      mixBlendMode: spec.additive ? 'plus-lighter' : undefined,
      backgroundColor: spec.incomingBacking ? '#000' : undefined,
    },
    incomingClip: spec.incomingClip,
    incomingEllipse: spec.incomingEllipse,
    veil:
      spec.veil === null ? null : { backgroundColor: spec.veil.color, opacity: spec.veil.alpha },
  }
}

/**
 * Composes a layer's styles with its entry's color adjustments (#192): the
 * shared filter string (colorAdjustments.ts — the same string the export
 * will hand the canvas context, #195) set as the element's CSS `filter`.
 * Identity adds nothing, so unadjusted layers keep their exact style
 * objects. Applied to the media element itself (video/image), outside the
 * transition and zoom styling — the adjustment belongs to the clip, so it
 * rides along through overlaps exactly like the clip's pixels do.
 */
function withColorFilter(
  style: CSSProperties | undefined,
  adjustments: ColorAdjustments | undefined,
): CSSProperties | undefined {
  const filter = colorFilterFor(adjustments)
  if (filter === 'none') return style
  return { ...style, filter }
}

/**
 * The media element's styles for its orientation (#232), mapped from the
 * shared transform rule (orientation.ts) that the export will also consume
 * (#233). The media element sits inside its layer card (the frame-shaped —
 * or, for an overlay, rectangle-shaped — box that transitions and zooms
 * style), so orientation composes *inside* everything downstream: a push
 * slides the oriented card, a zoom magnifies the oriented picture.
 *
 * A quarter turn (90°/270°) additionally swaps the element's box to the
 * card's transposed rectangle, centred: `object-fit: contain` then fits the
 * source into the swapped box, and rotating that box back over the card
 * yields exactly the rotated source contained in the card — the two
 * letterbox ratios are the same two numbers — with no need to know the
 * source's own dimensions. `cardAspect` is the card box's width ÷ height
 * (the percentages resolve against the card), so the swapped box is
 * height × width of the card exactly.
 *
 * The identity orientation returns no style at all, keeping unoriented
 * layers' style objects untouched.
 */
function orientedMediaStyle(
  orientation: Orientation | undefined,
  cardAspect: number,
): CSSProperties | undefined {
  if (orientation === undefined) return undefined
  const { rotation, scaleX, scaleY } = orientationTransform(orientation)
  const flip = scaleX === -1 || scaleY === -1 ? `scale(${scaleX}, ${scaleY})` : ''
  if ((rotation === 90 || rotation === 270) && Number.isFinite(cardAspect) && cardAspect > 0) {
    return {
      left: '50%',
      top: '50%',
      width: `${100 / cardAspect}%`,
      height: `${100 * cardAspect}%`,
      transform: `translate(-50%, -50%) rotate(${rotation}deg)${flip === '' ? '' : ` ${flip}`}`,
    }
  }
  const parts = [...(rotation !== 0 ? [`rotate(${rotation}deg)`] : []), ...(flip !== '' ? [flip] : [])]
  return parts.length === 0 ? undefined : { transform: parts.join(' ') }
}

/** Style numbers rounded so inline styles stay readable and stable. */
const styleNumber = (value: number) => String(Math.round(value * 10000) / 10000)

/**
 * The media element's styles for its crop (#255) composed with its
 * orientation (#232): the orientation style is untouched (crop-free layers
 * keep byte-identical styles), and a crop appends the shared placement
 * rule's three pieces — a clip-path cutting the element to the kept region,
 * then (rightmost in the transform, so innermost in CSS order) the scale
 * and centring translate that contain-fit the kept region in the element
 * box. The box is the card, or the transposed card a quarter turn already
 * swaps to — `cropMediaPlacement` works in that box, which is exactly why
 * crop-then-rotate needs no new cases here. Until the source's dimensions
 * are probed (`sourceAspect` undefined) the crop styles nothing, exactly as
 * the frame rule waits for the same probe.
 */
function croppedOrientedMediaStyle(
  crop: Crop | undefined,
  orientation: Orientation | undefined,
  cardAspect: number,
  sourceAspect: number | undefined,
): CSSProperties | undefined {
  const base = orientedMediaStyle(orientation, cardAspect)
  if (crop === undefined) return base
  const swapped =
    (orientation?.rotation === 90 || orientation?.rotation === 270) &&
    Number.isFinite(cardAspect) &&
    cardAspect > 0
  const placement = cropMediaPlacement(crop, sourceAspect, swapped ? 1 / cardAspect : cardAspect)
  if (placement === undefined) return base
  const cropTransform = `translate(${styleNumber(placement.translateX)}%, ${styleNumber(placement.translateY)}%) scale(${styleNumber(placement.scale)})`
  return {
    ...base,
    clipPath: `inset(${styleNumber(placement.insetTop)}% ${styleNumber(placement.insetRight)}% ${styleNumber(placement.insetBottom)}% ${styleNumber(placement.insetLeft)}%)`,
    transform: base?.transform === undefined ? cropTransform : `${base.transform} ${cropTransform}`,
  }
}

/**
 * The blur-fill backdrop (#259): a low-resolution canvas behind the fitted
 * media element, repainting the same element's current frame on its own rAF
 * loop — sampling the element the user already sees, so the backdrop can
 * never drift from playback. The picture is composed exactly as the export
 * composes a layer — the shared crop rule (#255) then orientation (#232)
 * via the compositor's own `drawLayerSource`/`withLayerOrientation`, into
 * `backdropRect` (the shared cover-fit rule) — and the blur itself is CSS
 * on the element, `BACKDROP_BLUR_FRACTION` of the frame's shorter side in
 * cq units (the frame is the size container), so the strength matches the
 * export's frame-relative radius at any rendered size.
 */
function BlurBackdrop({
  sourceRef,
  crop,
  orientation,
}: {
  sourceRef: RefObject<HTMLVideoElement | HTMLImageElement | null>
  crop: Crop | undefined
  orientation: Orientation | undefined
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let frame = 0
    const paint = () => {
      frame = requestAnimationFrame(paint)
      const canvas = canvasRef.current
      const source = sourceRef.current
      if (canvas === null || source === null) return
      // Unlaid-out (or jsdom) canvases have no box to shape the buffer by.
      if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return
      const isVideo = source instanceof HTMLVideoElement
      if (isVideo && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      const sourceWidth = isVideo ? source.videoWidth : source.naturalWidth
      const sourceHeight = isVideo ? source.videoHeight : source.naturalHeight
      if (sourceWidth <= 0 || sourceHeight <= 0) return
      // The buffer mirrors the element box's aspect (the frame's), so the
      // CSS stretch to 100%/100% never distorts.
      const width = BACKDROP_BUFFER_WIDTH
      const height = Math.max(1, Math.round((width * canvas.clientHeight) / canvas.clientWidth))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const context = canvas.getContext('2d')
      if (context === null) return
      const dims = orientedDimensions(
        croppedDimensions({ width: sourceWidth, height: sourceHeight }, crop),
        orientation,
      )
      const rect = backdropRect(dims, { width, height })
      withLayerOrientation(context, orientation, rect, (drawRect) => {
        drawLayerSource(context, source, crop, sourceWidth, sourceHeight, drawRect)
      })
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [sourceRef, crop, orientation])
  return (
    <canvas
      ref={canvasRef}
      className="preview-backfill"
      data-testid="preview-backfill-blur"
      aria-hidden="true"
      style={{
        filter: `blur(min(${styleNumber(BACKDROP_BLUR_FRACTION * 100)}cqw, ${styleNumber(BACKDROP_BLUR_FRACTION * 100)}cqh))`,
      }}
    />
  )
}

/**
 * An entry's background-fill backdrop (#259), rendered as its layer card's
 * first child so the fitted media element paints above it and the bars the
 * fit leaves show it: a flat color as a plain div, blur as the sampled
 * canvas. Fill-free entries render nothing at all, keeping their cards'
 * DOM byte-identical (the #255 discipline). Inside the card, the backdrop
 * rides transitions and zooms with the entry — the backdrop is part of the
 * entry's rendered frame, exactly the export's compositing order (#260).
 */
function entryBackdrop(
  entry: TimelineEntry | undefined,
  sourceRef: RefObject<HTMLVideoElement | HTMLImageElement | null>,
) {
  const fill = entry?.backgroundFill
  if (entry === undefined || fill === undefined) return null
  if (fill.kind === 'color') {
    return (
      <div
        className="preview-backfill"
        data-testid="preview-backfill-color"
        style={{ backgroundColor: fill.color }}
      />
    )
  }
  return <BlurBackdrop sourceRef={sourceRef} crop={entry.crop} orientation={entry.orientation} />
}

/**
 * Composes an element's transition styles with its entry's zoom state (#64).
 * The element box is the frame (it fills the stage), so the transform maps a
 * frame fraction p to 0.5 + scale·(p − centre): the visible region
 * centre ± 1/(2·scale) lands exactly on the frame edges. Uniform scale on
 * both axes preserves the aspect ratio by construction, and the reducer's
 * centre clamp keeps the region inside the frame, so nothing beyond a frame
 * edge is ever pulled into view. The clip-path pre-cuts the element to that
 * same region — the piece the transform maps onto the (possibly
 * slide-translated) frame card — so a zoomed element, backing included
 * (#74), never paints outside where its unzoomed card would be, and a
 * zoomed slide still covers exactly its slice of the stage. The identity
 * zoom returns the transition styles untouched, transform format included.
 *
 * `frameClip` is a wipe's reveal rectangle (#181), in the card's own
 * space. Unzoomed it becomes the element's clip-path directly; zoomed it is
 * mapped through the inverse zoom into the element's pre-transform space
 * and intersected with the zoom's own visible region, so one inset carries
 * both cuts — the canvas export nests its two clips the same way.
 *
 * `frameEllipse` is an iris's reveal ellipse (#181), likewise in the card's
 * own space: it becomes a hard-edged radial-gradient mask on the element
 * (mask and clip-path intersect, exactly as the export's nested clips do),
 * mapped through the same inverse zoom when the incoming entry is zoomed.
 */
function withZoom(
  style: CSSProperties | undefined,
  zoom: ZoomState,
  frameClip: TransitionClipRect | null = null,
  frameEllipse: TransitionEllipse | null = null,
): CSSProperties | undefined {
  if (zoom.scale === 1 && frameClip === null && frameEllipse === null) return style
  const { scale, centerX, centerY } = zoom
  const half = 1 / (2 * scale)
  const pct = (value: number) => `${value * 100}%`
  let maskStyle: CSSProperties = {}
  if (frameEllipse !== null) {
    const { radiusFraction, invert } = frameEllipse
    if (radiusFraction === 0 && !invert) {
      // A zero-radius reveal shows nothing; a degenerate zero-size gradient
      // is UB across browsers, so hide the element outright instead.
      maskStyle = { visibility: 'hidden' }
    } else if (radiusFraction === 0 && invert) {
      // A zero-radius hole hides nothing — no mask at all.
    } else {
      // The ellipse is centred on the card (frame fraction 0.5), radii a
      // fraction of each frame dimension; in the element's pre-transform
      // space the inverse zoom moves the centre to the zoom's own centre and
      // divides the radii by the scale. Radial-gradient percentages resolve
      // the horizontal radius against the element width and the vertical one
      // against its height — the same axes the export's canvas ellipse uses.
      const rx = (radiusFraction / scale) * 100
      const ry = (radiusFraction / scale) * 100
      const at = `at ${pct(centerX)} ${pct(centerY)}`
      const stops = invert ? 'transparent 100%, #000 100%' : '#000 100%, transparent 100%'
      const mask = `radial-gradient(ellipse ${rx}% ${ry}% ${at}, ${stops})`
      maskStyle = { maskImage: mask, WebkitMaskImage: mask }
    }
  }
  // The zoom's visible region in the element's pre-transform space; the
  // identity zoom sees the whole element.
  let x0 = centerX - half
  let x1 = centerX + half
  let y0 = centerY - half
  let y1 = centerY + half
  if (frameClip !== null) {
    // Map the card-space rectangle through the inverse zoom (frame fraction
    // q lands at centre + (q − 0.5) / scale) and intersect. A degenerate
    // (zero-area) result clips the element away entirely — progress 0 of a
    // wipe shows nothing of the incoming card.
    const inverseX = (q: number) => centerX + (q - 0.5) / scale
    const inverseY = (q: number) => centerY + (q - 0.5) / scale
    x0 = Math.max(x0, inverseX(frameClip.x))
    x1 = Math.min(x1, inverseX(frameClip.x + frameClip.width))
    y0 = Math.max(y0, inverseY(frameClip.y))
    y1 = Math.min(y1, inverseY(frameClip.y + frameClip.height))
    x1 = Math.max(x0, x1)
    y1 = Math.max(y0, y1)
  }
  const clipPath = `inset(${pct(y0)} ${pct(1 - x1)} ${pct(1 - y1)} ${pct(x0)})`
  if (zoom.scale === 1) return { ...style, clipPath, ...maskStyle }
  return {
    ...style,
    transform: [
      ...(style?.transform ? [style.transform] : []),
      `scale(${scale})`,
      `translate(${pct(0.5 - centerX)}, ${pct(0.5 - centerY)})`,
    ].join(' '),
    clipPath,
    ...maskStyle,
  }
}

/**
 * Plays the timeline sequence — each entry from its in-point to its
 * out-point, in order — through two stacked <video> elements. Outside a
 * transition only the primary element is visible and plays the current
 * entry, src-switching at hard cuts exactly as before. Inside a transition
 * overlap (#42) the secondary element plays the incoming entry on top of the
 * still-playing outgoing one, styled by the transition's progress; when the
 * outgoing entry ends the elements swap roles, so the incoming clip never
 * has to be re-cued at the handover.
 *
 * Still entries (#140) render as an <img> in the same stacked slots, styled
 * by the same transition/zoom mapping; having no element clock, a fronting
 * still is timed by a wall clock the rAF loop advances while playing.
 */
export function PreviewPlayer({
  timeline,
  expanded = false,
  onToggleExpanded,
  onSplit,
  onFreezeFrame,
  stepSeconds,
  largeStepSeconds,
}: PreviewPlayerProps) {
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  // The still layers' <img> elements (#140) — what a blur backdrop (#259)
  // samples when a still fronts (or transitions into) the sequence.
  const stillImageRef = useRef<HTMLImageElement>(null)
  const stillIncomingImageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef(0)
  // The entry index the primary element is currently cued to. The ref is for
  // the rAF loop, which reads and writes it between renders; the state mirror
  // is what the render fronts, so an entry the player has already left is
  // never painted again even while the published sequence time still trails
  // inside the overlap it just finished (#318 — the same clock drift #61
  // fixed on the incoming side).
  const indexRef = useRef(0)
  const [playedIndex, setPlayedIndex] = useState(0)
  // A still entry has no element clock (#140): while one fronts the
  // sequence, this wall clock stands in for `video.currentTime`, advanced
  // by the rAF loop only while playing (so pausing freezes it for free).
  const stillClockRef = useRef<{ sourceTime: number; lastNow: number } | null>(null)
  // An active pause plateau on the fronting entry (#141): the element is
  // paused on the frozen instant (`at`, relative to the entry's in-point)
  // while this wall clock — the still clock's pattern — advances the
  // sequence's output position from `outputNow` to `outputEnd` (output
  // seconds into the entry). Advanced only while playing, so pausing the
  // preview freezes the hold too.
  const holdRef = useRef<{ at: number; outputEnd: number; outputNow: number; lastNow: number } | null>(
    null,
  )
  // The fronting video entry's last observed source position relative to its
  // in-point, for detecting that the element's clock crossed a pause instant
  // between frames (#141). Reset on every cue.
  const lastRelSourceRef = useRef(0)
  // Which element is primary: a ref for the rAF loop, mirrored into state so
  // the render can assign roles (testids, stacking, transition styles).
  const primaryIsARef = useRef(true)
  const [primaryIsA, setPrimaryIsA] = useState(true)
  // Outgoing-entry index the secondary element is engaged for, or null while
  // it is idle. Prevents re-cueing the incoming clip on every overlap frame.
  // The ref is for the rAF loop; the state mirror is what the render keys
  // the overlay on, so a role swap hides the outgoing element immediately
  // even while the published sequence time still trails inside the overlap
  // (#61 — element clocks drift, so that happens routinely at handover).
  const engagedForRef = useRef<number | null>(null)
  const [engagedFor, setEngagedFor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [sequenceTime, setSequenceTime] = useState(0)
  // The keyboard-shortcut cheat sheet (#203), opened with `?`.
  const [helpOpen, setHelpOpen] = useState(false)
  // Save frame (#237): one snapshot at a time; a failure reports where the
  // transport lives rather than failing silently.
  const [savingFrame, setSavingFrame] = useState(false)
  const [saveFrameError, setSaveFrameError] = useState<string | null>(null)
  // Freeze frame (#379): same one-at-a-time and error discipline as Save
  // frame; the placement choice is transport-local UI state, not project
  // state — it configures the next freeze, it does not describe this one.
  const [freezing, setFreezing] = useState(false)
  const [freezeError, setFreezeError] = useState<string | null>(null)
  const [freezePlacement, setFreezePlacement] = useState<FreezePlacementMode>('split')
  // Intrinsic dimensions per source URL, probed off-DOM as sources join the
  // sequence, feeding the shared output-frame rule (frameSize.ts, #176) that
  // shapes the preview frame. Sources still probing simply don't contribute
  // yet (the frame settles as metadata arrives — in-memory blob metadata, so
  // effectively immediately).
  const [sourceDims, setSourceDims] = useState<ReadonlyMap<string, SourceDimensions>>(
    () => new Map(),
  )

  const total = totalDuration(timeline)
  const empty = timeline.entries.length === 0
  const audioTracks = audioTracksOf(timeline)
  // One <audio> element per track, keyed by track id (#103). A ref map, not
  // state: the rAF loop reads it every frame.
  const audioRefs = useRef(new Map<string, HTMLAudioElement | null>())
  const videoOverlays = videoOverlaysOf(timeline)
  // One <video> element per overlay layer (#145), keyed by overlay id —
  // rendered inside the stage at its rectangle, synced like an audio track.
  const overlayRefs = useRef(new Map<string, HTMLVideoElement | null>())
  // Duck windows (#241), resolved once per timeline change: every gain
  // assignment below multiplies in the shared duck factor, exactly as the
  // export mix does, so the two renders duck identically.
  const ducking = useMemo(() => duckWindows(timeline), [timeline])

  const primaryVideo = () => (primaryIsARef.current ? videoARef.current : videoBRef.current)
  const secondaryVideo = () => (primaryIsARef.current ? videoBRef.current : videoARef.current)

  /**
   * Aligns every audio track element with a sequence position (#103): a
   * track whose window covers the position plays from the matching source
   * time while `running`, and is paused otherwise. Its volume is set to the
   * track's effective gain at that position on every call — the rAF loop
   * calls this each frame, which is what renders fades as continuous ramps
   * (#104). Elements are re-cued exactly when they start; while running they
   * keep their own clock unless it drifts audibly. Each element keeps a
   * single source for the track's lifetime (src set in the render), so
   * cueing is only ever a seek — never the video elements' src-switch dance.
   */
  const syncAudioTracks = useCallback(
    (sequenceTime: number, running: boolean) => {
      for (const track of audioTracks) {
        const element = audioRefs.current.get(track.id)
        if (!element) continue
        const { shouldPlay, sourceTime } = audioTrackPlaybackAt(track, sequenceTime)
        element.volume =
          audioTrackGainAt(track, sequenceTime) * trackDuckFactorAt(track, ducking, sequenceTime)
        if (shouldPlay && running) {
          if (element.paused) {
            element.currentTime = sourceTime
            // play() rejects (AbortError) when interrupted by pause — an
            // expected outcome, matching the video elements.
            element.play().catch(() => {})
          } else if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        } else {
          if (!element.paused) element.pause()
          // Keep the paused element cued to the position (its in-point while
          // the position is before the window) so resuming starts aligned.
          if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        }
      }
    },
    [audioTracks, ducking],
  )

  const pauseAudioTracks = useCallback(() => {
    for (const element of audioRefs.current.values()) {
      if (element && !element.paused) element.pause()
    }
  }, [])

  /**
   * Aligns every overlay video layer's element with a sequence position
   * (#145), exactly as syncAudioTracks aligns the audio tracks — the same
   * window math (`audioTrackPlaybackAt` applies structurally: offset +
   * trim, half-open) and the same drift tolerance. Volume is the overlay's
   * own volume × mute × fade envelope (`videoOverlayGainAt`, #220), set
   * every call — the rAF loop calls this each frame, which is what renders
   * fades as continuous ramps, as for the audio tracks. Each element keeps
   * a single source for the overlay's lifetime (src set in the render), so
   * cueing is only ever a seek.
   */
  const syncVideoOverlays = useCallback(
    (sequenceTime: number, running: boolean) => {
      for (const overlay of videoOverlays) {
        // A still overlay (#294) has no media element to drive: it is
        // soundless and renders declaratively from the published time.
        if (isImageOverlay(overlay)) continue
        const element = overlayRefs.current.get(overlay.id)
        if (!element) continue
        const { shouldPlay, sourceTime } = audioTrackPlaybackAt(overlay, sequenceTime)
        element.volume =
          videoOverlayGainAt(overlay, sequenceTime) * duckFactorAt(ducking, sequenceTime)
        if (shouldPlay && running) {
          if (element.paused) {
            element.currentTime = sourceTime
            // play() rejects (AbortError) when interrupted by pause — an
            // expected outcome, matching the other media elements.
            element.play().catch(() => {})
          } else if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        } else {
          if (!element.paused) element.pause()
          // Keep the paused element cued to the position (its in-point while
          // the position is before the window) so resuming starts aligned —
          // and so a paused scrub through the window shows the right frame.
          if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        }
      }
    },
    [videoOverlays, ducking],
  )

  const pauseVideoOverlays = useCallback(() => {
    for (const element of overlayRefs.current.values()) {
      if (element && !element.paused) element.pause()
    }
  }, [])

  /** Single writer for the engagement, keeping the ref and its state mirror in step. */
  const setEngaged = useCallback((value: number | null) => {
    engagedForRef.current = value
    setEngagedFor(value)
  }, [])

  /** Single writer for the played index, keeping the ref and its mirror in step. */
  const setIndex = useCallback((value: number) => {
    indexRef.current = value
    setPlayedIndex(value)
  }, [])

  /**
   * Cues one element to a source time, switching src when it plays a
   * different source clip. currentTime is only settable once metadata is
   * loaded, so after a src switch the seek (and optional play) waits for
   * loadedmetadata. `rate` is the remapped playback rate at the cue point
   * (#141) — set with the seek so a cue into a speed segment starts at the
   * segment's speed rather than at whatever the element last played.
   */
  const cueElement = useCallback(
    (video: HTMLVideoElement, url: string, sourceTime: number, thenPlay: boolean, rate = 1) => {
      const start = () => {
        video.playbackRate = rate
        video.currentTime = sourceTime
        // play() rejects (AbortError) when interrupted by pause or a src
        // switch — an expected outcome here, not an error to surface.
        if (thenPlay) video.play().catch(() => {})
      }
      if (video.currentSrc !== url) {
        video.src = url
        video.addEventListener('loadedmetadata', start, { once: true })
      } else {
        start()
      }
    },
    [],
  )

  /**
   * Cues the primary element to a position given as *output* seconds into
   * the entry (#141) — the remapped currency locateInSequence's results are
   * found at — resolving the source instant, playback rate, and (inside a
   * pause plateau) the hold to freeze through via remapPlaybackAt. For an
   * entry without effects this is the identity: source = output, rate 1,
   * never a hold.
   */
  const cuePrimary = useCallback(
    (location: PlaybackLocation, outputInto: number, thenPlay: boolean) => {
      const video = primaryVideo()
      if (!video) return
      setIndex(location.index)
      holdRef.current = null
      if (isStillEntry(location.entry)) {
        // A still fronts declaratively (#140): its <img> renders from the
        // published location, so cueing is just starting its wall clock;
        // the idle primary video element must not keep sounding underneath.
        stillClockRef.current = { sourceTime: location.sourceTime, lastNow: performance.now() }
        if (!video.paused) video.pause()
        return
      }
      stillClockRef.current = null
      const trimmed = effectiveDuration(location.entry)
      const state = remapPlaybackAt(trimmed, remapsForEntry(timeline, location.entry.id), outputInto)
      lastRelSourceRef.current = state.sourceTime
      if (state.hold) {
        // Inside a pause plateau: freeze the element on the instant's frame;
        // the rAF loop advances the hold while playing.
        holdRef.current = {
          at: state.sourceTime,
          outputEnd: state.hold.outputEnd,
          outputNow: Math.min(Math.max(outputInto, state.hold.outputStart), state.hold.outputEnd),
          lastNow: performance.now(),
        }
        if (!video.paused) video.pause()
        cueElement(video, location.entry.url, location.entry.inPoint + state.sourceTime, false)
      } else {
        cueElement(
          video,
          location.entry.url,
          location.entry.inPoint + state.sourceTime,
          thenPlay,
          state.rate,
        )
      }
    },
    [cueElement, setIndex, timeline],
  )

  /**
   * Aligns the secondary element with a location: inside an overlap it is
   * cued to the incoming entry and the two elements' audio is split by the
   * transition's progress (a volume crossfade, for both transition types);
   * outside one it is silenced and paused. Every volume routes through the
   * composed gain (#104), so a muted or reduced entry stays that way through
   * a transition.
   */
  const syncSecondary = useCallback(
    (location: PlaybackLocation, thenPlay: boolean, sequenceTime: number) => {
      const primary = primaryVideo()
      const secondary = secondaryVideo()
      if (!primary || !secondary) return
      const overlap = location.transition
      // Output seconds into the fronting entry — the position its fade
      // envelope (#220) is evaluated at, like every gain call here.
      const outputInto = sequenceTime - entryStartTime(timeline, location.index)
      // Video-entry audio ducks with the rest of the mix (#241).
      const duck = duckFactorAt(ducking, sequenceTime)
      const outputLength = entryOutputDuration(location.entry, remapsOf(timeline))
      if (overlap) {
        // A still layer has no audio to ramp (#140); only video elements
        // carry gain through the crossfade.
        if (!isStillEntry(location.entry)) {
          primary.volume =
            videoEntryGainAt(location.entry, outputInto, outputLength, 1 - overlap.progress) * duck
        }
        setEngaged(location.index)
        if (isStillEntry(overlap.entry)) {
          // The incoming still renders declaratively — nothing to cue, and
          // whatever clip the secondary element held must not keep playing.
          if (!secondary.paused) secondary.pause()
        } else {
          const duration = boundaryTransitions(timeline)[location.index]?.duration ?? 0
          secondary.volume =
            videoEntryGainAt(
              overlap.entry,
              overlap.progress * duration,
              entryOutputDuration(overlap.entry, remapsOf(timeline)),
              overlap.progress,
            ) * duck
          // The incoming entry's remap state at this point of the overlap
          // (#141): output seconds into it are the overlap's elapsed output.
          const inState = remapPlaybackAt(
            effectiveDuration(overlap.entry),
            remapsForEntry(timeline, overlap.entry.id),
            overlap.progress * duration,
          )
          cueElement(
            secondary,
            overlap.entry.url,
            overlap.sourceTime,
            thenPlay && inState.hold === null,
            inState.hold === null ? inState.rate : 1,
          )
        }
      } else {
        if (!isStillEntry(location.entry)) {
          primary.volume = videoEntryGainAt(location.entry, outputInto, outputLength) * duck
        }
        if (engagedForRef.current !== null) {
          setEngaged(null)
          secondary.pause()
        }
      }
    },
    [cueElement, setEngaged, timeline, ducking],
  )

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
  }, [])

  /**
   * Per-frame while playing: publish the current sequence position, run the
   * transition overlap (engage the secondary element, split the audio), and
   * when the outgoing clip reaches its out-point (or actually ends) either
   * hand over to the next entry or finish the sequence.
   *
   * Under time remapping (#141) the entry's position is tracked in *output*
   * seconds into it: outside a pause the element clock is authoritative and
   * maps to output through the entry's effects (its rate driven to the
   * active segment's factor); inside a pause the element freezes on the
   * instant's frame and the hold's wall clock is authoritative. An entry
   * without effects reduces exactly to the pre-remap math.
   */
  const tick = useCallback(() => {
    const video = primaryVideo()
    if (!video) return
    const index = indexRef.current
    const entry = timeline.entries[index]
    if (!entry) return
    const next = timeline.entries[index + 1]
    const overlap = boundaryTransitions(timeline)[index]
    const still = isStillEntry(entry)
    const effects = still ? [] : remapsForEntry(timeline, entry.id)
    const trimmed = effectiveDuration(entry)

    // The fronting entry's source-clip clock: the element's for a video, the
    // wall clock for a still (#140), advanced here — only while playing —
    // so pausing freezes it and edits/seeks reset it via cuePrimary.
    let sourceTime: number
    // Output seconds into the entry at this frame — what the sequence
    // position and transition progress are measured in (#141). For an entry
    // with no effects it equals sourceTime − inPoint.
    let outputInto: number
    // Whether the entry has played out: its source consumed *and* no pause
    // still holding or left to hold.
    let reachedOut = false
    if (still) {
      const clock = stillClockRef.current
      if (!clock) return
      const now = performance.now()
      clock.sourceTime += (now - clock.lastNow) / 1000
      clock.lastNow = now
      sourceTime = clock.sourceTime
      outputInto = sourceTime - entry.inPoint
      reachedOut = sourceTime >= entry.outPoint - BOUNDARY_EPSILON
    } else if (holdRef.current) {
      // A pause plateau in progress: the element stays frozen while the wall
      // clock advances the output position through the hold.
      const hold = holdRef.current
      const now = performance.now()
      hold.outputNow += (now - hold.lastNow) / 1000
      hold.lastNow = now
      sourceTime = entry.inPoint + hold.at
      if (hold.outputNow < hold.outputEnd) {
        outputInto = hold.outputNow
      } else {
        outputInto = hold.outputEnd
        // Plateau over: re-resolve the position rather than assume playback
        // resumes — a second pause at the same instant plateaus again right
        // where this one ends (#153), so back-to-back holds chain into
        // their combined duration instead of the sequence clock jumping
        // over the later one. Chained plateaus share the frozen instant, so
        // the element simply stays paused where it is.
        const chained = remapPlaybackAt(trimmed, effects, hold.outputEnd)
        if (chained.hold !== null && chained.hold.outputEnd > hold.outputEnd) {
          holdRef.current = {
            at: chained.sourceTime,
            outputEnd: chained.hold.outputEnd,
            outputNow: hold.outputEnd,
            lastNow: now,
          }
          lastRelSourceRef.current = chained.sourceTime
        } else if (hold.at < trimmed - BOUNDARY_EPSILON && !video.ended) {
          // Resume the element from the frozen instant — unless the entry's
          // source is already consumed (an end-of-entry pause), in which
          // case the branch below hands over. play() on an ended element
          // would restart it from the beginning.
          holdRef.current = null
          lastRelSourceRef.current = hold.at
          video.playbackRate = rateAtSourceTime(effects, hold.at)
          video.play().catch(() => {})
        } else {
          holdRef.current = null
          lastRelSourceRef.current = hold.at
          reachedOut = true
        }
      }
    } else {
      sourceTime = video.currentTime
      const relSource = sourceTime - entry.inPoint
      const sourceDone = relSource >= trimmed - BOUNDARY_EPSILON || video.ended
      // Crossing a pause instant between frames starts its hold (#141):
      // freeze the element on the instant's frame. An end-of-entry pause is
      // reached through `sourceDone` — the element clock stops just short of
      // the exact out-point.
      const crossed = effects.find(
        (effect) =>
          effect.kind === 'pause' &&
          effect.at > lastRelSourceRef.current &&
          (effect.at <= relSource || sourceDone),
      )
      if (crossed !== undefined && crossed.kind === 'pause') {
        video.pause()
        video.currentTime = entry.inPoint + crossed.at
        const outputStart = outputTimeAtSource(trimmed, effects, crossed.at)
        holdRef.current = {
          at: crossed.at,
          outputEnd: outputStart + crossed.hold,
          outputNow: outputStart,
          lastNow: performance.now(),
        }
        lastRelSourceRef.current = crossed.at
        sourceTime = entry.inPoint + crossed.at
        outputInto = outputStart
      } else {
        lastRelSourceRef.current = relSource
        const rate = rateAtSourceTime(effects, relSource)
        if (video.playbackRate !== rate) video.playbackRate = rate
        outputInto = outputTimeAtSource(trimmed, effects, relSource)
        reachedOut = sourceDone
      }
    }

    if (reachedOut) {
      if (next && overlap && isStillEntry(next)) {
        // Handover into a still (#140): nothing was cued — the incoming
        // still has been rendering declaratively through the overlap — so
        // just start its wall clock where the overlap ends.
        if (!still) video.pause()
        setEngaged(null)
        setIndex(index + 1)
        stillClockRef.current = {
          sourceTime: next.inPoint + overlap.duration,
          lastNow: performance.now(),
        }
        const time = sequenceTimeAt(timeline, index + 1, next.inPoint + overlap.duration)
        setSequenceTime(time)
        syncAudioTracks(time, true)
        syncVideoOverlays(time, true)
      } else if (next && overlap) {
        // Handover mid-transition: the incoming entry is already playing in
        // the secondary element — promote it to primary instead of re-cueing.
        const incoming = secondaryVideo()
        if (!incoming) return
        const wasEngaged = engagedForRef.current === index
        if (!still) video.pause()
        // The incoming entry leaves its transition ramp for its own gain at
        // the handover point — overlap.duration output seconds in (#220);
        // the outgoing element is paused, its volume set when next cued.
        incoming.volume =
          videoEntryGainAt(next, overlap.duration, entryOutputDuration(next, remapsOf(timeline))) *
          duckFactorAt(ducking, entryStartTime(timeline, index + 1) + overlap.duration)
        setEngaged(null)
        setIndex(index + 1)
        stillClockRef.current = null
        primaryIsARef.current = !primaryIsARef.current
        setPrimaryIsA(primaryIsARef.current)
        const nextEffects = remapsForEntry(timeline, next.id)
        if (wasEngaged && nextEffects.length === 0) {
          const time = sequenceTimeAt(timeline, index + 1, incoming.currentTime)
          setSequenceTime(time)
          syncAudioTracks(time, true)
          syncVideoOverlays(time, true)
          holdRef.current = null
          lastRelSourceRef.current = incoming.currentTime - next.inPoint
          if (incoming.playbackRate !== 1) incoming.playbackRate = 1
        } else {
          // A remapped incoming entry (or an overlap shorter than a frame,
          // where engagement raced the out-point): land on the geometric
          // handover point — overlap.duration output seconds into the
          // incoming entry — and let cuePrimary resolve its rate or hold.
          // For an already-engaged element this is at most a drift-sized
          // snap.
          const time = entryStartTime(timeline, index + 1) + overlap.duration
          setSequenceTime(time)
          syncAudioTracks(time, true)
          syncVideoOverlays(time, true)
          cuePrimary({ index: index + 1, entry: next, sourceTime: next.inPoint }, overlap.duration, true)
        }
      } else if (next) {
        const time = entryStartTime(timeline, index + 1)
        setSequenceTime(time)
        syncAudioTracks(time, true)
        syncVideoOverlays(time, true)
        // A hard cut continues in the same element — apply the next entry's
        // gain (#104) at its start where the transition path would have
        // swapped roles. (A still has no element or gain; cuePrimary starts
        // its clock.)
        if (!isStillEntry(next)) {
          video.volume =
            videoEntryGainAt(next, 0, entryOutputDuration(next, remapsOf(timeline))) *
            duckFactorAt(ducking, time)
        }
        cuePrimary({ index: index + 1, entry: next, sourceTime: next.inPoint }, 0, true)
      } else {
        video.pause()
        secondaryVideo()?.pause()
        setPlaying(false)
        setSequenceTime(totalDuration(timeline))
        // End of the video sequence ends the mix: any track still inside its
        // window (a silent tail per #102) pauses with everything else.
        pauseAudioTracks()
        pauseVideoOverlays()
        return
      }
    } else {
      const time = entryStartTime(timeline, index) + outputInto
      setSequenceTime(time)
      // Tracks start and stop mid-play as the position crosses their
      // windows, and drifting clocks are snapped back (#103).
      syncAudioTracks(time, true)
      syncVideoOverlays(time, true)
      const outDuration = entryOutputDuration(entry, remapsOf(timeline))
      // The entry's own gain every frame (#220), ducked with the rest of the
      // mix (#241): its fade envelope ramps continuously, exactly as the
      // audio tracks' do. Inside a transition overlap the branch below
      // re-sets it with the crossfade ramp.
      const duck = duckFactorAt(ducking, time)
      if (!still) video.volume = videoEntryGainAt(entry, outputInto, outDuration) * duck
      if (next && overlap) {
        // The overlap plays out in output seconds (#141): it starts where
        // the entry's remaining *output* equals the transition's duration —
        // for an entry without effects, exactly the old source-time math.
        const overlapStartOut = outDuration - overlap.duration
        if (outputInto >= overlapStartOut) {
          const progress = Math.min((outputInto - overlapStartOut) / overlap.duration, 1)
          if (isStillEntry(next)) {
            // The incoming still renders declaratively from the published
            // time (#140) — engagement just marks the overlay active. Only
            // the outgoing side has audio to ramp.
            if (engagedForRef.current !== index) setEngaged(index)
            if (!still) {
              video.volume = videoEntryGainAt(entry, outputInto, outDuration, 1 - progress) * duck
            }
          } else {
            const secondary = secondaryVideo()
            if (secondary) {
              // The incoming entry's remap state this far into the overlap
              // (#141): where its source should stand, at what rate — or
              // frozen inside a pause plateau. Its element free-runs between
              // frames; the published mapping is authoritative, so a clock
              // that strays visibly is snapped back (the drift correction,
              // now against the remapped mapping).
              const inState = remapPlaybackAt(
                effectiveDuration(next),
                remapsForEntry(timeline, next.id),
                outputInto - overlapStartOut,
              )
              const expected = next.inPoint + inState.sourceTime
              if (engagedForRef.current !== index) {
                setEngaged(index)
                cueElement(
                  secondary,
                  next.url,
                  expected,
                  inState.hold === null,
                  inState.hold === null ? inState.rate : 1,
                )
              } else if (inState.hold !== null) {
                if (!secondary.paused) secondary.pause()
                if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                  secondary.currentTime = expected
                }
              } else {
                if (secondary.playbackRate !== inState.rate) secondary.playbackRate = inState.rate
                if (secondary.paused) {
                  secondary.currentTime = expected
                  secondary.play().catch(() => {})
                } else if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                  secondary.currentTime = expected
                }
              }
              if (!still) {
                video.volume = videoEntryGainAt(entry, outputInto, outDuration, 1 - progress) * duck
              }
              secondary.volume =
                videoEntryGainAt(
                  next,
                  outputInto - overlapStartOut,
                  entryOutputDuration(next, remapsOf(timeline)),
                  progress,
                ) * duck
            }
          }
        }
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [timeline, cueElement, cuePrimary, setEngaged, setIndex, syncAudioTracks, syncVideoOverlays, pauseAudioTracks, pauseVideoOverlays, ducking])

  const play = useCallback(() => {
    // Play from the end restarts the sequence.
    const from = sequenceTime >= total ? 0 : sequenceTime
    const location = locateInSequence(timeline, from)
    if (!location) return
    setPlaying(true)
    setSequenceTime(from)
    cuePrimary(location, from - entryStartTime(timeline, location.index), true)
    syncSecondary(location, true, from)
    syncAudioTracks(from, true)
    syncVideoOverlays(from, true)
    stopLoop()
    frameRef.current = requestAnimationFrame(tick)
  }, [sequenceTime, total, timeline, cuePrimary, syncSecondary, syncAudioTracks, syncVideoOverlays, stopLoop, tick])

  const pause = useCallback(() => {
    stopLoop()
    primaryVideo()?.pause()
    secondaryVideo()?.pause()
    pauseAudioTracks()
    pauseVideoOverlays()
    setPlaying(false)
  }, [stopLoop, pauseAudioTracks, pauseVideoOverlays])

  /**
   * Save frame (#237): compose the playhead's frame through the export's own
   * draw path (frameSnapshot.ts) at the output resolution and download it as
   * a PNG. The snapshot cues its own off-DOM elements, so it neither
   * disturbs playback nor reads the on-screen preview.
   */
  const saveFrame = () => {
    if (savingFrame || timeline.entries.length === 0) return
    setSavingFrame(true)
    setSaveFrameError(null)
    const time = Math.min(sequenceTime, total)
    void (async () => {
      try {
        const blob = await snapshotTimelineFrame(timeline, time)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = frameFileName(time)
        anchor.click()
        URL.revokeObjectURL(url)
      } catch (error) {
        setSaveFrameError(error instanceof Error ? error.message : 'Saving the frame failed.')
      } finally {
        setSavingFrame(false)
      }
    })()
  }

  /**
   * Freeze frame (#379): capture the playhead's composed frame — the exact
   * Save frame snapshot, at the export's own output frame — and hand it to
   * App with the placement resolved at the moment of the click, which is
   * when the freeze semantically happens (#316: a snapshot of the
   * composition, never a live reference). The reducer re-validates the
   * placement, so a timeline that changed under the capture refuses cleanly
   * instead of freezing onto the wrong entry.
   */
  const freezeFrame = () => {
    if (freezing || onFreezeFrame === undefined) return
    const time = Math.min(sequenceTime, total)
    const target = freezeTargetAt(timeline, time, freezePlacement)
    if (target === null) return
    setFreezing(true)
    setFreezeError(null)
    void (async () => {
      try {
        // The explicit frame keeps the clip's recorded dimensions and the
        // captured pixels the same derivation (#274's automatic rule).
        const frame = await automaticExportFrame(timeline)
        const blob = await snapshotTimelineFrame(timeline, time, { frame })
        onFreezeFrame(blob, frame, time, target)
      } catch (error) {
        setFreezeError(error instanceof Error ? error.message : 'Freezing the frame failed.')
      } finally {
        setFreezing(false)
      }
    })()
  }

  const seek = useCallback(
    (time: number) => {
      const location = locateInSequence(timeline, time)
      if (!location) return
      setSequenceTime(time)
      cuePrimary(location, time - entryStartTime(timeline, location.index), playing)
      syncSecondary(location, playing, time)
      // Scrubbing re-cues every track: active ones re-seek (and keep playing
      // if we are playing), the rest pause where they would next start.
      syncAudioTracks(time, playing)
      syncVideoOverlays(time, playing)
    },
    [timeline, cuePrimary, syncSecondary, syncAudioTracks, syncVideoOverlays, playing],
  )

  // Transport keyboard shortcuts (#203): Space play/pause, arrow stepping,
  // Home/End jumps, and ? for the cheat sheet. Window-level like the #189
  // undo/redo handler in App (which requires Ctrl/Cmd, so the two never
  // claim the same event); inert while focus sits on a control with its own
  // keyboard behavior (a text field keeps its typing, a button keeps
  // Space-to-activate, the seek slider keeps its arrows) or while any modal
  // dialog is open — the export modal, a removal confirmation, or the cheat
  // sheet itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = transportActionForKey(event, {
        step: stepSeconds,
        largeStep: largeStepSeconds,
      })
      if (action === null) return
      if (targetClaimsKeys(event.target) || modalDialogOpen(document)) return
      event.preventDefault()
      switch (action.kind) {
        case 'toggle-play':
          if (playing) pause()
          else play()
          break
        case 'step':
          // Stepping routes through seek(), so the stepped frame renders
          // exactly as an equivalent slider seek would — text overlays,
          // transitions, and remaps all reflect the new time. From a
          // position past the end (stale after an edit) a step re-clamps.
          seek(stepTarget(Math.min(sequenceTime, total), action.delta, total))
          break
        case 'jump':
          seek(action.to === 'start' ? 0 : total)
          break
        case 'shortcut-help':
          setHelpOpen(true)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playing, play, pause, seek, sequenceTime, total, stepSeconds, largeStepSeconds])

  // Edits to the timeline invalidate the playback position (entries or
  // tracks may be gone, reordered, or retrimmed): stop and re-clamp rather
  // than guessing.
  useEffect(() => {
    stopLoop()
    for (const video of [videoARef.current, videoBRef.current]) {
      if (video && !video.paused) video.pause()
    }
    pauseAudioTracks()
    pauseVideoOverlays()
    setEngaged(null)
    // The played index (#318) is position state like the rest: after an edit
    // the entry it named may be gone or renumbered, so it stops guarding
    // anything until the next cue re-establishes it. Index 0 can never be
    // ahead of a location, so the guard is simply inert until then.
    setIndex(0)
    holdRef.current = null
    setPlaying(false)
    setSequenceTime((time) => Math.min(time, totalDuration(timeline)))
  }, [timeline, stopLoop, setEngaged, setIndex, pauseAudioTracks, pauseVideoOverlays])

  useEffect(() => stopLoop, [stopLoop])

  // The published position, readable outside the reactive graph: the
  // idle-cue effect below must not re-run on every published frame (that is
  // just playback), only when the content or idleness changes.
  const sequenceTimeRef = useRef(0)
  useEffect(() => {
    sequenceTimeRef.current = sequenceTime
  }, [sequenceTime])

  // Idle frame (#382): the video elements have no declarative src — cueing
  // is imperative, and before this effect it only happened on play, seek,
  // and the rAF tick. A player never yet played or seeked (the first clip
  // added, a restored session) therefore held an element with no media at
  // all, rendering black. Whenever the timeline changes while the player is
  // idle — mount with restored content, the first add, any edit — cue the
  // primary element to the frame under the playhead, paused: exactly the
  // frame a slider seek to this position would show, trim and remaps
  // included (cuePrimary resolves both). While playing this does nothing —
  // the rAF loop owns the elements — and on pause the re-cue lands on the
  // published position the pause itself just left, within the drift
  // tolerances, so it never fights the #318/#61 handover discipline.
  useEffect(() => {
    if (playing) return
    const time = Math.min(sequenceTimeRef.current, totalDuration(timeline))
    const location = locateInSequence(timeline, time)
    if (location === null) return
    cuePrimary(location, time - entryStartTime(timeline, location.index), false)
  }, [playing, timeline, cuePrimary])

  // Never front an entry the player has already left (#318): at a handover
  // the published time comes off the incoming element's lagging clock, so the
  // raw location can still name the entry whose transition just ended.
  const location = frontedLocation(timeline, locateInSequence(timeline, sequenceTime), playedIndex)
  // What the Split control would cut at the playhead (#190), or null where
  // splitting is disabled. Clamped like the seek slider's value, so a
  // published time past the end reads as the end (not splittable).
  const splitTarget = splitTargetAt(timeline, Math.min(sequenceTime, total))
  // Whether Freeze frame (#379) has anything to freeze here in the chosen
  // placement — null exactly where the snapshot has no frame to compose.
  const freezeTarget = freezeTargetAt(timeline, Math.min(sequenceTime, total), freezePlacement)
  // Gate the overlay on the actual engagement, not the recomputed location
  // alone: right after a handover the published time can still trail inside
  // the overlap, and then the top-layer element holds the outgoing clip (#61).
  const overlap = isTransitionOverlayActive(location, engagedFor)
    ? location?.transition
    : undefined

  const layerStyles = overlap ? transitionLayerStyles(overlap) : undefined
  // Which layers are stills (#140): a still renders in the same stacked slot
  // a video element would occupy, styled identically — an <img> for an image
  // still, a solid-color div for a slate (#143).
  const stillPrimary = location !== null && isStillEntry(location.entry)
  const stillIncoming = overlap !== undefined && isStillEntry(overlap.entry)
  const slatePrimary = location !== null && isSlateEntry(location.entry)
  const slateIncoming = overlap !== undefined && isSlateEntry(overlap.entry)

  // Every real source's intrinsic dimensions, read via off-DOM metadata-only
  // elements: the stacked elements are cued lazily (on play or seek), so
  // their own metadata may not exist before anything played — and the frame
  // rule (#176) needs *all* sources, fronting or not, exactly like the
  // export's sizing pass. Blob metadata is in memory — this is cheap. An
  // image still probes through an <img> (#140), a video cannot decode it.
  // Slates (#143) have no dimensions of their own and overlay layers
  // deliberately never shape the frame (#145), so neither is probed. The
  // signature string keys the effect on the distinct source set, not on the
  // entries array's identity, so ordinary edits don't re-probe anything.
  const probeSignature = useMemo(() => {
    const targets: string[] = []
    const seen = new Set<string>()
    for (const entry of timeline.entries) {
      if (isSlateEntry(entry) || seen.has(entry.url)) continue
      seen.add(entry.url)
      targets.push(`${isStillEntry(entry) ? 'image' : 'video'} ${entry.url}`)
    }
    // Overlay sources are probed too (#255) — their crop placement needs
    // the source's aspect — but the frame rule above still reads only the
    // base entries, so overlays keep never shaping the frame (#145).
    for (const overlay of videoOverlaysOf(timeline)) {
      if (seen.has(overlay.url)) continue
      seen.add(overlay.url)
      // A still overlay's source is decoded as an image (#294), exactly as a
      // still entry's is — its aspect is what crop placement needs too.
      targets.push(`${isImageOverlay(overlay) ? 'image' : 'video'} ${overlay.url}`)
    }
    return targets.join('\n')
  }, [timeline])
  useEffect(() => {
    if (probeSignature === '') {
      setSourceDims(new Map())
      return undefined
    }
    let stale = false
    const found = new Map<string, SourceDimensions>()
    const cleanups: Array<() => void> = []
    for (const target of probeSignature.split('\n')) {
      const separator = target.indexOf(' ')
      const kind = target.slice(0, separator)
      const url = target.slice(separator + 1)
      const record = (width: number, height: number) => {
        if (stale || width <= 0 || height <= 0) return
        found.set(url, { width, height })
        setSourceDims(new Map(found))
      }
      if (kind === 'image') {
        const probe = new Image()
        probe.onload = () => record(probe.naturalWidth, probe.naturalHeight)
        probe.src = url
        cleanups.push(() => {
          probe.onload = null
          probe.removeAttribute('src')
        })
      } else {
        const probe = document.createElement('video')
        probe.preload = 'metadata'
        probe.addEventListener(
          'loadedmetadata',
          () => record(probe.videoWidth, probe.videoHeight),
          { once: true },
        )
        probe.src = url
        cleanups.push(() => probe.removeAttribute('src'))
      }
    }
    return () => {
      stale = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [probeSignature])

  // The output frame the preview letterboxes into (#176): the shared rule
  // over the current entries' known dimensions, composed with the project's
  // canvas preset (#273) — Auto is that rule untouched. Until anything is
  // known the fallback frame (16:9) applies — the historical default — and a
  // preset reshapes that fallback the same way it reshapes a real frame.
  //
  // Everything frame-relative follows from this one value: the stage's
  // aspect, and the letterboxing of each layer inside it. Overlay rectangles
  // (#145), text positions (#139) and zoom centres (#64) are fractions of
  // this frame, so they need no migration when the preset changes — they
  // stay proportional, which the component tests pin rather than assume.
  const frame = canvasFrameSize(
    timeline.entries.flatMap((entry) => {
      if (isSlateEntry(entry)) return []
      const dims = sourceDims.get(entry.url)
      // A cropped source presents its kept region (#255), then an oriented
      // source its oriented shape (#232), to the frame rule — crop before
      // orientation: a quarter-turned landscape clip is a portrait source.
      return dims === undefined
        ? []
        : [orientedDimensions(croppedDimensions(dims, entry.crop), entry.orientation)]
    }),
    timeline.canvasPreset,
  )
  const previewAspect = frameAspect(frame)

  // A source's own aspect for the crop placement rule (#255), from the same
  // probe that shapes the frame; undefined until (or unless) it reports.
  const sourceAspectOf = (url: string | undefined): number | undefined => {
    if (url === undefined) return undefined
    const dims = sourceDims.get(url)
    return dims === undefined || dims.height <= 0 ? undefined : dims.width / dims.height
  }

  // Each element's zoom (#64) at its entry's current source time: the
  // primary element renders `location`'s entry, the incoming element (only
  // while the overlay is active) the transition's incoming entry — so a zoom
  // follows its clip through a transition on either side. Both derive from
  // the published sequence time, exactly like the transition styles, so a
  // rAF tick and a paused seek update them the same way. All easing lives in
  // zoomAt (#63); this component only maps its output to CSS.
  const primaryZoom = location
    ? zoomAt(timeline, location.index, location.sourceTime)
    : IDENTITY_ZOOM
  const incomingZoom = overlap ? zoomAt(timeline, overlap.index, overlap.sourceTime) : IDENTITY_ZOOM

  /**
   * Role-dependent props for one of the two stacked video slots, each a
   * layer card (the frame-shaped box transitions and zooms style) wrapping
   * the media element (which carries the clip's own looks — color filter,
   * #192, and orientation, #232 — so they ride the clip through overlaps
   * exactly like its pixels, while a push slides and a zoom magnifies the
   * *oriented* card). A still layer (#140) takes over its slot with an
   * <img> instead, so the video slot standing in that role hides as idle.
   */
  const videoSlotProps = (isA: boolean) => {
    const isPrimary = isA === primaryIsA
    // The slot's own element — what a blur backdrop (#259) samples.
    const slotVideoRef = isA ? videoARef : videoBRef
    if (isPrimary) {
      if (stillPrimary) {
        return { card: { className: 'preview-video preview-video-idle' }, media: {}, backdrop: null }
      }
      return {
        card: {
          className: 'preview-video',
          'data-testid': 'preview-video-card',
          style: withZoom(layerStyles?.outgoing, primaryZoom),
        },
        media: {
          'data-testid': 'preview-video',
          style: withColorFilter(
            croppedOrientedMediaStyle(
              location?.entry.crop,
              location?.entry.orientation,
              previewAspect,
              sourceAspectOf(location?.entry.url),
            ),
            location?.entry.colorAdjustments,
          ),
        },
        backdrop: entryBackdrop(location?.entry, slotVideoRef),
      }
    }
    const videoOverlap = overlap !== undefined && !stillIncoming
    return {
      card: {
        className: `preview-video preview-video-incoming${videoOverlap ? '' : ' preview-video-idle'}`,
        style: videoOverlap ? withZoom(layerStyles?.incoming, incomingZoom, layerStyles?.incomingClip ?? null, layerStyles?.incomingEllipse ?? null) : undefined,
        'data-testid': videoOverlap ? 'preview-video-incoming-card' : undefined,
      },
      media: {
        style: videoOverlap
          ? withColorFilter(
              croppedOrientedMediaStyle(
                overlap.entry.crop,
                overlap.entry.orientation,
                previewAspect,
                sourceAspectOf(overlap.entry.url),
              ),
              overlap.entry.colorAdjustments,
            )
          : undefined,
        'data-testid': videoOverlap ? 'preview-video-incoming' : undefined,
      },
      backdrop: videoOverlap ? entryBackdrop(overlap.entry, slotVideoRef) : null,
    }
  }
  const slotA = videoSlotProps(true)
  const slotB = videoSlotProps(false)

  return (
    <section className="panel preview-panel" aria-label="Preview">
      <div className="preview-header">
        <h2>Preview</h2>
        {onToggleExpanded && (
          <button
            type="button"
            className="preview-expand"
            aria-label={expanded ? 'Restore preview size' : 'Expand preview'}
            onClick={onToggleExpanded}
          >
            {expanded ? 'Restore size' : 'Expand'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="placeholder">Add clips to the timeline to preview your edit.</p>
      ) : (
        <div className="preview-player">
          {/* Sized by CSS; sequence audio plays. Controls are the app's own.
              The stage is the layout box; the frame inside it (#176) renders
              at exactly the export frame's aspect ratio — the CSS variable
              drives both the frame's fit-inside math and the expanded/narrow
              stage's own aspect-ratio. */}
          <div
            className={expanded ? 'preview-stage preview-stage-expanded' : 'preview-stage'}
            style={{ '--preview-aspect': String(previewAspect) } as CSSProperties}
          >
            <div className="preview-frame" data-testid="preview-frame">
              <div {...slotA.card}>
                {slotA.backdrop}
                <video ref={videoARef} playsInline preload="auto" className="preview-media" {...slotA.media} />
              </div>
              <div {...slotB.card}>
                {slotB.backdrop}
                <video ref={videoBRef} playsInline preload="auto" className="preview-media" {...slotB.media} />
              </div>
              {/* Still layers (#140): an <img> in the same stacked slot,
                  sharing the video layers' classes so transitions and zooms
                  style it identically. Decorative — the still's name is
                  announced by the now-playing line below. A slate (#143)
                  renders as its flat color instead: same slot, same styles,
                  no media behind it. */}
              {slatePrimary && location ? (
                <div
                  className="preview-video"
                  data-testid="preview-slate"
                  style={{
                    ...withZoom(layerStyles?.outgoing, primaryZoom),
                    backgroundColor: location.entry.color,
                  }}
                />
              ) : (
                stillPrimary &&
                location && (
                  <div
                    className="preview-video"
                    data-testid="preview-image-card"
                    style={withZoom(layerStyles?.outgoing, primaryZoom)}
                  >
                    {entryBackdrop(location.entry, stillImageRef)}
                    <img
                      ref={stillImageRef}
                      className="preview-media"
                      data-testid="preview-image"
                      alt=""
                      src={location.entry.url}
                      style={withColorFilter(
                        croppedOrientedMediaStyle(
                          location.entry.crop,
                          location.entry.orientation,
                          previewAspect,
                          sourceAspectOf(location.entry.url),
                        ),
                        location.entry.colorAdjustments,
                      )}
                    />
                  </div>
                )
              )}
              {slateIncoming && overlap ? (
                <div
                  className="preview-video preview-video-incoming"
                  data-testid="preview-slate-incoming"
                  style={{
                    ...withZoom(layerStyles?.incoming, incomingZoom, layerStyles?.incomingClip ?? null, layerStyles?.incomingEllipse ?? null),
                    backgroundColor: overlap.entry.color,
                  }}
                />
              ) : (
                stillIncoming &&
                overlap && (
                  <div
                    className="preview-video preview-video-incoming"
                    data-testid="preview-image-incoming-card"
                    style={withZoom(layerStyles?.incoming, incomingZoom, layerStyles?.incomingClip ?? null, layerStyles?.incomingEllipse ?? null)}
                  >
                    {entryBackdrop(overlap.entry, stillIncomingImageRef)}
                    <img
                      ref={stillIncomingImageRef}
                      className="preview-media"
                      data-testid="preview-image-incoming"
                      alt=""
                      src={overlap.entry.url}
                      style={withColorFilter(
                        croppedOrientedMediaStyle(
                          overlap.entry.crop,
                          overlap.entry.orientation,
                          previewAspect,
                          sourceAspectOf(overlap.entry.url),
                        ),
                        overlap.entry.colorAdjustments,
                      )}
                    />
                  </div>
                )
              )}
              {/* A fade-through-color's veil (#181): a full-frame color layer
                  above the outgoing and incoming clips — the dip itself — but
                  beneath overlay video layers and text overlays, exactly
                  where the export paints it. */}
              {overlap && layerStyles?.veil && (
                <div className="preview-veil" data-testid="preview-veil" style={layerStyles.veil} />
              )}
              {/* Overlay video layers (#145): one <video> per layer, kept
                  mounted for the overlay's lifetime (so scrubbing never
                  re-loads a source) and positioned at its fractional rectangle
                  within the stage — the same frame proxy text overlays and
                  zoom fractions address. The clip letterboxes inside the
                  rectangle (object-fit: contain) with transparent gutters, so
                  the base video shows through rather than black bars.
                  Stacking, bottom to top: base video/still layers (transitions
                  and zooms apply to those), then overlay layers in add order,
                  then text overlays — a title is never hidden by a
                  picture-in-picture. Visibility is declarative from the
                  published time (hidden outside the window); playback and
                  audio follow via syncVideoOverlays each frame. */}
              {videoOverlays.map((overlay, index) => {
                const active = audioTrackPlaybackAt(overlay, Math.min(sequenceTime, total)).shouldPlay
                // The overlay's card is its fractional rectangle; the media
                // element inside carries the clip's own looks (filter,
                // orientation) — the base slots' split, at rectangle scale.
                // The card's aspect is the rectangle's: frame aspect times
                // the fractions' ratio (both resolve against the frame).
                const cardAspect =
                  overlay.height > 0 ? previewAspect * (overlay.width / overlay.height) : 0
                // Shape mask (#266): the card's box IS the placed rectangle,
                // so the shared rule's clip-path cuts the placed silhouette —
                // after crop/orientation shaped the picture inside. Mask-free
                // overlays get no clipPath key at all (the #255 discipline).
                const clipPath = maskClipPath(overlay.shapeMask, overlay)
                return (
                  <div
                    key={overlay.id}
                    className={`preview-overlay-video${active ? '' : ' preview-overlay-hidden'}`}
                    data-testid={`preview-overlay-card-${index}`}
                    style={{
                      left: `${overlay.x * 100}%`,
                      top: `${overlay.y * 100}%`,
                      width: `${overlay.width * 100}%`,
                      height: `${overlay.height * 100}%`,
                      ...(clipPath === undefined ? {} : { clipPath }),
                    }}
                  >
                    {/* A still overlay (#294) is an <img>, exactly as a
                        still sequence entry is (#140) — no element to drive,
                        and a transparent PNG's alpha shows the layers below
                        it through, since the card paints no background. */}
                    {isImageOverlay(overlay) ? (
                      <img
                        src={overlay.url}
                        alt=""
                        className="preview-media"
                        data-testid={`preview-overlay-${index}`}
                        style={withColorFilter(
                          croppedOrientedMediaStyle(
                            overlay.crop,
                            overlay.orientation,
                            cardAspect,
                            sourceAspectOf(overlay.url),
                          ),
                          overlay.colorAdjustments,
                        )}
                      />
                    ) : (
                      <video
                        ref={(element) => {
                          overlayRefs.current.set(overlay.id, element)
                        }}
                        src={overlay.url}
                        preload="auto"
                        playsInline
                        className="preview-media"
                        data-testid={`preview-overlay-${index}`}
                        style={withColorFilter(
                          croppedOrientedMediaStyle(
                            overlay.crop,
                            overlay.orientation,
                            cardAspect,
                            sourceAspectOf(overlay.url),
                          ),
                          overlay.colorAdjustments,
                        )}
                      />
                    )}
                  </div>
                )
              })}
              {/* Text overlays (#139): items whose window covers the published
                  sequence time, drawn above the composed frame. Stacking order,
                  bottom to top: video/still layers (transitions and zooms apply
                  to them below), then overlays in add order — an overlay never
                  zooms or slides with a clip; it annotates the output frame.
                  Position is the block's centre in frame fractions; size is a
                  fraction of the frame height, realized via container-query
                  height units against the stage (the frame proxy the preview
                  already letterboxes real sources into). Declarative from the
                  published time, so playing, pausing, and scrubbing all show
                  exactly the overlays for the current instant. */}
              {textsOf(timeline).map(
                (text, index) =>
                  textActiveAt(text, Math.min(sequenceTime, total)) && (
                    <p
                      key={text.id}
                      className="preview-text"
                      data-testid={`preview-text-${index}`}
                      style={{
                        left: `${text.x * 100}%`,
                        top: `${text.y * 100}%`,
                        fontSize: `${text.size * 100}cqh`,
                        fontFamily: textFontStack(text.font),
                        fontWeight: text.bold ? 700 : 400,
                        fontStyle: text.italic ? 'italic' : 'normal',
                        color: text.color,
                        // The fade envelope (#177): the same textOpacityAt
                        // value the export applies as globalAlpha.
                        opacity: textOpacityAt(text, Math.min(sequenceTime, total)),
                      }}
                    >
                      {text.content}
                    </p>
                  ),
              )}
            </div>
          </div>
          {/* One element per audio track (#103), driven by syncAudioTracks.
              Sound only — nothing rendered, nothing announced. Keyed by track
              id so retiming or trimming a track never re-creates (and never
              re-loads) another track's element. */}
          {audioTracks.map((track, index) => (
            <audio
              key={track.id}
              ref={(element) => {
                audioRefs.current.set(track.id, element)
              }}
              src={track.url}
              preload="auto"
              data-testid={`preview-audio-${index}`}
            />
          ))}
          <div className="preview-controls">
            <button
              type="button"
              aria-label={playing ? 'Pause preview' : 'Play preview'}
              onClick={playing ? pause : play}
            >
              {playing ? '⏸' : '▶'}
            </button>
            {/* The razor (#190): split the entry under the playhead. Disabled
                where there is nothing to split — a boundary, a transition
                overlap, or an empty timeline (see splitTargetAt). Undoable
                like any timeline edit (#189). */}
            <button
              type="button"
              data-testid="preview-split"
              title="Split the clip at the playhead (disabled at boundaries and inside transitions)"
              disabled={splitTarget === null || onSplit === undefined}
              onClick={() => {
                if (splitTarget !== null) onSplit?.(splitTarget.entryId, splitTarget.atSourceTime)
              }}
            >
              ✂ Split
            </button>
            {/* Save frame (#237): the playhead's frame as a PNG at the output
                resolution, composed through the export's draw path. Disabled
                with nothing on the timeline, matching the export control. */}
            <button
              type="button"
              data-testid="preview-save-frame"
              title="Save the current frame as a PNG image at the output resolution"
              disabled={timeline.entries.length === 0 || savingFrame}
              onClick={saveFrame}
            >
              📷 Save frame
            </button>
            {/* Freeze frame (#379): the same composed capture as Save frame,
                kept in the app — a library image clip placed on the timeline
                as a still holding this instant. Disabled with no frame to
                compose (empty timeline) or without App's wiring, like Split.
                The choice beside it picks the placement of the NEXT freeze:
                split & hold (the emphasis beat) or append (the end card). */}
            <button
              type="button"
              data-testid="preview-freeze-frame"
              title="Freeze the frame at the playhead as a 2-second still on the timeline (a snapshot of the composition at this instant, not a live reference)"
              disabled={freezeTarget === null || freezing || onFreezeFrame === undefined}
              onClick={freezeFrame}
            >
              ❄ Freeze frame
            </button>
            <select
              aria-label="Freeze frame placement"
              data-testid="preview-freeze-placement"
              title="Where the frozen still goes: cut the clip at the playhead and hold between the halves, or hold after the clip without cutting it"
              value={freezePlacement}
              onChange={(event) => setFreezePlacement(event.target.value as FreezePlacementMode)}
            >
              <option value="split">Split &amp; hold</option>
              <option value="append">Append after clip</option>
            </select>
            <input
              type="range"
              aria-label="Seek within sequence"
              min={0}
              max={total}
              step={0.01}
              value={Math.min(sequenceTime, total)}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="preview-position" data-testid="preview-position">
              {formatDuration(Math.min(sequenceTime, total))} / {formatDuration(total)}
            </span>
          </div>
          {saveFrameError !== null && (
            <p className="preview-save-frame-error" role="alert">
              Could not save the frame: {saveFrameError}
            </p>
          )}
          {freezeError !== null && (
            <p className="preview-save-frame-error" role="alert">
              Could not freeze the frame: {freezeError}
            </p>
          )}
          {location && (
            <p className="preview-now-playing" data-testid="preview-now-playing">
              Clip {location.index + 1} of {timeline.entries.length}: {location.entry.name}
              {overlap ? ` → ${overlap.entry.name} (${transitionLabel(overlap.type)})` : ''}
            </p>
          )}
        </div>
      )}
      {/* Rendered at the panel level, not inside the player block: `?`
          answers even while the timeline is empty (#203). */}
      {helpOpen && (
        <ShortcutHelpDialog
          onClose={() => setHelpOpen(false)}
          {...(stepSeconds === undefined ? {} : { stepSeconds })}
          {...(largeStepSeconds === undefined ? {} : { largeStepSeconds })}
        />
      )}
    </section>
  )
}
