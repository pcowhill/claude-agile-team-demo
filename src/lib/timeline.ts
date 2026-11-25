import type { ColorAdjustments } from './colorAdjustments'
import type { Orientation } from './orientation'
import { isValidOrientation, normalizeOrientation, orientationsEqual } from './orientation'
import type { Crop } from './crop'
import { cropsEqual, isValidCrop, normalizeCrop } from './crop'
import type { RedactionRegion } from './redaction'
import type { SpotlightRegion } from './spotlight'
import {
  areAcceptableSpotlightInputs,
  normalizeSpotlights,
  spotlightsEqual,
} from './spotlight'
import {
  areAcceptableRedactionInputs,
  normalizeRedactions,
  redactionsEqual,
} from './redaction'
import type { ShapeMaskInput } from './shapeMask'
import { isValidShapeMaskInput, normalizeShapeMask, shapeMasksEqual } from './shapeMask'
import type { OverlayBorder } from './overlayBorder'
import {
  isValidOverlayBorderInput,
  normalizeOverlayBorder,
  overlayBordersEqual,
} from './overlayBorder'
import type { OverlayShadow } from './overlayShadow'
import {
  isValidOverlayShadowInput,
  normalizeOverlayShadow,
  overlayShadowsEqual,
} from './overlayShadow'
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
  remapSpecsEqual,
  remapStart,
} from './remap'
import type { RangeCutPlan } from './rangeCut'
import { RANGE_CUT_EPSILON, planRangeCut } from './rangeCut'
import type { RippleChange, RippleCollections } from './ripple'
import { rippleCut, splitZoomAt } from './ripple'
import { splitAudioTrack, splitVideoOverlay } from './elementSplit'
import { cutAudioTrack, cutVideoOverlay } from './elementCut'
import type { OverlayMove, OverlayMoveSpec } from './overlayMove'
import type { PictureEffect, PictureEffectSpec } from './pictureEffect'
import {
  clampPictureEffect,
  isValidPictureEffectSpec,
  pictureEffectsEqual,
} from './pictureEffect'
import { isValidMoveSpec, moveSpecsEqual, withOverlayMovesClamped } from './overlayMove'
import type { SubtitleStyle, TextOverlay, TextOverlaySpec } from './textOverlay'
import type { ShapeGroup, ShapeGroupSpec } from './shapes'
import { clampShapeGroup, isValidShapeGroupSpec, shapeGroupsEqual } from './shapes'
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
import type { CopiedSettings, SettingsElementKind } from './settingsClipboard'
import type { CanvasPreset } from './frameSize'
import { clampVolume } from './volume'
import { isCanvasPreset } from './frameSize'
import type {
  ImageOverlayPlacement,
  OverlayPlacement,
  OverlayRemap,
  OverlayZoom,
  VideoOverlay,
  VideoOverlayPlacement,
} from './videoOverlay'
import {
  clampVideoOverlay,
  isImageOverlay,
  isValidImageOverlay,
  isValidImageOverlayPlacement,
  isValidVideoOverlayPlacement,
  overlayOutputDuration,
  videoOverlaysEqual,
} from './videoOverlay'

export type { ColorAdjustments, ColorLook } from './colorAdjustments'
export type { PauseRemapSpec, RemapEffect, RemapSpec, SpeedRemapSpec } from './remap'
export type { TextOverlay, TextOverlaySpec } from './textOverlay'
export type {
  ImageOverlayPlacement,
  OverlayPlacement,
  OverlayRemap,
  OverlayZoom,
  VideoOverlay,
  VideoOverlayPlacement,
} from './videoOverlay'
export { imageOverlayFromClip, isImageOverlay, videoOverlayFromClip } from './videoOverlay'

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
   * Volume of the entry's own audio, 0 to `MAX_VOLUME` (#104, #692). Absent means full volume —
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
  /**
   * Redaction regions on a video/image entry (#492): rectangles that hide
   * part of the picture for a window of the entry's own source time. Absent
   * means none — the `crop` shape (#255) — so pre-redaction states and files
   * stay valid and redaction-free files stay byte-identical. The rectangles
   * are fractions of the SOURCE frame, before orientation and crop, and the
   * windows are in source seconds, so turning, cropping or retrimming the
   * entry never slides a mask off what it hides. Slates carry none: a flat
   * colour has nothing to redact, exactly as it has no crop.
   */
  redactions?: RedactionRegion[]
  /**
   * Spotlight regions on a video/image entry (#532): rectangles or ovals
   * that dim everything outside them for a window of the entry's own source
   * time. Absent means none — the `redactions` shape exactly (#492) — so
   * pre-spotlight states and files stay valid and spotlight-free files stay
   * byte-identical. The rectangles are fractions of the SOURCE frame,
   * before orientation and crop, and the windows are in source seconds, so
   * turning, cropping or retrimming the entry never slides a spotlight off
   * what it points at. Slates carry none: a flat colour has no part worth
   * pointing at, exactly as it has nothing to redact.
   */
  spotlights?: SpotlightRegion[]
}

/**
 * An audio track placed against the video sequence (#102). Tracks are
 * independent of the sequence's ordering and of each other: any number may
 * overlap in time (two music tracks at once is an explicit customer
 * requirement, #100).
 *
 * `offset` is in **absolute timeline seconds** and is never re-anchored or
 * clamped by video edits — Cut out marked range aside, which ripples it
 * with the picture (#824, ripple.ts): when transitions or trims shorten the video
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
  /** Volume of the track, 0 to `MAX_VOLUME` (#104, #692). Absent means full volume. */
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
 * The core transitions, as a runtime list. Since #199 the source of truth
 * for what exists at runtime is the transition registry
 * (`transitionRender.ts`) — plugins can contribute more — and this list is
 * what registers the core set there at startup. UI selects and labels read
 * the registry; serialization accepts any registered type (the open flow
 * enforces it after plugin dependencies settle — #75's protection, moved to
 * where plugin types are knowable).
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

/**
 * A transition type id. A plain string since #199: plugins register
 * transitions at runtime, so the compile-time universe is open — validity is
 * a registry question (`transitionRender.ts`), not a type-level one.
 */
export type TransitionType = string

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
   * one, except Cut out marked range, which ripples them (#824, ripple.ts).
   * Optional like `remaps`, and the key is written only while overlays
   * exist, so every pre-text state stays shaped exactly as before.
   */
  texts?: TextOverlay[]
  /**
   * Overlay video layers — picture-in-picture (#145), in the order they were
   * added, which is also their stacking order: where two rectangles overlap,
   * the later-added one renders on top. Anchored to sequence time and
   * independent of the entries, like audio tracks (#102) — video edits never
   * retime or drop one, except Cut out marked range, which ripples them
   * (#824, ripple.ts). Optional like `remaps`, and the key is written only
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
  /**
   * The project's canvas preset (#273): a fixed output-frame aspect the
   * customer chooses, instead of the source-derived frame (#176). Present
   * exactly when one is chosen — absent means Auto, so preset-free states
   * (and files) stay shaped exactly as before, the #192/#232/#255/#259 rule.
   * Project-level like `subtitleStyle`, and carried across every edit for
   * the same reason: `withEffects` rebuilds the collections, not this.
   *
   * Frame-fraction state — overlay rectangles (#145), text positions (#139),
   * zoom centres (#64) — needs no migration when this changes: those are
   * fractions of whatever frame the rule yields, so they stay proportional
   * through a reshape. That is pinned by test rather than assumed.
   */
  canvasPreset?: CanvasPreset
  /**
   * Chapter markers (#487, the approved #461): named points in sequence
   * time, kept sorted by time. A marker is not attached to an entry and
   * does not move when clips are edited — a chapter is a point in the
   * finished video, and the user places it against the picture. Cut out
   * marked range is the one edit that moves it, with the picture (#824). Project
   * content: saved and restored like the collections, undoable like every
   * edit. Optional and written only while any exist, so every earlier state
   * (and file) stays shaped exactly as before. Carried across other edits
   * verbatim by `withProjectFields`, like `subtitleStyle` — `withEffects`
   * rebuilds the entry-bound collections only.
   */
  markers?: ChapterMarker[]
  /**
   * Shape groups (#683, the approved design #681): timed groups of
   * rectangles, ellipses and arrows (#684) drawn on the output frame, between the overlay
   * layers and the text. Anchored to sequence time and never retimed by a
   * video edit but Cut out marked range (#824), like text — so they are
   * project-level here, carried across
   * every other edit by `withProjectFields` exactly as markers are, rather
   * than rebuilt by `withEffects`. In add order; the order matters only
   * between groups that start together (later start draws on top, #681 §4).
   * Optional and written only while any exist, so every earlier state (and
   * file) stays shaped exactly as before.
   */
  shapeGroups?: ShapeGroup[]
  /**
   * Picture effects on entries (#862): a vignette, a blur, or another
   * registered effect over a window of an entry's trimmed range. An entry
   * may carry any number, and their windows may overlap; normalization
   * keeps them in entry order, sorted by start, each clamped into its
   * entry. Rebuilt by `withEffects` like zooms, since they live and die
   * with their entry. Optional like `remaps`, and the key is written only
   * while effects exist, so every earlier state (and file) stays shaped
   * exactly as before.
   */
  pictureEffects?: PictureEffect[]
}

/** A chapter marker (#487): a name at a sequence time. */
export interface ChapterMarker {
  id: string
  /** Sequence time in seconds, ≥ 0. May lie past the current end. */
  time: number
  name: string
}

export const emptyTimeline: TimelineState = { entries: [] }

export const DEFAULT_TRANSITION_DURATION = 1

/**
 * How long a newly placed still shows by default, in seconds — the
 * customer's own example figure (#136/#140). Adjustable afterwards to any
 * positive duration via `still-duration-set`, and the default itself is a
 * user setting whose out-of-the-box value this is (#286).
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
export function slateEntry(
  id: string,
  color: string = DEFAULT_SLATE_COLOR,
  /** How long it shows — the user's setting, defaulting to #143's figure (#286). */
  duration: number = DEFAULT_STILL_DURATION,
): TimelineEntry {
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
    duration,
    url: '',
    inPoint: 0,
    outPoint: duration,
    kind: 'slate',
    color,
  }
}

/**
 * What + Effect ▾ → Zoom adds (#419; the "+ Zoom" button until then): a
 * 2× zoom into the frame centre at the
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
       * Batch add from a library selection (#292): the entries join the end
       * of the sequence and the tracks the audio lane, both in the given
       * order, in one action — so one undo step removes the whole batch
       * (history.ts: one action = one step). Each item is exactly what a
       * single `entry-added` / `audio-track-added` would have carried.
       */
      type: 'clips-added'
      entries: TimelineEntry[]
      audioTracks: AudioTrack[]
    }
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
  | {
      /**
       * Cut out marked range (#823): remove the sequence's output time
       * `[from, to)`, splitting the entries at both marks with the razor
       * above and removing what lies between, as one action — so one undo
       * step. Refused (same state) exactly where `rangeCutPlanFor` returns
       * null. `newEntryIds` name the pieces the two splits create, supplied
       * by the caller like every entry id; the second names the kept part
       * after the range when its mark falls inside an entry.
       */
      type: 'range-cut'
      from: number
      to: number
      newEntryIds: readonly [string, string]
    }
  | {
      /**
       * Freeze frame (#379): insert the captured frame's still entry at the
       * playhead's placement, splitting the entry under it when the razor
       * can cut there — capture, cut, and insert as ONE action so the
       * history rule (history.ts) gives one undo step for the whole freeze.
       * `still` is the entry the captured library clip became
       * (`entryFromClip` on a freeze clip — kind 'image', positive
       * duration); the reducer validates it like any inserted entry and
       * refuses the whole action otherwise, the `texts-added` strictness.
       *
       * 'split' delegates to `entry-split` exactly (same guards, same
       * effect re-keying) and puts the still between the halves — that
       * boundary is a fresh hard cut, so no transition moves or drops. A
       * refused split refuses the whole action: a still landing anywhere
       * but between the halves would misplace the hold. 'before'/'after'
       * insert without cutting (the placement resolver in freezeFrame.ts
       * says when each applies); inserting between two entries separates
       * them, so a transition on that boundary is dropped by
       * normalization — the rule every insert path follows (see
       * `element-duplicated`).
       */
      type: 'frame-frozen'
      still: TimelineEntry
      placement:
        | { kind: 'split'; entryId: string; atSourceTime: number; newEntryId: string }
        | { kind: 'before'; entryId: string }
        | { kind: 'after'; entryId: string }
    }
  | {
      /**
       * A screen + camera take arrives placed (#388): the screen capture's
       * entry appended to the sequence, and the camera capture's overlay
       * starting exactly at that entry's start — whatever `offset` the
       * caller built, the reducer pins it to the appended entry's start
       * time, so the two can never disagree. ONE action so the history rule
       * (history.ts) gives one undo step for the arrival; the library keeps
       * both captured clips across that undo, like every recording — the
       * capture is a deliverable of its own (#224, #379). All-or-nothing:
       * any invalid piece refuses the whole action with the state
       * unchanged, so an undo never has to unpick half an arrival. The
       * appended boundary is a fresh hard cut, so no transition moves.
       */
      type: 'recording-pair-placed'
      /** The screen capture as a sequence entry (`entryFromClip`, video kind). */
      entry: TimelineEntry
      /** The camera capture as a video overlay (`videoOverlayFromClip`). */
      overlay: VideoOverlay
    }
  | {
      /**
       * Duplicate one timeline element with every adjustable setting (#314):
       * an exact copy of the identified row under `newId`, as one action so
       * the history rule gives one undo step. A sequence entry's copy is
       * inserted immediately after the original (its per-entry remaps and
       * zooms cloned under the new entry id, so editing either copy's
       * effects never touches the other); an audio track, video overlay, or
       * text overlay's copy lands on the same lane starting where the
       * original ends, so the two never stack. Transitions are never
       * copied — they belong to a boundary, not an entry — and inserting the
       * copy separates the original from its next entry, so normalization
       * drops any transition on that boundary, exactly as the existing
       * insert paths behave. A shape group's copy (#687) starts where the
       * original ends, and sits immediately after it in the group list.
       */
      type: 'element-duplicated'
      kind: 'entry' | 'audio-track' | 'video-overlay' | 'text' | 'shape-group'
      id: string
      /** The copy's id, supplied by the caller like every element id. */
      newId: string
    }
  | {
      /**
       * Split… on an audio track or a video overlay (#826): the element
       * becomes two at a source instant, each playing exactly where the
       * original did (see `elementSplit.ts` for the rule). The second part
       * is listed right after the first, so overlay stacking is unchanged,
       * and it is one action, so one undo step. Refused (same state) on In,
       * on Out, outside the trim, on an image overlay, for an unknown id,
       * and for a `newId` already taken.
       */
      type: 'element-split'
      kind: 'audio-track' | 'video-overlay'
      id: string
      /** Absolute source-clip seconds; must be strictly inside (inPoint, outPoint). */
      atSourceTime: number
      /** The second part's id, supplied by the caller like every element id. */
      newId: string
    }
  | {
      /**
       * Cut… on an audio track or a video overlay (#828): the part between
       * two source instants is removed and the later part closes up behind
       * the earlier, so the element plays on without a gap (see
       * `elementCut.ts` for the rule). Nothing else moves: an overlay or a
       * track is placed independently. The later part is listed right after
       * the earlier, so overlay stacking is unchanged, and it is one action,
       * so one undo step. Refused (same state) with a clamp on In or Out,
       * the clamps inverted or equal, on an image overlay, for an unknown
       * id, and for a `newId` already taken.
       */
      type: 'element-cut'
      kind: 'audio-track' | 'video-overlay'
      id: string
      /** Absolute source-clip seconds: the removed part is [from, to). */
      from: number
      to: number
      /** The later part's id, supplied by the caller like every element id. */
      newId: string
    }
  | {
      /**
       * Paste settings (#315): applies a copied set of settings to one
       * element, every chosen group in ONE action so the history rule gives
       * one undo step however many groups it carries. `settings` holds a key
       * per group being pasted; a group's value may be `undefined`, meaning
       * the source's effective value is the identity — pasting it *resets*
       * the target, the "make the target match the source" rule that Paste
       * Attributes means everywhere else (see `settingsClipboard.ts`).
       *
       * The reducer, not the dialog, is the truth: each group is applied
       * exactly as its dedicated setter would (validated, normalized,
       * clamped, identity stored as no key at all), a group the target
       * cannot hold is skipped rather than refused (no audio onto a still,
       * no mute onto an audio track, nothing at all onto a slate), and an
       * action carrying invalid input is refused whole — the all-or-nothing
       * strictness `texts-added` follows. Media, trim, position, and
       * placement are never settings and never change.
       */
      type: 'settings-pasted'
      kind: SettingsElementKind
      id: string
      settings: CopiedSettings
    }
  | {
      /**
       * Rename one timeline element (#405): a sequence entry (slates
       * included), an audio track, a video/image overlay, or a shape group
       * (#687), by id — one
       * action across the kinds, since each kind's list is searched for the
       * id. Text overlays are identified by their content and are not
       * renamed here. The name is whitespace-trimmed; an empty result, an
       * unknown id, or the name already held is a same-reference no-op, so
       * none of them records a history step. Renaming never touches the
       * library clip the element came from — each carries its own name,
       * copied at placement — and derived rows (splits, duplicates, freezes)
       * copy whatever name the source carries at that moment.
       *
       * A shape group differs in one way: its row shows a name derived from
       * its shapes until it is given one, so an empty name *clears* its own
       * name and returns it to the derived one (#687), rather than being
       * ignored.
       */
      type: 'element-renamed'
      id: string
      name: string
    }
  | { type: 'entry-removed'; id: string }
  | { type: 'entries-removed-for-clip'; clipId: string }
  | {
      /**
       * The batch counterpart of `entries-removed-for-clip` (#293): every
       * timeline item created from any of these library clips goes in one
       * action, so a batch removal is one undo-history event rather than N
       * (history.ts evaluates its clearing rule once, over one removal,
       * instead of N times across N intermediate states).
       */
      type: 'entries-removed-for-clips'
      clipIds: readonly string[]
    }
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
  /**
   * Picture effects (#862): add, replace an effect's window and parameter
   * values (one field commit is one edit), remove. Each is refused when
   * malformed and same-reference when it changes nothing.
   */
  | { type: 'picture-effect-added'; effect: PictureEffect }
  | { type: 'picture-effect-updated'; id: string; effect: PictureEffectSpec }
  | { type: 'picture-effect-removed'; id: string }
  | { type: 'text-added'; text: TextOverlay }
  | { type: 'texts-added'; texts: TextOverlay[] }
  | { type: 'text-updated'; id: string; text: TextOverlaySpec }
  | { type: 'text-removed'; id: string }
  /** Chapter markers (#487): add at a time, rename, move, remove — each one edit. */
  | { type: 'marker-added'; marker: ChapterMarker }
  | { type: 'marker-renamed'; id: string; name: string }
  | { type: 'marker-moved'; id: string; time: number }
  | { type: 'marker-removed'; id: string }
  /**
   * Shape groups (#683): add, replace whole (timing, fades and shapes — one
   * field commit is one edit), remove. Each is refused when malformed and
   * same-reference when it changes nothing.
   */
  | { type: 'shape-group-added'; group: ShapeGroup }
  | { type: 'shape-group-updated'; id: string; group: ShapeGroupSpec }
  | { type: 'shape-group-removed'; id: string }
  /**
   * Text overlays and shape groups placed together (#860): what an Add ▾
   * contribution's dialog returns, such as a title template, placed as one
   * edit so one undo removes every element. All-or-nothing, as
   * `texts-added` is: a duplicate id or a malformed element refuses the
   * whole batch, leaving the state unchanged.
   */
  | { type: 'elements-placed'; texts: TextOverlay[]; shapeGroups: ShapeGroup[] }
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
  | {
      /**
       * Sets the project's canvas preset (#273). `undefined` is Auto, and
       * stores no key at all — the absent-as-default rule, which is what
       * keeps preset-free projects byte-identical. Re-committing the current
       * preset (Auto included) is a same-reference no-op, not an edit, so it
       * never lands in history or stops preview playback.
       */
      type: 'canvas-preset-set'
      preset: CanvasPreset | undefined
    }
  | { type: 'video-overlay-added'; overlay: VideoOverlay }
  | {
      /**
       * Edits one overlay's placement. What the placement carries depends on
       * the *stored* overlay's kind (#294): a video overlay takes its
       * rectangle plus trim and audio, an image overlay its rectangle plus
       * the explicit `offset` + `duration` window and no audio at all. A
       * placement built for the wrong kind is refused whole rather than
       * half-applied — an image placement has no trim, so it fails a video
       * overlay's finite-trim check, and a video placement's audio fields
       * are refused by name on an image overlay.
       */
      type: 'video-overlay-updated'
      id: string
      placement: OverlayPlacement
    }
  | { type: 'video-overlay-removed'; id: string }
  /**
   * Zooms on an overlay's own picture (#699), the entry zoom actions'
   * counterparts: the add is vetoed when normalization leaves its window no
   * room, and an update that clamps back to what is stored is a no-op.
   */
  | { type: 'video-overlay-zoom-added'; overlayId: string; zoom: OverlayZoom }
  | { type: 'video-overlay-zoom-updated'; overlayId: string; id: string; zoom: ZoomSpec }
  | { type: 'video-overlay-zoom-removed'; overlayId: string; id: string }
  /**
   * Speed segments and pauses on a video overlay (#700), the entry remap
   * actions' counterparts: an add aimed at an image overlay, or one whose
   * speed segment normalization collapses to nothing, is vetoed, and an
   * update that clamps back to what is stored is a no-op.
   */
  | { type: 'video-overlay-remap-added'; overlayId: string; remap: OverlayRemap }
  | { type: 'video-overlay-remap-updated'; overlayId: string; id: string; remap: RemapSpec }
  | { type: 'video-overlay-remap-removed'; overlayId: string; id: string }
  /**
   * Moves on an overlay (#834), video or image: the zoom actions' shape. An
   * add whose glide normalization leaves no room is vetoed, and an update
   * that clamps back to what is stored is a no-op. Each is one undo step.
   */
  | { type: 'video-overlay-move-added'; overlayId: string; move: OverlayMove }
  | { type: 'video-overlay-move-updated'; overlayId: string; id: string; move: OverlayMoveSpec }
  | { type: 'video-overlay-move-removed'; overlayId: string; id: string }
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
       * Sets a video/image entry's redaction regions whole (#492), the
       * `entry-crop-set` idiom: the action carries the full list and the
       * reducer stores the normalized form — an empty list normalizes to no
       * `redactions` key at all, so `[]` is the reset. One action per commit
       * is what makes each field edit a single undo step, and adding,
       * editing and removing a region all reduce to "here is the new list".
       */
      type: 'entry-redactions-set'
      id: string
      redactions: RedactionRegion[]
    }
  | { type: 'video-overlay-redactions-set'; id: string; redactions: RedactionRegion[] }
  | {
      /**
       * Sets a video/image entry's spotlight regions whole (#532), the
       * `entry-redactions-set` idiom exactly: the action carries the full
       * list, the reducer stores the normalized form, and an empty list
       * normalizes to no `spotlights` key at all, so `[]` is the reset.
       */
      type: 'entry-spotlights-set'
      id: string
      spotlights: SpotlightRegion[]
    }
  | { type: 'video-overlay-spotlights-set'; id: string; spotlights: SpotlightRegion[] }
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
       * Sets an overlay's border (#697), in the mask-set idiom: the action
       * carries the full border and the reducer stores the normalized form
       * — a thickness of 0 normalizes to no `border` key at all, so it is
       * the reset.
       */
      type: 'video-overlay-border-set'
      id: string
      border: OverlayBorder
    }
  | {
      /**
       * Turns an overlay's drop shadow (#698) on, edits it, or (with
       * `null`) turns it off. The action carries the full shadow and the
       * reducer stores the normalized form; off is no `shadow` key at all.
       */
      type: 'video-overlay-shadow-set'
      id: string
      shadow: OverlayShadow | null
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
  | {
      /**
       * Match levels (#691): several elements' Volumes set at once, as one
       * action so one undo restores them all. Each is clamped to 0–`MAX_VOLUME` like
       * its own volume action; ids no longer present (an element removed
       * while the clips were measured) and image overlays are skipped.
       */
      type: 'volumes-matched'
      volumes: { kind: 'entry' | 'video-overlay' | 'audio-track'; id: string; volume: number }[]
    }
  | { type: 'audio-track-fades-set'; id: string; fadeIn: number; fadeOut: number }
  | { type: 'audio-track-duck-set'; id: string; duck: boolean; duckLevel?: number }

export function entryFromClip(
  clip: LibraryClip,
  id: string,
  /**
   * How long a still shows — the user's setting, defaulting to #140's figure
   * (#286). Ignored for video, which has a source duration of its own.
   */
  stillDuration: number = DEFAULT_STILL_DURATION,
): TimelineEntry {
  // The sequence carries video and stills (#140); audio placement is its own
  // model (#102). The UI never offers this path for audio — reaching here is
  // programmer error, and a silent audio entry would break preview and export.
  if (clip.kind === 'audio') {
    throw new Error(`cannot add "${clip.name}" to the sequence: it is an audio clip`)
  }
  if (clip.kind === 'image') {
    // A still has no source duration: it shows for the configured default
    // (#140/#286), adjustable afterwards; [0, duration] is its whole life.
    return {
      id,
      clipId: clip.id,
      name: clip.name,
      duration: stillDuration,
      url: clip.url,
      inPoint: 0,
      outPoint: stillDuration,
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

/**
 * The plan for Cut out marked range (#823) over the output time
 * `[from, to)`, or null where the cut is refused — see `planRangeCut`.
 * The one rule the `range-cut` action and the Frame ▾ item both read.
 */
export function rangeCutPlanFor(state: TimelineState, from: number, to: number): RangeCutPlan | null {
  const remaps = remapsOf(state)
  return planRangeCut(
    state.entries.map((entry) => ({
      id: entry.id,
      inPoint: entry.inPoint,
      outPoint: entry.outPoint,
      remaps: remaps.filter((remap) => remap.entryId === entry.id),
    })),
    boundaryTransitions(state).map((transition) => transition?.duration ?? 0),
    from,
    to,
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

/** The state's picture effects (#862), tolerating states from before them. */
export function pictureEffectsOf(state: TimelineState): PictureEffect[] {
  return state.pictureEffects ?? []
}

/** The state's text overlays (#139), tolerating pre-text states. */
/** The chapter markers (#487), sorted by time; an absent list is empty. */
export function markersOf(state: TimelineState): ChapterMarker[] {
  return state.markers ?? []
}

/** The state's shape groups (#683), tolerating earlier states. */
export function shapeGroupsOf(state: TimelineState): ShapeGroup[] {
  return state.shapeGroups ?? []
}

/**
 * The name a new marker gets (#487): `Chapter N`, N counting the markers
 * that exist plus one — a placeholder the inline field opens on, so a
 * marker added and left alone still reads as something.
 */
export function nextMarkerName(state: TimelineState): string {
  return `Chapter ${markersOf(state).length + 1}`
}

/** Two marker times this close are the same instant (the slider's step is 0.01 s). */
export const MARKER_TIME_EPSILON = 1e-6

/** The marker at `time`, if one sits within `tolerance` of it (nearest wins). */
export function markerAt(
  state: TimelineState,
  time: number,
  tolerance: number = MARKER_TIME_EPSILON,
): ChapterMarker | null {
  let best: ChapterMarker | null = null
  let bestDistance = Infinity
  for (const marker of markersOf(state)) {
    const distance = Math.abs(marker.time - time)
    if (distance <= tolerance && distance < bestDistance) {
      best = marker
      bestDistance = distance
    }
  }
  return best
}

function isValidMarker(marker: ChapterMarker): boolean {
  return (
    typeof marker.id === 'string' &&
    marker.id !== '' &&
    Number.isFinite(marker.time) &&
    marker.time >= 0 &&
    typeof marker.name === 'string' &&
    marker.name.trim() !== ''
  )
}

/** Sorted by time, ties by insertion order; names trimmed. */
function normalizedMarkers(markers: readonly ChapterMarker[]): ChapterMarker[] {
  return markers
    .map((marker) => (marker.name === marker.name.trim() ? marker : { ...marker, name: marker.name.trim() }))
    .sort((a, b) => a.time - b.time)
}

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
 * The entry's picture effects (#862). In a normalized state they are sorted
 * by start, a filtered view of `state.pictureEffects`.
 */
export function pictureEffectsForEntry(state: TimelineState, entryId: string): PictureEffect[] {
  return pictureEffectsOf(state).filter((effect) => effect.entryId === entryId)
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
 * What + Effect ▾ → Zoom should add for an entry that already carries the
 * given zooms (#129): the default zoom placed into free space. The chosen
 * gap is the first one that fits the default window whole, otherwise the
 * widest gap with the window shrunk proportionally to fit it — so adding
 * never displaces an existing zoom. Returns null when the windows already
 * cover the whole trimmed duration (nothing sensible to add).
 */
export function defaultZoomFor(zooms: readonly ZoomSpec[], entryDuration: number): ZoomSpec | null {
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
function clampZoom<T extends ZoomSpec>(zoom: T, entryDuration: number, floor = 0): T {
  const start = clamp(zoom.start, Math.min(floor, entryDuration), entryDuration)
  const rampIn = clamp(zoom.rampIn, 0, entryDuration - start)
  const hold = clamp(zoom.hold, 0, entryDuration - start - rampIn)
  const rampOut = clamp(zoom.rampOut, 0, entryDuration - start - rampIn - hold)
  const halfExtent = 1 / (2 * zoom.scale)
  const centerX = clamp(zoom.centerX, halfExtent, 1 - halfExtent)
  const centerY = clamp(zoom.centerY, halfExtent, 1 - halfExtent)
  const next = { ...zoom, start, rampIn, hold, rampOut, centerX, centerY }
  return zoomSpecsEqual(zoom, next) ? zoom : next
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
  return a.id === b.id && a.entryId === b.entryId && zoomSpecsEqual(a, b)
}

/** Whether two zooms have the same window, magnification and centre. */
function zoomSpecsEqual(a: ZoomSpec, b: ZoomSpec): boolean {
  return (
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
    return sweptZooms(list, durations.get(entry.id) as number)
  })
}

/**
 * One owner's zooms, sorted by start and clamped in that order with the
 * previous window's end as each one's floor (#129) — the sweep
 * `normalizedZooms` runs per entry, and the overlay's zooms (#699) per
 * overlay, so the two owners resolve overlaps by one rule.
 */
function sweptZooms<T extends ZoomSpec>(zooms: readonly T[], duration: number): T[] {
  // Array.prototype.sort is stable: equal starts keep their stored order.
  const sorted = [...zooms].sort((a, b) => a.start - b.start)
  let cursor = 0
  return sorted.map((zoom) => {
    const clamped = clampZoom(zoom, duration, cursor)
    cursor = clamped.start + zoomWindowDuration(clamped)
    return clamped
  })
}

/**
 * An overlay with its zooms (#699) normalized against its own trimmed
 * window, by the entry's sweep (`sweptZooms`). The same object when
 * nothing moved — including an overlay with no zooms — so zoom-free states
 * keep every reference and every saved byte.
 */
function withOverlayZoomsClamped(overlay: VideoOverlay): VideoOverlay {
  if (overlay.zooms === undefined) return overlay
  const swept = sweptZooms(overlay.zooms, effectiveDuration(overlay))
  const unchanged =
    swept.length === overlay.zooms.length &&
    swept.every((zoom, index) => zoom === overlay.zooms?.[index])
  return unchanged ? overlay : { ...overlay, zooms: swept }
}

/**
 * Restores the picture-effect invariants against a (possibly just edited)
 * entry list (#862): an effect survives only while its entry exists, and
 * each window is clamped into its entry's trimmed source range, as a
 * zoom's is (`clampPictureEffect`). Windows may overlap, so there is no
 * sweep: an entry's effects are only sorted by start (ties keep their
 * stored order). Results follow entry order so states compare
 * deterministically, and an unchanged list comes back by reference.
 */
function normalizedPictureEffects(
  entries: TimelineEntry[],
  effects: PictureEffect[],
): PictureEffect[] {
  if (effects.length === 0) return effects
  const byEntry = new Map<string, PictureEffect[]>()
  const durations = new Map(entries.map((entry) => [entry.id, effectiveDuration(entry)]))
  for (const effect of effects) {
    if (!durations.has(effect.entryId)) continue
    const list = byEntry.get(effect.entryId)
    if (list === undefined) byEntry.set(effect.entryId, [effect])
    else list.push(effect)
  }
  const normalized = entries.flatMap((entry) => {
    const list = byEntry.get(entry.id)
    if (list === undefined) return []
    const duration = durations.get(entry.id) as number
    // Array.prototype.sort is stable: equal starts keep their stored order.
    return list.map((effect) => clampPictureEffect(effect, duration)).sort((a, b) => a.start - b.start)
  })
  const unchanged =
    normalized.length === effects.length && normalized.every((effect, index) => effect === effects[index])
  return unchanged ? effects : normalized
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

/**
 * The fields the visual settings groups live in — the shape a sequence entry
 * and a video overlay have in common (an overlay carries no background fill,
 * which is why the helper takes `holdsFill`).
 */
interface PastedVisualSettings {
  colorAdjustments?: ColorAdjustments
  orientation?: Orientation
  crop?: Crop
  backgroundFill?: BackgroundFill
  redactions?: RedactionRegion[]
  spotlights?: SpotlightRegion[]
}

/**
 * The visual half of a settings paste (#315) — Color, Orientation, Crop and
 * Background fill — applied to a sequence entry or a video overlay alike,
 * exactly as each group's dedicated setter does it: input validated, the
 * normalized form stored, and identity stored as no key at all (the
 * byte-identity rule that keeps adjustment-free saved files unchanged).
 *
 * Returns the SAME reference when no group changes anything, so the caller
 * can detect a no-op paste by identity, and `undefined` when the action
 * carries invalid input, which refuses the whole paste. `holdsFill` says
 * whether the target can hold a background fill at all (entries can, video
 * overlays have no such field): a group the target cannot hold is skipped,
 * never a refusal.
 */
function withPastedVisualSettings<T extends PastedVisualSettings>(
  element: T,
  settings: CopiedSettings,
  holdsFill: boolean,
): T | undefined {
  let next = element
  // Copy on first change only, so an all-no-op paste keeps the reference.
  const draft = (): PastedVisualSettings => {
    if (next === element) next = { ...element }
    return next
  }
  if (settings.color !== undefined) {
    const adjustments = settings.color.adjustments
    if (adjustments !== undefined && !isValidColorAdjustments(adjustments)) return undefined
    const normalized =
      adjustments === undefined ? undefined : normalizeColorAdjustments(adjustments)
    if (!colorAdjustmentsEqual(normalized, element.colorAdjustments)) {
      const target = draft()
      if (normalized === undefined) delete target.colorAdjustments
      else target.colorAdjustments = normalized
    }
  }
  if (settings.orientation !== undefined) {
    const orientation = settings.orientation.orientation
    if (orientation !== undefined && !isValidOrientation(orientation)) return undefined
    const normalized = orientation === undefined ? undefined : normalizeOrientation(orientation)
    if (!orientationsEqual(normalized, element.orientation)) {
      const target = draft()
      if (normalized === undefined) delete target.orientation
      else target.orientation = normalized
    }
  }
  if (settings.redaction !== undefined) {
    const regions = settings.redaction.redactions
    // A copied list is already normalized (it came off an element), but it
    // arrives through an action like any other input, so it is validated
    // before it is stored — the strict check, since a region that is out of
    // range no longer covers what it was drawn over (#492).
    if (regions !== undefined && !areAcceptableRedactionInputs(regions)) return undefined
    const normalized = normalizeRedactions(regions)
    if (!redactionsEqual(normalized, element.redactions)) {
      const target = draft()
      if (normalized === undefined) delete target.redactions
      else target.redactions = normalized
    }
  }
  if (settings.spotlight !== undefined) {
    // The redaction group's rule, for the same reason: a copied list is
    // already normalized, but it arrives through an action like any other
    // input, so it is checked before it is stored (#532).
    const regions = settings.spotlight.spotlights
    if (regions !== undefined && !areAcceptableSpotlightInputs(regions)) return undefined
    const normalized = normalizeSpotlights(regions)
    if (!spotlightsEqual(normalized, element.spotlights)) {
      const target = draft()
      if (normalized === undefined) delete target.spotlights
      else target.spotlights = normalized
    }
  }
  if (settings.crop !== undefined) {
    const crop = settings.crop.crop
    if (crop !== undefined && !isValidCrop(crop)) return undefined
    const normalized = crop === undefined ? undefined : normalizeCrop(crop)
    if (!cropsEqual(normalized, element.crop)) {
      const target = draft()
      if (normalized === undefined) delete target.crop
      else target.crop = normalized
    }
  }
  if (settings['background-fill'] !== undefined && holdsFill) {
    const fill = settings['background-fill'].fill
    if (fill !== undefined && !isValidBackgroundFillInput(fill)) return undefined
    const normalized = fill === undefined ? undefined : normalizeBackgroundFill(fill)
    if (!backgroundFillsEqual(normalized, element.backgroundFill)) {
      const target = draft()
      if (normalized === undefined) delete target.backgroundFill
      else target.backgroundFill = normalized
    }
  }
  return next
}

/**
 * The lists `withEffects` normalizes together: the entries and every
 * collection whose invariants depend on them. One object rather than seven
 * positional arguments (#862), so a reducer case names only the lists it
 * changes and takes the rest from `effectListsOf`, and a new entry-bound
 * kind is one more key here rather than one more argument at every call.
 */
interface EffectLists {
  entries: TimelineEntry[]
  transitions: TimelineTransition[]
  zooms: ZoomEffect[]
  audioTracks: AudioTrack[]
  remaps: RemapEffect[]
  texts: TextOverlay[]
  videoOverlays: VideoOverlay[]
  pictureEffects: PictureEffect[]
}

/** A state's lists as `withEffects` takes them, each absent key read as empty. */
function effectListsOf(state: TimelineState): EffectLists {
  return {
    entries: state.entries,
    transitions: transitionsOf(state),
    zooms: zoomsOf(state),
    audioTracks: audioTracksOf(state),
    remaps: remapsOf(state),
    texts: textsOf(state),
    videoOverlays: videoOverlaysOf(state),
    pictureEffects: pictureEffectsOf(state),
  }
}

function withEffects({
  entries,
  transitions,
  zooms,
  audioTracks,
  remaps,
  texts,
  videoOverlays,
  pictureEffects,
}: EffectLists): TimelineState {
  // Remaps normalize first: transition clamping reads output durations, and
  // an unclamped effect window would count source time the entry no longer
  // plays. Entry fades (#220) clamp against those output durations, so they
  // follow — a retrim or remap edit shrinks an envelope with its window.
  const normalizedRemapList = normalizedRemaps(entries, remaps)
  const clampedEntries = entries.map((entry) => clampEntryFades(entry, normalizedRemapList))
  const fadedEntries = clampedEntries.every((entry, index) => entry === entries[index])
    ? entries
    : clampedEntries
  const normalizedPictureEffectList = normalizedPictureEffects(entries, pictureEffects)
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
    // Picture effects (#862) clamp against the trimmed source range too, for
    // the zooms' reason: their windows are source seconds. The key exists
    // only while effects do, like remaps.
    ...(normalizedPictureEffectList.length === 0 ? {} : { pictureEffects: normalizedPictureEffectList }),
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
    // Each overlay's own zooms (#699) clamp against its trimmed window after
    // the window itself clamps, as an entry's do against its trim; its Moves
    // (#834) against its on-screen window, which the remaps just settled.
    ...(videoOverlays.length === 0
      ? {}
      : {
          videoOverlays: videoOverlays.map((overlay) =>
            withOverlayMovesClamped(withOverlayZoomsClamped(clampVideoOverlay(overlay))),
          ),
        }),
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
 * transitions only on surviving adjacent boundaries, zooms and picture
 * effects clamped to their entries. For building a state outside the reducer (opening a project, #77)
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
  canvasPreset?: CanvasPreset,
  markers: ChapterMarker[] = [],
  shapeGroups: ShapeGroup[] = [],
  pictureEffects: PictureEffect[] = [],
): TimelineState {
  const state = withEffects({
    entries,
    transitions,
    zooms,
    audioTracks,
    remaps,
    texts,
    videoOverlays,
    pictureEffects,
  })
  // The project-level fields (#250, #273) are carried, not normalized — the
  // caller (deserialization) already stores them in canonical form. Markers
  // (#487) are sorted, the one canonical form a file might not have kept.
  return withProjectFields(state, {
    subtitleStyle,
    canvasPreset,
    ...(markers.length === 0 ? {} : { markers: normalizedMarkers(markers) }),
    ...(shapeGroups.length === 0 ? {} : { shapeGroups: shapeGroups.map(clampShapeGroup) }),
  })
}

/**
 * Adds the project-level fields — the default subtitle style (#250) and the
 * canvas preset (#273) — to a state a collection rebuild produced.
 *
 * `withEffects` rebuilds the collections only, so anything stored beside them
 * has to be carried across every edit explicitly. An absent field stays
 * absent (never written as `undefined`), which is what keeps a state that
 * never used one shaped exactly as it always was; with nothing to carry the
 * given state comes back by reference, so a no-op edit stays a no-op.
 */
function withProjectFields(
  next: TimelineState,
  fields: {
    subtitleStyle?: SubtitleStyle
    canvasPreset?: CanvasPreset
    markers?: ChapterMarker[]
    shapeGroups?: ShapeGroup[]
  },
): TimelineState {
  const carried = {
    ...(fields.subtitleStyle === undefined ? {} : { subtitleStyle: fields.subtitleStyle }),
    ...(fields.canvasPreset === undefined ? {} : { canvasPreset: fields.canvasPreset }),
    // Markers (#487) are project-level too: an empty list is no key.
    ...(fields.markers === undefined || fields.markers.length === 0 ? {} : { markers: fields.markers }),
    // Shape groups (#683) likewise.
    ...(fields.shapeGroups === undefined || fields.shapeGroups.length === 0
      ? {}
      : { shapeGroups: fields.shapeGroups }),
  }
  return Object.keys(carried).length === 0 ? next : { ...next, ...carried }
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  // The default subtitle style (#250) and the canvas preset (#273) are
  // project-level state, not collections `withEffects` rebuilds, so they are
  // handled here: their own actions first, and after any other edit the
  // stored values are carried onto the new state verbatim.
  // `timeline-replaced` swaps in a whole state (opening a project) that
  // brings its own — nothing to carry.
  if (action.type === 'canvas-preset-set') {
    // An unknown identifier is refused rather than stored: it would reshape
    // the frame both renderers derive from (#176).
    if (action.preset !== undefined && !isCanvasPreset(action.preset)) return state
    // Re-committing the current preset — Auto over Auto included — is a
    // same-reference no-op, so it is not an edit (edits stop playback).
    if (state.canvasPreset === action.preset) return state
    // The preset moves no window and invalidates no fraction, so the
    // collections are carried verbatim rather than rebuilt: overlay
    // rectangles, text positions and zoom centres are fractions of whatever
    // frame the rule yields and stay proportional through a reshape.
    const { canvasPreset: _replaced, ...rest } = state
    return action.preset === undefined ? rest : { ...rest, canvasPreset: action.preset }
  }
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
    const next = withEffects({ ...effectListsOf(state), texts: restyled })
    // Equal to the built-in default means no key at all (#192/#232/#255
    // rule), which is what keeps never-customized files byte-identical.
    const normalized = normalizeSubtitleStyle(clamped)
    // Every other project-level field is carried as it stands — markers
    // (#487) and shape groups (#683) included. Naming the fields one by one
    // here is how markers came to be dropped by a style change (#694).
    return withProjectFields(next, { ...state, subtitleStyle: normalized })
  }
  if (
    action.type === 'marker-added' ||
    action.type === 'marker-renamed' ||
    action.type === 'marker-moved' ||
    action.type === 'marker-removed'
  ) {
    // Chapter markers (#487) are project-level like the two above: their
    // own actions here, and every other edit carries them verbatim through
    // withProjectFields below. Each is same-reference when it changes
    // nothing, so a no-op is not an edit.
    const markers = reduceMarkers(markersOf(state), action)
    if (markers === markersOf(state)) return state
    const { markers: _replaced, ...rest } = state
    return markers.length === 0 ? rest : { ...rest, markers }
  }
  if (action.type === 'elements-placed') return placeElements(state, action.texts, action.shapeGroups)
  // Duplicate, Paste settings and Rename… on a shape group (#687) act on
  // the project-level list, so they are answered here, as its own actions
  // are just below. Every other kind goes on to the collections.
  const shapeGroupEdit = reduceShapeGroupRowAction(state, action)
  if (shapeGroupEdit !== undefined) {
    const current = shapeGroupsOf(state)
    if (shapeGroupEdit === current) return state
    const { shapeGroups: _replaced, ...rest } = state
    return { ...rest, shapeGroups: shapeGroupEdit }
  }
  if (
    action.type === 'shape-group-added' ||
    action.type === 'shape-group-updated' ||
    action.type === 'shape-group-removed'
  ) {
    // Shape groups (#683) are project-level like markers: their own actions
    // here, carried verbatim through every other edit below.
    const current = shapeGroupsOf(state)
    const groups = reduceShapeGroups(current, action)
    if (groups === current) return state
    const { shapeGroups: _replaced, ...rest } = state
    return groups.length === 0 ? rest : { ...rest, shapeGroups: groups }
  }
  const next = reduceTimelineCollections(state, action)
  if (next === state || action.type === 'timeline-replaced') return next
  // Cut out marked range (#824): everything placed in sequence time follows
  // the picture. Here, not in `cutRange`, because markers and shape groups
  // are project-level fields that `withProjectFields` would otherwise copy
  // back unchanged.
  if (action.type === 'range-cut') return withRipple(state, next, action.from, action.to)
  return withProjectFields(next, state)
}

/**
 * `elements-placed` (#860): the texts through `texts-added`'s own checks,
 * then each shape group through `shape-group-added`'s, so a placed element
 * is exactly as valid as one added by hand. Any refusal refuses the batch.
 */
function placeElements(
  state: TimelineState,
  texts: TextOverlay[],
  shapeGroups: ShapeGroup[],
): TimelineState {
  if (texts.length === 0 && shapeGroups.length === 0) return state
  const withTexts = texts.length === 0 ? state : timelineReducer(state, { type: 'texts-added', texts })
  if (withTexts === state && texts.length > 0) return state
  let groups = shapeGroupsOf(withTexts)
  for (const group of shapeGroups) {
    const next = reduceShapeGroups(groups, { type: 'shape-group-added', group })
    if (next === groups) return state
    groups = next
  }
  if (shapeGroups.length === 0) return withTexts
  const { shapeGroups: _replaced, ...rest } = withTexts
  return { ...rest, shapeGroups: groups }
}

/** The collections the ripple (#824) acts on, read from a state. */
function rippleCollectionsOf(state: TimelineState): RippleCollections {
  return {
    audioTracks: audioTracksOf(state),
    videoOverlays: videoOverlaysOf(state),
    texts: textsOf(state),
    shapeGroups: shapeGroupsOf(state),
    markers: markersOf(state),
  }
}

/**
 * What Cut out marked range (#824) would move, shorten or remove besides
 * the sequence's entries: the same `rippleCut` the reducer applies, so the
 * confirmation's counts are what the cut does. Empty when the cut touches
 * nothing placed in sequence time.
 */
export function rangeCutRipple(state: TimelineState, from: number, to: number): RippleChange[] {
  return rippleCut(rippleCollectionsOf(state), from, to).changes
}

/**
 * The cut timeline with the ripple applied (see `ripple.ts`). `state` is the
 * timeline before the cut, whose project-level fields are carried; `cut` is
 * what `cutRange` made of its collections. Normalization runs on the result
 * as on any edit, which clamps fades, draw-ons and effect windows to the
 * shortened elements.
 */
function withRipple(state: TimelineState, cut: TimelineState, from: number, to: number): TimelineState {
  // Tracks, overlays and text come from the cut; the project-level fields
  // were not part of it, so they come from the state before.
  const rippled = rippleCut(
    { ...rippleCollectionsOf(cut), shapeGroups: shapeGroupsOf(state), markers: markersOf(state) },
    from,
    to,
  )
  const next = withEffects({
    ...effectListsOf(cut),
    audioTracks: rippled.audioTracks,
    texts: rippled.texts,
    videoOverlays: rippled.videoOverlays,
  })
  return withProjectFields(next, {
    ...state,
    markers: normalizedMarkers(rippled.markers),
    shapeGroups: rippled.shapeGroups.map(clampShapeGroup),
  })
}

/**
 * Cut out marked range (#823): carries out `rangeCutPlanFor`'s plan as one
 * state change. Each mark inside an entry is cut by the razor
 * (`entry-split`, #190) — the Out mark first, so that an In mark in the same
 * entry still finds that entry's first half under its own id — then the
 * pieces strictly between the two marks are removed. Effects on removed
 * pieces go with them, and a transition on a removed boundary goes too:
 * `withEffects` keeps only transitions on boundaries that still exist, so
 * the two sides meet at a hard cut. A pause the marks fall inside has its
 * hold shortened as the plan says (see `rangeCut.ts`).
 *
 * Elements placed in sequence time — tracks, overlays, text, shape groups,
 * chapter markers — are rippled afterwards by `timelineReducer`
 * (`withRipple`, #824), because two of them are project-level fields this
 * collection reducer does not hold.
 */
function cutRange(
  state: TimelineState,
  action: Extract<TimelineAction, { type: 'range-cut' }>,
): TimelineState {
  const plan = rangeCutPlanFor(state, action.from, action.to)
  if (plan === null) return state
  const [midId, tailId] = action.newEntryIds
  // Ids are the handles every entry-scoped action acts on — never two alike.
  if (midId === tailId) return state
  if (state.entries.some((entry) => entry.id === midId || entry.id === tailId)) return state
  const withHold = (list: RemapEffect[], pauseId: string, seconds: number): RemapEffect[] =>
    seconds > RANGE_CUT_EPSILON
      ? list.map((remap) =>
          remap.id === pauseId && remap.kind === 'pause' ? { ...remap, hold: seconds } : remap,
        )
      : list.filter((remap) => remap.id !== pauseId)
  if (plan.kind === 'within-hold') {
    return withEffects({ ...effectListsOf(state), remaps: withHold(remapsOf(state), plan.pauseId, plan.seconds) })
  }
  const { from, to } = plan
  // The last piece kept before the range and the first kept after it, by
  // id — undefined at the sequence's start or end. A split keeps the
  // entry's id on its first half, so the head is the entry itself.
  const headId =
    from.kind === 'boundary' ? state.entries[from.index - 1]?.id : state.entries[from.index].id
  const tailFirstId =
    to.kind === 'boundary'
      ? state.entries[to.index]?.id
      : to.kind === 'split'
        ? tailId
        : state.entries[to.index].id
  let next = state
  if (to.kind === 'split') {
    next = reduceTimelineCollections(next, {
      type: 'entry-split',
      id: state.entries[to.index].id,
      atSourceTime: to.atSourceTime,
      newEntryId: tailId,
    })
    if (next === state) return state
  }
  if (from.kind === 'split') {
    const split = reduceTimelineCollections(next, {
      type: 'entry-split',
      id: state.entries[from.index].id,
      atSourceTime: from.atSourceTime,
      newEntryId: midId,
    })
    if (split === next) return state
    next = split
  }
  let remaps = remapsOf(next)
  if (from.kind === 'split' && from.hold !== undefined) {
    remaps = withHold(remaps, from.hold.pauseId, from.hold.seconds)
  }
  if (from.kind === 'hold') remaps = withHold(remaps, from.pauseId, from.seconds)
  if (to.kind === 'hold') remaps = withHold(remaps, to.pauseId, to.seconds)
  if (to.kind === 'split' && to.hold !== undefined && to.hold.seconds > RANGE_CUT_EPSILON) {
    // The razor kept the pause whole on the removed first half; what is left
    // of its hold after the Out mark opens the kept second half. Listed
    // first, so a speed segment also starting at 0 sorts after it rather
    // than pushing it off the first frame.
    remaps = [
      {
        id: `${tailId}:held`,
        entryId: tailId,
        kind: 'pause',
        at: 0,
        hold: to.hold.seconds,
      },
      ...remaps,
    ]
  }
  const headIndex =
    headId === undefined ? -1 : next.entries.findIndex((entry) => entry.id === headId)
  const tailIndex =
    tailFirstId === undefined
      ? next.entries.length
      : next.entries.findIndex((entry) => entry.id === tailFirstId)
  const entries = [...next.entries.slice(0, headIndex + 1), ...next.entries.slice(tailIndex)]
  return withEffects({ ...effectListsOf(next), entries, remaps })
}

/**
 * The row actions every timeline row shares, on a shape group (#687):
 * Duplicate, Paste settings and Rename…. Returns the new list (the same
 * reference when nothing changes), or `undefined` when the action is not
 * one of these aimed at a shape group, so the caller passes it on.
 *
 * - **Duplicate** copies every field, shapes included (their ids are scoped
 *   to the group, so the copy keeps them), under the caller's new id. The
 *   copy starts where the original ends and sits right after it in the list.
 * - **Paste settings** applies only the `shape-timing` group: window and
 *   fades, validated and clamped exactly as the row's own fields are. Any
 *   other group is skipped; there is nothing else a shape group holds.
 * - **Rename** trims the name; an empty one clears it, back to the name
 *   derived from the shapes.
 */
function reduceShapeGroupRowAction(
  state: TimelineState,
  action: TimelineAction,
): ShapeGroup[] | undefined {
  const groups = shapeGroupsOf(state)
  switch (action.type) {
    case 'element-duplicated': {
      if (action.kind !== 'shape-group') return undefined
      const index = groups.findIndex((group) => group.id === action.id)
      if (index === -1) return groups
      if (typeof action.newId !== 'string' || action.newId === '') return groups
      if (groups.some((group) => group.id === action.newId)) return groups
      const original = groups[index]
      const copy: ShapeGroup = {
        ...original,
        id: action.newId,
        offset: original.offset + original.duration,
        shapes: original.shapes.map((shape) => ({ ...shape })),
      }
      return [...groups.slice(0, index + 1), copy, ...groups.slice(index + 1)]
    }
    case 'settings-pasted': {
      if (action.kind !== 'shape-group') return undefined
      const index = groups.findIndex((group) => group.id === action.id)
      if (index === -1) return groups
      const timing = action.settings['shape-timing']
      if (timing === undefined) return groups
      const original = groups[index]
      const { fadeIn: _in, fadeOut: _out, drawOn: _drawOn, ...rest } = original
      // The entrance travels with the timing (#690): a copied draw-on
      // replaces the target's fade-in, and a copied fade replaces its draw-on.
      const candidate: ShapeGroup = {
        ...rest,
        offset: timing.offset,
        duration: timing.duration,
        ...(timing.drawOn !== undefined
          ? { drawOn: timing.drawOn }
          : timing.fadeIn > 0
            ? { fadeIn: timing.fadeIn }
            : {}),
        ...(timing.fadeOut > 0 ? { fadeOut: timing.fadeOut } : {}),
      }
      // Invalid input refuses the whole paste, the `settings-pasted` rule.
      if (!isValidShapeGroupSpec(candidate)) return groups
      const clamped = clampShapeGroup(candidate)
      if (shapeGroupsEqual(original, clamped)) return groups
      const next = [...groups]
      next[index] = clamped
      return next
    }
    case 'element-renamed': {
      const index = groups.findIndex((group) => group.id === action.id)
      if (index === -1) return undefined
      const original = groups[index]
      const name = typeof action.name === 'string' ? action.name.trim() : ''
      if ((original.name ?? '') === name) return groups
      const { name: _old, ...rest } = original
      const next = [...groups]
      next[index] = name === '' ? rest : { ...rest, name }
      return next
    }
    default:
      return undefined
  }
}

function reduceShapeGroups(
  groups: ShapeGroup[],
  action: Extract<
    TimelineAction,
    { type: 'shape-group-added' | 'shape-group-updated' | 'shape-group-removed' }
  >,
): ShapeGroup[] {
  switch (action.type) {
    case 'shape-group-added': {
      const group = action.group
      if (typeof group.id !== 'string' || group.id === '') return groups
      if (groups.some((existing) => existing.id === group.id)) return groups
      if (!isValidShapeGroupSpec(group)) return groups
      return [...groups, clampShapeGroup(group)]
    }
    case 'shape-group-updated': {
      const index = groups.findIndex((group) => group.id === action.id)
      if (index === -1 || !isValidShapeGroupSpec(action.group)) return groups
      const candidate = clampShapeGroup({ ...action.group, id: action.id })
      if (shapeGroupsEqual(groups[index], candidate)) return groups
      const next = [...groups]
      next[index] = candidate
      return next
    }
    case 'shape-group-removed': {
      const remaining = groups.filter((group) => group.id !== action.id)
      return remaining.length === groups.length ? groups : remaining
    }
  }
}

function reduceMarkers(
  markers: ChapterMarker[],
  action: Extract<
    TimelineAction,
    { type: 'marker-added' | 'marker-renamed' | 'marker-moved' | 'marker-removed' }
  >,
): ChapterMarker[] {
  switch (action.type) {
    case 'marker-added': {
      const marker = action.marker
      if (!isValidMarker(marker)) return markers
      // Ids are the handle the other actions act on — never two alike; and
      // two markers at one instant would be one tick with two names, so a
      // second at the same time is refused (the UI selects the first instead).
      if (markers.some((existing) => existing.id === marker.id)) return markers
      if (markers.some((existing) => Math.abs(existing.time - marker.time) <= MARKER_TIME_EPSILON)) {
        return markers
      }
      return normalizedMarkers([...markers, marker])
    }
    case 'marker-renamed': {
      const name = action.name.trim()
      if (name === '') return markers
      const index = markers.findIndex((marker) => marker.id === action.id)
      if (index === -1 || markers[index].name === name) return markers
      const next = [...markers]
      next[index] = { ...next[index], name }
      return next
    }
    case 'marker-moved': {
      if (!Number.isFinite(action.time) || action.time < 0) return markers
      const index = markers.findIndex((marker) => marker.id === action.id)
      if (index === -1 || Math.abs(markers[index].time - action.time) <= MARKER_TIME_EPSILON) return markers
      // Onto another marker's instant is refused for the same reason adding there is.
      if (
        markers.some(
          (other, i) => i !== index && Math.abs(other.time - action.time) <= MARKER_TIME_EPSILON,
        )
      ) {
        return markers
      }
      const next = [...markers]
      next[index] = { ...next[index], time: action.time }
      return normalizedMarkers(next)
    }
    case 'marker-removed': {
      const remaining = markers.filter((marker) => marker.id !== action.id)
      return remaining.length === markers.length ? markers : remaining
    }
  }
}

function reduceTimelineCollections(
  state: TimelineState,
  action: Exclude<
    TimelineAction,
    | { type: 'subtitle-style-set' }
    | { type: 'canvas-preset-set' }
    | { type: 'marker-added' }
    | { type: 'marker-renamed' }
    | { type: 'marker-moved' }
    | { type: 'marker-removed' }
    | { type: 'shape-group-added' }
    | { type: 'shape-group-updated' }
    | { type: 'shape-group-removed' }
    | { type: 'elements-placed' }
  >,
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
      return withEffects({ ...effectListsOf(state), entries: [...state.entries, action.entry] })
    case 'clips-added':
      // An empty batch is a same-reference no-op: nothing to undo (#292).
      if (action.entries.length === 0 && action.audioTracks.length === 0) return state
      return withEffects({
        ...effectListsOf(state),
        entries: [...state.entries, ...action.entries],
        audioTracks: [...audioTracks, ...action.audioTracks],
      })
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
        const { before, after } = splitZoomAt(zoom, splitRel)
        return [
          ...(before === null ? [] : [before]),
          ...(after === null
            ? []
            : [
                {
                  ...after,
                  // Fresh ids derive from the (fresh) second-half entry id,
                  // so a cut piece can never collide with any existing
                  // effect id; a zoom that moves whole keeps its own.
                  id: before === null ? zoom.id : `${action.newEntryId}:${zoom.id}`,
                  entryId: action.newEntryId,
                },
              ]),
        ]
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
      // Picture effects (#862) cut as speed segments do: a window wholly
      // before the cut stays, one wholly after moves to the second half
      // (re-anchored, keeping its id), and one containing the cut becomes
      // two effects of the same type and parameters, the second under a
      // fresh id derived from the second half's. A window ending exactly on
      // the cut stays whole with the first half; one starting on it moves.
      // The halves meet at the entries' shared edge, so they render as the
      // one effect did only if the renderer does not ease in or out at an
      // edge lying on its entry's own bounds — a requirement on #862's
      // rendering rule, which this split relies on.
      const splitPictureEffects = pictureEffectsOf(state).flatMap((effect): PictureEffect[] => {
        if (effect.entryId !== action.id || effect.end <= splitRel) return [effect]
        if (effect.start >= splitRel) {
          return [
            {
              ...effect,
              entryId: action.newEntryId,
              start: effect.start - splitRel,
              end: effect.end - splitRel,
            },
          ]
        }
        return [
          { ...effect, end: splitRel },
          {
            ...effect,
            id: `${action.newEntryId}:${effect.id}`,
            entryId: action.newEntryId,
            start: 0,
            end: effect.end - splitRel,
          },
        ]
      })
      return withEffects({
        entries,
        transitions: splitTransitions,
        zooms: splitZooms,
        audioTracks,
        remaps: splitRemaps,
        texts,
        videoOverlays,
        pictureEffects: splitPictureEffects,
      })
    }
    case 'element-split': {
      // Split… on a track or an overlay (#826): see elementSplit.ts. The
      // second part goes right after the first in its list.
      if (typeof action.newId !== 'string' || action.newId === '') return state
      if (action.kind === 'audio-track') {
        const index = audioTracks.findIndex((track) => track.id === action.id)
        if (index === -1) return state
        if (audioTracks.some((track) => track.id === action.newId)) return state
        const parts = splitAudioTrack(audioTracks[index], action.atSourceTime, action.newId)
        if (parts === null) return state
        const nextTracks = [...audioTracks.slice(0, index), ...parts, ...audioTracks.slice(index + 1)]
        return withEffects({ ...effectListsOf(state), audioTracks: nextTracks })
      }
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      if (videoOverlays.some((overlay) => overlay.id === action.newId)) return state
      const parts = splitVideoOverlay(videoOverlays[index], action.atSourceTime, action.newId)
      if (parts === null) return state
      const nextOverlays = [...videoOverlays.slice(0, index), ...parts, ...videoOverlays.slice(index + 1)]
      return withEffects({ ...effectListsOf(state), videoOverlays: nextOverlays })
    }
    case 'element-cut': {
      // Cut… on a track or an overlay (#828): see elementCut.ts. The later
      // part goes right after the earlier in its list.
      if (typeof action.newId !== 'string' || action.newId === '') return state
      const clamps = { from: action.from, to: action.to }
      if (action.kind === 'audio-track') {
        const index = audioTracks.findIndex((track) => track.id === action.id)
        if (index === -1) return state
        if (audioTracks.some((track) => track.id === action.newId)) return state
        const parts = cutAudioTrack(audioTracks[index], clamps, action.newId)
        if (parts === null) return state
        const nextTracks = [...audioTracks.slice(0, index), ...parts, ...audioTracks.slice(index + 1)]
        return withEffects({ ...effectListsOf(state), audioTracks: nextTracks })
      }
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      if (videoOverlays.some((overlay) => overlay.id === action.newId)) return state
      const parts = cutVideoOverlay(videoOverlays[index], clamps, action.newId)
      if (parts === null) return state
      const nextOverlays = [...videoOverlays.slice(0, index), ...parts, ...videoOverlays.slice(index + 1)]
      return withEffects({ ...effectListsOf(state), videoOverlays: nextOverlays })
    }
    case 'frame-frozen': {
      // Freeze frame (#379): validate the still whole, then place it — see
      // the action's doc comment. All-or-nothing: any invalid piece refuses
      // the action with the state unchanged, so one undo step never has to
      // unpick a partial freeze.
      const { still, placement } = action
      if (still.kind !== 'image') return state
      if (!Number.isFinite(still.duration) || still.duration <= 0) return state
      // A still's window is always [0, duration] (see TimelineEntry).
      if (still.inPoint !== 0 || still.outPoint !== still.duration) return state
      if (state.entries.some((entry) => entry.id === still.id)) return state
      if (placement.kind === 'split') {
        if (placement.newEntryId === still.id) return state
        // The cut is exactly the razor's: same guards, same effect
        // re-keying, by delegating to the entry-split case above.
        const split = reduceTimelineCollections(state, {
          type: 'entry-split',
          id: placement.entryId,
          atSourceTime: placement.atSourceTime,
          newEntryId: placement.newEntryId,
        })
        if (split === state) return state
        // The first half kept the original id (the entry-split rule), so the
        // still slots in right after it — between the halves, on a boundary
        // that is a fresh hard cut carrying no transition to disturb.
        const halfIndex = split.entries.findIndex((entry) => entry.id === placement.entryId)
        const entries = [
          ...split.entries.slice(0, halfIndex + 1),
          still,
          ...split.entries.slice(halfIndex + 1),
        ]
        return withEffects({ ...effectListsOf(split), entries })
      }
      const index = state.entries.findIndex((entry) => entry.id === placement.entryId)
      if (index === -1) return state
      const at = placement.kind === 'before' ? index : index + 1
      const entries = [...state.entries.slice(0, at), still, ...state.entries.slice(at)]
      return withEffects({ ...effectListsOf(state), entries })
    }
    case 'range-cut':
      return cutRange(state, action)
    case 'recording-pair-placed': {
      // Screen + camera in one take (#388): validate both pieces whole, then
      // append the entry and start the overlay exactly at its start — the
      // frame-frozen all-or-nothing rule, so one undo step never has to
      // unpick a partial arrival.
      const { entry, overlay } = action
      if (state.entries.some((existing) => existing.id === entry.id)) return state
      if (videoOverlays.some((existing) => existing.id === overlay.id)) return state
      // The screen capture is a video entry: a still here is a programmer
      // error upstream (entryFromClip on the wrong clip kind), refused whole.
      if (isStillEntry(entry)) return state
      if (
        !Number.isFinite(entry.duration) ||
        entry.duration <= 0 ||
        !Number.isFinite(entry.inPoint) ||
        !Number.isFinite(entry.outPoint) ||
        entry.inPoint < 0 ||
        entry.inPoint >= entry.outPoint ||
        entry.outPoint > entry.duration
      ) {
        return state
      }
      // The camera capture is a video overlay — the video-overlay-added
      // checks, with an image overlay refused outright.
      if (isImageOverlay(overlay)) return state
      if (!isValidVideoOverlayPlacement(overlay)) return state
      const clampedOverlay = clampVideoOverlay(overlay)
      if (clampedOverlay.inPoint >= clampedOverlay.outPoint) return state
      // The appended entry starts where today's sequence ends; the overlay
      // is pinned to that instant regardless of what the caller built, so
      // the bubble and the screen take begin together by construction.
      const start = totalDuration(state)
      return withEffects({
        ...effectListsOf(state),
        entries: [...state.entries, entry],
        videoOverlays: [...videoOverlays, { ...overlay, offset: start }],
      })
    }
    case 'element-duplicated': {
      // Duplicate (#314): the copy is the original spread under a fresh id —
      // every adjustable setting is a plain field, so the spread carries all
      // of them. Ids are the handles entry-scoped actions act on: a taken
      // newId is refused (the entry-split guard), and an unknown original is
      // a same-reference no-op, never an edit.
      switch (action.kind) {
        case 'entry': {
          const index = state.entries.findIndex((entry) => entry.id === action.id)
          if (index === -1) return state
          if (state.entries.some((existing) => existing.id === action.newId)) return state
          const entries = [
            ...state.entries.slice(0, index + 1),
            { ...state.entries[index], id: action.newId },
            ...state.entries.slice(index + 1),
          ]
          // Per-entry effects follow their entry by id, so the copy's are
          // cloned under the new entry id — editing one copy's speed or zoom
          // never touches the other. Derived effect ids take the entry-split
          // form `${newEntryId}:${effectId}`, which cannot collide with any
          // existing effect id (entry ids are fresh UUIDs).
          const duplicatedZooms = zooms
            .filter((zoom) => zoom.entryId === action.id)
            .map((zoom) => ({ ...zoom, id: `${action.newId}:${zoom.id}`, entryId: action.newId }))
          const duplicatedRemaps = remaps
            .filter((remap) => remap.entryId === action.id)
            .map((remap) => ({ ...remap, id: `${action.newId}:${remap.id}`, entryId: action.newId }))
          // Picture effects (#862) are the entry's own, like its zooms: the
          // copy carries them, under ids derived from the copy's.
          const pictureEffects = pictureEffectsOf(state)
          const duplicatedPictureEffects = pictureEffects
            .filter((effect) => effect.entryId === action.id)
            .map((effect) => ({ ...effect, id: `${action.newId}:${effect.id}`, entryId: action.newId }))
          // Transitions pass through untouched: none is copied (a transition
          // belongs to a boundary, not an entry), the boundary INTO the
          // original keeps its transition (that pair is still adjacent), and
          // the one OUT of the original is dropped by normalization because
          // the copy now separates the pair — the insert-path rule.
          return withEffects({
            ...effectListsOf(state),
            entries,
            zooms: [...zooms, ...duplicatedZooms],
            remaps: [...remaps, ...duplicatedRemaps],
            pictureEffects: [...pictureEffects, ...duplicatedPictureEffects],
          })
        }
        case 'audio-track': {
          const track = audioTracks.find((candidate) => candidate.id === action.id)
          if (track === undefined) return state
          if (audioTracks.some((existing) => existing.id === action.newId)) return state
          // The copy starts where the original's trimmed audio ends, so the
          // two play back to back instead of stacking.
          const copy = {
            ...track,
            id: action.newId,
            offset: track.offset + (track.outPoint - track.inPoint),
          }
          return withEffects({ ...effectListsOf(state), audioTracks: [...audioTracks, copy] })
        }
        case 'video-overlay': {
          const overlay = videoOverlays.find((candidate) => candidate.id === action.id)
          if (overlay === undefined) return state
          if (videoOverlays.some((existing) => existing.id === action.newId)) return state
          // The copy starts where the original leaves the screen — its
          // remapped length (#700), which is its trim when it has no remaps.
          const copy = {
            ...overlay,
            id: action.newId,
            offset: overlay.offset + overlayOutputDuration(overlay),
          }
          return withEffects({ ...effectListsOf(state), videoOverlays: [...videoOverlays, copy] })
        }
        case 'text': {
          const text = texts.find((candidate) => candidate.id === action.id)
          if (text === undefined) return state
          if (texts.some((existing) => existing.id === action.newId)) return state
          const copy = { ...text, id: action.newId, offset: text.offset + text.duration }
          return withEffects({ ...effectListsOf(state), texts: [...texts, copy] })
        }
      }
      return state
    }
    case 'settings-pasted': {
      // Paste settings (#315). Everything the paste applies happens here, in
      // one action, so one Undo reverts the whole paste; a paste that changes
      // nothing returns the same state reference, so it never lands in undo
      // history or marks the project dirty (#76 compares references). See the
      // action's doc comment for what the reducer refuses versus skips.
      const settings = action.settings
      switch (action.kind) {
        case 'entry': {
          const index = state.entries.findIndex((entry) => entry.id === action.id)
          if (index === -1) return state
          const entry = state.entries[index]
          // A slate holds no settings group at all — no adjustments (#192),
          // orientation (#232), crop (#255), fill (#259), or audio (#220):
          // its color is set directly (#143). Nothing to paste.
          if (isSlateEntry(entry)) return state
          const visual = withPastedVisualSettings(entry, settings, true)
          if (visual === undefined) return state
          let next = visual
          // Stills (images) are soundless (#220), so the audio group is
          // skipped for them exactly as `entry-fades-set` refuses them.
          if (settings.audio !== undefined && !isStillEntry(entry)) {
            const audio = settings.audio
            if (
              !Number.isFinite(audio.volume) ||
              !Number.isFinite(audio.fadeIn) ||
              !Number.isFinite(audio.fadeOut) ||
              (audio.muted !== undefined && typeof audio.muted !== 'boolean')
            ) {
              return state
            }
            // Volume and mute compare against the *effective* value, so
            // pasting full volume onto an untouched entry is a no-op.
            const volume = clampVolume(audio.volume)
            const muted = audio.muted
            const candidate = { ...next }
            if (volume !== (entry.volume ?? 1)) candidate.volume = volume
            if (muted !== undefined && muted !== (entry.muted ?? false)) candidate.muted = muted
            // Zero fades store as no fields at all (the byte-identity rule),
            // and clamping keeps the pair inside the target's own output
            // window — fadeIn keeps its value first (#104/#220).
            const fadeIn = Math.max(0, audio.fadeIn)
            const fadeOut = Math.max(0, audio.fadeOut)
            if (fadeIn === 0) delete candidate.fadeIn
            else candidate.fadeIn = fadeIn
            if (fadeOut === 0) delete candidate.fadeOut
            else candidate.fadeOut = fadeOut
            const clamped = clampEntryFades(candidate, remaps)
            const fadesChanged =
              (clamped.fadeIn ?? 0) !== (entry.fadeIn ?? 0) ||
              (clamped.fadeOut ?? 0) !== (entry.fadeOut ?? 0)
            if (
              fadesChanged ||
              clamped.volume !== next.volume ||
              clamped.muted !== next.muted
            ) {
              next = clamped
            }
          }
          if (next === entry) return state
          const entries = [...state.entries]
          entries[index] = next
          return withEffects({ ...effectListsOf(state), entries })
        }
        case 'audio-track': {
          const index = audioTracks.findIndex((track) => track.id === action.id)
          if (index === -1) return state
          const audio = settings.audio
          // Audio is the only group a track holds; anything else is skipped.
          if (audio === undefined) return state
          if (
            !Number.isFinite(audio.volume) ||
            !Number.isFinite(audio.fadeIn) ||
            !Number.isFinite(audio.fadeOut)
          ) {
            return state
          }
          const track = audioTracks[index]
          // A track holds no mute (#104): a pasted `muted` is skipped, never
          // stored — the field must not appear on a track.
          const candidate = clampTrackFades({
            ...track,
            volume: clampVolume(audio.volume),
            fadeIn: Math.max(0, audio.fadeIn),
            fadeOut: Math.max(0, audio.fadeOut),
          })
          if (
            (candidate.volume ?? 1) === (track.volume ?? 1) &&
            (candidate.fadeIn ?? 0) === (track.fadeIn ?? 0) &&
            (candidate.fadeOut ?? 0) === (track.fadeOut ?? 0)
          ) {
            return state
          }
          const tracks = [...audioTracks]
          tracks[index] = candidate
          return withEffects({ ...effectListsOf(state), audioTracks: tracks })
        }
        case 'video-overlay': {
          const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
          if (index === -1) return state
          const overlay = videoOverlays[index]
          // No background fill on an overlay layer: it has no such field.
          const visual = withPastedVisualSettings(overlay, settings, false)
          if (visual === undefined) return state
          let next = visual
          if (settings.audio !== undefined) {
            const audio = settings.audio
            if (
              !Number.isFinite(audio.volume) ||
              !Number.isFinite(audio.fadeIn) ||
              !Number.isFinite(audio.fadeOut) ||
              (audio.muted !== undefined && typeof audio.muted !== 'boolean')
            ) {
              return state
            }
            const volume = clampVolume(audio.volume)
            const muted = audio.muted
            const candidate: VideoOverlay = { ...next }
            if (volume !== (overlay.volume ?? 1)) candidate.volume = volume
            if (muted !== undefined && muted !== (overlay.muted ?? false)) candidate.muted = muted
            candidate.fadeIn = Math.max(0, audio.fadeIn)
            candidate.fadeOut = Math.max(0, audio.fadeOut)
            // clampVideoOverlay drops zero fades to absent fields and keeps
            // the pair within the overlay's on-screen length (its trim, after
            // any speed segments and pauses, #700); placement is untouched,
            // since it is not a settings group.
            const clamped = clampVideoOverlay(candidate)
            if (!videoOverlaysEqual(overlay, clamped)) next = clamped
          }
          if (next === overlay) return state
          const overlays = [...videoOverlays]
          overlays[index] = next
          return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
        }
        case 'text': {
          const index = texts.findIndex((text) => text.id === action.id)
          if (index === -1) return state
          const style = settings['text-style']
          // Text style is the only group a text overlay holds.
          if (style === undefined) return state
          const existing = texts[index]
          // The look and the visual fades (#177) only: the window (offset,
          // duration) and the content are never settings. `x`/`y` are the
          // block's on-frame centre — the #250 style surface — not timeline
          // placement.
          let candidate: TextOverlay = {
            ...existing,
            x: style.x,
            y: style.y,
            font: style.font,
            size: style.size,
            color: style.color,
            bold: style.bold,
            italic: style.italic,
            fadeIn: style.fadeIn,
            fadeOut: style.fadeOut,
          }
          if (!isValidTextOverlaySpec(candidate)) return state
          if (existing.subtitle === true) {
            // Pasting style onto an imported subtitle claims the fields it
            // changes, exactly as an individual edit does (#250) — the
            // `text-updated` rule, mirrored so the two paths cannot drift.
            const overrides = normalizeStyleOverrides([
              ...(existing.styleOverrides ?? []),
              ...changedStyleFields(existing, clampTextOverlay(candidate)),
            ])
            delete candidate.styleOverrides
            if (overrides !== undefined) candidate = { ...candidate, styleOverrides: overrides }
          }
          // Normalization can clamp the paste back to what is already stored
          // — a no-op must keep the state reference.
          if (textOverlaysEqual(existing, clampTextOverlay(candidate))) return state
          return withEffects({
            ...effectListsOf(state),
            texts: texts.map((text, position) => (position === index ? candidate : text)),
          })
        }
      }
      return state
    }
    case 'element-renamed': {
      // Rename (#405): the one collection holding the id gets the trimmed
      // name; everything else is carried verbatim. Same-reference on an
      // empty name, an unknown id, or no change — not an edit, so nothing
      // to undo and preview playback is not stopped.
      const name = action.name.trim()
      if (name === '') return state
      const entryIndex = state.entries.findIndex((entry) => entry.id === action.id)
      if (entryIndex !== -1) {
        if (state.entries[entryIndex].name === name) return state
        const entries = [...state.entries]
        entries[entryIndex] = { ...entries[entryIndex], name }
        return withEffects({ ...effectListsOf(state), entries })
      }
      const trackIndex = audioTracks.findIndex((track) => track.id === action.id)
      if (trackIndex !== -1) {
        if (audioTracks[trackIndex].name === name) return state
        const tracks = [...audioTracks]
        tracks[trackIndex] = { ...tracks[trackIndex], name }
        return withEffects({ ...effectListsOf(state), audioTracks: tracks })
      }
      const overlayIndex = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (overlayIndex !== -1) {
        if (videoOverlays[overlayIndex].name === name) return state
        const overlays = [...videoOverlays]
        overlays[overlayIndex] = { ...overlays[overlayIndex], name }
        return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      }
      return state
    }
    case 'entry-removed':
      return withEffects({ ...effectListsOf(state), entries: state.entries.filter((entry) => entry.id !== action.id) })
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
        : withEffects({ ...effectListsOf(state), entries, audioTracks: tracks, videoOverlays: overlays })
    }
    case 'entries-removed-for-clips': {
      // Same per-clip semantics as the single removal above, applied to the
      // whole set at once. An entry with no clip of its own (a color slate,
      // #140) carries an empty clipId, which is never in the set — slates
      // survive a batch removal exactly as they survive a single one.
      if (action.clipIds.length === 0) return state
      const removed = new Set(action.clipIds)
      const entries = state.entries.filter((entry) => !removed.has(entry.clipId))
      const tracks = audioTracks.filter((track) => !removed.has(track.clipId))
      const overlays = videoOverlays.filter((overlay) => !removed.has(overlay.clipId))
      // Same reference when nothing matched, like the single case: a
      // removal touching no timeline item must not read as a timeline edit.
      return entries.length === state.entries.length &&
        tracks.length === audioTracks.length &&
        overlays.length === videoOverlays.length
        ? state
        : withEffects({ ...effectListsOf(state), entries, audioTracks: tracks, videoOverlays: overlays })
    }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      const next = withEffects({
        ...effectListsOf(state),
        transitions: [
          ...transitions.filter(
            (transition) =>
              transition.beforeId !== action.beforeId || transition.afterId !== action.afterId,
          ),
          candidate,
        ],
      })
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
      return withEffects({ ...effectListsOf(state), transitions: remaining })
    }
    case 'zoom-added': {
      const zoom = action.zoom
      if (!state.entries.some((entry) => entry.id === zoom.entryId)) return state
      // Ids are the handle updates and removals act on — never two alike.
      if (zooms.some((existing) => existing.id === zoom.id)) return state
      if (!isValidZoomSpec(zoom)) return state
      const next = withEffects({ ...effectListsOf(state), zooms: [...zooms, zoom] })
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
      const next = withEffects({
        ...effectListsOf(state),
        zooms: zooms.map((zoom) => (zoom.id === action.id ? candidate : zoom)),
      })
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
      return withEffects({ ...effectListsOf(state), zooms: remaining })
    }
    case 'remap-added': {
      const remap = action.remap
      if (!state.entries.some((entry) => entry.id === remap.entryId)) return state
      // Ids are the handle updates and removals act on — never two alike.
      if (remaps.some((existing) => existing.id === remap.id)) return state
      if (!isValidRemapSpec(remap)) return state
      const next = withEffects({ ...effectListsOf(state), remaps: [...remaps, remap] })
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
      const next = withEffects({
        ...effectListsOf(state),
        remaps: remaps.map((remap) => (remap.id === action.id ? candidate : remap)),
      })
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
      return withEffects({ ...effectListsOf(state), remaps: remaining })
    }
    case 'picture-effect-added': {
      const effect = action.effect
      if (!state.entries.some((entry) => entry.id === effect.entryId)) return state
      // Ids are the handle updates and removals act on — never two alike.
      const effects = pictureEffectsOf(state)
      if (effects.some((existing) => existing.id === effect.id)) return state
      if (typeof effect.type !== 'string' || effect.type === '') return state
      if (!isValidPictureEffectSpec(effect)) return state
      const next = withEffects({ ...effectListsOf(state), pictureEffects: [...effects, effect] })
      const applied = next.pictureEffects?.find((existing) => existing.id === effect.id)
      // A window that starts at or past the entry's end clamps to nothing:
      // veto the add rather than store an effect that can never show, as a
      // zoom with no room is vetoed.
      if (applied === undefined || applied.end <= applied.start) return state
      return next
    }
    case 'picture-effect-updated': {
      const effects = pictureEffectsOf(state)
      const existing = effects.find((effect) => effect.id === action.id)
      if (existing === undefined) return state
      if (!isValidPictureEffectSpec(action.effect)) return state
      const candidate: PictureEffect = {
        id: existing.id,
        entryId: existing.entryId,
        type: existing.type,
        start: action.effect.start,
        end: action.effect.end,
        params: { ...action.effect.params },
      }
      const next = withEffects({
        ...effectListsOf(state),
        pictureEffects: effects.map((effect) => (effect.id === action.id ? candidate : effect)),
      })
      const applied = next.pictureEffects?.find((effect) => effect.id === action.id)
      if (applied === undefined) return state
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      // Effects do not sweep, so no sibling can have moved.
      if (pictureEffectsEqual(existing, applied)) return state
      return next
    }
    case 'picture-effect-removed': {
      const effects = pictureEffectsOf(state)
      const remaining = effects.filter((effect) => effect.id !== action.id)
      if (remaining.length === effects.length) return state
      return withEffects({ ...effectListsOf(state), pictureEffects: remaining })
    }
    case 'text-added': {
      const text = action.text
      // Ids are the handle updates and removals act on — never two alike.
      if (texts.some((existing) => existing.id === text.id)) return state
      if (!isValidTextOverlaySpec(text)) return state
      return withEffects({ ...effectListsOf(state), texts: [...texts, text] })
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
      return withEffects({ ...effectListsOf(state), texts: [...texts, ...action.texts] })
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
      return withEffects({
        ...effectListsOf(state),
        texts: texts.map((text) => (text.id === action.id ? candidate : text)),
      })
    }
    case 'text-removed': {
      const remaining = texts.filter((text) => text.id !== action.id)
      if (remaining.length === texts.length) return state
      return withEffects({ ...effectListsOf(state), texts: remaining })
    }
    case 'video-overlay-added': {
      const overlay = action.overlay
      // Ids are the handle updates and removals act on — never two alike.
      if (videoOverlays.some((existing) => existing.id === overlay.id)) return state
      if (isImageOverlay(overlay)) {
        // A still overlay (#294) has no trim to reject — its window is its
        // duration, and a non-positive one would make it unshowable, exactly
        // as a still entry's would (#140). Audio fields are refused here
        // rather than dropped, so a caller cannot half-build one.
        if (!isValidImageOverlay(overlay)) return state
      } else {
        if (!isValidVideoOverlayPlacement(overlay)) return state
        // An empty or inverted trim range would make the overlay unplayable —
        // reject it whole (mirroring audio-track-trimmed), judged after the
        // clamp so an out-of-range trim that clamps sane is kept.
        const clamped = clampVideoOverlay(overlay)
        if (clamped.inPoint >= clamped.outPoint) return state
      }
      return withEffects({ ...effectListsOf(state), videoOverlays: [...videoOverlays, overlay] })
    }
    case 'video-overlay-updated': {
      const existing = videoOverlays.find((overlay) => overlay.id === action.id)
      if (existing === undefined) return state
      if (isImageOverlay(existing)) {
        // The still overlay's window is offset + duration (#294); the trim
        // follows it, exactly as `still-duration-set` moves a still entry's.
        const placement = action.placement as ImageOverlayPlacement
        if (!isValidImageOverlayPlacement(placement)) return state
        const candidate: VideoOverlay = {
          ...existing,
          offset: placement.offset,
          duration: placement.duration,
          inPoint: 0,
          outPoint: placement.duration,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        }
        // Normalization can clamp the edit back to what is already stored — a
        // no-op must keep the state reference (edits stop preview playback).
        if (videoOverlaysEqual(existing, clampVideoOverlay(candidate))) return state
        return withEffects({
          ...effectListsOf(state),
          videoOverlays: videoOverlays.map((overlay) => (overlay.id === action.id ? candidate : overlay)),
        })
      }
      if (!isValidVideoOverlayPlacement(action.placement as VideoOverlayPlacement)) return state
      // Identity and source binding never change: only the placement fields
      // are taken from the action.
      const candidate: VideoOverlay = { ...existing, ...(action.placement as VideoOverlayPlacement) }
      const clamped = clampVideoOverlay(candidate)
      if (clamped.inPoint >= clamped.outPoint) return state
      // Normalization can clamp the edit back to what is already stored — a
      // no-op must keep the state reference (edits stop preview playback).
      if (videoOverlaysEqual(existing, clamped)) return state
      return withEffects({
        ...effectListsOf(state),
        videoOverlays: videoOverlays.map((overlay) => (overlay.id === action.id ? candidate : overlay)),
      })
    }
    case 'video-overlay-removed': {
      const remaining = videoOverlays.filter((overlay) => overlay.id !== action.id)
      if (remaining.length === videoOverlays.length) return state
      return withEffects({ ...effectListsOf(state), videoOverlays: remaining })
    }
    case 'video-overlay-zoom-added': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const existing = overlay.zooms ?? []
      // Ids are the handle updates and removals act on — never two alike.
      if (existing.some((zoom) => zoom.id === action.zoom.id)) return state
      if (!isValidZoomSpec(action.zoom)) return state
      const overlays = [...videoOverlays]
      overlays[index] = { ...overlay, zooms: [...existing, action.zoom] }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].zooms?.find((zoom) => zoom.id === action.zoom.id)
      // No room left in the overlay's window: veto, as `zoom-added` does.
      if (applied === undefined || zoomWindowDuration(applied) <= 0) return state
      return next
    }
    case 'video-overlay-zoom-updated': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const stored = overlay.zooms?.find((zoom) => zoom.id === action.id)
      if (stored === undefined) return state
      if (!isValidZoomSpec(action.zoom)) return state
      const candidate: OverlayZoom = { id: stored.id, ...action.zoom }
      const overlays = [...videoOverlays]
      overlays[index] = {
        ...overlay,
        zooms: (overlay.zooms ?? []).map((zoom) => (zoom.id === action.id ? candidate : zoom)),
      }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].zooms?.find((zoom) => zoom.id === action.id)
      if (applied === undefined) return state
      // Clamped back to what is stored: a no-op keeps the state reference.
      if (zoomSpecsEqual(stored, applied)) return state
      return next
    }
    case 'video-overlay-zoom-removed': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const remaining = (overlay.zooms ?? []).filter((zoom) => zoom.id !== action.id)
      if (remaining.length === (overlay.zooms ?? []).length) return state
      const overlays = [...videoOverlays]
      // None means no key at all, so a zoom-free overlay saves as before.
      const next = { ...overlay }
      if (remaining.length === 0) delete next.zooms
      else next.zooms = remaining
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'video-overlay-remap-added': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      // A still has no time to remap (#700), as a still entry has none.
      if (isImageOverlay(overlay)) return state
      const existing = overlay.remaps ?? []
      // Ids are the handle updates and removals act on — never two alike.
      if (existing.some((remap) => remap.id === action.remap.id)) return state
      if (!isValidRemapSpec(action.remap)) return state
      const overlays = [...videoOverlays]
      overlays[index] = { ...overlay, remaps: [...existing, action.remap] }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].remaps?.find((remap) => remap.id === action.remap.id)
      // No room left in the overlay's trim: veto, as `remap-added` does.
      if (applied === undefined) return state
      if (applied.kind === 'speed' && applied.start >= applied.end) return state
      return next
    }
    case 'video-overlay-remap-updated': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const stored = overlay.remaps?.find((remap) => remap.id === action.id)
      if (stored === undefined) return state
      if (!isValidRemapSpec(action.remap)) return state
      const candidate: OverlayRemap = { ...action.remap, id: stored.id }
      const overlays = [...videoOverlays]
      overlays[index] = {
        ...overlay,
        remaps: (overlay.remaps ?? []).map((remap) => (remap.id === action.id ? candidate : remap)),
      }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].remaps?.find((remap) => remap.id === action.id)
      if (applied === undefined) return state
      // Clamped back to what is stored: a no-op keeps the state reference
      // (edits stop preview playback). The edited effect unchanged means
      // every sweep input is unchanged, so no sibling moved either.
      if (remapSpecsEqual(stored, applied)) return state
      return next
    }
    case 'video-overlay-remap-removed': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const remaining = (overlay.remaps ?? []).filter((remap) => remap.id !== action.id)
      if (remaining.length === (overlay.remaps ?? []).length) return state
      const overlays = [...videoOverlays]
      // None means no key at all, so a remap-free overlay saves as before.
      const next = { ...overlay }
      if (remaining.length === 0) delete next.remaps
      else next.remaps = remaining
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'video-overlay-move-added': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const existing = overlay.moves ?? []
      // Ids are the handle updates and removals act on — never two alike.
      if (typeof action.move.id !== 'string' || action.move.id === '') return state
      if (existing.some((move) => move.id === action.move.id)) return state
      if (!isValidMoveSpec(action.move)) return state
      const overlays = [...videoOverlays]
      overlays[index] = { ...overlay, moves: [...existing, action.move] }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].moves?.find((move) => move.id === action.move.id)
      // No room left in the overlay's window: veto, as a zoom's add does.
      if (applied === undefined || applied.glide <= 0) return state
      return next
    }
    case 'video-overlay-move-updated': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const stored = overlay.moves?.find((move) => move.id === action.id)
      if (stored === undefined) return state
      if (!isValidMoveSpec(action.move)) return state
      const candidate: OverlayMove = {
        id: stored.id,
        start: action.move.start,
        glide: action.move.glide,
        x: action.move.x,
        y: action.move.y,
        width: action.move.width,
        height: action.move.height,
      }
      const overlays = [...videoOverlays]
      overlays[index] = {
        ...overlay,
        moves: (overlay.moves ?? []).map((move) => (move.id === action.id ? candidate : move)),
      }
      const next = withEffects({ ...effectListsOf(state), videoOverlays: overlays })
      const applied = next.videoOverlays?.[index].moves?.find((move) => move.id === action.id)
      if (applied === undefined) return state
      // Clamped back to what is stored: a no-op keeps the state reference.
      if (moveSpecsEqual(stored, applied)) return state
      return next
    }
    case 'video-overlay-move-removed': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.overlayId)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      const remaining = (overlay.moves ?? []).filter((move) => move.id !== action.id)
      if (remaining.length === (overlay.moves ?? []).length) return state
      const overlays = [...videoOverlays]
      // None means no key at all, so a Move-free overlay saves as before.
      const next = { ...overlay }
      if (remaining.length === 0) delete next.moves
      else next.moves = remaining
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'audio-track-added':
      return withEffects({ ...effectListsOf(state), audioTracks: [...audioTracks, action.track] })
    case 'audio-track-removed': {
      const remaining = audioTracks.filter((track) => track.id !== action.id)
      if (remaining.length === audioTracks.length) return state
      return withEffects({ ...effectListsOf(state), audioTracks: remaining })
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
      return withEffects({ ...effectListsOf(state), audioTracks: tracks })
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
      return withEffects({ ...effectListsOf(state), audioTracks: tracks })
    }
    case 'entry-volume-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.volume)) return state
      const volume = clampVolume(action.volume)
      // Compare against the effective value: setting an untouched entry to
      // full volume is a no-op, not an edit (edits stop preview playback).
      if (volume === (state.entries[index].volume ?? 1)) return state
      const entries = [...state.entries]
      entries[index] = { ...entries[index], volume }
      return withEffects({ ...effectListsOf(state), entries })
    }
    case 'entry-mute-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (action.muted === (state.entries[index].muted ?? false)) return state
      const entries = [...state.entries]
      entries[index] = { ...entries[index], muted: action.muted }
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
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
      return withEffects({ ...effectListsOf(state), entries })
    }
    case 'entry-redactions-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no redactions (#492): a flat colour has nothing to
      // hide, exactly as it carries no crop (#255).
      if (isSlateEntry(entry)) return state
      if (!areAcceptableRedactionInputs(action.redactions)) return state
      const normalized = normalizeRedactions(action.redactions)
      // Compare normalized against stored (stored is always normalized), so
      // re-committing the same list — or clearing an entry that has none —
      // is a no-op, not an edit (edits stop preview playback).
      if (redactionsEqual(normalized, entry.redactions)) return state
      const entries = [...state.entries]
      // None means no key at all, never `[]` — what keeps redaction-free
      // saved files byte-identical (see redaction.ts).
      const next = { ...entry }
      if (normalized === undefined) delete next.redactions
      else next.redactions = normalized
      entries[index] = next
      return withEffects({ ...effectListsOf(state), entries })
    }
    case 'video-overlay-redactions-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!areAcceptableRedactionInputs(action.redactions)) return state
      const normalized = normalizeRedactions(action.redactions)
      if (redactionsEqual(normalized, overlay.redactions)) return state
      const overlays = [...videoOverlays]
      const next = { ...overlay }
      if (normalized === undefined) delete next.redactions
      else next.redactions = normalized
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'entry-spotlights-set': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      const entry = state.entries[index]
      // Slates carry no spotlights (#532): a flat colour has no part worth
      // pointing at, exactly as it has nothing to redact (#492).
      if (isSlateEntry(entry)) return state
      if (!areAcceptableSpotlightInputs(action.spotlights)) return state
      const normalized = normalizeSpotlights(action.spotlights)
      // Normalized against stored (stored is always normalized), so
      // re-committing the same list is a no-op rather than an edit.
      if (spotlightsEqual(normalized, entry.spotlights)) return state
      const entries = [...state.entries]
      // None means no key at all, never `[]` — what keeps spotlight-free
      // saved files byte-identical (see spotlight.ts).
      const next = { ...entry }
      if (normalized === undefined) delete next.spotlights
      else next.spotlights = normalized
      entries[index] = next
      return withEffects({ ...effectListsOf(state), entries })
    }
    case 'video-overlay-spotlights-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!areAcceptableSpotlightInputs(action.spotlights)) return state
      const normalized = normalizeSpotlights(action.spotlights)
      if (spotlightsEqual(normalized, overlay.spotlights)) return state
      const overlays = [...videoOverlays]
      const next = { ...overlay }
      if (normalized === undefined) delete next.spotlights
      else next.spotlights = normalized
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
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
      return withEffects({ ...effectListsOf(state), entries })
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
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'video-overlay-border-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (!isValidOverlayBorderInput(action.border)) return state
      const normalized = normalizeOverlayBorder(action.border)
      // Stored is always normalized, so re-committing the same border — or
      // clearing a border-free overlay — is a no-op, not an edit.
      if (overlayBordersEqual(normalized, overlay.border)) return state
      const overlays = [...videoOverlays]
      // None means no key at all — what keeps border-free files byte-identical.
      const next = { ...overlay }
      if (normalized === undefined) delete next.border
      else next.border = normalized
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'video-overlay-shadow-set': {
      const index = videoOverlays.findIndex((overlay) => overlay.id === action.id)
      if (index === -1) return state
      const overlay = videoOverlays[index]
      if (action.shadow !== null && !isValidOverlayShadowInput(action.shadow)) return state
      const normalized = action.shadow === null ? undefined : normalizeOverlayShadow(action.shadow)
      // Stored is always normalized, so re-committing the same shadow — or
      // turning off a shadow-free overlay's — is a no-op, not an edit.
      if (overlayShadowsEqual(normalized, overlay.shadow)) return state
      const overlays = [...videoOverlays]
      // Off means no key at all — what keeps shadow-free files byte-identical.
      const next = { ...overlay }
      if (normalized === undefined) delete next.shadow
      else next.shadow = normalized
      overlays[index] = next
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
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
      return withEffects({ ...effectListsOf(state), videoOverlays: overlays })
    }
    case 'audio-track-volume-set': {
      const index = audioTracks.findIndex((track) => track.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.volume)) return state
      const volume = clampVolume(action.volume)
      if (volume === (audioTracks[index].volume ?? 1)) return state
      const tracks = [...audioTracks]
      tracks[index] = { ...tracks[index], volume }
      return withEffects({ ...effectListsOf(state), audioTracks: tracks })
    }
    case 'volumes-matched': {
      let entries = state.entries
      let tracks = audioTracks
      let overlays = videoOverlays
      for (const { kind, id, volume: asked } of action.volumes) {
        if (!Number.isFinite(asked)) continue
        const volume = clampVolume(asked)
        if (kind === 'entry') {
          const index = entries.findIndex((entry) => entry.id === id)
          if (index === -1 || entries[index].kind !== undefined) continue
          if (volume === (entries[index].volume ?? 1)) continue
          if (entries === state.entries) entries = [...entries]
          entries[index] = { ...entries[index], volume }
        } else if (kind === 'audio-track') {
          const index = tracks.findIndex((track) => track.id === id)
          if (index === -1 || volume === (tracks[index].volume ?? 1)) continue
          if (tracks === audioTracks) tracks = [...tracks]
          tracks[index] = { ...tracks[index], volume }
        } else {
          const index = overlays.findIndex((overlay) => overlay.id === id)
          if (index === -1 || isImageOverlay(overlays[index])) continue
          if (volume === (overlays[index].volume ?? 1)) continue
          if (overlays === videoOverlays) overlays = [...overlays]
          overlays[index] = { ...overlays[index], volume }
        }
      }
      // Nothing changed: a same-reference no-op, so no undo step.
      if (entries === state.entries && tracks === audioTracks && overlays === videoOverlays) return state
      return withEffects({ ...effectListsOf(state), entries, audioTracks: tracks, videoOverlays: overlays })
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
      return withEffects({ ...effectListsOf(state), audioTracks: tracks })
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
      return withEffects({ ...effectListsOf(state), audioTracks: tracks })
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
