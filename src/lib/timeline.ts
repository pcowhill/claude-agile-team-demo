import type { ColorAdjustments } from './colorAdjustments'
import type { Orientation } from './orientation'
import { isValidOrientation, normalizeOrientation, orientationsEqual } from './orientation'
import type { Crop } from './crop'
import { cropsEqual, isValidCrop, normalizeCrop } from './crop'
import type { ShapeMaskInput } from './shapeMask'
import { isValidShapeMaskInput, normalizeShapeMask, shapeMasksEqual } from './shapeMask'
import type { BackgroundFill, BackgroundFillInput } from './backgroundFill'
import {
  backgroundFillsEqual,
  isValidBackgroundFillInput,
  normalizeBackgroundFill,
} from './backgroundFill'
import {
  colorAdjustmentsEqual,
  isValidColorAdjustments,
  normalizeColorAdjustments,
} from './colorAdjustments'
import type { LibraryClip } from './mediaLibrary'
import type { RemapEffect, RemapSpec } from './remap'
import {
  clampRemap,
  isValidRemapSpec,
  remapEnd,
  remappedDuration,
  remapsEqual,
  remapStart,
} from './remap'
import type { SubtitleStyle, TextOverlay, TextOverlaySpec } from './textOverlay'
import {
  DEFAULT_SUBTITLE_STYLE,
  applySubtitleStyle,
  changedStyleFields,
  clampSubtitleStyle,
  clampTextOverlay,
  isValidSubtitleStyle,
  isValidTextOverlaySpec,
  normalizeStyleOverrides,
  normalizeSubtitleStyle,
  subtitleStylesEqual,
  textOverlaysEqual,
} from './textOverlay'
import type { VideoOverlay, VideoOverlayPlacement } from './videoOverlay'
import {
  clampVideoOverlay,
  isValidVideoOverlayPlacement,
  videoOverlaysEqual,
} from './videoOverlay'

export type { ColorAdjustments, ColorLook } from './colorAdjustments'
export type { PauseRemapSpec, RemapEffect, RemapSpec, SpeedRemapSpec } from './remap'
export type { TextOverlay, TextOverlaySpec } from './textOverlay'
export type { VideoOverlay, VideoOverlayPlacement } from './videoOverlay'
export { videoOverlayFromClip } from './videoOverlay'

export interface TimelineEntry {
  /** Unique per entry — the same library clip can appear multiple times. */
  id: string
  /** The library clip this entry was created from. */
  clipId: string
  name: string
  /**
   * Duration of the source clip in seconds. For a still entry (#140) the
   * source has no duration, so this is the still's on-screen duration —
   * the one settable value a still has, always equal to its outPoint.
   */
  duration: number
  /** Object URL of the source clip, usable as a <video> or <img> src. */
  url: string
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration. */
  outPoint: number
  /**
   * Present exactly when the entry is a still image (#140) or a solid-color
   * slate (#143); absent means a video entry, so every pre-image state (and
   * saved file) stays valid. Neither kind has a source trim: the window is
   * always [0, duration], and the duration is edited via
   * `still-duration-set` rather than a trim.
   */
  kind?: 'image' | 'slate'
  /**
   * The slate's fill color as lowercase `#rrggbb` (#143) — any 24-bit sRGB
   * value, per the customer's "any displayable color". Present exactly when
   * `kind` is 'slate'; edited via `slate-color-set`.
   */
  color?: string
  /**
   * Volume of the entry's own audio, 0..1 (#104). Absent means full volume —
   * the fields are additive so pre-#104 states (and saved files) stay valid.
   */
  volume?: number
  /** Whether the entry's own audio is silenced entirely (#104). Absent means false. */
  muted?: boolean
  /**
   * Linear audio fade-in duration in seconds (#220), from the start of the
   * entry's *output* window — output seconds (#141), so a speed segment
   * never stretches an audible ramp. Absent means no fade, and zero fades
   * are stored as no fields at all (like `colorAdjustments`' identity), so
   * fade-free states and saved files stay byte-identical. Present only on
   * video entries — stills and slates are soundless. The reducer clamps
   * fadeIn and fadeOut so together they never exceed the entry's output
   * duration (the #104 rule).
   */
  fadeIn?: number
  /** Linear audio fade-out duration in seconds, ending at the output window's end (#220). */
  fadeOut?: number
  /**
   * Color adjustments on a video/image entry (#192). Absent behaves as
   * identity (as shot), like the gain fields, so pre-#192 states and files
   * stay valid; present exactly when non-identity (the reducer normalizes —
   * see `normalizeColorAdjustments`). Slates carry none: their color is set
   * directly (#143), and filtering a chosen flat color would just store the
   * intended color two competing ways.
   */
  colorAdjustments?: ColorAdjustments
  /**
   * Orientation of a video/image entry (#232): quarter-turn rotation and
   * horizontal/vertical flips, exactly the `colorAdjustments` shape — absent
   * behaves as identity (as shot), so pre-#232 states and files stay valid;
   * present exactly when non-identity (the reducer normalizes — see
   * `normalizeOrientation`). Slates carry none: a flat color has no
   * orientation, exactly as it has no color adjustments.
   */
  orientation?: Orientation
  /**
   * Crop of a video/image entry (#255): fractions trimmed from each edge,
   * exactly the `orientation` shape — absent behaves as identity (whole
   * frame), so pre-crop states and files stay valid; present exactly when
   * non-identity (the reducer normalizes — see `normalizeCrop`). Applies in
   * source space BEFORE orientation (crop selects sensor content;
   * orientation turns the kept region). Slates carry none: a flat color has
   * nothing to trim away, exactly as it has no orientation.
   */
  crop?: Crop
  /**
   * Background fill of a video/image entry (#259): what shows behind a
   * source that doesn't fill the output frame — a blurred cover-fit copy of
   * its own frame, or a flat color — exactly the `crop` shape: absent
   * behaves as none (today's black bars), so fill-free states and files
   * stay valid; present exactly when set (the reducer normalizes — see
   * `normalizeBackgroundFill`). The fill never changes the entry's
   * effective dimensions or the output frame — it fills whatever bars the
   * frame rule leaves. Slates carry none: a flat color fills its frame by
   * construction, exactly as it carries no crop.
   */
  backgroundFill?: BackgroundFill
}

/**
 * An audio track placed against the video sequence (#102). Tracks are
 * independent of the sequence's ordering and of each other: any number may
 * overlap in time (two music tracks at once is an explicit customer
 * requirement, #100).
 *
 * `offset` is in **absolute timeline seconds** and is never re-anchored or
 * clamped by video edits: when transitions or trims shorten the video
 * sequence, a track keeps its offset even if it now extends past the
 * sequence's end — the video simply ends while the audio plays on
 * (allowed-and-silent-tail, decided in #102). Clamping instead would
 * destructively retrim audio as a side effect of video editing. How
 * playback and export treat the tail is #103/#105's concern.
 */
export interface AudioTrack {
  /** Unique per track — the same library clip can appear multiple times. */
  id: string
  /** The library clip this track was created from. Always an audio clip. */
  clipId: string
  name: string
  /** Duration of the source audio clip in seconds. */
  duration: number
  /** Object URL of the source clip, usable as an <audio> src. */
  url: string
  /** Seconds into the composed timeline where the track starts. ≥ 0. */
  offset: number
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration. */
  outPoint: number
  /** Volume of the track, 0..1 (#104). Absent means full volume. */
  volume?: number
  /**
   * Linear fade-in duration in seconds, from the start of the track's
   * window (#104). Absent means no fade. The reducer clamps fadeIn and
   * fadeOut so together they never exceed the trimmed length.
   */
  fadeIn?: number
  /** Linear fade-out duration in seconds, ending at the window's end (#104). */
  fadeOut?: number
  /**
   * Duck other audio while this track audibly plays (#241): every other
   * sound source is lowered to the duck level inside this track's window.
   * Absent means off. The rule itself lives in gain.ts (`duckWindows` /
   * `duckFactorAt`), consumed by preview and export alike.
   */
  duck?: boolean
  /**
   * The gain other audio drops to while ducked, 0..1 (#241). Absent means
   * the shared default (`DEFAULT_DUCK_LEVEL` in gain.ts) — absent-as-default
   * like every optional gain field, so duck-free projects are unchanged.
   */
  duckLevel?: number
}

/**
 * Every transition the timeline can carry, as a runtime list so other layers
 * (UI selects, serialization validation — #75) derive their set from this
 * single source of truth instead of enumerating privately.
 */
export const TRANSITION_TYPES = [
  'crossfade',
  'slide-from-above',
  'slide-from-below',
  'slide-from-left',
  'slide-from-right',
  'wipe-from-left',
  'wipe-from-right',
  'wipe-from-above',
  'wipe-from-below',
  'push-from-left',
  'push-from-right',
  'push-from-above',
  'push-from-below',
  'fade-through-black',
  'fade-through-white',
  'iris-open',
  'iris-close',
  'cross-zoom',
] as const

export type TransitionType = (typeof TRANSITION_TYPES)[number]

export interface TransitionSpec {
  type: TransitionType
  /** Overlap duration in seconds. Always > 0; the reducer clamps it. */
  duration: number
}

/**
 * A transition at the boundary between two *adjacent* entries. It belongs to
 * the ordered pair (beforeId, afterId): reordering or removing either
 * neighbor dissolves that boundary and the transition with it. During the
 * transition the tail of the before-entry and the head of the after-entry
 * play simultaneously, so the sequence shortens by `duration`.
 */
export interface TimelineTransition extends TransitionSpec {
  /** Entry whose tail plays under the transition. */
  beforeId: string
  /** Entry whose head plays under the transition. */
  afterId: string
}

/**
 * A temporary zoom into part of the frame (#63). The window is phased —
 * ramp in, hold, ramp out — and positioned by `start` seconds into the
 * entry's *trimmed* range. Centre + scale (rather than a rectangle) keeps
 * the zoomed region the frame's own aspect ratio by construction: the
 * visible region is always the frame divided by `scale` on both axes.
 */
export interface ZoomSpec {
  /** Seconds into the entry's trimmed range where the zoom-in begins. */
  start: number
  /** Seconds of zoom-in animation. */
  rampIn: number
  /** Seconds held at full zoom. */
  hold: number
  /** Seconds of zoom-out animation. */
  rampOut: number
  /** Magnification at full zoom. Always > 1; the reducer rejects less. */
  scale: number
  /** Centre of the zoomed region, as a fraction of frame width (0..1). */
  centerX: number
  /** Centre of the zoomed region, as a fraction of frame height (0..1). */
  centerY: number
}

/** A zoom owned by one timeline entry. An entry may carry several (#129). */
export interface ZoomEffect extends ZoomSpec {
  /** Unique per zoom — the handle add/update/remove act on (#129). */
  id: string
  entryId: string
}

export interface TimelineState {
  entries: TimelineEntry[]
  /**
   * Transitions between adjacent entries, at most one per boundary. Optional
   * so pre-transition states (and plain `{ entries }` literals) remain valid;
   * a missing or empty list means every boundary is a hard cut.
   */
  transitions?: TimelineTransition[]
  /**
   * Zooms on entries (#63). An entry may carry any number whose windows do
   * not overlap (#129); normalization keeps them sorted and disjoint.
   * Optional for the same reason `transitions` is; a missing or empty list
   * means nothing zooms.
   */
  zooms?: ZoomEffect[]
  /**
   * Audio tracks placed against the sequence (#102), in the order they were
   * added. Optional for the same reason `transitions` is; a missing or empty
   * list means no audio beyond the video entries' own.
   */
  audioTracks?: AudioTrack[]
  /**
   * Time-remap effects on entries (#138): speed segments and pauses. An
   * entry may carry any number whose source windows do not overlap;
   * normalization keeps them sorted and disjoint, exactly as for zooms.
   * Optional for the same reason `transitions` is — and the key is written
   * only while effects exist, so every pre-remap state (and its tests)
   * stays shaped exactly as before.
   */
  remaps?: RemapEffect[]
  /**
   * Text overlays (#139), in the order they were added — which is also
   * their stacking order: where two overlap on screen, the later-added one
   * renders on top. Anchored to sequence time and independent of the
   * entries, like audio tracks (#102) — video edits never retime or drop
   * one. Optional like `remaps`, and the key is written only while overlays
   * exist, so every pre-text state stays shaped exactly as before.
   */
  texts?: TextOverlay[]
  /**
   * Overlay video layers — picture-in-picture (#145), in the order they were
   * added, which is also their stacking order: where two rectangles overlap,
   * the later-added one renders on top. Anchored to sequence time and
   * independent of the entries, like audio tracks (#102) — video edits never
   * retime or drop one. Optional like `remaps`, and the key is written only
   * while overlays exist, so every earlier state stays shaped as before.
   */
  videoOverlays?: VideoOverlay[]
  /**
   * The project's default subtitle style (#250): what the SRT import (#249)
   * stamps on new cues, and what every `subtitle: true` overlay's
   * non-overridden style fields follow (see `subtitle-style-set`). Present
   * exactly when it differs from `DEFAULT_SUBTITLE_STYLE` — absent means
   * the built-in default, so never-customized states (and files) stay
   * shaped exactly as before. Unlike the collection fields this is not
   * rebuilt by normalization: the reducer carries it across every edit
   * verbatim (see `timelineReducer`).
   */
  subtitleStyle?: SubtitleStyle
}

export const emptyTimeline: TimelineState = { entries: [] }

export const DEFAULT_TRANSITION_DURATION = 1

/**
 * How long a newly placed still shows by default, in seconds — the
 * customer's own example figure (#136/#140). Adjustable afterwards to any
 * positive duration via `still-duration-set`.
 */
export const DEFAULT_STILL_DURATION = 5

/**
 * Whether a timeline entry is a still — an image (#140) or a color slate
 * (#143) — rather than a video. Stills share all window behavior: no source
 * trim, a settable duration, and wall-clock timing in preview and export.
 */
export function isStillEntry(entry: Pick<TimelineEntry, 'kind'>): boolean {
  return entry.kind === 'image' || entry.kind === 'slate'
}

/** Whether a timeline entry is a solid-color slate (#143). */
export function isSlateEntry(entry: Pick<TimelineEntry, 'kind'>): boolean {
  return entry.kind === 'slate'
}

/**
 * The color a newly added slate starts with (#143) — the customer's own
 * example ("a red screen before fading into my clip"). Any 24-bit color is
 * settable afterwards via `slate-color-set`.
 */
export const DEFAULT_SLATE_COLOR = '#ff0000'

/** Lowercase #rrggbb — the one shape `<input type="color">` reads and writes. */
const SLATE_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/**
 * Whether a string is a storable slate color: lowercase `#rrggbb` exactly,
 * so state comparisons and saved files never carry the same color in two
 * spellings. Shared with project-file validation (#143).
 */
export function isValidSlateColor(color: string): boolean {
  return SLATE_COLOR_PATTERN.test(color)
}

/**
 * What the "+ Color slate" control adds (#143): a solid-color entry with no
 * backing media — nothing is imported, nothing lives in the library. It is a
 * still (#140) in every window-related way; only its rendering differs.
 */
export function slateEntry(id: string, color: string = DEFAULT_SLATE_COLOR): TimelineEntry {
  if (!isValidSlateColor(color)) {
    // Callers pass picker output or the default; anything else is programmer
    // error, and a malformed color would poison saved files.
    throw new Error(`cannot create a slate with color "${color}": expected lowercase #rrggbb`)
  }
  return {
    id,
    // A slate references no library clip and has no media URL. Empty strings
    // (not absent fields) keep every video path's types unchanged; nothing
    // matches them — clip ids are UUIDs and clip-scoped actions compare
    // against real ids only.
    clipId: '',
    name: 'Color slate',
    duration: DEFAULT_STILL_DURATION,
    url: '',
    inPoint: 0,
    outPoint: DEFAULT_STILL_DURATION,
    kind: 'slate',
    color,
  }
}

/**
 * What the "+ Zoom" control adds: a 2× zoom into the frame centre at the
 * start of the entry, with gentle ramps. The reducer clamps the window to
 * the entry's trimmed duration, so this is safe on any entry.
 */
export const DEFAULT_ZOOM: ZoomSpec = {
  start: 0,
  rampIn: 0.5,
  hold: 1,
  rampOut: 0.5,
  scale: 2,
  centerX: 0.5,
  centerY: 0.5,
}

export type TimelineAction =
  | {
      /**
       * Wholesale replacement, for opening a project or starting a new one
       * (#77). The action's state is stored as-is — callers pass a state that
       * already satisfies the invariants (see `normalizedTimelineState`) so
       * that the stored reference is exactly the one they hold, which is what
       * the unsaved-changes tracking compares against (#76).
       */
      type: 'timeline-replaced'
      timeline: TimelineState
    }
  | { type: 'entry-added'; entry: TimelineEntry }
  | {
      /**
       * The razor (#190): split one entry into two at a source instant,
       * playing back exactly as before until either half is edited. The
       * caller resolves the playhead's *output* time to `atSourceTime` (see
       * `splitTargetAt` in playback.ts — locateInSequence already maps
       * output through the entry's remap effects); `newEntryId` names the
       * second half, supplied by the caller like every entry id.
       */
      type: 'entry-split'
      id: string
      /** Absolute source-clip seconds; must be strictly inside (inPoint, outPoint). */
      atSourceTime: number
      newEntryId: string
    }
  | { type: 'entry-removed'; id: string }
  | { type: 'entries-removed-for-clip'; clipId: string }
  | { type: 'entry-moved'; id: string; direction: 'up' | 'down' }
  | { type: 'entry-trimmed'; id: string; inPoint: number; outPoint: number }
  | { type: 'still-duration-set'; id: string; duration: number }
  | { type: 'slate-color-set'; id: string; color: string }
  | { type: 'transition-set'; beforeId: string; afterId: string; transition: TransitionSpec }
  | { type: 'transition-removed'; beforeId: string; afterId: string }
  | { type: 'zoom-added'; zoom: ZoomEffect }
  | { type: 'zoom-updated'; id: string; zoom: ZoomSpec }
  | { type: 'zoom-removed'; id: string }
  | { type: 'remap-added'; remap: RemapEffect }
  | { type: 'remap-updated'; id: string; remap: RemapSpec }
  | { type: 'remap-removed'; id: string }
  | { type: 'text-added'; text: TextOverlay }
  | { type: 'texts-added'; texts: TextOverlay[] }
  | { type: 'text-updated'; id: string; text: TextOverlaySpec }
  | { type: 'text-removed'; id: string }
  | {
      /**
       * Sets the project's default subtitle style whole (#250), the
       * orient/crop-set idiom: the action carries the full style; the
       * reducer clamps it, stores the normalized form (equal to the
       * built-in default means no `subtitleStyle` key at all — committing
       * `DEFAULT_SUBTITLE_STYLE` is the reset), and rewrites every
       * `subtitle: true` overlay's non-overridden style fields to it.
       * Hand-made text overlays are untouched.
       */
      type: 'subtitle-style-set'
      style: SubtitleStyle
    }
  | { type: 'video-overlay-added'; overlay: VideoOverlay }
  | { type: 'video-overlay-updated'; id: string; placement: VideoOverlayPlacement }
  | { type: 'video-overlay-removed'; id: string }
  | { type: 'audio-track-added'; track: AudioTrack }
  | { type: 'audio-track-removed'; id: string }
  | { type: 'audio-track-retimed'; id: string; offset: number }
  | { type: 'audio-track-trimmed'; id: string; inPoint: number; outPoint: number }
  | { type: 'entry-volume-set'; id: string; volume: number }
  | { type: 'entry-mute-set'; id: string; muted: boolean }
  | { type: 'entry-fades-set'; id: string; fadeIn: number; fadeOut: number }
  | {
      /**
       * Sets a video/image entry's color adjustments whole (#192): the
       * action carries the full set (absent fields = identity), and the
       * reducer stores the normalized form — identity normalizes to no
       * `colorAdjustments` key at all, so `{}` is the "reset" action.
       */
      type: 'entry-color-set'
      id: string
      adjustments: ColorAdjustments
    }
  | { type: 'video-overlay-color-set'; id: string; adjustments: ColorAdjustments }
  | {
      /**
       * Sets a video/image entry's orientation whole (#232), the
       * `entry-color-set` idiom: the action carries the full orientation
       * (absent fields = identity) and the reducer stores the normalized
       * form — identity normalizes to no `orientation` key at all, so `{}`
       * is the "reset" action.
       */
      type: 'entry-orient-set'
      id: string
      orientation: Orientation
    }
  | { type: 'video-overlay-orient-set'; id: string; orientation: Orientation }
  | {
      /**
       * Sets a video/image entry's crop whole (#255), the
       * `entry-orient-set` idiom: the action carries the full crop and the
       * reducer stores the normalized form — a no-op crop normalizes to no
       * `crop` key at all, so `{}` is the reset.
       */
      type: 'entry-crop-set'
      id: string
      crop: Crop
    }
  | { type: 'video-overlay-crop-set'; id: string; crop: Crop }
  | {
      /**
       * Sets a video overlay's shape mask whole (#266), the
       * `video-overlay-crop-set` idiom: the action carries the full mask
       * and the reducer stores the normalized form — `{ kind: 'rectangle' }`
       * normalizes to no `shapeMask` key at all, so it is the reset.
       */
      type: 'video-overlay-mask-set'
      id: string
      mask: ShapeMaskInput
    }
  | {
      /**
       * Sets a video/image entry's background fill whole (#259), the
       * `entry-crop-set` idiom: the action carries the full fill and the
       * reducer stores the normalized form — `{ kind: 'none' }` normalizes
       * to no `backgroundFill` key at all, so it is the reset.
       */
      type: 'entry-background-fill-set'
      id: string
      fill: BackgroundFillInput
    }
  | { type: 'audio-track-volume-set'; id: string; volume: number }
  | { type: 'audio-track-fades-set'; id: string; fadeIn: number; fadeOut: number }
  | { type: 'audio-track-duck-set'; id: string; duck: boolean; duckLevel?: number }

export function entryFromClip(clip: LibraryClip, id: string): TimelineEntry {
  // The sequence carries video and stills (#140); audio placement is its own
  // model (#102). The UI never offers this path for audio — reaching here is
  // programmer error, and a silent audio entry would break preview and export.
  if (clip.kind === 'audio') {
    throw new Error(`cannot add "${clip.name}" to the sequence: it is an audio clip`)
  }
  if (clip.kind === 'image') {
    // A still has no source duration: it shows for the default (#140),
    // adjustable afterwards; the window [0, duration] is its whole life.
    return {
      id,
      clipId: clip.id,
      name: clip.name,
      duration: DEFAULT_STILL_DURATION,
      url: clip.url,
      inPoint: 0,
      outPoint: DEFAULT_STILL_DURATION,
      kind: 'image',
    }
  }
  return {
    id,
    clipId: clip.id,
    name: clip.name,
    duration: clip.duration,
    url: clip.url,
    inPoint: 0,
    outPoint: clip.duration,
  }
}

/**
 * What the media library's "Add" does for an audio clip: a track starting at
 * the very beginning of the timeline, untrimmed. Placement and trim are then
 * edited on the audio lane.
 */
export function audioTrackFromClip(clip: LibraryClip, id: string, offset = 0): AudioTrack {
  // Only audio clips become audio tracks; a video clip's own audio stays
  // bound to its sequence entry (#104 gives each its own volume control).
  // The UI never offers this path for video — reaching here is programmer
  // error.
  if (clip.kind !== 'audio') {
    throw new Error(`cannot add "${clip.name}" as an audio track: it is not an audio clip`)
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
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Whether `atSourceTime` is a point an entry can split at (#190): strictly
 * inside the trimmed window. At either edge one half would be empty — there
 * is nothing to split — so edges are rejected, mirroring the empty-trim rule.
 * Shared by the reducer's veto and the UI's enablement (via `splitTargetAt`
 * in playback.ts).
 */
export function isSplittablePoint(
  entry: Pick<TimelineEntry, 'inPoint' | 'outPoint'>,
  atSourceTime: number,
): boolean {
  return (
    Number.isFinite(atSourceTime) && atSourceTime > entry.inPoint && atSourceTime < entry.outPoint
  )
}

/** The state's transitions, tolerating pre-transition states. */
export function transitionsOf(state: TimelineState): TimelineTransition[] {
  return state.transitions ?? []
}

/** The state's audio tracks, tolerating pre-audio states. */
export function audioTracksOf(state: TimelineState): AudioTrack[] {
  return state.audioTracks ?? []
}

/** The state's zooms, tolerating pre-zoom states. */
export function zoomsOf(state: TimelineState): ZoomEffect[] {
  return state.zooms ?? []
}

/** The state's time-remap effects (#138), tolerating pre-remap states. */
export function remapsOf(state: TimelineState): RemapEffect[] {
  return state.remaps ?? []
}

/** The state's text overlays (#139), tolerating pre-text states. */
export function textsOf(state: TimelineState): TextOverlay[] {
  return state.texts ?? []
}

/** The state's overlay video layers (#145), tolerating earlier states. */
export function videoOverlaysOf(state: TimelineState): VideoOverlay[] {
  return state.videoOverlays ?? []
}

/**
 * The entry's remap effects (#138). In a normalized state they are sorted
 * by window start with disjoint source windows, like an entry's zooms.
 */
export function remapsForEntry(state: TimelineState, entryId: string): RemapEffect[] {
  return remapsOf(state).filter((remap) => remap.entryId === entryId)
}

/**
 * The entry's duration in **output (playback) seconds** (#138): its trimmed
 * length adjusted by its time-remap effects — what the entry occupies in the
 * sequence. Equal to `effectiveDuration` for an entry with no effects, so
 * every pre-remap timeline keeps its exact math. `remaps` is the state's
 * full (normalized) list; the entry's own effects are selected here.
 */
export function entryOutputDuration(entry: TimelineEntry, remaps: readonly RemapEffect[]): number {
  return remappedDuration(
    effectiveDuration(entry),
    remaps.filter((remap) => remap.entryId === entry.id),
  )
}

/**
 * The entry's zooms (#129). In a normalized state they are sorted by start
 * with non-overlapping windows, in the same relative order they hold in
 * `state.zooms`.
 */
export function zoomsForEntry(state: TimelineState, entryId: string): ZoomEffect[] {
  return zoomsOf(state).filter((zoom) => zoom.entryId === entryId)
}

/** A zoom window's length: ramp in, hold, and ramp out together, in seconds. */
export function zoomWindowDuration(zoom: ZoomSpec): number {
  return zoom.rampIn + zoom.hold + zoom.rampOut
}

/**
 * What the "+ Zoom" control should add for an entry that already carries the
 * given zooms (#129): the default zoom placed into free space. The chosen
 * gap is the first one that fits the default window whole, otherwise the
 * widest gap with the window shrunk proportionally to fit it — so adding
 * never displaces an existing zoom. Returns null when the windows already
 * cover the whole trimmed duration (nothing sensible to add).
 */
export function defaultZoomFor(zooms: ZoomEffect[], entryDuration: number): ZoomSpec | null {
  const sorted = [...zooms].sort((a, b) => a.start - b.start)
  const gaps: { start: number; length: number }[] = []
  let cursor = 0
  for (const zoom of sorted) {
    if (zoom.start > cursor) gaps.push({ start: cursor, length: zoom.start - cursor })
    cursor = Math.max(cursor, zoom.start + zoomWindowDuration(zoom))
  }
  if (entryDuration > cursor) gaps.push({ start: cursor, length: entryDuration - cursor })
  if (gaps.length === 0) return null
  const preferred = zoomWindowDuration(DEFAULT_ZOOM)
  const gap =
    gaps.find((candidate) => candidate.length >= preferred) ??
    gaps.reduce((widest, candidate) => (candidate.length > widest.length ? candidate : widest))
  const factor = Math.min(1, gap.length / preferred)
  return {
    ...DEFAULT_ZOOM,
    start: gap.start,
    rampIn: DEFAULT_ZOOM.rampIn * factor,
    hold: DEFAULT_ZOOM.hold * factor,
    rampOut: DEFAULT_ZOOM.rampOut * factor,
  }
}

/**
 * Restores the transition invariants against a (possibly just edited) entry
 * list, returning one transition per boundary index (between entries[i] and
 * entries[i+1]) or undefined for a hard cut:
 *
 * - a transition survives only while its ordered pair is still adjacent;
 * - its duration never exceeds either neighbor's output duration — the
 *   trimmed duration adjusted by time-remap effects (#138), since the
 *   overlap plays out in output seconds;
 * - transitions on both sides of one entry never overlap *each other* (their
 *   durations sum to at most the entry's output duration), so no sequence
 *   time ever has more than two clips playing. When boundaries compete for
 *   the same clip time, the earlier boundary wins and the later is clamped.
 *
 * `remaps` must already be normalized against `entries` (clamped windows),
 * or output durations would count source time the entry no longer plays.
 */
function normalizedBoundaries(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
  remaps: RemapEffect[],
): (TimelineTransition | undefined)[] {
  const position = new Map(entries.map((entry, index) => [entry.id, index]))
  const byBoundary = new Map<number, TimelineTransition>()
  for (const transition of transitions) {
    const before = position.get(transition.beforeId)
    if (before !== undefined && position.get(transition.afterId) === before + 1) {
      byBoundary.set(before, transition)
    }
  }
  const boundaries: (TimelineTransition | undefined)[] = []
  let headOverlap = 0
  for (let index = 0; index < entries.length - 1; index++) {
    const transition = byBoundary.get(index)
    if (transition === undefined) {
      boundaries.push(undefined)
      headOverlap = 0
      continue
    }
    const room = Math.min(
      entryOutputDuration(entries[index], remaps) - headOverlap,
      entryOutputDuration(entries[index + 1], remaps),
    )
    const duration = Math.min(transition.duration, room)
    if (duration <= 0) {
      boundaries.push(undefined)
      headOverlap = 0
      continue
    }
    boundaries.push(duration === transition.duration ? transition : { ...transition, duration })
    headOverlap = duration
  }
  return boundaries
}

/**
 * The transition (if any) at each boundary index, with the invariants above
 * applied. Length is entries.length - 1 (or 0 for an empty timeline).
 */
export function boundaryTransitions(state: TimelineState): (TimelineTransition | undefined)[] {
  return normalizedBoundaries(state.entries, transitionsOf(state), remapsOf(state))
}

/**
 * Clamps one zoom against its entry's trimmed duration, the window floor set
 * by the entry's earlier zooms (#129), and the frame:
 *
 * - the window starts no earlier than `floor` (the end of the previous
 *   zoom's window in the per-entry sweep — 0 for the first) and never
 *   exceeds the trimmed duration — `start` first, then `rampIn`, `hold`,
 *   `rampOut` absorb the shortfall in that order, so retrimming or an
 *   overlapping edit re-clamps a zoom rather than dropping it;
 * - the zoomed region stays inside the frame: at `scale`, the region extends
 *   1 / (2·scale) from its centre on each axis, so the centre is clamped to
 *   [1 / (2·scale), 1 − 1 / (2·scale)].
 *
 * Returns the same object when nothing changes, so no-op edits are cheap to
 * detect.
 */
function clampZoom(zoom: ZoomEffect, entryDuration: number, floor = 0): ZoomEffect {
  const start = clamp(zoom.start, Math.min(floor, entryDuration), entryDuration)
  const rampIn = clamp(zoom.rampIn, 0, entryDuration - start)
  const hold = clamp(zoom.hold, 0, entryDuration - start - rampIn)
  const rampOut = clamp(zoom.rampOut, 0, entryDuration - start - rampIn - hold)
  const halfExtent = 1 / (2 * zoom.scale)
  const centerX = clamp(zoom.centerX, halfExtent, 1 - halfExtent)
  const centerY = clamp(zoom.centerY, halfExtent, 1 - halfExtent)
  const next = { ...zoom, start, rampIn, hold, rampOut, centerX, centerY }
  return zoomsEqual(zoom, next) ? zoom : next
}

/**
 * Whether a zoom spec is acceptable input at all: every field finite, and a
 * magnification above 1 — a scale of 1 or less is not a zoom, rejected
 * rather than clamped, mirroring the zero-duration transition rule.
 */
function isValidZoomSpec(zoom: ZoomSpec): boolean {
  const values = [
    zoom.start,
    zoom.rampIn,
    zoom.hold,
    zoom.rampOut,
    zoom.scale,
    zoom.centerX,
    zoom.centerY,
  ]
  return values.every((value) => Number.isFinite(value)) && zoom.scale > 1
}

function zoomsEqual(a: ZoomEffect, b: ZoomEffect): boolean {
  return (
    a.id === b.id &&
    a.entryId === b.entryId &&
    a.start === b.start &&
    a.rampIn === b.rampIn &&
    a.hold === b.hold &&
    a.rampOut === b.rampOut &&
    a.scale === b.scale &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY
  )
}

/**
 * Restores the zoom invariants against a (possibly just edited) entry list:
 * a zoom survives only while its entry exists, and an entry's zooms are
 * kept sorted by start with non-overlapping windows (#129). The resolution
 * rule for overlaps introduced by edits or re-trims: sweep the entry's
 * zooms in start order (ties keep their stored order) and clamp each per
 * `clampZoom` with the previous window's end as its floor — the earlier
 * window wins, the later one is pushed after it, and what no longer fits
 * the trimmed duration collapses phase by phase rather than being dropped,
 * mirroring how a single zoom absorbs a retrim. Results follow entry order
 * so states compare deterministically.
 */
function normalizedZooms(entries: TimelineEntry[], zooms: ZoomEffect[]): ZoomEffect[] {
  const byEntry = new Map<string, ZoomEffect[]>()
  const durations = new Map(entries.map((entry) => [entry.id, effectiveDuration(entry)]))
  for (const zoom of zooms) {
    if (!durations.has(zoom.entryId)) continue
    const list = byEntry.get(zoom.entryId)
    if (list === undefined) byEntry.set(zoom.entryId, [zoom])
    else list.push(zoom)
  }
  return entries.flatMap((entry) => {
    const list = byEntry.get(entry.id)
    if (list === undefined) return []
    const duration = durations.get(entry.id) as number
    // Array.prototype.sort is stable: equal starts keep their stored order.
    list.sort((a, b) => a.start - b.start)
    let cursor = 0
    return list.map((zoom) => {
      const clamped = clampZoom(zoom, duration, cursor)
      cursor = clamped.start + zoomWindowDuration(clamped)
      return clamped
    })
  })
}

/**
 * Restores the remap invariants against a (possibly just edited) entry list
 * (#138), mirroring `normalizedZooms`: an effect survives only while its
 * entry exists and is a video entry, and an entry's effects are kept sorted
 * by window start with disjoint source windows. Overlaps introduced by
 * edits or re-trims resolve by the same sweep rule as zooms: walk the
 * entry's effects in start order (ties keep their stored order) and clamp
 * each per `clampRemap` with the previous window's end as its floor — the
 * earlier window wins and what no longer fits the trimmed range collapses
 * against its end rather than being dropped. Results follow entry order so
 * states compare deterministically.
 *
 * Stills (images and slates, #140/#143) carry no remaps: their timing is
 * fully controlled by their one settable duration, and a second, competing
 * time control would let the same on-screen length be stored two ways.
 * Effects targeting a still are dropped here, which also makes the reducer
 * veto a `remap-added` aimed at one.
 */
function normalizedRemaps(entries: TimelineEntry[], remaps: RemapEffect[]): RemapEffect[] {
  const byEntry = new Map<string, RemapEffect[]>()
  const lengths = new Map(
    entries
      .filter((entry) => !isStillEntry(entry))
      .map((entry) => [entry.id, effectiveDuration(entry)]),
  )
  for (const remap of remaps) {
    if (!lengths.has(remap.entryId)) continue
    const list = byEntry.get(remap.entryId)
    if (list === undefined) byEntry.set(remap.entryId, [remap])
    else list.push(remap)
  }
  return entries.flatMap((entry) => {
    const list = byEntry.get(entry.id)
    if (list === undefined) return []
    const length = lengths.get(entry.id) as number
    // Array.prototype.sort is stable: equal starts keep their stored order.
    list.sort((a, b) => remapStart(a) - remapStart(b))
    let cursor = 0
    return list.map((remap) => {
      const clamped = clampRemap(remap, length, cursor)
      cursor = remapEnd(clamped)
      return clamped
    })
  })
}

/**
 * Clamps one track's fades against its trimmed length (#104): each fade is
 * non-negative and together they never exceed the length — `fadeIn` keeps
 * its value first and `fadeOut` absorbs the shortfall, mirroring how zoom
 * windows absorb a retrim. Fades meeting exactly in the middle (their sum
 * equal to the length) are allowed. Returns the same object when nothing
 * changes, so no-op edits are cheap to detect.
 */
function clampTrackFades(track: AudioTrack): AudioTrack {
  const length = effectiveDuration(track)
  const fadeIn = clamp(track.fadeIn ?? 0, 0, length)
  const fadeOut = clamp(track.fadeOut ?? 0, 0, length - fadeIn)
  if (fadeIn === (track.fadeIn ?? 0) && fadeOut === (track.fadeOut ?? 0)) return track
  return { ...track, fadeIn, fadeOut }
}

/**
 * Clamps one entry's audio fades against its *output* duration (#220) — the
 * window they ramp over (fades are output-time, see the field comment) —
 * with the same keep-fadeIn-first rule as `clampTrackFades`. Re-run by
 * `withEffects` so a retrim or remap edit shrinks an envelope rather than
 * leaving it longer than the audio. Zero fades are stored as no fields at
 * all (the byte-identity rule); fade-free entries pass through untouched by
 * reference.
 */
function clampEntryFades(entry: TimelineEntry, remaps: readonly RemapEffect[]): TimelineEntry {
  if (entry.fadeIn === undefined && entry.fadeOut === undefined) return entry
  const length = entryOutputDuration(entry, remaps)
  const clampedIn = clamp(entry.fadeIn ?? 0, 0, length)
  const clampedOut = clamp(entry.fadeOut ?? 0, 0, length - clampedIn)
  const fadeIn = clampedIn === 0 ? undefined : clampedIn
  const fadeOut = clampedOut === 0 ? undefined : clampedOut
  if (fadeIn === entry.fadeIn && fadeOut === entry.fadeOut) return entry
  const next = { ...entry }
  if (fadeIn === undefined) delete next.fadeIn
  else next.fadeIn = fadeIn
  if (fadeOut === undefined) delete next.fadeOut
  else next.fadeOut = fadeOut
  return next
}

function withEffects(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
  zooms: ZoomEffect[],
  audioTracks: AudioTrack[],
  remaps: RemapEffect[],
  texts: TextOverlay[],
  videoOverlays: VideoOverlay[],
): TimelineState {
  // Remaps normalize first: transition clamping reads output durations, and
  // an unclamped effect window would count source time the entry no longer
  // plays. Entry fades (#220) clamp against those output durations, so they
  // follow — a retrim or remap edit shrinks an envelope with its window.
  const normalizedRemapList = normalizedRemaps(entries, remaps)
  const clampedEntries = entries.map((entry) => clampEntryFades(entry, normalizedRemapList))
  const fadedEntries = clampedEntries.every((entry, index) => entry === entries[index])
    ? entries
    : clampedEntries
  return {
    entries: fadedEntries,
    transitions: normalizedBoundaries(entries, transitions, normalizedRemapList).filter(
      (transition): transition is TimelineTransition => transition !== undefined,
    ),
    // Zooms clamp against the trimmed *source* range, not the output
    // duration: they key off source time (#138 keeps that — zoomAt already
    // works in source seconds), so a remap shifts when a zoom appears in
    // the output but never what it zooms on.
    zooms: normalizedZooms(entries, zooms),
    // The remaps key exists only while effects do, so every pre-remap state
    // keeps its exact shape (see the TimelineState field comment).
    ...(normalizedRemapList.length === 0 ? {} : { remaps: normalizedRemapList }),
    // Text overlays (#139) are, like audio tracks, deliberately untouched by
    // video edits — sequence-anchored windows are never re-anchored (see the
    // TimelineState field comment). Only their own ranges clamp. The key
    // exists only while overlays do, like remaps.
    ...(texts.length === 0 ? {} : { texts: texts.map(clampTextOverlay) }),
    // Overlay video layers (#145) are, like audio tracks and text overlays,
    // deliberately untouched by video edits — sequence-anchored windows are
    // never re-anchored (see the TimelineState field comment). Only their
    // own ranges clamp. The key exists only while overlays do.
    ...(videoOverlays.length === 0 ? {} : { videoOverlays: videoOverlays.map(clampVideoOverlay) }),
    // Audio tracks are deliberately untouched by video edits: offsets are
    // absolute and never clamped to the sequence's (possibly new) length —
    // see the AudioTrack doc comment. Fades, though, depend only on the
    // track's own trim, so they are re-clamped here (a retrim shrinks them
    // rather than leaving an envelope longer than the audio).
    audioTracks: audioTracks.map(clampTrackFades),
  }
}

/**
 * A timeline state with the reducer's invariants applied to the given lists:
 * transitions only on surviving adjacent boundaries, zooms clamped to their
 * entries. For building a state outside the reducer (opening a project, #77)
 * so that `timeline-replaced` can store the caller's reference unchanged.
 */
export function normalizedTimelineState(
  entries: TimelineEntry[],
  transitions: TimelineTransition[],
  zooms: ZoomEffect[],
  audioTracks: AudioTrack[] = [],
  remaps: RemapEffect[] = [],
  texts: TextOverlay[] = [],
  videoOverlays: VideoOverlay[] = [],
  subtitleStyle?: SubtitleStyle,
): TimelineState {
  const state = withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
  // The default subtitle style (#250) is carried, not normalized — the
  // caller (deserialization) already stores it in canonical form.
  return subtitleStyle === undefined ? state : { ...state, subtitleStyle }
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  // The default subtitle style (#250) is project-level state, not a
  // collection `withEffects` rebuilds, so it is handled here: its own
  // action first, and after any other edit the stored style is carried onto
  // the new state verbatim. `timeline-replaced` swaps in a whole state
  // (opening a project) that brings its own style — nothing to carry.
  if (action.type === 'subtitle-style-set') {
    if (!isValidSubtitleStyle(action.style)) return state
    const clamped = clampSubtitleStyle(action.style)
    // Compare against the effective current default, so re-committing the
    // stored state — or resetting a never-customized project — is a no-op,
    // not an edit (edits stop preview playback).
    if (subtitleStylesEqual(clamped, state.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE)) return state
    // The mass restyle the customer asked for (#246 → #250): every subtitle
    // overlay's non-overridden style fields follow the new default at once;
    // hand-made overlays never move.
    const restyled = textsOf(state).map((text) =>
      text.subtitle === true ? applySubtitleStyle(text, clamped) : text,
    )
    const next = withEffects(
      state.entries,
      transitionsOf(state),
      zoomsOf(state),
      audioTracksOf(state),
      remapsOf(state),
      restyled,
      videoOverlaysOf(state),
    )
    // Equal to the built-in default means no key at all (#192/#232/#255
    // rule), which is what keeps never-customized files byte-identical.
    const normalized = normalizeSubtitleStyle(clamped)
    return normalized === undefined ? next : { ...next, subtitleStyle: normalized }
  }
  const next = reduceTimelineCollections(state, action)
  if (next === state || action.type === 'timeline-replaced') return next
  return state.subtitleStyle === undefined ? next : { ...next, subtitleStyle: state.subtitleStyle }
}

function reduceTimelineCollections(
  state: TimelineState,
  action: Exclude<TimelineAction, { type: 'subtitle-style-set' }>,
): TimelineState {
  const transitions = transitionsOf(state)
  const zooms = zoomsOf(state)
  const audioTracks = audioTracksOf(state)
  const remaps = remapsOf(state)
  const texts = textsOf(state)
  const videoOverlays = videoOverlaysOf(state)
  switch (action.type) {
    case 'timeline-replaced':
      return action.timeline
    case 'entry-added':
      return withEffects([...state.entries, action.entry], transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    case 'entry-split': {
      // The razor (#190). The halves cover exactly the original's trimmed
      // range, so an untouched split plays back indistinguishably; per-entry
      // effects follow the rules below (each exact except a zoom whose ramp
      // contains the cut — see the zoom case).
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      if (!isSplittablePoint(entry, action.atSourceTime)) return state
      // Ids are the handles every entry-scoped action acts on — never two
      // alike, mirroring the zoom-added and remap-added guards.
      if (state.entries.some((existing) => existing.id === action.newEntryId)) return state
      // Effect windows are relative to the trimmed range (seconds past the
      // in-point) — the cut in that coordinate space.
      const splitRel = action.atSourceTime - entry.inPoint
      // A still's window is always [0, duration] (see TimelineEntry), so its
      // halves get split *durations*; a video's halves split the source trim.
      const halves: TimelineEntry[] = isStillEntry(entry)
        ? [
            { ...entry, duration: splitRel, outPoint: splitRel },
            {
              ...entry,
              id: action.newEntryId,
              duration: entry.duration - splitRel,
              outPoint: entry.duration - splitRel,
            },
          ]
        : [
            { ...entry, outPoint: action.atSourceTime },
            { ...entry, id: action.newEntryId, inPoint: action.atSourceTime },
          ]
      const entries = [...state.entries.slice(0, index), ...halves, ...state.entries.slice(index + 1)]
      // The first half keeps the entry's id, so a transition *into* the entry
      // stays put; the boundary *out of* the entry now follows the second
      // half. The new halves' own boundary is a hard cut on continuous
      // content — invisible until either half is edited.
      const splitTransitions = transitions.map((transition) =>
        transition.beforeId === action.id
          ? { ...transition, beforeId: action.newEntryId }
          : transition,
      )
      // Zooms cut at the same instant where that is exactly representable:
      // a window wholly before the cut stays, one wholly after moves (its
      // start re-anchored to the second half), and one whose *hold* contains
      // the cut splits into two zooms that render identically (the first
      // keeps the ramp-in and the hold up to the cut, the second holds from
      // its first instant and keeps the ramp-out). A cut inside a ramp has
      // no exact ZoomSpec form (a ramp always runs 1 → scale over its own
      // length), so that zoom stays whole with the first half and
      // normalization clamps it — the issue's sanctioned fallback (#190),
      // asserted by its test.
      const splitZooms = zooms.flatMap((zoom): ZoomEffect[] => {
        if (zoom.entryId !== action.id) return [zoom]
        if (zoom.start + zoomWindowDuration(zoom) <= splitRel) return [zoom]
        if (zoom.start >= splitRel) {
          return [{ ...zoom, entryId: action.newEntryId, start: zoom.start - splitRel }]
        }
        const holdStart = zoom.start + zoom.rampIn
        if (splitRel >= holdStart && splitRel <= holdStart + zoom.hold) {
          return [
            { ...zoom, hold: splitRel - holdStart, rampOut: 0 },
            {
              ...zoom,
              // Fresh ids derive from the (fresh) second-half entry id, so a
              // cut piece can never collide with any existing effect id.
              id: `${action.newEntryId}:${zoom.id}`,
              entryId: action.newEntryId,
              start: 0,
              rampIn: 0,
              hold: holdStart + zoom.hold - splitRel,
            },
          ]
        }
        return [zoom]
      })
      // Remap effects cut exactly in every case: a speed segment containing
      // the cut becomes two segments with the same factor (the piecewise
      // output↔source mapping is identical), and a pause sits at a single
      // instant — at the cut itself it stays with the first half, freezing
      // that half's final frame, which plays out identically.
      const splitRemaps = remaps.flatMap((remap): RemapEffect[] => {
        if (remap.entryId !== action.id) return [remap]
        if (remap.kind === 'pause') {
          return remap.at <= splitRel
            ? [remap]
            : [{ ...remap, entryId: action.newEntryId, at: remap.at - splitRel }]
        }
        if (remap.end <= splitRel) return [remap]
        if (remap.start >= splitRel) {
          return [
            {
              ...remap,
              entryId: action.newEntryId,
              start: remap.start - splitRel,
              end: remap.end - splitRel,
            },
          ]
        }
        return [
          { ...remap, end: splitRel },
          {
            ...remap,
            id: `${action.newEntryId}:${remap.id}`,
            entryId: action.newEntryId,
            start: 0,
            end: remap.end - splitRel,
          },
        ]
      })
      return withEffects(entries, splitTransitions, splitZooms, audioTracks, splitRemaps, texts, videoOverlays)
    }
    case 'entry-removed':
      return withEffects(
        state.entries.filter((entry) => entry.id !== action.id),
        transitions,
        zooms,
        audioTracks,
        remaps,
        texts,
        videoOverlays,
      )
    case 'entries-removed-for-clip': {
      // Removing a library clip removes everything created from it: sequence
      // entries, audio tracks (#102), and overlay video layers (#145) alike.
      const entries = state.entries.filter((entry) => entry.clipId !== action.clipId)
      const tracks = audioTracks.filter((track) => track.clipId !== action.clipId)
      const overlays = videoOverlays.filter((overlay) => overlay.clipId !== action.clipId)
      // Same reference when nothing matched: a library removal that touches
      // no entries must not read as a timeline edit (which stops playback).
      return entries.length === state.entries.length &&
        tracks.length === audioTracks.length &&
        overlays.length === videoOverlays.length
        ? state
        : withEffects(entries, transitions, zooms, tracks, remaps, texts, overlays)
    }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'entry-trimmed': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.inPoint) || !Number.isFinite(action.outPoint)) return state
      const entry = state.entries[index]
      // A still has no source material to trim (#140): its one adjustable
      // dimension is its duration, edited via still-duration-set.
      if (isStillEntry(entry)) return state
      const inPoint = clamp(action.inPoint, 0, entry.duration)
      const outPoint = clamp(action.outPoint, 0, entry.duration)
      // An empty or inverted range would make the entry unplayable — reject it.
      if (inPoint >= outPoint) return state
      if (inPoint === entry.inPoint && outPoint === entry.outPoint) return state
      const entries = [...state.entries]
      entries[index] = { ...entry, inPoint, outPoint }
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'still-duration-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Only stills have a settable duration (#140); a video entry's length
      // is its trim. Any positive duration is accepted (the customer asked
      // for full control, e.g. 5 seconds) — zero or less would make the
      // entry unplayable, mirroring the empty-trim rejection above.
      if (!isStillEntry(entry)) return state
      if (!Number.isFinite(action.duration) || action.duration <= 0) return state
      if (action.duration === entry.duration) return state
      const entries = [...state.entries]
      // The window is always the whole still: duration and outPoint move
      // together, and transitions/zooms re-clamp exactly as after a retrim.
      entries[index] = { ...entry, duration: action.duration, inPoint: 0, outPoint: action.duration }
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'slate-color-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Only slates carry a color (#143). Anything but lowercase #rrggbb is
      // rejected rather than normalized — the color picker only emits that
      // shape, so anything else is a programmatic caller's mistake.
      if (!isSlateEntry(entry)) return state
      if (!isValidSlateColor(action.color)) return state
      if (action.color === entry.color) return state
      const entries = [...state.entries]
      entries[index] = { ...entry, color: action.color }
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'transition-set': {
      const before = state.entries.findIndex((entry) => entry.id === action.beforeId)
      // Only an existing boundary can carry a transition.
      if (before === -1 || state.entries[before + 1]?.id !== action.afterId) return state
      if (!Number.isFinite(action.transition.duration) || action.transition.duration <= 0) {
        return state
      }
      const candidate: TimelineTransition = {
        beforeId: action.beforeId,
        afterId: action.afterId,
        ...action.transition,
      }
      const next = withEffects(
        state.entries,
        [
          ...transitions.filter(
            (transition) =>
              transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
          ),
          candidate,
        ],
        zooms,
        audioTracks,
        remaps,
        texts,
        videoOverlays,
      )
      const applied = next.transitions?.find((transition) => transition.beforeId === action.beforeId)
      // Normalization can veto the whole transition (no room at this
      // boundary) or clamp it back to what is already there — both no-ops.
      if (applied === undefined) return state
      const existing = transitions.find(
        (transition) =>
          transition.beforeId === action.beforeId && transition.afterId === action.afterId,
      )
      if (existing?.type === applied.type && existing.duration === applied.duration) return state
      return next
    }
    case 'transition-removed': {
      const remaining = transitions.filter(
        (transition) =>
          transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
      )
      if (remaining.length === transitions.length) return state
      return withEffects(state.entries, remaining, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'zoom-added': {
      const zoom = action.zoom
      if (!state.entries.some((entry) => entry.id === zoom.entryId)) return state
      // Ids are the handle updates and removals act on — never two alike.
      if (zooms.some((existing) => existing.id === zoom.id)) return state
      if (!isValidZoomSpec(zoom)) return state
      const next = withEffects(state.entries, transitions, [...zooms, zoom], audioTracks, remaps, texts, videoOverlays)
      const applied = next.zooms?.find((existing) => existing.id === zoom.id)
      // Normalization can leave the new window no room at all (the entry's
      // existing zooms already reach its end) — veto the add, mirroring the
      // no-room transition rule above.
      if (applied === undefined || zoomWindowDuration(applied) <= 0) return state
      return next
    }
    case 'zoom-updated': {
      const existing = zooms.find((zoom) => zoom.id === action.id)
      if (existing === undefined) return state
      if (!isValidZoomSpec(action.zoom)) return state
      const candidate: ZoomEffect = { id: existing.id, entryId: existing.entryId, ...action.zoom }
      const next = withEffects(
        state.entries,
        transitions,
        zooms.map((zoom) => (zoom.id === action.id ? candidate : zoom)),
        audioTracks,
        remaps,
        texts,
        videoOverlays,
      )
      const applied = next.zooms?.find((zoom) => zoom.id === action.id)
      if (applied === undefined) return state
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      // The edited zoom unchanged means every sweep input is unchanged, so
      // no sibling moved either.
      if (zoomsEqual(existing, applied)) return state
      return next
    }
    case 'zoom-removed': {
      const remaining = zooms.filter((zoom) => zoom.id !== action.id)
      if (remaining.length === zooms.length) return state
      return withEffects(state.entries, transitions, remaining, audioTracks, remaps, texts, videoOverlays)
    }
    case 'remap-added': {
      const remap = action.remap
      if (!state.entries.some((entry) => entry.id === remap.entryId)) return state
      // Ids are the handle updates and removals act on — never two alike.
      if (remaps.some((existing) => existing.id === remap.id)) return state
      if (!isValidRemapSpec(remap)) return state
      const next = withEffects(state.entries, transitions, zooms, audioTracks, [...remaps, remap], texts, videoOverlays)
      const applied = next.remaps?.find((existing) => existing.id === remap.id)
      // Normalization can drop the effect (its entry is a still — see
      // normalizedRemaps) or collapse a speed segment to nothing (the
      // entry's existing effects already reach its end) — veto the add,
      // mirroring the no-room zoom rule above. A pause never collapses:
      // its hold survives wherever its instant clamps to.
      if (applied === undefined) return state
      if (applied.kind === 'speed' && applied.start >= applied.end) return state
      return next
    }
    case 'remap-updated': {
      const existing = remaps.find((remap) => remap.id === action.id)
      if (existing === undefined) return state
      if (!isValidRemapSpec(action.remap)) return state
      const candidate: RemapEffect = {
        ...action.remap,
        id: existing.id,
        entryId: existing.entryId,
      }
      const next = withEffects(
        state.entries,
        transitions,
        zooms,
        audioTracks,
        remaps.map((remap) => (remap.id === action.id ? candidate : remap)),
        texts,
        videoOverlays,
      )
      const applied = next.remaps?.find((remap) => remap.id === action.id)
      if (applied === undefined) return state
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      // The edited effect unchanged means every sweep input is unchanged,
      // so no sibling moved either.
      if (remapsEqual(existing, applied)) return state
      return next
    }
    case 'remap-removed': {
      const remaining = remaps.filter((remap) => remap.id !== action.id)
      if (remaining.length === remaps.length) return state
      return withEffects(state.entries, transitions, zooms, audioTracks, remaining, texts, videoOverlays)
    }
    case 'text-added': {
      const text = action.text
      // Ids are the handle updates and removals act on — never two alike.
      if (texts.some((existing) => existing.id === text.id)) return state
      if (!isValidTextOverlaySpec(text)) return state
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, [...texts, text], videoOverlays)
    }
    case 'texts-added': {
      // A subtitle import (#249) lands as one action, so a file of many
      // cues is a single edit — one undo removes the whole import. The
      // batch is all-or-nothing, mirroring text-added's strictness: the
      // import path parses and validates before dispatching, so a rejected
      // batch is a programming error, not a user-visible outcome.
      if (action.texts.length === 0) return state
      const ids = new Set(texts.map((text) => text.id))
      for (const text of action.texts) {
        if (ids.has(text.id)) return state
        ids.add(text.id)
        if (!isValidTextOverlaySpec(text)) return state
      }
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, [...texts, ...action.texts], videoOverlays)
    }
    case 'text-updated': {
      const existing = texts.find((text) => text.id === action.id)
      if (existing === undefined) return state
      if (!isValidTextOverlaySpec(action.text)) return state
      let candidate: TextOverlay = { ...action.text, id: existing.id }
      if (existing.subtitle === true) {
        // An individual edit to a subtitle overlay's style claims those
        // fields (#250): the union of what was already overridden and what
        // this edit changes, recomputed here so the stored list is the
        // reducer's truth whatever the action carried. A later default-
        // style edit leaves claimed fields alone.
        const overrides = normalizeStyleOverrides([
          ...(existing.styleOverrides ?? []),
          ...changedStyleFields(existing, clampTextOverlay(candidate)),
        ])
        delete candidate.styleOverrides
        if (overrides !== undefined) candidate = { ...candidate, styleOverrides: overrides }
      }
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      if (textOverlaysEqual(existing, clampTextOverlay(candidate))) return state
      return withEffects(
        state.entries,
        transitions,
        zooms,
        audioTracks,
        remaps,
        texts.map((text) => (text.id === action.id ? candidate : text)),
        videoOverlays,
      )
    }
    case 'text-removed': {
      const remaining = texts.filter((text) => text.id !== action.id)
      if (remaining.length === texts.length) return state
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, remaining, videoOverlays)
    }
    case 'video-overlay-added': {
      const overlay = action.overlay
      // Ids are the handle updates and removals act on — never two alike.
      if (videoOverlays.some((existing) => existing.id === overlay.id)) return state
      if (!isValidVideoOverlayPlacement(overlay)) return state
      // An empty or inverted trim range would make the overlay unplayable —
      // reject it whole (mirroring audio-track-trimmed), judged after the
      // clamp so an out-of-range trim that clamps sane is kept.
      const clamped = clampVideoOverlay(overlay)
      if (clamped.inPoint >= clamped.outPoint) return state
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, [
        ...videoOverlays,
        overlay,
      ])
    }
    case 'video-overlay-updated': {
      const existing = videoOverlays.find((overlay) => overlay.id === action.id)
      if (existing === undefined) return state
      if (!isValidVideoOverlayPlacement(action.placement)) return state
      // Identity and source binding never change: only the placement fields
      // are taken from the action.
      const candidate: VideoOverlay = { ...existing, ...action.placement }
      const clamped = clampVideoOverlay(candidate)
      if (clamped.inPoint >= clamped.outPoint) return state
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      if (videoOverlaysEqual(existing, clamped)) return state
      return withEffects(
        state.entries,
        transitions,
        zooms,
        audioTracks,
        remaps,
        texts,
        videoOverlays.map((overlay) => (overlay.id === action.id ? candidate : overlay)),
      )
    }
    case 'video-overlay-removed': {
      const remaining = videoOverlays.filter((overlay) => overlay.id !== action.id)
      if (remaining.length === videoOverlays.length) return state
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, remaining)
    }
    case 'audio-track-added':
      return withEffects(state.entries, transitions, zooms, [...audioTracks, action.track], remaps, texts, videoOverlays)
    case 'audio-track-removed': {
      const remaining = audioTracks.filter((track) => track.id !== action.id)
      if (remaining.length === audioTracks.length) return state
      return withEffects(state.entries, transitions, zooms, remaining, remaps, texts, videoOverlays)
    }
    case 'audio-track-retimed': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.offset)) return state
      // Offsets are clamped at zero but unbounded above: a track may start
      // beyond the video sequence's current end (silent tail — see AudioTrack).
      const offset = Math.max(0, action.offset)
      if (offset === audioTracks[index].offset) return state
      const tracks = [...audioTracks]
      tracks[index] = { ...tracks[index], offset }
      return withEffects(state.entries, transitions, zooms, tracks, remaps, texts, videoOverlays)
    }
    case 'audio-track-trimmed': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.inPoint) || !Number.isFinite(action.outPoint)) return state
      const track = audioTracks[index]
      const inPoint = clamp(action.inPoint, 0, track.duration)
      const outPoint = clamp(action.outPoint, 0, track.duration)
      // An empty or inverted range would make the track unplayable — reject it.
      if (inPoint >= outPoint) return state
      if (inPoint === track.inPoint && outPoint === track.outPoint) return state
      const tracks = [...audioTracks]
      tracks[index] = { ...track, inPoint, outPoint }
      return withEffects(state.entries, transitions, zooms, tracks, remaps, texts, videoOverlays)
    }
    case 'entry-volume-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.volume)) return state
      const volume = clamp(action.volume, 0, 1)
      // Compare against the effective value: setting an untouched entry to
      // full volume is a no-op, not an edit (edits stop preview playback).
      if (volume === (state.entries[index].volume ?? 1)) return state
      const entries = [...state.entries]
      entries[index] = { ...entries[index], volume }
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'entry-mute-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (action.muted === (state.entries[index].muted ?? false)) return state
      const entries = [...state.entries]
      entries[index] = { ...entries[index], muted: action.muted }
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'entry-fades-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.fadeIn) || !Number.isFinite(action.fadeOut)) return state
      const entry = state.entries[index]
      // Stills (images and slates) are soundless (#220): there is no audio
      // to fade, exactly as color adjustments reject slates (#192).
      if (isStillEntry(entry)) return state
      // clampEntryFades (via withEffects) enforces the invariant; clamping
      // negatives here keeps the no-op comparison honest, and zero fades
      // store as no fields at all (the byte-identity rule).
      const fadeIn = Math.max(0, action.fadeIn)
      const fadeOut = Math.max(0, action.fadeOut)
      const candidate = { ...entry }
      if (fadeIn === 0) delete candidate.fadeIn
      else candidate.fadeIn = fadeIn
      if (fadeOut === 0) delete candidate.fadeOut
      else candidate.fadeOut = fadeOut
      const clamped = clampEntryFades(candidate, remaps)
      if (
        (clamped.fadeIn ?? 0) === (entry.fadeIn ?? 0) &&
        (clamped.fadeOut ?? 0) === (entry.fadeOut ?? 0)
      ) {
        return state
      }
      const entries = [...state.entries]
      entries[index] = clamped
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'entry-color-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no adjustments (#192): their color is set directly
      // (#143) — see the TimelineEntry field comment.
      if (isSlateEntry(entry)) return state
      if (!isValidColorAdjustments(action.adjustments)) return state
      const normalized = normalizeColorAdjustments(action.adjustments)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same values — or resetting an untouched entry — is
      // a no-op, not an edit (edits stop preview playback).
      if (colorAdjustmentsEqual(normalized, entry.colorAdjustments)) return state
      const entries = [...state.entries]
      // Identity means no key at all, never `{}` — what keeps adjustment-free
      // saved files byte-identical (see colorAdjustments.ts).
      const next = { ...entry }
      if (normalized === undefined) delete next.colorAdjustments
      else next.colorAdjustments = normalized
      entries[index] = next
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'video-overlay-color-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!isValidColorAdjustments(action.adjustments)) return state
      const normalized = normalizeColorAdjustments(action.adjustments)
      if (colorAdjustmentsEqual(normalized, overlay.colorAdjustments)) return state
      const overlays = [...videoOverlays]
      const next = { ...overlay }
      if (normalized === undefined) delete next.colorAdjustments
      else next.colorAdjustments = normalized
      overlays[index] = next
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, overlays)
    }
    case 'entry-orient-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no orientation (#232): a flat color has no sideways,
      // exactly as they carry no color adjustments (#192).
      if (isSlateEntry(entry)) return state
      if (!isValidOrientation(action.orientation)) return state
      const normalized = normalizeOrientation(action.orientation)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same state — or resetting an untouched entry — is
      // a no-op, not an edit (edits stop preview playback).
      if (orientationsEqual(normalized, entry.orientation)) return state
      const entries = [...state.entries]
      // Identity means no key at all, never `{}` — what keeps
      // orientation-free saved files byte-identical (see orientation.ts).
      const next = { ...entry }
      if (normalized === undefined) delete next.orientation
      else next.orientation = normalized
      entries[index] = next
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'video-overlay-orient-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!isValidOrientation(action.orientation)) return state
      const normalized = normalizeOrientation(action.orientation)
      if (orientationsEqual(normalized, overlay.orientation)) return state
      const overlays = [...videoOverlays]
      const next = { ...overlay }
      if (normalized === undefined) delete next.orientation
      else next.orientation = normalized
      overlays[index] = next
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, overlays)
    }
    case 'entry-crop-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no crop (#255): a flat color has nothing to trim,
      // exactly as it carries no orientation (#232).
      if (isSlateEntry(entry)) return state
      if (!isValidCrop(action.crop)) return state
      const normalized = normalizeCrop(action.crop)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same state — or resetting an untouched entry — is
      // a no-op, not an edit (edits stop preview playback).
      if (cropsEqual(normalized, entry.crop)) return state
      const entries = [...state.entries]
      // Identity means no key at all, never `{}` — what keeps crop-free
      // saved files byte-identical (see crop.ts).
      const next = { ...entry }
      if (normalized === undefined) delete next.crop
      else next.crop = normalized
      entries[index] = next
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'entry-background-fill-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no fill (#259): a flat color fills its frame by
      // construction, exactly as it carries no crop (#255).
      if (isSlateEntry(entry)) return state
      if (!isValidBackgroundFillInput(action.fill)) return state
      const normalized = normalizeBackgroundFill(action.fill)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same state — or resetting an untouched entry — is
      // a no-op, not an edit (edits stop preview playback).
      if (backgroundFillsEqual(normalized, entry.backgroundFill)) return state
      const entries = [...state.entries]
      // None means no key at all (see backgroundFill.ts) — what keeps
      // fill-free saved files byte-identical.
      const next = { ...entry }
      if (normalized === undefined) delete next.backgroundFill
      else next.backgroundFill = normalized
      entries[index] = next
      return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
    }
    case 'video-overlay-crop-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!isValidCrop(action.crop)) return state
      const normalized = normalizeCrop(action.crop)
      if (cropsEqual(normalized, overlay.crop)) return state
      const overlays = [...videoOverlays]
      const next = { ...overlay }
      if (normalized === undefined) delete next.crop
      else next.crop = normalized
      overlays[index] = next
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, overlays)
    }
    case 'video-overlay-mask-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!isValidShapeMaskInput(action.mask)) return state
      const normalized = normalizeShapeMask(action.mask)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same shape — or resetting an unmasked overlay —
      // is a no-op, not an edit.
      if (shapeMasksEqual(normalized, overlay.shapeMask)) return state
      const overlays = [...videoOverlays]
      // Rectangle means no key at all (see shapeMask.ts) — what keeps
      // mask-free saved files byte-identical.
      const next = { ...overlay }
      if (normalized === undefined) delete next.shapeMask
      else next.shapeMask = normalized
      overlays[index] = next
      return withEffects(state.entries, transitions, zooms, audioTracks, remaps, texts, overlays)
    }
    case 'audio-track-volume-set': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.volume)) return state
      const volume = clamp(action.volume, 0, 1)
      if (volume === (audioTracks[index].volume ?? 1)) return state
      const tracks = [...audioTracks]
      tracks[index] = { ...tracks[index], volume }
      return withEffects(state.entries, transitions, zooms, tracks, remaps, texts, videoOverlays)
    }
    case 'audio-track-fades-set': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.fadeIn) || !Number.isFinite(action.fadeOut)) return state
      const track = audioTracks[index]
      // clampTrackFades (via withEffects) enforces the invariant; clamping
      // negatives here keeps the no-op comparison honest.
      const candidate = clampTrackFades({
        ...track,
        fadeIn: Math.max(0, action.fadeIn),
        fadeOut: Math.max(0, action.fadeOut),
      })
      if (
        (candidate.fadeIn ?? 0) === (track.fadeIn ?? 0) &&
        (candidate.fadeOut ?? 0) === (track.fadeOut ?? 0)
      ) {
        return state
      }
      const tracks = [...audioTracks]
      tracks[index] = candidate
      return withEffects(state.entries, transitions, zooms, tracks, remaps, texts, videoOverlays)
    }
    case 'audio-track-duck-set': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      const track = audioTracks[index]
      const next = { ...track }
      if (action.duck) {
        next.duck = true
        // The level is stored only when the action carries one — absent
        // means the shared default (see the AudioTrack doc comment), so a
        // plain toggle-on writes no level field.
        if (action.duckLevel !== undefined) {
          if (!Number.isFinite(action.duckLevel)) return state
          next.duckLevel = clamp(action.duckLevel, 0, 1)
        }
      } else {
        // Toggling off restores the absent-as-default shape entirely, so a
        // never-ducked and a duck-then-undone track serialize identically.
        delete next.duck
        delete next.duckLevel
      }
      if ((next.duck ?? false) === (track.duck ?? false) && next.duckLevel === track.duckLevel) {
        return state
      }
      const tracks = [...audioTracks]
      tracks[index] = next
      return withEffects(state.entries, transitions, zooms, tracks, remaps, texts, videoOverlays)
    }
  }
}

/** The trimmed (playable) duration of one entry or audio track, in seconds. */
export function effectiveDuration(entry: Pick<TimelineEntry, 'inPoint' | 'outPoint'>): number {
  return entry.outPoint - entry.inPoint
}

/**
 * Total duration of the **video sequence** in seconds, honoring trims and
 * time-remap effects (#138) — each entry contributes its output duration.
 * Each transition overlaps its neighbors rather than adding time, so the
 * total shrinks by every transition's duration. Audio tracks do not extend
 * it — whether a tail of audio past this point lengthens playback/export is
 * #103/#105's decision.
 */
export function totalDuration(state: TimelineState): number {
  const remaps = remapsOf(state)
  const overlap = boundaryTransitions(state).reduce(
    (sum, transition) => sum + (transition?.duration ?? 0),
    0,
  )
  return state.entries.reduce((sum, entry) => sum + entryOutputDuration(entry, remaps), 0) - overlap
}
