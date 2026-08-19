import type { MediaLibraryState } from './mediaLibrary'
import { TRANSITION_TYPES } from './timeline'
import type {
  TimelineEntry,
  TimelineState,
  TimelineTransition,
  TransitionType,
  ZoomEffect,
} from './timeline'
import { transitionsOf, zoomsOf } from './timeline'

/**
 * The project file format (#75): everything needed to reopen a project and
 * continue editing, EXCEPT the video data itself. The customer asked for the
 * file to be "as small as it can reasonably be" (#71), so clips are stored as
 * metadata to re-link against on open (slice 3/3), never embedded. The file
 * is the gzip of a JSON document:
 *
 *   {
 *     "format": PROJECT_FORMAT,          // magic — rejects arbitrary gzips
 *     "schemaVersion": 1,                // integer; bumped on breaking change
 *     "clips": [{ id, name, duration, mimeType?, byteSize? }],
 *     "timeline": {
 *       "entries": [{ id, clipId, name, duration, inPoint, outPoint }],
 *       "transitions": [{ beforeId, afterId, type, duration }],
 *       "zooms": [{ entryId, start, rampIn, hold, rampOut, scale,
 *                   centerX, centerY }]
 *     }
 *   }
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
export const PROJECT_SCHEMA_VERSION = 1

/**
 * A library clip as stored in a project file: metadata for re-linking, not
 * media. `mimeType` and `byteSize` are optional — the format preserves them
 * for re-link matching whenever the library model knows them, and files
 * written before it did simply omit them.
 */
export interface ProjectClip {
  id: string
  name: string
  duration: number
  mimeType?: string
  byteSize?: number
}

/**
 * A timeline entry as stored: everything but `url`, which is a runtime
 * object-URL binding that cannot outlive the session. Opening a project
 * (slice 3/3) reconstructs urls by re-linking clips and joining on `clipId`.
 */
export type ProjectEntry = Omit<TimelineEntry, 'url'>

/** The editing state a project file carries. Lists are always present. */
export interface ProjectTimeline {
  entries: ProjectEntry[]
  transitions: TimelineTransition[]
  zooms: ZoomEffect[]
}

export interface Project {
  clips: ProjectClip[]
  timeline: ProjectTimeline
}

/**
 * Deserialization never throws for bad input — a project file comes from
 * outside the program and being unreadable is an expected outcome, reported
 * as a value with a human-readable reason.
 */
export type DeserializeResult = { ok: true; project: Project } | { ok: false; error: string }

/**
 * Serializes the current library + timeline into project-file bytes.
 * Import failures (transient UI state) are not part of a project. Throws
 * only on programmer error: a timeline entry referencing a clip that is not
 * in the library would produce a file our own deserializer refuses, so it
 * is rejected here, at the source.
 */
export async function serializeProject(
  library: MediaLibraryState,
  timeline: TimelineState,
): Promise<Uint8Array<ArrayBuffer>> {
  const clipIds = new Set(library.clips.map((clip) => clip.id))
  for (const entry of timeline.entries) {
    if (!clipIds.has(entry.clipId)) {
      throw new Error(
        `cannot serialize: timeline entry "${entry.id}" references clip "${entry.clipId}" which is not in the library`,
      )
    }
  }
  const document = {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    clips: library.clips.map(({ id, name, duration }) => ({ id, name, duration })),
    timeline: {
      entries: timeline.entries.map(({ id, clipId, name, duration, inPoint, outPoint }) => ({
        id,
        clipId,
        name,
        duration,
        inPoint,
        outPoint,
      })),
      transitions: transitionsOf(timeline).map(({ beforeId, afterId, type, duration }) => ({
        beforeId,
        afterId,
        type,
        duration,
      })),
      zooms: zoomsOf(timeline).map(
        ({ entryId, start, rampIn, hold, rampOut, scale, centerX, centerY }) => ({
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
    return { ok: true, project: validateProject(parsed) }
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

function validateProject(document: Record<string, unknown>): Project {
  const clips = asArray(document.clips, 'clips').map((value, index) => {
    const raw = asRecord(value, `clips[${index}]`)
    const clip: ProjectClip = {
      id: asString(raw.id, `clips[${index}].id`),
      name: asString(raw.name, `clips[${index}].name`),
      duration: asFinite(raw.duration, `clips[${index}].duration`),
    }
    if (clip.duration <= 0) throw new Error(`clips[${index}].duration must be greater than 0`)
    if (raw.mimeType !== undefined) clip.mimeType = asString(raw.mimeType, `clips[${index}].mimeType`)
    if (raw.byteSize !== undefined) {
      clip.byteSize = asNonNegative(raw.byteSize, `clips[${index}].byteSize`)
    }
    return clip
  })
  const clipIds = new Set<string>()
  for (const [index, clip] of clips.entries()) {
    if (clipIds.has(clip.id)) throw new Error(`clips[${index}].id "${clip.id}" is duplicated`)
    clipIds.add(clip.id)
  }

  const timelineRaw = asRecord(document.timeline, 'timeline')
  const entries = asArray(timelineRaw.entries, 'timeline.entries').map((value, index) => {
    const path = `timeline.entries[${index}]`
    const raw = asRecord(value, path)
    const entry: ProjectEntry = {
      id: asString(raw.id, `${path}.id`),
      clipId: asString(raw.clipId, `${path}.clipId`),
      name: asString(raw.name, `${path}.name`),
      duration: asFinite(raw.duration, `${path}.duration`),
      inPoint: asNonNegative(raw.inPoint, `${path}.inPoint`),
      outPoint: asFinite(raw.outPoint, `${path}.outPoint`),
    }
    if (entry.duration <= 0) throw new Error(`${path}.duration must be greater than 0`)
    if (!clipIds.has(entry.clipId)) {
      throw new Error(`${path}.clipId "${entry.clipId}" does not match any clip`)
    }
    if (entry.inPoint >= entry.outPoint) {
      throw new Error(`${path} trim range is empty (inPoint must be less than outPoint)`)
    }
    if (entry.outPoint > entry.duration) {
      throw new Error(`${path}.outPoint must not exceed the clip duration`)
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

  const zoomedEntries = new Set<string>()
  const zooms = asArray(timelineRaw.zooms ?? [], 'timeline.zooms').map((value, index) => {
    const path = `timeline.zooms[${index}]`
    const raw = asRecord(value, path)
    const zoom: ZoomEffect = {
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
    if (zoomedEntries.has(zoom.entryId)) {
      throw new Error(`${path} duplicates the zoom on entry "${zoom.entryId}"`)
    }
    zoomedEntries.add(zoom.entryId)
    return zoom
  })

  return { clips, timeline: { entries, transitions, zooms } }
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
