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
  videoOverlaysOf,
  zoomsOf,
} from './timeline'
import type { TextOverlay } from './textOverlay'
import type { VideoOverlay } from './videoOverlay'
import { isTextFontId, isValidTextColor, MAX_TEXT_SIZE, MIN_TEXT_SIZE } from './textOverlay'

/**
 * The project file format (#75): everything needed to reopen a project and
 * continue editing. The file is the gzip of a JSON document:
 *
 *   {
 *     "format": PROJECT_FORMAT,          // magic — rejects arbitrary gzips
 *     "schemaVersion": 1 | 2 | 3 | 4 | 5 | 6, // integer; bumped on breaking change
 *     "plugins": ["gif-export"],         // version 6: plugin dependencies (#197)
 *     "clips": [{ id, name, duration?, kind?, width?, height?,
 *                 mimeType?, byteSize?, extractedFrom? }],
 *     "media": {                         // version 2 always; version 3 when
 *       [clipId]: { byteLength, crc32, mimeType?, data }   // embedding (#97)
 *     },
 *     "timeline": {
 *       "entries": [{ id, clipId, name, duration, inPoint, outPoint,
 *                     volume?, muted? }],
 *       "transitions": [{ beforeId, afterId, type, duration }],
 *       "zooms": [{ id?, entryId, start, rampIn, hold, rampOut, scale,
 *                   centerX, centerY }],
 *       "remaps": [{ id, entryId, kind: "speed", start, end, factor } |
 *                  { id, entryId, kind: "pause", at, hold }],   // (#138)
 *       "texts": [{ id, content, offset, duration, x, y, font, size,
 *                   color, bold, italic,
 *                   fadeIn?, fadeOut? }],                       // (#139, #177)
 *       "audioTracks": [{ id, clipId, name, duration, offset,
 *                         inPoint, outPoint, volume?, fadeIn?, fadeOut? }],
 *       "videoOverlays": [{ id, clipId, name, duration, offset, inPoint,
 *                           outPoint, x, y, width, height,
 *                           volume?, muted? }]                  // (#145)
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
export const PROJECT_SCHEMA_VERSION = 6
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
  // A plugin dependency forces version 6 (#197), a color slate version 5
  // (#143), an image on the timeline version 4 (#140), an image merely in
  // the library version 3 (#137), whichever the save mode; otherwise the
  // mode alone decides, exactly as before images existed.
  const clipKindById = new Map(library.clips.map((clip) => [clip.id, clip.kind]))
  const hasSlateEntries = timeline.entries.some(isSlateEntry)
  const hasImageEntries = timeline.entries.some(
    (entry) => clipKindById.get(entry.clipId) === 'image',
  )
  const hasImages = library.clips.some((clip) => clip.kind === 'image')
  const document = {
    format: PROJECT_FORMAT,
    schemaVersion:
      plugins.length > 0
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
        ({ id, clipId, name, duration, inPoint, outPoint, kind, color, volume, muted }) => ({
          id,
          ...(kind === 'slate' ? {} : { clipId }),
          name,
          duration,
          inPoint,
          outPoint,
          ...(kind === 'slate' ? { color } : {}),
          ...(volume === undefined ? {} : { volume }),
          ...(muted === undefined ? {} : { muted }),
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
              ({ id, content, offset, duration, x, y, font, size, color, bold, italic, fadeIn, fadeOut }) => ({
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
              }),
            ),
          }),
      audioTracks: audioTracksOf(timeline).map(
        ({ id, clipId, name, duration, offset, inPoint, outPoint, volume, fadeIn, fadeOut }) => ({
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
        }),
      ),
      // Overlay video layers (#145) are written only while any exist, so
      // overlay-free projects stay byte-identical to earlier output —
      // additive within the schema version, like remaps and texts.
      ...(videoOverlaysOf(timeline).length === 0
        ? {}
        : {
            videoOverlays: videoOverlaysOf(timeline).map(
              ({ id, clipId, name, duration, offset, inPoint, outPoint, x, y, width, height, volume, muted }) => ({
                id,
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
    return text
  })
  const textIds = new Set<string>()
  for (const [index, text] of texts.entries()) {
    if (textIds.has(text.id)) {
      throw new Error(`timeline.texts[${index}].id "${text.id}" is duplicated`)
    }
    textIds.add(text.id)
  }

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
      const overlay: ProjectVideoOverlay = {
        id: asString(raw.id, `${path}.id`),
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
      if (overlayClipKind !== 'video') {
        // Overlay layers carry video clips only (#145): audio has no
        // picture, and a still overlay would be a different feature.
        throw new Error(`${path}.clipId "${overlay.clipId}" references ${describeKind(overlayClipKind)} clip, but overlay layers carry video only`)
      }
      if (overlay.inPoint >= overlay.outPoint) {
        throw new Error(`${path} trim range is empty (inPoint must be less than outPoint)`)
      }
      if (overlay.outPoint > overlay.duration) {
        throw new Error(`${path}.outPoint must not exceed the clip duration`)
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
      if (raw.volume !== undefined) overlay.volume = asVolume(raw.volume, `${path}.volume`)
      if (raw.muted !== undefined) overlay.muted = asBoolean(raw.muted, `${path}.muted`)
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
