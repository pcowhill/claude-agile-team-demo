import type { ColorAdjustments, ColorLook } from './colorAdjustments'
import {
  COLOR_ADJUSTMENT_MAX,
  COLOR_ADJUSTMENT_MIN,
  COLOR_LOOKS,
  normalizeColorAdjustments,
} from './colorAdjustments'
import type { MediaKind, MediaLibraryState } from './mediaLibrary'
import { TRANSITION_TYPES } from './timeline'
import type {
  AudioTrack,
  RemapEffect,
  TimelineEntry,
  TimelineState,
  TimelineTransition,
  TransitionType,
  ZoomEffect,
} from './timeline'
import {
  audioTracksOf,
  isSlateEntry,
  isValidSlateColor,
  remapsOf,
  textsOf,
  transitionsOf,
  isImageOverlay,
  videoOverlaysOf,
  zoomsOf,
} from './timeline'
import type { SubtitleStyle, SubtitleStyleField, TextOverlay } from './textOverlay'
import type { VideoOverlay } from './videoOverlay'
import { forbiddenImageOverlayField } from './videoOverlay'
import {
  isTextFontId,
  isValidTextColor,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  normalizeStyleOverrides,
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_FIELDS,
} from './textOverlay'
import type { Orientation, OrientationRotation } from './orientation'
import { normalizeOrientation, ORIENTATION_ROTATIONS } from './orientation'
import type { Crop } from './crop'
import { normalizeCrop } from './crop'
import type { BackgroundFill } from './backgroundFill'
import type { ShapeMask } from './shapeMask'
import { MAX_ROUNDED_RADIUS } from './shapeMask'
import { isValidBackgroundFillInput } from './backgroundFill'
import type { CanvasPreset } from './frameSize'
import { isCanvasPreset } from './frameSize'

/**
 * The project file format (#75): everything needed to reopen a project and
 * continue editing. The file is the gzip of a JSON document:
 *
 *   {
 *     "format": PROJECT_FORMAT,          // magic — rejects arbitrary gzips
 *     "schemaVersion": 1 | .. | 13,      // integer; bumped on breaking change
 *     "plugins": ["gif-export"],         // version 6: plugin dependencies (#197)
 *     "clips": [{ id, name, duration?, kind?, width?, height?,
 *                 mimeType?, byteSize?, extractedFrom? }],
 *     "media": {                         // version 2 always; version 3 when
 *       [clipId]: { byteLength, crc32, mimeType?, data }   // embedding (#97)
 *     },
 *     "timeline": {
 *       "entries": [{ id, clipId, name, duration, inPoint, outPoint,
 *                     volume?, muted?, fadeIn?, fadeOut?,        // (#220)
 *                     colorAdjustments?: { brightness?, contrast?,
 *                       saturation?, look? },                    // (#192)
 *                     orientation?: { rotation?, flipH?, flipV? },   // (#232)
 *                     crop?: { left?, right?, top?, bottom? },       // (#255)
 *                     backgroundFill?: { kind: 'blur' } |
 *                                      { kind: 'color', color } }],  // (#259)
 *       "transitions": [{ beforeId, afterId, type, duration }],
 *       "zooms": [{ id?, entryId, start, rampIn, hold, rampOut, scale,
 *                   centerX, centerY }],
 *       "remaps": [{ id, entryId, kind: "speed", start, end, factor } |
 *                  { id, entryId, kind: "pause", at, hold }],   // (#138)
 *       "texts": [{ id, content, offset, duration, x, y, font, size,
 *                   color, bold, italic,
 *                   fadeIn?, fadeOut?,                          // (#139, #177)
 *                   subtitle?,                                  // (#249)
 *                   styleOverrides? }],                         // (#250)
 *       "subtitleStyle": { x, y, font, size, color, bold, italic }, // (#250)
 *       "canvasPreset": "16:9" | "9:16" | "1:1" | "4:5",          // (#273)
 *       "audioTracks": [{ id, clipId, name, duration, offset,
 *                         inPoint, outPoint, volume?, fadeIn?, fadeOut?,
 *                         duck?, duckLevel? }],                 // (#241)
 *       "videoOverlays": [{ id, clipId, name, duration, offset, inPoint,
 *                           outPoint, x, y, width, height, volume?, muted?,
 *                           fadeIn?, fadeOut?,                    // (#220)
 *                           colorAdjustments?, orientation?,       // (#145, #192, #232)
 *                           crop?,                                 // (#255)
 *                           shapeMask?: { kind: 'ellipse' } |
 *                                       { kind: 'rounded', radius } }] // (#266)
 *     }
 *   }
 *
 * Two kinds of file share the format (#92/#97):
 *
 * - **References-only** (schema version 1): clips are metadata to re-link
 *   against on open (#77), keeping the file "as small as it can reasonably
 *   be" (#71). Written at version 1 — the lowest version that can represent
 *   the content — so older builds keep opening them.
 * - **Embedded media** (schema version 2): the `media` object additionally
 *   carries every clip's bytes, so the single file moves to another
 *   computer and opens fully linked with no re-link step. `data` is
 *   standard base64: the format stays gzip-of-JSON (older builds refuse it
 *   through the version gate with the "saved by a newer version" error
 *   rather than a parse failure), and gzip's Huffman stage re-compresses
 *   base64's 33% inflation down to a few percent even for media bytes that
 *   are themselves incompressible — measured in the test suite against the
 *   1.15 × (media + references file) budget from #97. `byteLength` and
 *   `crc32` (of the decoded bytes, hex) let a truncated or mutated payload
 *   be refused by name; a version-2 file whose `media` does not cover every
 *   clip is refused rather than half-opened.
 *
 * Schema version 3 (#137) marks that the library holds still images —
 * `kind: "image"` clips, which carry `width`/`height` and no `duration`
 * (a still has none). It is written exactly when images are present, in
 * BOTH save modes: a references-only file with images is version 3 with no
 * `media` section, an embedded one is version 3 with it — so at version 3
 * the `media` section's presence is what distinguishes the two kinds of
 * file, where versions 1/2 encoded that in the version itself. Older
 * builds refuse image-carrying files through the version gate instead of
 * choking on the unknown kind value.
 *
 * Schema version 5 (#143) adds solid-color slate entries to the timeline:
 * a sequence entry may carry a `color` (lowercase `#rrggbb`) instead of a
 * `clipId` — it references no clip and no media, and renders as that flat
 * color for the entry's window. As at version 4, the media section's
 * presence keeps distinguishing the save modes, and 5 is written exactly
 * when a slate is on the timeline so older builds route slate-carrying
 * files to the "saved by a newer version" refusal.
 *
 * Schema version 6 (#197) marks that the project uses features contributed
 * by plugins (ADR 0003): a top-level `plugins` array names the plugin ids
 * the project depends on, written exactly when an enabled plugin's features
 * are in the saveable state — so plugin-free projects stay byte-identical
 * to what earlier builds wrote, and older builds route plugin-dependent
 * files to the "saved by a newer version" refusal instead of opening them
 * silently degraded. Opening a version-6 file prompts to enable the named
 * plugins when they are disabled (prompt-and-enable, `ProjectControls`).
 * The media section's presence keeps distinguishing the save modes.
 *
 * Schema version 7 (#192) marks that the project carries per-clip color
 * adjustments: a sequence entry or a video overlay may carry a
 * `colorAdjustments` object (percent `brightness`/`contrast`/`saturation`,
 * each 0–200 and never the identity 100, plus an optional `look` of
 * "grayscale" or "sepia" — see `colorAdjustments.ts`). Written exactly when
 * any entry or overlay is adjusted, so adjustment-free projects stay
 * byte-identical to earlier output and older builds route adjusted files to
 * the "saved by a newer version" refusal instead of opening them silently
 * unadjusted. The media section's presence keeps distinguishing the save
 * modes.
 *
 * Schema version 8 (#220) marks that a sequence entry or a video overlay
 * carries audio fades: optional `fadeIn`/`fadeOut` durations in seconds
 * (non-negative, exactly the audio-track fade shape from #104). Written
 * exactly when any entry or overlay fade is set, so fade-free projects stay
 * byte-identical to earlier output and older builds route fading files to
 * the "saved by a newer version" refusal instead of opening them silently
 * unfaded. The media section's presence keeps distinguishing the save
 * modes.
 *
 * Schema version 15 (#266) marks that a video overlay carries a shape
 * mask: an optional `shapeMask` object — `{ kind: 'ellipse' }` (the ellipse
 * inscribed in the placed rectangle) or `{ kind: 'rounded', radius }` (a
 * rounded rectangle; radius a fraction of the rectangle's shorter side in
 * (0, 0.5]); absence means the hard rectangle — today's outline (see
 * shapeMask.ts). Written exactly when any mask exists, so mask-free
 * projects stay byte-identical to earlier output and older builds route
 * masked files to the "saved by a newer version" refusal instead of opening
 * them silently unmasked. The media section's presence keeps distinguishing
 * the save modes.
 *
 * Schema version 14 (#259) marks that a sequence entry carries a background
 * fill: an optional `backgroundFill` object — `{ kind: 'blur' }` (the
 * entry's own frame, cover-fit behind the fitted clip and blurred) or
 * `{ kind: 'color', color }` (a flat lowercase `#rrggbb` backdrop); absence
 * means none — today's black bars (see backgroundFill.ts). Written exactly
 * when any fill exists, so fill-free projects stay byte-identical to
 * earlier output and older builds route filled files to the "saved by a
 * newer version" refusal instead of opening them silently unfilled. The
 * media section's presence keeps distinguishing the save modes.
 *
 * Schema version 13 (#250) marks that the project carries default-subtitle-
 * style data: a customized `timeline.subtitleStyle` (the full style — x, y,
 * font, size, color, bold, italic — present exactly when it differs from
 * the built-in subtitle default; see textOverlay.ts), and/or a text
 * overlay's `styleOverrides` list naming the style fields that overlay owns
 * individually (canonical field order, only on `subtitle: true` overlays).
 * Written exactly when either exists, so style-free projects stay
 * byte-identical to earlier output and older builds route styled files to
 * the "saved by a newer version" refusal instead of opening them silently
 * unstyled. The media section's presence keeps distinguishing the save
 * modes.
 *
 * Schema version 12 (#255) marks that a sequence entry or a video overlay
 * carries a crop: an optional `crop` object with `left`/`right`/`top`/
 * `bottom` edge fractions (each in [0, 1), present exactly when non-zero,
 * each axis keeping at least MIN_KEPT_FRACTION — see crop.ts). Written
 * exactly when any crop exists, so crop-free projects stay byte-identical
 * to earlier output and older builds route cropped files to the "saved by
 * a newer version" refusal instead of opening them silently uncropped. The
 * media section's presence keeps distinguishing the save modes.
 *
 * Schema version 9 (#232) marks that a sequence entry or a video overlay
 * carries an orientation: an optional `orientation` object with `rotation`
 * (90 | 180 | 270 — 0 is expressed by absence) and boolean `flipH`/`flipV`
 * (present exactly when true; see orientation.ts). Written exactly when any
 * orientation exists, so orientation-free projects stay byte-identical to
 * earlier output and older builds route oriented files to the "saved by a
 * newer version" refusal instead of opening them silently unrotated. The
 * media section's presence keeps distinguishing the save modes.
 *
 * Schema version 4 (#140) marks that the *timeline* places still images:
 * a sequence entry may reference an image clip, showing it for the entry's
 * `duration` (equal to its `outPoint`; a still has no source trim). The
 * entry's stored shape is unchanged — stillness is derived from the
 * referenced clip's kind on open, never stored — so 4 exists purely to
 * route older builds (which refuse image entries as invalid) to the
 * accurate "saved by a newer version" refusal instead. The media section's
 * presence keeps distinguishing the save modes, exactly as at version 3.
 *
 * Compatibility contract: a file with `schemaVersion` GREATER than this
 * build understands is refused with a clear error (it may mean something
 * this code would mis-load). Within a known version, unknown extra keys are
 * ignored, so additive evolution does not need a version bump. Every
 * shipped version keeps a fixture under `src/lib/fixtures/` that the test
 * suite must always deserialize — that is what makes "older saved files
 * still open" (#71) checkable forever.
 */
export const PROJECT_FORMAT = 'browser-video-editor-project'
/** The newest schema version this build understands. */
export const PROJECT_SCHEMA_VERSION = 17
/** The version written for references-only files, openable by older builds. */
export const REFERENCES_SCHEMA_VERSION = 1
/** The version written when embedding media and the library has no images. */
export const EMBEDDED_SCHEMA_VERSION = 2
/** The version any image in the library forces, whichever the save mode (#137). */
export const IMAGES_SCHEMA_VERSION = 3
/** The version any image ON the timeline forces, whichever the save mode (#140). */
export const IMAGE_ENTRIES_SCHEMA_VERSION = 4
/** The version any color slate forces, whichever the save mode (#143). */
export const SLATE_ENTRIES_SCHEMA_VERSION = 5
/** The version any plugin dependency forces, whichever the save mode (#197). */
export const PLUGINS_SCHEMA_VERSION = 6
/** The version any color adjustment forces, whichever the save mode (#192). */
export const COLOR_ADJUSTMENTS_SCHEMA_VERSION = 7
/** The version any entry/overlay audio fade forces, whichever the save mode (#220). */
export const AUDIO_FADES_SCHEMA_VERSION = 8
/** The version any entry/overlay orientation forces, whichever the save mode (#232). */
export const ORIENTATION_SCHEMA_VERSION = 9
/** The version any duck-enabled audio track forces, whichever the save mode (#241). */
export const DUCKING_SCHEMA_VERSION = 10
/** The version any subtitle-imported text overlay forces, whichever the save mode (#249). */
export const SUBTITLE_SCHEMA_VERSION = 11
/** The version any entry/overlay crop forces, whichever the save mode (#255). */
export const CROP_SCHEMA_VERSION = 12
/** The version any default-subtitle-style data forces, whichever the save mode (#250). */
export const SUBTITLE_STYLE_SCHEMA_VERSION = 13
/** The version any entry background fill forces, whichever the save mode (#259). */
export const BACKGROUND_FILL_SCHEMA_VERSION = 14
/** The version any overlay shape mask forces, whichever the save mode (#266). */
export const SHAPE_MASK_SCHEMA_VERSION = 15
/** The version a set canvas preset forces, whichever the save mode (#273). */
export const CANVAS_PRESET_SCHEMA_VERSION = 16
/** The version any image overlay layer forces, whichever the save mode (#294). */
export const IMAGE_OVERLAYS_SCHEMA_VERSION = 17

/**
 * A library clip as stored in a project file: metadata for re-linking, not
 * media. `mimeType` and `byteSize` are optional — the format preserves them
 * for re-link matching whenever the library model knows them, and files
 * written before it did simply omit them. `kind` is always present after
 * parsing: files written before the library knew audio (#101) omit the key,
 * and every clip in them is a video — the additive-within-a-version
 * contract above makes the default safe in both directions.
 */
export interface ProjectClip {
  id: string
  name: string
  /**
   * Duration in seconds. Always 0 for images (#137) — the file omits their
   * `duration` key entirely, because a still has no duration to store — and
   * finite, > 0 for video and audio.
   */
  duration: number
  kind: MediaKind
  /** Intrinsic pixel dimensions (#137). Written for images, for re-linking. */
  width?: number
  height?: number
  mimeType?: string
  byteSize?: number
  /**
   * Filename of the video clip this audio clip was extracted from (#154).
   * Present only on extracted audio clips; re-linking uses it to let the
   * original video file satisfy this clip (openProject.ts). Additive within
   * the schema version: extraction-free files omit the key and stay
   * byte-identical.
   */
  extractedFrom?: string
}

/**
 * A timeline entry as stored: everything but `url`, which is a runtime
 * object-URL binding that cannot outlive the session. Opening a project
 * (slice 3/3) reconstructs urls by re-linking clips and joining on `clipId`.
 */
export type ProjectEntry = Omit<TimelineEntry, 'url'>

/** An audio track as stored (#102): everything but `url`, like an entry. */
export type ProjectAudioTrack = Omit<AudioTrack, 'url'>

/** An overlay video layer as stored (#145): everything but `url`. */
export type ProjectVideoOverlay = Omit<VideoOverlay, 'url'>

/**
 * One clip's media, as passed to serialization and returned from
 * deserializing an embedded file. `mimeType` is preserved so the restored
 * Blob (see `openProject.ts`) plays back under its original type.
 */
export interface ClipMedia {
  bytes: Uint8Array<ArrayBuffer>
  mimeType?: string
}

/** The editing state a project file carries. Lists are always present. */
export interface ProjectTimeline {
  entries: ProjectEntry[]
  transitions: TimelineTransition[]
  zooms: ZoomEffect[]
  /**
   * Time-remap effects (#138). Present exactly when the file carries any,
   * mirroring `TimelineState` where a missing list means none — files
   * written before remaps (and remap-free files since) simply omit the key,
   * additive within a schema version per the contract above.
   */
  remaps?: RemapEffect[]
  /**
   * Text overlays (#139). Present exactly when the file carries any,
   * additive within a schema version exactly like `remaps`.
   */
  texts?: TextOverlay[]
  /**
   * The customized default subtitle style (#250, schema version 13).
   * Present exactly when it differs from the built-in subtitle default,
   * mirroring `TimelineState` where absence means that default.
   */
  subtitleStyle?: SubtitleStyle
  /**
   * The project's canvas preset (#273, schema version 16). Present exactly
   * when one is set, mirroring `TimelineState` where absence means Auto.
   */
  canvasPreset?: CanvasPreset
  /**
   * Overlay video layers (#145). Present exactly when the file carries any,
   * additive within a schema version exactly like `remaps`.
   */
  videoOverlays?: ProjectVideoOverlay[]
  /**
   * Always present after parsing: files written before audio tracks (#102)
   * omit the key and parse as an empty list — additive within a schema
   * version per the contract above.
   */
  audioTracks: ProjectAudioTrack[]
}

export interface Project {
  clips: ProjectClip[]
  timeline: ProjectTimeline
  /**
   * Ids of the plugins whose features this project uses (#197, schema
   * version 6). Present exactly when non-empty, mirroring the serializer.
   * The open flow prompts to enable these when they are disabled, and
   * refuses by name any id this build's catalog does not know.
   */
  plugins?: string[]
}

/**
 * Deserialization never throws for bad input — a project file comes from
 * outside the program and being unreadable is an expected outcome, reported
 * as a value with a human-readable reason. `media` is present exactly when
 * the file embedded its media (schema version 2), keyed by clip id and
 * covering every clip — the validator refuses partial coverage.
 */
export type DeserializeResult =
  | { ok: true; project: Project; media?: ReadonlyMap<string, ClipMedia> }
  | { ok: false; error: string }

/**
 * A color adjustment set as stored (#192): fixed key order (brightness,
 * contrast, saturation, look), present fields only, so the same set always
 * serializes to the same bytes. The state is already normalized (no
 * identity fields — see colorAdjustments.ts); this only fixes the order.
 */
function storedColorAdjustments({
  brightness,
  contrast,
  saturation,
  look,
}: ColorAdjustments): ColorAdjustments {
  return {
    ...(brightness === undefined ? {} : { brightness }),
    ...(contrast === undefined ? {} : { contrast }),
    ...(saturation === undefined ? {} : { saturation }),
    ...(look === undefined ? {} : { look }),
  }
}

/**
 * An orientation as stored (#232): fixed key order (rotation, flipH,
 * flipV), present fields only, so the same orientation always serializes to
 * the same bytes. The state is already normalized (no identity fields — see
 * orientation.ts); this only fixes the order.
 */
function storedOrientation({ rotation, flipH, flipV }: Orientation): Orientation {
  return {
    ...(rotation === undefined ? {} : { rotation }),
    ...(flipH === undefined ? {} : { flipH }),
    ...(flipV === undefined ? {} : { flipV }),
  }
}

/**
 * A crop as stored (#255): fixed key order (left, right, top, bottom),
 * present fields only, so the same crop always serializes to the same
 * bytes. The state is already normalized (no zero fields — see crop.ts);
 * this only fixes the order.
 */
function storedCrop({ left, right, top, bottom }: Crop): Crop {
  return {
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    ...(top === undefined ? {} : { top }),
    ...(bottom === undefined ? {} : { bottom }),
  }
}

/**
 * A background fill as stored (#259): fixed key order (kind, then color for
 * the color kind), exactly the normalized state's own fields, so the same
 * fill always serializes to the same bytes.
 */
function storedBackgroundFill(fill: BackgroundFill): BackgroundFill {
  return fill.kind === 'color' ? { kind: 'color', color: fill.color } : { kind: 'blur' }
}

/**
 * A shape mask as stored (#266): fixed key order (kind, then radius for the
 * rounded kind), exactly the normalized state's own fields, so the same
 * mask always serializes to the same bytes.
 */
function storedShapeMask(mask: ShapeMask): ShapeMask {
  return mask.kind === 'rounded' ? { kind: 'rounded', radius: mask.radius } : { kind: 'ellipse' }
}

/**
 * The default subtitle style as stored (#250): every field, fixed key order
 * (x, y, font, size, color, bold, italic — `SUBTITLE_STYLE_FIELDS`), so the
 * same style always serializes to the same bytes. The state stores it only
 * when it differs from the built-in default (see textOverlay.ts).
 */
function storedSubtitleStyle({ x, y, font, size, color, bold, italic }: SubtitleStyle): SubtitleStyle {
  return { x, y, font, size, color, bold, italic }
}

/**
 * Serializes the current library + timeline into project-file bytes.
 * Import failures (transient UI state) are not part of a project. With
 * `media` (bytes per clip id, covering the whole library) the file embeds
 * the media; without it, a references-only file is written. The schema
 * version is the lowest that can represent the content (see the format
 * notes above): 1 or 2 by save mode, byte-compatible with what this
 * function always produced, or 3 as soon as the library has images (#137).
 * `plugins` (#197) names the plugin ids whose features the state uses —
 * the caller computes it via `PluginRuntime.projectPlugins` — and forces
 * schema version 6 exactly when non-empty, so plugin-free projects stay
 * byte-identical whatever the enabled set.
 * Throws only on programmer error: a timeline entry referencing a clip that
 * is not in the library — or a media map that does not match the library
 * exactly — would produce a file our own deserializer refuses, so it is
 * rejected here, at the source.
 */
export async function serializeProject(
  library: MediaLibraryState,
  timeline: TimelineState,
  media?: ReadonlyMap<string, ClipMedia>,
  plugins: readonly string[] = [],
): Promise<Uint8Array<ArrayBuffer>> {
  const clipIds = new Set(library.clips.map((clip) => clip.id))
  for (const entry of timeline.entries) {
    // A slate references no clip (#143) — there is nothing to check.
    if (isSlateEntry(entry)) continue
    if (!clipIds.has(entry.clipId)) {
      throw new Error(
        `cannot serialize: timeline entry "${entry.id}" references clip "${entry.clipId}" which is not in the library`,
      )
    }
  }
  for (const track of audioTracksOf(timeline)) {
    if (!clipIds.has(track.clipId)) {
      throw new Error(
        `cannot serialize: audio track "${track.id}" references clip "${track.clipId}" which is not in the library`,
      )
    }
  }
  if (media !== undefined) {
    for (const clip of library.clips) {
      if (!media.has(clip.id)) {
        throw new Error(
          `cannot serialize: no media bytes supplied for clip "${clip.id}" ("${clip.name}")`,
        )
      }
    }
    for (const clipId of media.keys()) {
      if (!clipIds.has(clipId)) {
        throw new Error(
          `cannot serialize: media bytes supplied for clip "${clipId}" which is not in the library`,
        )
      }
    }
  }
  const uniquePlugins = new Set(plugins)
  if (uniquePlugins.size !== plugins.length) {
    throw new Error('cannot serialize: the plugin dependency list contains duplicates')
  }
  // The lowest version that can represent the content is the one written,
  // so older builds keep opening every file that has nothing newer in it.
  // An overlay shape mask forces version 15 (#266),
  // an entry background fill version 14 (#259),
  // default-subtitle-style data version 13 (#250), an
  // entry/overlay crop version 12 (#255), a
  // subtitle-imported text overlay version 11 (#249), a
  // duck-enabled audio track version 10 (#241), an entry/overlay
  // orientation version 9 (#232), an entry/overlay
  // audio fade version 8 (#220), a color adjustment version 7 (#192), a
  // plugin dependency version 6 (#197), a color slate version 5 (#143), an
  // image on the timeline version 4 (#140), an image merely in the library
  // version 3 (#137), whichever the save mode; otherwise the mode alone
  // decides, exactly as before images existed.
  const clipKindById = new Map(library.clips.map((clip) => [clip.id, clip.kind]))
  const hasImageOverlays = videoOverlaysOf(timeline).some(isImageOverlay)
  const hasCanvasPreset = timeline.canvasPreset !== undefined
  const hasShapeMask = videoOverlaysOf(timeline).some(
    (overlay) => overlay.shapeMask !== undefined,
  )
  const hasBackgroundFill = timeline.entries.some((entry) => entry.backgroundFill !== undefined)
  const hasSubtitleStyle =
    timeline.subtitleStyle !== undefined ||
    textsOf(timeline).some((text) => text.styleOverrides !== undefined)
  const hasCrop =
    timeline.entries.some((entry) => entry.crop !== undefined) ||
    videoOverlaysOf(timeline).some((overlay) => overlay.crop !== undefined)
  const hasSubtitles = textsOf(timeline).some((text) => text.subtitle === true)
  const hasDucking = audioTracksOf(timeline).some((track) => track.duck === true)
  const hasOrientation =
    timeline.entries.some((entry) => entry.orientation !== undefined) ||
    videoOverlaysOf(timeline).some((overlay) => overlay.orientation !== undefined)
  const hasAudioFades =
    timeline.entries.some((entry) => entry.fadeIn !== undefined || entry.fadeOut !== undefined) ||
    videoOverlaysOf(timeline).some(
      (overlay) => overlay.fadeIn !== undefined || overlay.fadeOut !== undefined,
    )
  const hasColorAdjustments =
    timeline.entries.some((entry) => entry.colorAdjustments !== undefined) ||
    videoOverlaysOf(timeline).some((overlay) => overlay.colorAdjustments !== undefined)
  const hasSlateEntries = timeline.entries.some(isSlateEntry)
  const hasImageEntries = timeline.entries.some(
    (entry) => clipKindById.get(entry.clipId) === 'image',
  )
  const hasImages = library.clips.some((clip) => clip.kind === 'image')
  const document = {
    format: PROJECT_FORMAT,
    schemaVersion: hasImageOverlays
      ? IMAGE_OVERLAYS_SCHEMA_VERSION
      : hasCanvasPreset
      ? CANVAS_PRESET_SCHEMA_VERSION
      : hasShapeMask
      ? SHAPE_MASK_SCHEMA_VERSION
      : hasBackgroundFill
      ? BACKGROUND_FILL_SCHEMA_VERSION
      : hasSubtitleStyle
      ? SUBTITLE_STYLE_SCHEMA_VERSION
      : hasCrop
      ? CROP_SCHEMA_VERSION
      : hasSubtitles
      ? SUBTITLE_SCHEMA_VERSION
      : hasDucking
      ? DUCKING_SCHEMA_VERSION
      : hasOrientation
      ? ORIENTATION_SCHEMA_VERSION
      : hasAudioFades
        ? AUDIO_FADES_SCHEMA_VERSION
        : hasColorAdjustments
        ? COLOR_ADJUSTMENTS_SCHEMA_VERSION
        : plugins.length > 0
        ? PLUGINS_SCHEMA_VERSION
        : hasSlateEntries
          ? SLATE_ENTRIES_SCHEMA_VERSION
          : hasImageEntries
            ? IMAGE_ENTRIES_SCHEMA_VERSION
            : hasImages
              ? IMAGES_SCHEMA_VERSION
              : media === undefined
                ? REFERENCES_SCHEMA_VERSION
                : EMBEDDED_SCHEMA_VERSION,
    // Plugin dependencies (#197) are written only while any exist, so
    // plugin-free projects stay byte-identical to earlier output.
    ...(plugins.length === 0 ? {} : { plugins: [...plugins] }),
    clips: library.clips.map(({ id, name, duration, kind, width, height, extractedFrom }) => ({
      id,
      name,
      // Images store dimensions instead of a duration (#137); other kinds
      // keep the exact key order files always had, staying byte-identical.
      ...(kind === 'image' ? {} : { duration }),
      kind,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(extractedFrom === undefined ? {} : { extractedFrom }),
    })),
    ...(media === undefined
      ? {}
      : {
          media: Object.fromEntries(
            library.clips.map((clip) => {
              const clipMedia = media.get(clip.id) as ClipMedia
              return [
                clip.id,
                {
                  byteLength: clipMedia.bytes.length,
                  crc32: crc32Hex(clipMedia.bytes),
                  ...(clipMedia.mimeType === undefined ? {} : { mimeType: clipMedia.mimeType }),
                  data: encodeBase64(clipMedia.bytes),
                },
              ]
            }),
          ),
        }),
    timeline: {
      // Gain fields (#104) are written only when present, so files touched
      // by no volume/mute/fade edit stay byte-identical to pre-#104 output.
      // A slate (#143) writes its color and no clipId — it references
      // nothing; slateness is derived from `color` on open, never stored.
      entries: timeline.entries.map(
        ({ id, clipId, name, duration, inPoint, outPoint, kind, color, volume, muted, fadeIn, fadeOut, colorAdjustments, orientation, crop, backgroundFill }) => ({
          id,
          ...(kind === 'slate' ? {} : { clipId }),
          name,
          duration,
          inPoint,
          outPoint,
          ...(kind === 'slate' ? { color } : {}),
          ...(volume === undefined ? {} : { volume }),
          ...(muted === undefined ? {} : { muted }),
          // Audio fades (#220) are written only when set (zero fades are
          // stored as absent by the reducer), so fade-free projects stay
          // byte-identical to earlier output.
          ...(fadeIn === undefined ? {} : { fadeIn }),
          ...(fadeOut === undefined ? {} : { fadeOut }),
          // Color adjustments (#192) are written only when present — the
          // state is normalized (identity = no key), so adjustment-free
          // projects stay byte-identical to earlier output.
          ...(colorAdjustments === undefined
            ? {}
            : { colorAdjustments: storedColorAdjustments(colorAdjustments) }),
          // Orientation (#232) is written only when present — normalized
          // state has no identity key, so unoriented projects stay
          // byte-identical to earlier output.
          ...(orientation === undefined ? {} : { orientation: storedOrientation(orientation) }),
          // Crop (#255) is written only when present — normalized state has
          // no identity key, so crop-free projects stay byte-identical to
          // earlier output.
          ...(crop === undefined ? {} : { crop: storedCrop(crop) }),
          // Background fill (#259) is written only when present — none is
          // no key at all, so fill-free projects stay byte-identical to
          // earlier output.
          ...(backgroundFill === undefined
            ? {}
            : { backgroundFill: storedBackgroundFill(backgroundFill) }),
        }),
      ),
      transitions: transitionsOf(timeline).map(({ beforeId, afterId, type, duration }) => ({
        beforeId,
        afterId,
        type,
        duration,
      })),
      zooms: zoomsOf(timeline).map(
        ({ id, entryId, start, rampIn, hold, rampOut, scale, centerX, centerY }) => ({
          id,
          entryId,
          start,
          rampIn,
          hold,
          rampOut,
          scale,
          centerX,
          centerY,
        }),
      ),
      // Time-remap effects (#138) are written only while any exist, so
      // remap-free projects stay byte-identical to pre-#138 output —
      // additive within the schema version, like the gain fields (#104).
      ...(remapsOf(timeline).length === 0
        ? {}
        : {
            remaps: remapsOf(timeline).map((remap) =>
              remap.kind === 'pause'
                ? {
                    id: remap.id,
                    entryId: remap.entryId,
                    kind: remap.kind,
                    at: remap.at,
                    hold: remap.hold,
                  }
                : {
                    id: remap.id,
                    entryId: remap.entryId,
                    kind: remap.kind,
                    start: remap.start,
                    end: remap.end,
                    factor: remap.factor,
                  },
            ),
          }),
      // Text overlays (#139) are written only while any exist, so text-free
      // projects stay byte-identical to earlier output — additive within the
      // schema version, like remaps.
      ...(textsOf(timeline).length === 0
        ? {}
        : {
            texts: textsOf(timeline).map(
              ({ id, content, offset, duration, x, y, font, size, color, bold, italic, fadeIn, fadeOut, subtitle, styleOverrides }) => ({
                id,
                content,
                offset,
                duration,
                x,
                y,
                font,
                size,
                color,
                bold,
                italic,
                // Fades (#177) are written only when set, like audio-track
                // fades, so fade-free projects stay byte-identical.
                ...(fadeIn === undefined || fadeIn === 0 ? {} : { fadeIn }),
                ...(fadeOut === undefined || fadeOut === 0 ? {} : { fadeOut }),
                // The subtitle-import marker (#249) is written only when
                // set, so subtitle-free projects stay byte-identical (and
                // keep their lower schema version).
                ...(subtitle === true ? { subtitle } : {}),
                // Individually-overridden style fields (#250), already in
                // canonical order in state; written only when any exist.
                ...(styleOverrides === undefined ? {} : { styleOverrides: [...styleOverrides] }),
              }),
            ),
          }),
      // The customized default subtitle style (#250) is written only when it
      // differs from the built-in default (the state stores it exactly then),
      // so never-customized projects stay byte-identical to earlier output.
      ...(timeline.subtitleStyle === undefined
        ? {}
        : { subtitleStyle: storedSubtitleStyle(timeline.subtitleStyle) }),
      // The canvas preset (#273) is written only when one is set (the state
      // stores it exactly then), so Auto projects stay byte-identical to
      // earlier output at their lower schema version.
      ...(timeline.canvasPreset === undefined ? {} : { canvasPreset: timeline.canvasPreset }),
      audioTracks: audioTracksOf(timeline).map(
        ({ id, clipId, name, duration, offset, inPoint, outPoint, volume, fadeIn, fadeOut, duck, duckLevel }) => ({
          id,
          clipId,
          name,
          duration,
          offset,
          inPoint,
          outPoint,
          ...(volume === undefined ? {} : { volume }),
          ...(fadeIn === undefined ? {} : { fadeIn }),
          ...(fadeOut === undefined ? {} : { fadeOut }),
          // Ducking (#241) is written only when on, so duck-free projects
          // stay byte-identical to earlier output (and keep their lower
          // schema version).
          ...(duck === true ? { duck } : {}),
          ...(duck === true && duckLevel !== undefined ? { duckLevel } : {}),
        }),
      ),
      // Overlay video layers (#145) are written only while any exist, so
      // overlay-free projects stay byte-identical to earlier output —
      // additive within the schema version, like remaps and texts.
      ...(videoOverlaysOf(timeline).length === 0
        ? {}
        : {
            videoOverlays: videoOverlaysOf(timeline).map(
              ({ id, kind, clipId, name, duration, offset, inPoint, outPoint, x, y, width, height, volume, muted, fadeIn, fadeOut, colorAdjustments, orientation, crop, shapeMask }) => ({
                id,
                // Still overlays (#294) carry their kind; a video overlay
                // writes no key at all, so overlay output that existed before
                // image overlays stays byte-identical.
                ...(kind === undefined ? {} : { kind }),
                clipId,
                name,
                duration,
                offset,
                inPoint,
                outPoint,
                x,
                y,
                width,
                height,
                ...(volume === undefined ? {} : { volume }),
                ...(muted === undefined ? {} : { muted }),
                // Audio fades (#220), written only when set — like the
                // entries above, keeping fade-free output byte-identical.
                ...(fadeIn === undefined ? {} : { fadeIn }),
                ...(fadeOut === undefined ? {} : { fadeOut }),
                ...(colorAdjustments === undefined
                  ? {}
                  : { colorAdjustments: storedColorAdjustments(colorAdjustments) }),
                ...(orientation === undefined
                  ? {}
                  : { orientation: storedOrientation(orientation) }),
                ...(crop === undefined ? {} : { crop: storedCrop(crop) }),
                // Shape mask (#266) is written only when present — the hard
                // rectangle is no key at all, so mask-free projects stay
                // byte-identical to earlier output.
                ...(shapeMask === undefined ? {} : { shapeMask: storedShapeMask(shapeMask) }),
              }),
            ),
          }),
    },
  }
  return gzip(new TextEncoder().encode(JSON.stringify(document)))
}

/**
 * Reads project-file bytes back into a {@link Project}, or explains why it
 * cannot: not gzip, not JSON, not this format, a newer schema version, or a
 * shape/consistency violation. Never returns a silently partial project —
 * any defect fails the whole load with the first problem found.
 */
export async function deserializeProject(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<DeserializeResult> {
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(await gunzip(bytes))
  } catch {
    return refusal('not a project file (the data is not valid gzip)')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return refusal('corrupt project file (the decompressed data is not valid JSON)')
  }
  if (!isRecord(parsed)) return refusal('corrupt project file (expected a JSON object)')
  if (parsed.format !== PROJECT_FORMAT) {
    return refusal(`not a project file (missing the "${PROJECT_FORMAT}" format marker)`)
  }
  const version = parsed.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return refusal('corrupt project file (schemaVersion must be a positive integer)')
  }
  if (version > PROJECT_SCHEMA_VERSION) {
    return refusal(
      `this project file uses schema version ${version}, but this build of the editor only understands up to version ${PROJECT_SCHEMA_VERSION} — it was saved by a newer version of the editor`,
    )
  }
  try {
    const project = validateProject(parsed)
    if (version < 2) {
      // A version-1 file never has media; any `media` key is an unknown
      // extra key from some foreign writer and is ignored per the contract.
      return { ok: true, project }
    }
    if (version >= 3 && parsed.media === undefined) {
      // At version 3 both save modes exist (#137): the media section's
      // presence — not the version — says whether the file embedded its
      // media. Version 2 is embedded by definition, so only 3+ may lack it.
      return { ok: true, project }
    }
    return { ok: true, project, media: validateMedia(parsed, project.clips) }
  } catch (error) {
    return refusal(`corrupt project file (${error instanceof Error ? error.message : error})`)
  }
}

const refusal = (error: string): DeserializeResult => ({ ok: false, error })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Field extractors that throw the path of the first defect they find. */
const asString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}
const asFinite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}
const asNonNegative = (value: unknown, path: string): number => {
  const numeric = asFinite(value, path)
  if (numeric < 0) throw new Error(`${path} must not be negative`)
  return numeric
}
const asArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}
const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  return value
}
const asMediaKind = (value: unknown, path: string): MediaKind => {
  if (value !== 'video' && value !== 'audio' && value !== 'image') {
    throw new Error(`${path} must be "video", "audio", or "image"`)
  }
  return value
}
/** "a video" / "an audio" / "an image", for kind-mismatch messages. */
const describeKind = (kind: MediaKind): string => (kind === 'video' ? 'a video' : `an ${kind}`)
const asPositiveInteger = (value: unknown, path: string): number => {
  const numeric = asFinite(value, path)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${path} must be a positive integer`)
  }
  return numeric
}
const asVolume = (value: unknown, path: string): number => {
  const numeric = asFinite(value, path)
  if (numeric < 0 || numeric > 1) throw new Error(`${path} must be between 0 and 1`)
  return numeric
}
const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}
/**
 * A stored color adjustment set (#192): present dials finite within
 * [0, 200], a present look a known one; anything else is refused by name.
 * The result is normalized (identity fields dropped) — our own serializer
 * never writes identity values, but a foreign writer's are meaningless
 * rather than wrong, so they normalize away instead of refusing, exactly
 * how open-time normalization treats an overlong fade. A set that
 * normalizes to all-identity returns undefined: the caller stores no key.
 */
const asColorAdjustments = (value: unknown, path: string): ColorAdjustments | undefined => {
  const raw = asRecord(value, path)
  const dial = (key: 'brightness' | 'contrast' | 'saturation'): number | undefined => {
    if (raw[key] === undefined) return undefined
    const numeric = asFinite(raw[key], `${path}.${key}`)
    if (numeric < COLOR_ADJUSTMENT_MIN || numeric > COLOR_ADJUSTMENT_MAX) {
      throw new Error(
        `${path}.${key} must be between ${COLOR_ADJUSTMENT_MIN} and ${COLOR_ADJUSTMENT_MAX}`,
      )
    }
    return numeric
  }
  const adjustments: ColorAdjustments = {
    brightness: dial('brightness'),
    contrast: dial('contrast'),
    saturation: dial('saturation'),
  }
  if (raw.look !== undefined) {
    const look = asString(raw.look, `${path}.look`)
    if (!(COLOR_LOOKS as readonly string[]).includes(look)) {
      throw new Error(`${path}.look "${look}" is unknown`)
    }
    adjustments.look = look as ColorLook
  }
  return normalizeColorAdjustments(adjustments)
}

/**
 * A stored orientation (#232): a present rotation must be one of the
 * quarter turns (0 is expressed by absence) and present flips booleans;
 * anything else is refused by name — the states are discrete, so unlike a
 * dial there is nothing to clamp. A `false` flip from a foreign writer is
 * meaningless rather than wrong and normalizes away, exactly as an identity
 * dial does. An all-identity object returns undefined: the caller stores no
 * key.
 */
const asOrientation = (value: unknown, path: string): Orientation | undefined => {
  const raw = asRecord(value, path)
  const orientation: Orientation = {}
  if (raw.rotation !== undefined) {
    const rotation = asFinite(raw.rotation, `${path}.rotation`)
    if (!(ORIENTATION_ROTATIONS as readonly number[]).includes(rotation)) {
      throw new Error(
        `${path}.rotation must be one of ${ORIENTATION_ROTATIONS.join(', ')} (0 is expressed by omitting it)`,
      )
    }
    orientation.rotation = rotation as OrientationRotation
  }
  if (raw.flipH !== undefined) orientation.flipH = asBoolean(raw.flipH, `${path}.flipH`)
  if (raw.flipV !== undefined) orientation.flipV = asBoolean(raw.flipV, `${path}.flipV`)
  return normalizeOrientation(orientation)
}

/**
 * A stored crop (#255): present edges must be finite fractions in [0, 1);
 * anything else is refused by name. Zero edges from a foreign writer are
 * meaningless rather than wrong and normalize away, exactly as an identity
 * dial does — and a foreign pair of edges too deep for the minimum kept
 * fraction clamps back (normalizeCrop), exactly how open-time
 * normalization treats an overlong fade. A crop that normalizes to all-zero
 * returns undefined: the caller stores no key.
 */
const asCrop = (value: unknown, path: string): Crop | undefined => {
  const raw = asRecord(value, path)
  const edge = (key: 'left' | 'right' | 'top' | 'bottom'): number | undefined => {
    if (raw[key] === undefined) return undefined
    const numeric = asFinite(raw[key], `${path}.${key}`)
    if (numeric < 0 || numeric >= 1) {
      throw new Error(`${path}.${key} must be a fraction at least 0 and below 1`)
    }
    return numeric
  }
  return normalizeCrop({
    left: edge('left'),
    right: edge('right'),
    top: edge('top'),
    bottom: edge('bottom'),
  })
}

/**
 * A stored background fill (#259): a known kind, and for `color` a storable
 * lowercase `#rrggbb` value — unknown kinds and malformed colors are
 * refused by name (silently dropping one would open the file rendering
 * differently from the build that wrote it). A stored `none` cannot occur
 * (absence means none), so any object here must be a real fill.
 */
const asBackgroundFill = (value: unknown, path: string): BackgroundFill => {
  const raw = asRecord(value, path)
  const kind = asString(raw.kind, `${path}.kind`)
  if (kind === 'blur') return { kind: 'blur' }
  if (kind !== 'color') throw new Error(`${path}.kind "${kind}" is not a background fill kind`)
  const color = asString(raw.color, `${path}.color`)
  const fill: BackgroundFill = { kind: 'color', color }
  if (!isValidBackgroundFillInput(fill)) {
    throw new Error(`${path}.color "${color}" is not a lowercase #rrggbb color`)
  }
  return fill
}

/**
 * A stored shape mask (#266): a known kind, and for `rounded` a radius in
 * (0, MAX_ROUNDED_RADIUS] — unknown kinds and out-of-range or non-finite
 * radii are refused by name (silently dropping one would open the file
 * rendering a different silhouette from the build that wrote it). A stored
 * `rectangle` cannot occur (absence means the rectangle), and neither can a
 * zero radius (it normalizes to absence), so any object here must be a real
 * mask.
 */
const asShapeMask = (value: unknown, path: string): ShapeMask => {
  const raw = asRecord(value, path)
  const kind = asString(raw.kind, `${path}.kind`)
  if (kind === 'ellipse') return { kind: 'ellipse' }
  if (kind !== 'rounded') throw new Error(`${path}.kind "${kind}" is not a shape mask kind`)
  const radius = asFinite(raw.radius, `${path}.radius`)
  if (radius <= 0 || radius > MAX_ROUNDED_RADIUS) {
    throw new Error(
      `${path}.radius must be within (0, ${MAX_ROUNDED_RADIUS}] of the rectangle's shorter side`,
    )
  }
  return { kind: 'rounded', radius }
}

/**
 * A stored default subtitle style (#250): the full style, every field
 * validated exactly as a text overlay's own (unknown font, malformed color,
 * and out-of-range numbers are refused by name — the same rules, because
 * they are the same fields). A foreign writer's style equal to the built-in
 * default normalizes away — the caller stores no key — exactly as a
 * zero-edge crop does (#255).
 */
const asSubtitleStyle = (value: unknown, path: string): SubtitleStyle | undefined => {
  const raw = asRecord(value, path)
  const font = asString(raw.font, `${path}.font`)
  if (!isTextFontId(font)) throw new Error(`${path}.font "${font}" is unknown`)
  const color = asString(raw.color, `${path}.color`)
  if (!isValidTextColor(color)) {
    throw new Error(`${path}.color "${color}" is not a lowercase #rrggbb color`)
  }
  const style: SubtitleStyle = {
    x: asFinite(raw.x, `${path}.x`),
    y: asFinite(raw.y, `${path}.y`),
    font,
    size: asFinite(raw.size, `${path}.size`),
    color,
    bold: asBoolean(raw.bold, `${path}.bold`),
    italic: asBoolean(raw.italic, `${path}.italic`),
  }
  for (const [field, fraction] of [
    ['x', style.x],
    ['y', style.y],
  ] as const) {
    if (fraction < 0 || fraction > 1) throw new Error(`${path}.${field} must be between 0 and 1`)
  }
  if (style.size < MIN_TEXT_SIZE || style.size > MAX_TEXT_SIZE) {
    throw new Error(`${path}.size must be between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE}`)
  }
  return normalizeSubtitleStyle(style)
}

/**
 * A stored canvas preset (#273): one of the known identifiers, or absent for
 * Auto. An unrecognized value is refused by name rather than ignored —
 * silently falling back to Auto would reshape the frame the file was built
 * against, which is the whole point of storing it.
 */
const asCanvasPreset = (value: unknown, path: string): CanvasPreset | undefined => {
  if (value === undefined) return undefined
  const preset = asString(value, path)
  if (!isCanvasPreset(preset)) throw new Error(`${path} "${preset}" is unknown`)
  return preset
}

function validateProject(document: Record<string, unknown>): Project {
  // Plugin dependencies (#197): absent in files saved before them, and in
  // plugin-free files since. Validated whatever the version — within a known
  // version unknown extra keys are ignored, but a present `plugins` key that
  // is malformed is a defect, not an unknown key.
  const plugins =
    document.plugins === undefined
      ? []
      : asArray(document.plugins, 'plugins').map((value, index) =>
          asString(value, `plugins[${index}]`),
        )
  const pluginIds = new Set<string>()
  for (const [index, id] of plugins.entries()) {
    if (pluginIds.has(id)) throw new Error(`plugins[${index}] "${id}" is duplicated`)
    pluginIds.add(id)
  }

  const clips = asArray(document.clips, 'clips').map((value, index) => {
    const raw = asRecord(value, `clips[${index}]`)
    // Absent in files saved before #101, whose clips are all videos.
    const kind = raw.kind === undefined ? 'video' : asMediaKind(raw.kind, `clips[${index}].kind`)
    const clip: ProjectClip = {
      id: asString(raw.id, `clips[${index}].id`),
      name: asString(raw.name, `clips[${index}].name`),
      // Images have no duration to store (#137): the key is absent in the
      // file and 0 in the model, matching what import probes for them.
      duration: kind === 'image' ? 0 : asFinite(raw.duration, `clips[${index}].duration`),
      kind,
    }
    if (kind !== 'image' && clip.duration <= 0) {
      throw new Error(`clips[${index}].duration must be greater than 0`)
    }
    if (raw.width !== undefined) clip.width = asPositiveInteger(raw.width, `clips[${index}].width`)
    if (raw.height !== undefined) {
      clip.height = asPositiveInteger(raw.height, `clips[${index}].height`)
    }
    if (raw.mimeType !== undefined) clip.mimeType = asString(raw.mimeType, `clips[${index}].mimeType`)
    if (raw.byteSize !== undefined) {
      clip.byteSize = asNonNegative(raw.byteSize, `clips[${index}].byteSize`)
    }
    if (raw.extractedFrom !== undefined) {
      clip.extractedFrom = asString(raw.extractedFrom, `clips[${index}].extractedFrom`)
    }
    return clip
  })
  const clipIds = new Set<string>()
  const clipKinds = new Map<string, MediaKind>()
  for (const [index, clip] of clips.entries()) {
    if (clipIds.has(clip.id)) throw new Error(`clips[${index}].id "${clip.id}" is duplicated`)
    clipIds.add(clip.id)
    clipKinds.set(clip.id, clip.kind)
  }

  const timelineRaw = asRecord(document.timeline, 'timeline')
  const entries = asArray(timelineRaw.entries, 'timeline.entries').map((value, index) => {
    const path = `timeline.entries[${index}]`
    const raw = asRecord(value, path)
    const entry: ProjectEntry = {
      id: asString(raw.id, `${path}.id`),
      // A slate entry (#143) carries a color instead of a clipId; the empty
      // string is the model's "references no clip", matching no real id.
      clipId: raw.color !== undefined && raw.clipId === undefined ? '' : asString(raw.clipId, `${path}.clipId`),
      name: asString(raw.name, `${path}.name`),
      duration: asFinite(raw.duration, `${path}.duration`),
      inPoint: asNonNegative(raw.inPoint, `${path}.inPoint`),
      outPoint: asFinite(raw.outPoint, `${path}.outPoint`),
    }
    if (entry.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
    if (raw.color !== undefined) {
      // Exactly one of clipId and color: an entry claiming to be both a
      // slate and a clip reference could only come from a foreign writer,
      // and either reading would silently drop half its meaning.
      if (raw.clipId !== undefined) {
        throw new Error(`${path} carries both a clipId and a color — an entry is a clip reference or a slate, never both`)
      }
      const color = asString(raw.color, `${path}.color`)
      if (!isValidSlateColor(color)) {
        throw new Error(`${path}.color "${color}" is not a lowercase #rrggbb color`)
      }
      entry.kind = 'slate'
      entry.color = color
    } else {
      if (!clipIds.has(entry.clipId)) {
        throw new Error(`${path}.clipId "${entry.clipId}" does not match any clip`)
      }
      const entryClipKind = clipKinds.get(entry.clipId) as MediaKind
      if (entryClipKind === 'audio') {
        // The sequence carries video and stills (#101/#140): an audio entry
        // here could only come from a foreign writer, and would break preview
        // and export — audio placement is the audio lane's model (#102).
        throw new Error(`${path}.clipId "${entry.clipId}" references an audio clip, but the sequence carries video and stills only`)
      }
      // Stillness is derived, never stored (#140): the file's entry shape is
      // unchanged, and any entry referencing an image clip is a still.
      if (entryClipKind === 'image') entry.kind = 'image'
    }
    if (entry.inPoint >= entry.outPoint) {
      throw new Error(`${path} trim range is empty (inPoint must be less than outPoint)`)
    }
    if (entry.outPoint > entry.duration) {
      throw new Error(`${path}.outPoint must not exceed the clip duration`)
    }
    // Gain fields (#104): absent in files saved before them, meaning full
    // volume and unmuted.
    if (raw.volume !== undefined) entry.volume = asVolume(raw.volume, `${path}.volume`)
    if (raw.muted !== undefined) entry.muted = asBoolean(raw.muted, `${path}.muted`)
    // Audio fades (#220): absent in files saved before them, and on every
    // fade-free entry since, meaning no fade. Stills and slates are
    // soundless — a fading one could only come from a foreign writer.
    if (raw.fadeIn !== undefined || raw.fadeOut !== undefined) {
      if (entry.kind !== undefined) {
        throw new Error(
          `${path} carries audio fades, but a ${entry.kind} entry is soundless — fades apply to video entries only`,
        )
      }
      if (raw.fadeIn !== undefined) entry.fadeIn = asNonNegative(raw.fadeIn, `${path}.fadeIn`)
      if (raw.fadeOut !== undefined) entry.fadeOut = asNonNegative(raw.fadeOut, `${path}.fadeOut`)
    }
    // Color adjustments (#192): absent in files saved before them, and on
    // every unadjusted entry since, meaning as-shot.
    if (raw.colorAdjustments !== undefined) {
      if (entry.kind === 'slate') {
        // A slate's color is set directly (#143): an adjusted slate could
        // only come from a foreign writer, and would store the intended
        // color two competing ways.
        throw new Error(
          `${path}.colorAdjustments is set on a slate entry, but color adjustments apply to video and image entries only`,
        )
      }
      const adjustments = asColorAdjustments(raw.colorAdjustments, `${path}.colorAdjustments`)
      if (adjustments !== undefined) entry.colorAdjustments = adjustments
    }
    // Orientation (#232): absent in files saved before it, and on every
    // unoriented entry since, meaning as shot.
    if (raw.orientation !== undefined) {
      if (entry.kind === 'slate') {
        // A flat color has no sideways: an oriented slate could only come
        // from a foreign writer.
        throw new Error(
          `${path}.orientation is set on a slate entry, but orientation applies to video and image entries only`,
        )
      }
      const orientation = asOrientation(raw.orientation, `${path}.orientation`)
      if (orientation !== undefined) entry.orientation = orientation
    }
    // Crop (#255): absent in files saved before it, and on every uncropped
    // entry since, meaning the whole frame.
    if (raw.crop !== undefined) {
      if (entry.kind === 'slate') {
        // A flat color has nothing to trim: a cropped slate could only come
        // from a foreign writer.
        throw new Error(
          `${path}.crop is set on a slate entry, but crop applies to video and image entries only`,
        )
      }
      const crop = asCrop(raw.crop, `${path}.crop`)
      if (crop !== undefined) entry.crop = crop
    }
    // Background fill (#259): absent in files saved before it, and on every
    // fill-free entry since, meaning none — today's black bars.
    if (raw.backgroundFill !== undefined) {
      if (entry.kind === 'slate') {
        // A slate fills its frame by construction: a filled slate could only
        // come from a foreign writer.
        throw new Error(
          `${path}.backgroundFill is set on a slate entry, but background fill applies to video and image entries only`,
        )
      }
      entry.backgroundFill = asBackgroundFill(raw.backgroundFill, `${path}.backgroundFill`)
    }
    // A shape mask is an overlay treatment (#266): on a sequence entry it
    // could only come from a foreign writer — refuse it by name rather than
    // silently dropping what that writer meant to render.
    if (raw.shapeMask !== undefined) {
      throw new Error(
        `${path}.shapeMask is set on a sequence entry, but shape masks apply to video overlays only`,
      )
    }
    return entry
  })
  const entryIds = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (entryIds.has(entry.id)) {
      throw new Error(`timeline.entries[${index}].id "${entry.id}" is duplicated`)
    }
    entryIds.add(entry.id)
  }

  const validTypes: readonly string[] = TRANSITION_TYPES
  const boundaries = new Set<string>()
  const transitions = asArray(timelineRaw.transitions ?? [], 'timeline.transitions').map(
    (value, index) => {
      const path = `timeline.transitions[${index}]`
      const raw = asRecord(value, path)
      const type = asString(raw.type, `${path}.type`)
      if (!validTypes.includes(type)) throw new Error(`${path}.type "${type}" is unknown`)
      const transition: TimelineTransition = {
        beforeId: asString(raw.beforeId, `${path}.beforeId`),
        afterId: asString(raw.afterId, `${path}.afterId`),
        type: type as TransitionType,
        duration: asFinite(raw.duration, `${path}.duration`),
      }
      if (transition.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
      for (const [field, id] of [
        ['beforeId', transition.beforeId],
        ['afterId', transition.afterId],
      ] as const) {
        if (!entryIds.has(id)) {
          throw new Error(`${path}.${field} "${id}" does not match any timeline entry`)
        }
      }
      const boundary = `${transition.beforeId} ${transition.afterId}`
      if (boundaries.has(boundary)) {
        throw new Error(`${path} duplicates the transition between "${transition.beforeId}" and "${transition.afterId}"`)
      }
      boundaries.add(boundary)
      return transition
    },
  )

  const zooms = asArray(timelineRaw.zooms ?? [], 'timeline.zooms').map((value, index) => {
    const path = `timeline.zooms[${index}]`
    const raw = asRecord(value, path)
    const zoom: ZoomEffect = {
      // Files written before zooms had identity (#129) carry no id: generate
      // a deterministic one — it only needs to be a unique in-session handle,
      // and determinism keeps the fixture round-trips exactly assertable.
      id: raw.id === undefined ? `zoom-${index + 1}` : asString(raw.id, `${path}.id`),
      entryId: asString(raw.entryId, `${path}.entryId`),
      start: asNonNegative(raw.start, `${path}.start`),
      rampIn: asNonNegative(raw.rampIn, `${path}.rampIn`),
      hold: asNonNegative(raw.hold, `${path}.hold`),
      rampOut: asNonNegative(raw.rampOut, `${path}.rampOut`),
      scale: asFinite(raw.scale, `${path}.scale`),
      centerX: asFinite(raw.centerX, `${path}.centerX`),
      centerY: asFinite(raw.centerY, `${path}.centerY`),
    }
    if (!entryIds.has(zoom.entryId)) {
      throw new Error(`${path}.entryId "${zoom.entryId}" does not match any timeline entry`)
    }
    if (zoom.scale <= 1) throw new Error(`${path}.scale must be greater than 1`)
    for (const [field, centre] of [
      ['centerX', zoom.centerX],
      ['centerY', zoom.centerY],
    ] as const) {
      if (centre < 0 || centre > 1) throw new Error(`${path}.${field} must be between 0 and 1`)
    }
    return zoom
  })
  // An entry may carry several zooms (#129); ids are what edits act on, so
  // they must be unique. Overlapping windows are not refused here — open-time
  // normalization resolves them, exactly as it resolves an overlong fade.
  const zoomIds = new Set<string>()
  for (const [index, zoom] of zooms.entries()) {
    if (zoomIds.has(zoom.id)) {
      throw new Error(`timeline.zooms[${index}].id "${zoom.id}" is duplicated`)
    }
    zoomIds.add(zoom.id)
  }

  // Time-remap effects (#138): absent in files saved before them, and in
  // remap-free files since. Window positions are range-checked here (finite,
  // non-negative, non-empty); fitting within the trimmed range is the
  // reducer's clamp, re-applied when the opened timeline is normalized —
  // exactly how zoom windows and audio fades are treated.
  const stillEntryIds = new Set(
    entries.filter((entry) => entry.kind !== undefined).map((entry) => entry.id),
  )
  const remaps = asArray(timelineRaw.remaps ?? [], 'timeline.remaps').map((value, index) => {
    const path = `timeline.remaps[${index}]`
    const raw = asRecord(value, path)
    const id = asString(raw.id, `${path}.id`)
    const entryId = asString(raw.entryId, `${path}.entryId`)
    if (!entryIds.has(entryId)) {
      throw new Error(`${path}.entryId "${entryId}" does not match any timeline entry`)
    }
    if (stillEntryIds.has(entryId)) {
      // A still's timing is its one settable duration (#140/#143): a remap
      // on one could only come from a foreign writer, and would store the
      // same on-screen length two competing ways.
      throw new Error(`${path}.entryId "${entryId}" references a still entry, but time remapping applies to video entries only`)
    }
    const kind = asString(raw.kind, `${path}.kind`)
    if (kind === 'pause') {
      const at = asNonNegative(raw.at, `${path}.at`)
      const hold = asFinite(raw.hold, `${path}.hold`)
      if (hold <= 0) throw new Error(`${path}.hold must be greater than 0`)
      return { id, entryId, kind: 'pause', at, hold } satisfies RemapEffect
    }
    if (kind === 'speed') {
      const start = asNonNegative(raw.start, `${path}.start`)
      const end = asFinite(raw.end, `${path}.end`)
      const factor = asFinite(raw.factor, `${path}.factor`)
      if (factor <= 0) throw new Error(`${path}.factor must be greater than 0`)
      if (start >= end) {
        throw new Error(`${path} source range is empty (start must be less than end)`)
      }
      return { id, entryId, kind: 'speed', start, end, factor } satisfies RemapEffect
    }
    throw new Error(`${path}.kind "${kind}" is unknown`)
  })
  const remapIds = new Set<string>()
  for (const [index, remap] of remaps.entries()) {
    if (remapIds.has(remap.id)) {
      throw new Error(`timeline.remaps[${index}].id "${remap.id}" is duplicated`)
    }
    remapIds.add(remap.id)
  }

  // Text overlays (#139): absent in files saved before them, and in
  // text-free files since. Continuous fields are range-checked here; an
  // unknown font or a malformed color is refused by name — silently
  // substituting either would change how the customer's title renders.
  const texts = asArray(timelineRaw.texts ?? [], 'timeline.texts').map((value, index) => {
    const path = `timeline.texts[${index}]`
    const raw = asRecord(value, path)
    const font = asString(raw.font, `${path}.font`)
    if (!isTextFontId(font)) throw new Error(`${path}.font "${font}" is unknown`)
    const color = asString(raw.color, `${path}.color`)
    if (!isValidTextColor(color)) {
      throw new Error(`${path}.color "${color}" is not a lowercase #rrggbb color`)
    }
    const text: TextOverlay = {
      id: asString(raw.id, `${path}.id`),
      content: asString(raw.content, `${path}.content`),
      offset: asNonNegative(raw.offset, `${path}.offset`),
      duration: asFinite(raw.duration, `${path}.duration`),
      x: asFinite(raw.x, `${path}.x`),
      y: asFinite(raw.y, `${path}.y`),
      font,
      size: asFinite(raw.size, `${path}.size`),
      color,
      bold: asBoolean(raw.bold, `${path}.bold`),
      italic: asBoolean(raw.italic, `${path}.italic`),
    }
    if (text.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
    for (const [field, fraction] of [
      ['x', text.x],
      ['y', text.y],
    ] as const) {
      if (fraction < 0 || fraction > 1) throw new Error(`${path}.${field} must be between 0 and 1`)
    }
    if (text.size < MIN_TEXT_SIZE || text.size > MAX_TEXT_SIZE) {
      throw new Error(`${path}.size must be between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE}`)
    }
    // Fades (#177): absent in files saved before them, meaning 0 (instant).
    // Range-checked here (finite, non-negative); fitting within the
    // overlay's duration is the reducer's clamp, re-applied when the opened
    // timeline is normalized — exactly the audio-track fade rule.
    if (raw.fadeIn !== undefined) text.fadeIn = asNonNegative(raw.fadeIn, `${path}.fadeIn`)
    if (raw.fadeOut !== undefined) text.fadeOut = asNonNegative(raw.fadeOut, `${path}.fadeOut`)
    // The subtitle-import marker (#249, schema version 11): absent means a
    // hand-made overlay. Only `true` is stored, so a foreign writer's
    // `subtitle: false` normalizes to absent on the next save.
    if (raw.subtitle !== undefined) {
      if (typeof raw.subtitle !== 'boolean') {
        throw new Error(`${path}.subtitle must be a boolean`)
      }
      if (raw.subtitle) text.subtitle = true
    }
    // Individually-overridden style fields (#250, schema version 13):
    // absent means the overlay follows the default subtitle style entirely.
    // Unknown field names are refused by name — silently dropping one would
    // let a later default edit clobber a value the user pinned. A foreign
    // writer's empty or unordered list normalizes to the canonical form.
    if (raw.styleOverrides !== undefined) {
      if (text.subtitle !== true) {
        throw new Error(
          `${path}.styleOverrides is set on a non-subtitle text overlay, but style overrides apply to imported subtitles only`,
        )
      }
      const fields = asArray(raw.styleOverrides, `${path}.styleOverrides`).map((value, fieldIndex) => {
        const field = asString(value, `${path}.styleOverrides[${fieldIndex}]`)
        if (!(SUBTITLE_STYLE_FIELDS as readonly string[]).includes(field)) {
          throw new Error(`${path}.styleOverrides[${fieldIndex}] "${field}" is not a subtitle style field`)
        }
        return field as SubtitleStyleField
      })
      const normalized = normalizeStyleOverrides(fields)
      if (normalized !== undefined) text.styleOverrides = normalized
    }
    return text
  })
  const textIds = new Set<string>()
  for (const [index, text] of texts.entries()) {
    if (textIds.has(text.id)) {
      throw new Error(`timeline.texts[${index}].id "${text.id}" is duplicated`)
    }
    textIds.add(text.id)
  }

  // The customized default subtitle style (#250, schema version 13): absent
  // in files saved before it, and in every never-customized file since,
  // meaning the built-in subtitle default.
  const subtitleStyle =
    timelineRaw.subtitleStyle === undefined
      ? undefined
      : asSubtitleStyle(timelineRaw.subtitleStyle, 'timeline.subtitleStyle')

  // The canvas preset (#273, schema version 16): absent in files saved
  // before it, and in every Auto file since, meaning the source-derived
  // frame rule (#176). Refused by name when unknown — a preset silently
  // dropped would reshape the project's frame without saying so.
  const canvasPreset = asCanvasPreset(timelineRaw.canvasPreset, 'timeline.canvasPreset')

  // Absent in files saved before #102, which carry no audio tracks.
  const trackIds = new Set<string>()
  const audioTracks = asArray(timelineRaw.audioTracks ?? [], 'timeline.audioTracks').map(
    (value, index) => {
      const path = `timeline.audioTracks[${index}]`
      const raw = asRecord(value, path)
      const track: ProjectAudioTrack = {
        id: asString(raw.id, `${path}.id`),
        clipId: asString(raw.clipId, `${path}.clipId`),
        name: asString(raw.name, `${path}.name`),
        duration: asFinite(raw.duration, `${path}.duration`),
        offset: asNonNegative(raw.offset, `${path}.offset`),
        inPoint: asNonNegative(raw.inPoint, `${path}.inPoint`),
        outPoint: asFinite(raw.outPoint, `${path}.outPoint`),
      }
      if (track.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
      if (!clipIds.has(track.clipId)) {
        throw new Error(`${path}.clipId "${track.clipId}" does not match any clip`)
      }
      const trackClipKind = clipKinds.get(track.clipId) as MediaKind
      if (trackClipKind !== 'audio') {
        // Audio tracks carry audio clips only (#102): a video clip's audio
        // stays bound to its sequence entry, and an image has none.
        throw new Error(`${path}.clipId "${track.clipId}" references ${describeKind(trackClipKind)} clip, but audio tracks carry audio only`)
      }
      if (track.inPoint >= track.outPoint) {
        throw new Error(`${path} trim range is empty (inPoint must be less than outPoint)`)
      }
      if (track.outPoint > track.duration) {
        throw new Error(`${path}.outPoint must not exceed the clip duration`)
      }
      // Gain fields (#104): absent means full volume, no fades. Fades are
      // range-checked here (finite, non-negative); fitting within the
      // trimmed length is the reducer's clamp, re-applied when the opened
      // timeline is normalized — a foreign writer's overlong fade is
      // shortened on open, exactly as a retrim would shorten it in-app.
      if (raw.volume !== undefined) track.volume = asVolume(raw.volume, `${path}.volume`)
      if (raw.fadeIn !== undefined) track.fadeIn = asNonNegative(raw.fadeIn, `${path}.fadeIn`)
      if (raw.fadeOut !== undefined) track.fadeOut = asNonNegative(raw.fadeOut, `${path}.fadeOut`)
      // Ducking (#241, schema version 10): absent means off. Only `true` is
      // stored, so a foreign writer's `duck: false` normalizes to absent on
      // the next save; the level is meaningless (and dropped) without it.
      if (raw.duck !== undefined) {
        if (typeof raw.duck !== 'boolean') {
          throw new Error(`${path}.duck must be a boolean`)
        }
        if (raw.duck) {
          track.duck = true
          if (raw.duckLevel !== undefined) {
            track.duckLevel = asVolume(raw.duckLevel, `${path}.duckLevel`)
          }
        }
      }
      if (trackIds.has(track.id)) {
        throw new Error(`${path}.id "${track.id}" is duplicated`)
      }
      trackIds.add(track.id)
      return track
    },
  )

  // Overlay video layers (#145): absent in files saved before them, and in
  // overlay-free files since. Trim and rectangle are range-checked here so a
  // foreign file cannot smuggle in an unplayable or off-frame overlay;
  // the reducer's clamp is re-applied when the opened timeline is
  // normalized, as for every other effect.
  const overlayIds = new Set<string>()
  const videoOverlays = asArray(timelineRaw.videoOverlays ?? [], 'timeline.videoOverlays').map(
    (value, index) => {
      const path = `timeline.videoOverlays[${index}]`
      const raw = asRecord(value, path)
      // A still overlay (#294) declares its kind; a video overlay writes no
      // key, so files from before image overlays parse exactly as before.
      if (raw.kind !== undefined && raw.kind !== 'image') {
        throw new Error(`${path}.kind must be "image" when present`)
      }
      const isImage = raw.kind === 'image'
      const overlay: ProjectVideoOverlay = {
        id: asString(raw.id, `${path}.id`),
        ...(isImage ? { kind: 'image' as const } : {}),
        clipId: asString(raw.clipId, `${path}.clipId`),
        name: asString(raw.name, `${path}.name`),
        duration: asFinite(raw.duration, `${path}.duration`),
        offset: asNonNegative(raw.offset, `${path}.offset`),
        inPoint: asNonNegative(raw.inPoint, `${path}.inPoint`),
        outPoint: asFinite(raw.outPoint, `${path}.outPoint`),
        x: asNonNegative(raw.x, `${path}.x`),
        y: asNonNegative(raw.y, `${path}.y`),
        width: asFinite(raw.width, `${path}.width`),
        height: asFinite(raw.height, `${path}.height`),
      }
      if (overlay.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
      if (!clipIds.has(overlay.clipId)) {
        throw new Error(`${path}.clipId "${overlay.clipId}" does not match any clip`)
      }
      const overlayClipKind = clipKinds.get(overlay.clipId) as MediaKind
      const expectedClipKind = isImage ? 'image' : 'video'
      if (overlayClipKind !== expectedClipKind) {
        // An overlay layer carries a picture — video (#145) or a still
        // (#294) — and each kind carries its own: audio has none at all.
        throw new Error(`${path}.clipId "${overlay.clipId}" references ${describeKind(overlayClipKind)} clip, but ${isImage ? 'image overlay layers carry images only' : 'overlay layers carry video only'}`)
      }
      if (isImage) {
        // A still is soundless (#294/#220). A file carrying an audio field on
        // an image overlay is refused BY NAME rather than quietly dropped —
        // it means the writer disagreed with the model, and silently loading
        // a fraction of what the file says is how corruption hides.
        const forbidden = forbiddenImageOverlayField(raw)
        if (forbidden !== undefined) {
          throw new Error(`${path}.${forbidden} is not allowed on an image overlay: a still has no audio`)
        }
        // Its window is offset + duration; the stored trim is the whole
        // still, exactly as a still entry's is (#140).
        if (overlay.inPoint !== 0 || overlay.outPoint !== overlay.duration) {
          throw new Error(`${path} window must be the whole still (inPoint 0, outPoint equal to the duration)`)
        }
      } else {
        if (overlay.inPoint >= overlay.outPoint) {
          throw new Error(`${path} trim range is empty (inPoint must be less than outPoint)`)
        }
        if (overlay.outPoint > overlay.duration) {
          throw new Error(`${path}.outPoint must not exceed the clip duration`)
        }
      }
      for (const [field, size] of [
        ['width', overlay.width],
        ['height', overlay.height],
      ] as const) {
        if (size <= 0 || size > 1) throw new Error(`${path}.${field} must be within (0, 1]`)
      }
      for (const [field, edge] of [
        ['x', overlay.x + overlay.width],
        ['y', overlay.y + overlay.height],
      ] as const) {
        if (edge > 1) {
          throw new Error(`${path}.${field} places the rectangle beyond the frame edge`)
        }
      }
      // Audio belongs to video overlays only — an image overlay carrying any
      // of it was already refused by name above.
      if (raw.volume !== undefined) overlay.volume = asVolume(raw.volume, `${path}.volume`)
      if (raw.muted !== undefined) overlay.muted = asBoolean(raw.muted, `${path}.muted`)
      // Audio fades (#220): absent in files saved before them, and on every
      // fade-free overlay since, meaning no fade.
      if (raw.fadeIn !== undefined) overlay.fadeIn = asNonNegative(raw.fadeIn, `${path}.fadeIn`)
      if (raw.fadeOut !== undefined) {
        overlay.fadeOut = asNonNegative(raw.fadeOut, `${path}.fadeOut`)
      }
      // Color adjustments (#192), exactly as on a sequence entry.
      if (raw.colorAdjustments !== undefined) {
        const adjustments = asColorAdjustments(raw.colorAdjustments, `${path}.colorAdjustments`)
        if (adjustments !== undefined) overlay.colorAdjustments = adjustments
      }
      // Orientation (#232), exactly as on a sequence entry.
      if (raw.orientation !== undefined) {
        const orientation = asOrientation(raw.orientation, `${path}.orientation`)
        if (orientation !== undefined) overlay.orientation = orientation
      }
      // Crop (#255), exactly as on a sequence entry.
      if (raw.crop !== undefined) {
        const crop = asCrop(raw.crop, `${path}.crop`)
        if (crop !== undefined) overlay.crop = crop
      }
      // Shape mask (#266): absent in files saved before it, and on every
      // mask-free overlay since, meaning the hard rectangle.
      if (raw.shapeMask !== undefined) {
        overlay.shapeMask = asShapeMask(raw.shapeMask, `${path}.shapeMask`)
      }
      if (overlayIds.has(overlay.id)) {
        throw new Error(`${path}.id "${overlay.id}" is duplicated`)
      }
      overlayIds.add(overlay.id)
      return overlay
    },
  )

  return {
    clips,
    timeline: {
      entries,
      transitions,
      zooms,
      // Present exactly when the file carried effects, mirroring the
      // serializer and TimelineState (see the ProjectTimeline field).
      ...(remaps.length === 0 ? {} : { remaps }),
      ...(texts.length === 0 ? {} : { texts }),
      ...(subtitleStyle === undefined ? {} : { subtitleStyle }),
      ...(canvasPreset === undefined ? {} : { canvasPreset }),
      audioTracks,
      ...(videoOverlays.length === 0 ? {} : { videoOverlays }),
    },
    ...(plugins.length === 0 ? {} : { plugins }),
  }
}

/**
 * Validates a version-2 file's embedded media against its clips: exact
 * coverage (no clip without bytes, no bytes for an unknown clip), valid
 * base64, and the declared byteLength + crc32 matching what actually
 * decoded — a truncated or mutated payload is refused by name, never
 * half-opened (#97).
 */
function validateMedia(
  document: Record<string, unknown>,
  clips: readonly ProjectClip[],
): Map<string, ClipMedia> {
  if (document.media === undefined) {
    throw new Error(
      'this file declares embedded media (schema version 2) but the "media" section is missing',
    )
  }
  const mediaRaw = asRecord(document.media, 'media')
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]))
  for (const clipId of Object.keys(mediaRaw)) {
    if (!clipsById.has(clipId)) {
      throw new Error(`media["${clipId}"] does not match any clip`)
    }
  }
  const media = new Map<string, ClipMedia>()
  for (const clip of clips) {
    const path = `media["${clip.id}"]`
    if (mediaRaw[clip.id] === undefined) {
      throw new Error(`media is missing the bytes for clip "${clip.id}" ("${clip.name}")`)
    }
    const raw = asRecord(mediaRaw[clip.id], path)
    const byteLength = asNonNegative(raw.byteLength, `${path}.byteLength`)
    if (!Number.isInteger(byteLength)) throw new Error(`${path}.byteLength must be an integer`)
    const crc32 = typeof raw.crc32 === 'string' ? raw.crc32 : null
    if (crc32 === null || !/^[0-9a-f]{8}$/.test(crc32)) {
      throw new Error(`${path}.crc32 must be an 8-digit lowercase hex string`)
    }
    if (typeof raw.data !== 'string') throw new Error(`${path}.data must be a string`)
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = decodeBase64(raw.data)
    } catch {
      throw new Error(`${path}.data is not valid base64`)
    }
    if (bytes.length !== byteLength) {
      throw new Error(
        `${path} is truncated: it declares ${byteLength} bytes but ${bytes.length} decoded`,
      )
    }
    if (crc32Hex(bytes) !== crc32) {
      throw new Error(
        `${path} failed its integrity check (crc32 mismatch) — the embedded media for "${clip.name}" is damaged`,
      )
    }
    const entry: ClipMedia = { bytes }
    if (raw.mimeType !== undefined) entry.mimeType = asString(raw.mimeType, `${path}.mimeType`)
    media.set(clip.id, entry)
  }
  return media
}

/**
 * CRC-32 (the gzip/zlib polynomial) of the decoded media bytes, as 8 hex
 * digits. Not cryptographic — it guards against damage, not adversaries:
 * the whole file's gzip CRC already catches on-disk corruption, so this
 * exists to catch a payload mangled before compression (a buggy or
 * hand-edited writer) and name the clip it belongs to.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32Hex(bytes: Uint8Array): string {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

/** Chunked so large media never builds a fromCharCode argument list. */
function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)))
  }
  return btoa(parts.join(''))
}

/** Throws (from atob) on input that is not base64. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Runs bytes through a Compression/DecompressionStream. The write side's
 * rejections are collected rather than awaited up front so that a corrupt
 * input surfaces once, as the read loop's error, never as an unhandled
 * rejection.
 */
async function throughStream(
  bytes: Uint8Array<ArrayBuffer>,
  transform: {
    readable: ReadableStream<Uint8Array<ArrayBuffer>>
    writable: WritableStream<BufferSource>
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter()
  const writes = Promise.allSettled([writer.write(bytes), writer.close()])
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = transform.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await writes
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const gzip = (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  throughStream(bytes, new CompressionStream('gzip'))

const gunzip = (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  throughStream(bytes, new DecompressionStream('gzip'))
