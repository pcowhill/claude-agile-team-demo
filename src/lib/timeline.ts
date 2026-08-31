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
import type { TextOverlay, TextOverlaySpec } from './textOverlay'
import { clampTextOverlay, isValidTextOverlaySpec, textOverlaysEqual } from './textOverlay'
import type { VideoOverlay, VideoOverlayPlacement } from './videoOverlay'
import {
  clampVideoOverlay,
  isValidVideoOverlayPlacement,
  videoOverlaysEqual,
} from './videoOverlay'

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
  | { type: 'text-updated'; id: string; text: TextOverlaySpec }
  | { type: 'text-removed'; id: string }
  | { type: 'video-overlay-added'; overlay: VideoOverlay }
  | { type: 'video-overlay-updated'; id: string; placement: VideoOverlayPlacement }
  | { type: 'video-overlay-removed'; id: string }
  | { type: 'audio-track-added'; track: AudioTrack }
  | { type: 'audio-track-removed'; id: string }
  | { type: 'audio-track-retimed'; id: string; offset: number }
  | { type: 'audio-track-trimmed'; id: string; inPoint: number; outPoint: number }
  | { type: 'entry-volume-set'; id: string; volume: number }
  | { type: 'entry-mute-set'; id: string; muted: boolean }
  | { type: 'audio-track-volume-set'; id: string; volume: number }
  | { type: 'audio-track-fades-set'; id: string; fadeIn: number; fadeOut: number }

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
  // plays.
  const normalizedRemapList = normalizedRemaps(entries, remaps)
  return {
    entries,
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
): TimelineState {
  return withEffects(entries, transitions, zooms, audioTracks, remaps, texts, videoOverlays)
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
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
    case 'text-updated': {
      const existing = texts.find((text) => text.id === action.id)
      if (existing === undefined) return state
      if (!isValidTextOverlaySpec(action.text)) return state
      const candidate: TextOverlay = { ...action.text, id: existing.id }
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
