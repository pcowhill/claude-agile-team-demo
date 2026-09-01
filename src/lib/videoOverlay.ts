import type { ColorAdjustments } from './colorAdjustments'
import { colorAdjustmentsEqual } from './colorAdjustments'
import type { LibraryClip } from './mediaLibrary'

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
 * Deliberately out of scope at first (#145): no transitions, zooms, or time
 * remapping on overlays — those belong to base sequence entries only.
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
  /** The library clip this overlay was created from. Always a video clip. */
  clipId: string
  name: string
  /** Duration of the source video clip in seconds. */
  duration: number
  /** Object URL of the source clip, usable as a <video> src. */
  url: string
  /** Seconds into the composed timeline where the overlay starts. ≥ 0. */
  offset: number
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration. */
  outPoint: number
  /** Rectangle's left edge, as a fraction of frame width (0..1 − width). */
  x: number
  /** Rectangle's top edge, as a fraction of frame height (0..1 − height). */
  y: number
  /** Rectangle's width, as a fraction of frame width. */
  width: number
  /** Rectangle's height, as a fraction of frame height. */
  height: number
  /** Volume of the overlay's own audio, 0..1 (#104). Absent = full volume. */
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
 * within the source clip, volume into 0..1, audio fades within the trimmed
 * length (#220, fadeIn keeps its value first as for audio tracks — and zero
 * fades normalize to absent fields, the byte-identity rule), and the
 * rectangle fully onto the frame — size first into its bounds, then position
 * into what the size leaves. Returns the same object when nothing changes,
 * so no-op edits are cheap to detect.
 */
export function clampVideoOverlay(overlay: VideoOverlay): VideoOverlay {
  const offset = Math.max(0, overlay.offset)
  const inPoint = clamp(overlay.inPoint, 0, overlay.duration)
  const outPoint = clamp(overlay.outPoint, 0, overlay.duration)
  const width = clamp(overlay.width, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  const height = clamp(overlay.height, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  const x = clamp(overlay.x, 0, 1 - width)
  const y = clamp(overlay.y, 0, 1 - height)
  const volume = overlay.volume === undefined ? undefined : clamp(overlay.volume, 0, 1)
  const trimmedLength = Math.max(0, outPoint - inPoint)
  const clampedFadeIn = clamp(overlay.fadeIn ?? 0, 0, trimmedLength)
  const clampedFadeOut = clamp(overlay.fadeOut ?? 0, 0, trimmedLength - clampedFadeIn)
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
    fadeOut === overlay.fadeOut
  ) {
    return overlay
  }
  const next = { ...overlay, offset, inPoint, outPoint, x, y, width, height, volume }
  if (fadeIn === undefined) delete next.fadeIn
  else next.fadeIn = fadeIn
  if (fadeOut === undefined) delete next.fadeOut
  else next.fadeOut = fadeOut
  return next
}

export function videoOverlaysEqual(a: VideoOverlay, b: VideoOverlay): boolean {
  return (
    a.id === b.id &&
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
    colorAdjustmentsEqual(a.colorAdjustments, b.colorAdjustments)
  )
}
