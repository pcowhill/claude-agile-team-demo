import type { ColorAdjustments } from './colorAdjustments'
import { colorAdjustmentsEqual } from './colorAdjustments'
import type { Orientation } from './orientation'
import { orientationsEqual } from './orientation'
import type { Crop } from './crop'
import type { RedactionRegion } from './redaction'
import type { SpotlightRegion } from './spotlight'
import { cropsEqual } from './crop'
import type { ShapeMask } from './shapeMask'
import { shapeMasksEqual } from './shapeMask'
import type { OverlayBorder } from './overlayBorder'
import { overlayBordersEqual } from './overlayBorder'
import type { OverlayShadow } from './overlayShadow'
import { overlayShadowsEqual } from './overlayShadow'
import type { LibraryClip } from './mediaLibrary'
import type { ZoomSpec } from './timeline'
import type { RemapSpec } from './remap'
import { remappedDuration, remapSpecsEqual, sweptRemaps } from './remap'
import { clampVolume } from './volume'

/**
 * Overlay video layers — picture-in-picture (#145): video clips composited
 * above the single base sequence, each inside its own rectangle of the
 * frame. The model deliberately keeps the base sequence unchanged (see
 * docs/adr/0002-overlay-video-layers.md): an overlay is anchored to
 * **sequence time** (offset in
 * absolute timeline seconds, exactly like an audio track, #102) with the
 * same allowed-tail semantics — video edits never re-anchor or drop one; a
 * window past the sequence's end simply never shows. Side-by-side layouts
 * fall out of composition: a color slate (#143) as the base entry with two
 * or more overlays placed in halves or quadrants.
 *
 * Placement is a rectangle in fractional frame coordinates: `x`/`y` are the
 * rectangle's top-left corner, `width`/`height` its size, all as fractions
 * of the output frame — the same frame the text overlays (#139) and zoom
 * centres address, so preview stage and a later export canvas (#146)
 * resolve them identically. The clip letterboxes *within* the rectangle
 * (aspect ratio preserved, `object-fit: contain`); the gutters are
 * transparent, showing the base video, never black bars. Clamping keeps the
 * rectangle fully on the frame: size first into its bounds, then position
 * into [0, 1 − size].
 *
 * Deliberately out of scope at first (#145): no transitions or time
 * remapping on overlays — those belong to base sequence entries only. Zooms
 * came later (#699), as the overlay's own `zooms` below, and speed segments
 * and pauses later still (#700), as its own `remaps`.
 *
 * The overlay's field shape is a superset of AudioTrack's (id, clipId,
 * name, duration, url, offset, inPoint, outPoint), which is what lets the
 * shared window/sync helpers (`audioTrackPlaybackAt`, `effectiveDuration`)
 * and the gain function (`videoEntryGain` — volume × mute) apply to it
 * structurally. Ownership, actions, and normalization live in
 * `timeline.ts`, as for every other effect.
 */
export interface VideoOverlay {
  /** Unique per overlay — the same library clip can appear multiple times. */
  id: string
  /**
   * Present exactly when the overlay is a still image (#294); absent means a
   * video overlay, so every pre-image state (and saved file) stays valid —
   * the `TimelineEntry.kind` rule (#140), applied to the overlay lane.
   *
   * An image overlay differs from a video one in exactly two ways, and is
   * identical in every other: it carries **no audio fields** (`volume`,
   * `muted`, `fadeIn`, `fadeOut` — a still is soundless, #220), and its
   * window is an explicit `offset` + `duration` rather than a trim of a
   * source. The window is still stored as `inPoint`/`outPoint`, pinned to
   * `[0, duration]` exactly as a still entry's is, so every shared window
   * helper (`audioTrackPlaybackAt`, `effectiveDuration`) keeps working on it
   * unchanged — editing the window means editing `duration`, the
   * `still-duration-set` rule (#137/#140).
   */
  kind?: 'image'
  /** The library clip this overlay was created from — video, or an image when `kind` is 'image'. */
  clipId: string
  name: string
  /**
   * Duration of the source video clip in seconds — for an image overlay
   * (which has no source duration), the window length itself, always equal
   * to `outPoint`.
   */
  duration: number
  /** Object URL of the source clip, usable as a `<video>` src — or an `<img>` src for an image overlay. */
  url: string
  /** Seconds into the composed timeline where the overlay starts. ≥ 0. */
  offset: number
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint; always 0 for an image overlay. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration; always `duration` for an image overlay. */
  outPoint: number
  /** Rectangle's left edge, as a fraction of frame width (0..1 − width). */
  x: number
  /** Rectangle's top edge, as a fraction of frame height (0..1 − height). */
  y: number
  /** Rectangle's width, as a fraction of frame width. */
  width: number
  /** Rectangle's height, as a fraction of frame height. */
  height: number
  /** Volume of the overlay's own audio, 0 to `MAX_VOLUME` (#104, #692). Absent = full volume. Never present on an image overlay. */
  volume?: number
  /** Mutes the overlay's audio; mute wins over volume (#104). */
  muted?: boolean
  /**
   * Linear audio fade-in duration in seconds, from the start of the
   * overlay's window (#220) — the same envelope shape as an audio track's
   * (#104). Absent means no fade, and zero fades are stored as no fields at
   * all, so fade-free states and saved files stay byte-identical.
   * `clampVideoOverlay` keeps fadeIn + fadeOut within the trimmed length.
   */
  fadeIn?: number
  /** Linear audio fade-out duration in seconds, ending at the window's end (#220). */
  fadeOut?: number
  /**
   * Color adjustments (#192), exactly as on a sequence entry: absent behaves
   * as identity, present exactly when non-identity (normalized by the
   * `video-overlay-color-set` reducer case — not part of the placement,
   * which `video-overlay-updated` edits).
   */
  colorAdjustments?: ColorAdjustments
  /**
   * Orientation (#232), exactly as on a sequence entry: absent behaves as
   * identity, present exactly when non-identity (normalized by the
   * `video-overlay-orient-set` reducer case — not part of the placement,
   * which `video-overlay-updated` edits).
   */
  orientation?: Orientation
  /**
   * Crop (#255), exactly as on a sequence entry: absent behaves as
   * identity, present exactly when non-identity (normalized by the
   * `video-overlay-crop-set` reducer case — not part of the placement,
   * which `video-overlay-updated` edits). Applies in source space before
   * orientation.
   */
  crop?: Crop
  /**
   * Redaction regions (#492), exactly as on a sequence entry: rectangles
   * hiding part of the picture for a window of the overlay's own source
   * time. Absent means none (normalized by the
   * `video-overlay-redactions-set` reducer case). The rectangles are
   * fractions of the source frame, before orientation and crop, so an
   * overlay that is turned, cropped or re-placed keeps its masks on the
   * pixels they were drawn over.
   */
  redactions?: RedactionRegion[]
  /**
   * Spotlight regions (#532), exactly as on a sequence entry: rectangles or
   * ovals that dim everything outside them for a window of the overlay's
   * own source time. Absent means none (normalized by the
   * `video-overlay-spotlights-set` reducer case), and the rectangles are
   * fractions of the source frame, before orientation and crop, so an
   * overlay that is turned, cropped or re-placed keeps its spotlights on
   * the pixels they were drawn over.
   */
  spotlights?: SpotlightRegion[]
  /**
   * Shape mask (#266): clips the overlay's picture — its outline, the
   * cropped and oriented picture letterboxed in the placed rectangle
   * (`overlayPictureRect`, #791) — to an inscribed ellipse or a rounded
   * rectangle. Absent behaves as the hard rectangle — today's outline —
   * present exactly when a shape is set (normalized by the
   * `video-overlay-mask-set` reducer case). Applies in frame space, after
   * crop and orientation have produced the picture: it shapes that
   * silhouette, never the source pixels.
   */
  shapeMask?: ShapeMask
  /**
   * A coloured border (#697): an outline drawn outside the overlay's
   * silhouette — its outline (the visible picture, #791), or the shape the
   * mask cuts from it —
   * in a colour and a thickness (see overlayBorder.ts). Absent means none,
   * present exactly when the thickness is above 0 (normalized by the
   * `video-overlay-border-set` reducer case), so border-free states and
   * files stay byte-identical.
   */
  border?: OverlayBorder
  /**
   * A drop shadow (#698): a soft, offset copy of the overlay's silhouette —
   * grown by its border, when it has one — drawn beneath it and kept only
   * outside it (see overlayShadow.ts). Absent means off; the
   * `video-overlay-shadow-set` reducer case stores the normalized form, so
   * shadow-free states and files stay byte-identical.
   */
  shadow?: OverlayShadow
  /**
   * Zooms on the overlay's own picture (#699): each magnifies what the
   * placed rectangle shows, the way a sequence zoom (#63) magnifies the
   * frame — the rectangle itself never grows or moves. The fields are a
   * sequence zoom's, read against the overlay instead of the frame: `start`
   * is seconds into the overlay's trimmed window (its own source clock less
   * `inPoint`, as an entry's zoom is), and the centre is a fraction of the
   * rectangle. Held on the overlay, like its redactions and spotlights, so
   * removing or duplicating the overlay takes its zooms with it. Absent
   * means none; normalization keeps the list sorted by start with disjoint
   * windows, exactly as for an entry's zooms (#129).
   */
  zooms?: OverlayZoom[]
  /**
   * Speed segments and pauses on the overlay's own clock (#700), with the
   * fields, defaults and non-overlap rule of a sequence entry's (#138):
   * positions are seconds into the overlay's trimmed range, a pause's hold
   * is output seconds. They change how long the overlay is on screen — its
   * window is `offset + remappedDuration(trim, remaps)` — and which source
   * instant shows at each moment of it (`videoOverlayPlaybackAt`). Held on
   * the overlay, like its zooms, so removing or duplicating it takes them
   * along. Absent means none, and a video overlay only: an image overlay
   * has no time to remap, exactly as a still entry has none (#138).
   * `clampVideoOverlay` keeps the list sorted with disjoint windows inside
   * the trim, by the entries' sweep (`sweptRemaps`).
   */
  remaps?: OverlayRemap[]
}

/** One speed segment or pause on an overlay (#700): an entry's spec plus its handle. */
export type OverlayRemap = RemapSpec & {
  /** Unique within its overlay — what update and remove act on. */
  id: string
}

/**
 * How long the overlay is on screen (#700): its trimmed length, adjusted by
 * its speed segments and pauses — `remappedDuration`, as for an entry. With
 * no remaps it is exactly the trimmed length, so every remap-free overlay
 * keeps its old window math. Remaps must be normalized, as any published
 * state's are.
 */
export function overlayOutputDuration(
  overlay: Pick<VideoOverlay, 'inPoint' | 'outPoint' | 'remaps'>,
): number {
  const trimmedLength = overlay.outPoint - overlay.inPoint
  const remaps = overlay.remaps
  return remaps === undefined || remaps.length === 0
    ? trimmedLength
    : remappedDuration(trimmedLength, remaps)
}

/** One zoom on an overlay (#699): a sequence zoom's spec plus its handle. */
export interface OverlayZoom extends ZoomSpec {
  /** Unique within its overlay — what update and remove act on. */
  id: string
}

/**
 * The editable fields a `video-overlay-updated` action carries — everything
 * but the identity (id) and the source binding (clipId, name, duration,
 * url), which never change after the overlay is created.
 */
export interface VideoOverlayPlacement {
  offset: number
  inPoint: number
  outPoint: number
  x: number
  y: number
  width: number
  height: number
  volume?: number
  muted?: boolean
  fadeIn?: number
  fadeOut?: number
}

/**
 * The editable fields a `video-overlay-updated` action carries for an
 * **image** overlay (#294): the placement rectangle and the explicit
 * `offset` + `duration` window. No trim (a still has no source to trim) and
 * no audio (a still is soundless) — the reducer refuses a placement carrying
 * either, rather than silently ignoring it.
 */
export interface ImageOverlayPlacement {
  offset: number
  /** Window length in seconds, > 0 — the still-entry rule (#137/#140). */
  duration: number
  x: number
  y: number
  width: number
  height: number
}

/** What `video-overlay-updated` carries, per overlay kind. */
export type OverlayPlacement = VideoOverlayPlacement | ImageOverlayPlacement

/**
 * The audio fields an image overlay must never carry (#294) — a still is
 * soundless (#220). `duck`/`duckLevel` are audio-track fields that no
 * overlay of either kind has, and are listed so a foreign project file
 * carrying one is refused by name rather than quietly dropped.
 */
export const IMAGE_OVERLAY_FORBIDDEN_FIELDS = [
  'volume',
  'muted',
  'fadeIn',
  'fadeOut',
  'duck',
  'duckLevel',
] as const

/**
 * The first forbidden audio field this value carries, or `undefined` when it
 * carries none — so a validator can refuse it and a parser can name it. Only
 * meaningful for image overlays.
 */
export function forbiddenImageOverlayField(
  source: Readonly<Record<string, unknown>>,
): string | undefined {
  return IMAGE_OVERLAY_FORBIDDEN_FIELDS.find((field) => source[field] !== undefined)
}

/** Whether this overlay is a still image (#294) rather than a video. */
export function isImageOverlay(overlay: Pick<VideoOverlay, 'kind'>): boolean {
  return overlay.kind === 'image'
}

/**
 * Whether a placement is acceptable input for an **image** overlay (#294):
 * finite geometry and a positive duration, with no trim and no audio field —
 * those are refused by name (see `forbiddenImageOverlayField`) rather than
 * ignored, so an action built for the wrong overlay kind cannot half-apply.
 * Ranges are not rejected here; they clamp, exactly as for a video overlay.
 */
export function isValidImageOverlayPlacement(placement: ImageOverlayPlacement): boolean {
  const source = placement as unknown as Record<string, unknown>
  return (
    Number.isFinite(placement.offset) &&
    Number.isFinite(placement.duration) &&
    placement.duration > 0 &&
    Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.width) &&
    Number.isFinite(placement.height) &&
    source.inPoint === undefined &&
    source.outPoint === undefined &&
    forbiddenImageOverlayField(source) === undefined
  )
}

/**
 * Whether a whole **image** overlay is acceptable input (#294): finite
 * geometry, a positive duration, and no audio field. The window pinning
 * (`inPoint`/`outPoint` = `[0, duration]`) is normalization's job, not a
 * rejection — `clampVideoOverlay` enforces it — so an overlay whose trim was
 * built loosely still lands in a consistent state.
 */
export function isValidImageOverlay(overlay: VideoOverlay): boolean {
  return (
    Number.isFinite(overlay.offset) &&
    Number.isFinite(overlay.duration) &&
    overlay.duration > 0 &&
    Number.isFinite(overlay.x) &&
    Number.isFinite(overlay.y) &&
    Number.isFinite(overlay.width) &&
    Number.isFinite(overlay.height) &&
    forbiddenImageOverlayField(overlay as unknown as Record<string, unknown>) === undefined
  )
}

/**
 * How long a newly placed image overlay shows by default, in seconds. Equal
 * to `DEFAULT_STILL_DURATION` (#140) — a still is a still, whether it sits in
 * the sequence or above it — but declared here rather than imported, because
 * `timeline.ts` imports this module and the reverse would be a cycle. A unit
 * test pins the two to the same value.
 *
 * That equality is why the user's still-duration setting (#286) is passed
 * here too: leaving this path on the constant would have a still on the
 * sequence show for the chosen duration while a still *layer* added a moment
 * later showed for five seconds, contradicting the rule above.
 */
export const DEFAULT_IMAGE_OVERLAY_DURATION = 5

/**
 * What "add as overlay" creates for an image clip (#294): the same
 * picture-in-picture placement a video overlay gets, showing from the
 * sequence start for the default still duration. The window is `[0,
 * duration]` — a still has nothing to trim.
 */
export function imageOverlayFromClip(
  clip: LibraryClip,
  id: string,
  offset = 0,
  duration = DEFAULT_IMAGE_OVERLAY_DURATION,
): VideoOverlay {
  // Only images become still overlay layers; video has its own constructor
  // and audio has no picture. The UI never offers this path for other kinds —
  // reaching here is programmer error.
  if (clip.kind !== 'image') {
    throw new Error(`cannot add "${clip.name}" as an image overlay: it is not an image clip`)
  }
  return {
    id,
    kind: 'image',
    clipId: clip.id,
    name: clip.name,
    duration,
    url: clip.url,
    offset,
    inPoint: 0,
    outPoint: duration,
    ...DEFAULT_OVERLAY_RECT,
  }
}

/**
 * Rectangle size bounds, as fractions of the frame. The floor keeps a typo
 * from storing an invisible sliver (which would read as "my overlay
 * vanished"); the ceiling is the whole frame.
 */
export const MIN_OVERLAY_SIZE = 0.05
export const MAX_OVERLAY_SIZE = 1

/**
 * What "add as overlay" creates (#145): the classic picture-in-picture
 * placement — a bit over a quarter of the frame, inset from the
 * bottom-right corner — playing the whole clip from sequence start.
 */
export const DEFAULT_OVERLAY_RECT = { x: 0.62, y: 0.62, width: 0.35, height: 0.35 }

export function videoOverlayFromClip(clip: LibraryClip, id: string, offset = 0): VideoOverlay {
  // Only video clips become overlay layers: audio has no picture, and a
  // still would be a different feature. The UI never offers this path for
  // other kinds — reaching here is programmer error.
  if (clip.kind !== 'video') {
    throw new Error(`cannot add "${clip.name}" as an overlay: it is not a video clip`)
  }
  return {
    id,
    clipId: clip.id,
    name: clip.name,
    duration: clip.duration,
    url: clip.url,
    offset,
    inPoint: 0,
    outPoint: clip.duration,
    ...DEFAULT_OVERLAY_RECT,
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * A stored **video** overlay re-expressed as the placement
 * `video-overlay-updated` takes: the row's fields edit one part of it, and
 * the Trim window (#711) both applies and previews a trim through it, so
 * the warning and Apply dispatch the same action.
 */
export const overlayPlacementOf = ({
  offset,
  inPoint,
  outPoint,
  x,
  y,
  width,
  height,
  volume,
  muted,
  fadeIn,
  fadeOut,
}: VideoOverlay): VideoOverlayPlacement => ({
  offset,
  inPoint,
  outPoint,
  x,
  y,
  width,
  height,
  volume,
  muted,
  ...(fadeIn === undefined ? {} : { fadeIn }),
  ...(fadeOut === undefined ? {} : { fadeOut }),
})

/**
 * Whether a placement is acceptable input at all: finite numbers and boolean
 * toggles. Ranges are not rejected here — they clamp (`clampVideoOverlay`),
 * like a zoom centre; an empty trim range is rejected by the reducer against
 * the overlay's duration, like an audio track's.
 */
export function isValidVideoOverlayPlacement(placement: VideoOverlayPlacement): boolean {
  return (
    Number.isFinite(placement.offset) &&
    Number.isFinite(placement.inPoint) &&
    Number.isFinite(placement.outPoint) &&
    Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.width) &&
    Number.isFinite(placement.height) &&
    (placement.volume === undefined || Number.isFinite(placement.volume)) &&
    (placement.muted === undefined || typeof placement.muted === 'boolean') &&
    (placement.fadeIn === undefined || Number.isFinite(placement.fadeIn)) &&
    (placement.fadeOut === undefined || Number.isFinite(placement.fadeOut))
  )
}

/**
 * Clamps one overlay's continuous fields into their ranges: offset at 0 but
 * unbounded above (the allowed-tail decision — see the module comment), trim
 * within the source clip, volume into 0 to `MAX_VOLUME`, audio fades within the trimmed
 * length (#220, fadeIn keeps its value first as for audio tracks — and zero
 * fades normalize to absent fields, the byte-identity rule), and the
 * rectangle fully onto the frame — size first into its bounds, then position
 * into what the size leaves. Returns the same object when nothing changes,
 * so no-op edits are cheap to detect.
 *
 * An **image** overlay (#294) takes the same offset and rectangle rules, but
 * its window is its explicit duration rather than a trim — `inPoint` and
 * `outPoint` are pinned to `[0, duration]` — and it carries no audio at all,
 * so any audio field is dropped instead of clamped.
 */
export function clampVideoOverlay(overlay: VideoOverlay): VideoOverlay {
  const offset = Math.max(0, overlay.offset)
  const width = clamp(overlay.width, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  const height = clamp(overlay.height, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  const x = clamp(overlay.x, 0, 1 - width)
  const y = clamp(overlay.y, 0, 1 - height)
  if (isImageOverlay(overlay)) {
    // An image overlay's window is its explicit duration (#294): the trim is
    // pinned to the whole still, exactly as `still-duration-set` keeps a
    // still entry's (#140), so every shared window helper reads it correctly.
    // Audio fields are dropped rather than clamped — a still is soundless, so
    // the invariant holds in state whatever an action or a file carried (the
    // validator and the parser refuse them by name first; this is the
    // backstop that keeps the model honest).
    const stripped =
      overlay.remaps !== undefined ||
      IMAGE_OVERLAY_FORBIDDEN_FIELDS.some(
        (field) => (overlay as unknown as Record<string, unknown>)[field] !== undefined,
      )
    if (
      !stripped &&
      offset === overlay.offset &&
      overlay.inPoint === 0 &&
      overlay.outPoint === overlay.duration &&
      x === overlay.x &&
      y === overlay.y &&
      width === overlay.width &&
      height === overlay.height
    ) {
      return overlay
    }
    const next = { ...overlay, offset, inPoint: 0, outPoint: overlay.duration, x, y, width, height }
    for (const field of IMAGE_OVERLAY_FORBIDDEN_FIELDS) {
      delete (next as unknown as Record<string, unknown>)[field]
    }
    // A still has no time to remap (#700), as a still entry has none.
    delete next.remaps
    return next
  }
  const inPoint = clamp(overlay.inPoint, 0, overlay.duration)
  const outPoint = clamp(overlay.outPoint, 0, overlay.duration)
  const volume = overlay.volume === undefined ? undefined : clampVolume(overlay.volume)
  const trimmedLength = Math.max(0, outPoint - inPoint)
  // Speed segments and pauses (#700) clamp into the (possibly new) trim by
  // the entries' sweep; the fades then ramp over the remapped window, as an
  // entry's do over its output duration (#220).
  const remaps =
    overlay.remaps === undefined ? undefined : sweptRemaps(overlay.remaps, trimmedLength)
  const outputLength =
    remaps === undefined ? trimmedLength : remappedDuration(trimmedLength, remaps)
  const clampedFadeIn = clamp(overlay.fadeIn ?? 0, 0, outputLength)
  const clampedFadeOut = clamp(overlay.fadeOut ?? 0, 0, outputLength - clampedFadeIn)
  const fadeIn = clampedFadeIn === 0 ? undefined : clampedFadeIn
  const fadeOut = clampedFadeOut === 0 ? undefined : clampedFadeOut
  if (
    offset === overlay.offset &&
    inPoint === overlay.inPoint &&
    outPoint === overlay.outPoint &&
    x === overlay.x &&
    y === overlay.y &&
    width === overlay.width &&
    height === overlay.height &&
    volume === overlay.volume &&
    fadeIn === overlay.fadeIn &&
    fadeOut === overlay.fadeOut &&
    remaps === overlay.remaps
  ) {
    return overlay
  }
  const next = { ...overlay, offset, inPoint, outPoint, x, y, width, height, volume }
  if (remaps !== undefined) next.remaps = [...remaps]
  if (fadeIn === undefined) delete next.fadeIn
  else next.fadeIn = fadeIn
  if (fadeOut === undefined) delete next.fadeOut
  else next.fadeOut = fadeOut
  return next
}

export function videoOverlaysEqual(a: VideoOverlay, b: VideoOverlay): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.clipId === b.clipId &&
    a.name === b.name &&
    a.duration === b.duration &&
    a.url === b.url &&
    a.offset === b.offset &&
    a.inPoint === b.inPoint &&
    a.outPoint === b.outPoint &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.fadeIn === b.fadeIn &&
    a.fadeOut === b.fadeOut &&
    colorAdjustmentsEqual(a.colorAdjustments, b.colorAdjustments) &&
    orientationsEqual(a.orientation, b.orientation) &&
    cropsEqual(a.crop, b.crop) &&
    shapeMasksEqual(a.shapeMask, b.shapeMask) &&
    overlayBordersEqual(a.border, b.border) &&
    overlayShadowsEqual(a.shadow, b.shadow) &&
    overlayRemapsEqual(a.remaps, b.remaps)
  )
}

/** Whether two overlays' remap lists (#700) are the same effects, in order. */
export function overlayRemapsEqual(
  a: readonly OverlayRemap[] | undefined,
  b: readonly OverlayRemap[] | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  return (
    left.length === right.length &&
    left.every((remap, index) => remap.id === right[index].id && remapSpecsEqual(remap, right[index]))
  )
}
