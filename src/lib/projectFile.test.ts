import { describe, expect, it } from 'vitest'
import fixtureV1Base64 from './fixtures/project-v1.bvep.base64?raw'
import fixtureV2Base64 from './fixtures/project-v2-embedded.bvep.base64?raw'
import fixtureV1AudioBase64 from './fixtures/project-v1-audio-tracks.bvep.base64?raw'
import fixtureV1GainBase64 from './fixtures/project-v1-gain.bvep.base64?raw'
import fixtureV3ImageReferencesBase64 from './fixtures/project-v3-image-references.bvep.base64?raw'
import fixtureV3ImageEmbeddedBase64 from './fixtures/project-v3-image-embedded.bvep.base64?raw'
import fixtureV4ImageEntryReferencesBase64 from './fixtures/project-v4-image-entry-references.bvep.base64?raw'
import fixtureV4ImageEntryEmbeddedBase64 from './fixtures/project-v4-image-entry-embedded.bvep.base64?raw'
import fixtureV5SlateReferencesBase64 from './fixtures/project-v5-slate-references.bvep.base64?raw'
import fixtureV5SlateEmbeddedBase64 from './fixtures/project-v5-slate-embedded.bvep.base64?raw'
import fixtureV6PluginsReferencesBase64 from './fixtures/project-v6-plugins-references.bvep.base64?raw'
import fixtureV7ColorReferencesBase64 from './fixtures/project-v7-color-adjustments-references.bvep.base64?raw'
import fixtureV8FadesReferencesBase64 from './fixtures/project-v8-audio-fades-references.bvep.base64?raw'
import fixtureV9OrientationReferencesBase64 from './fixtures/project-v9-orientation-references.bvep.base64?raw'
import fixtureV10DuckingReferencesBase64 from './fixtures/project-v10-ducking-references.bvep.base64?raw'
import fixtureV11SubtitleReferencesBase64 from './fixtures/project-v11-subtitle-references.bvep.base64?raw'
import fixtureV12CropReferencesBase64 from './fixtures/project-v12-crop-references.bvep.base64?raw'
import fixtureV13SubtitleStyleReferencesBase64 from './fixtures/project-v13-subtitle-style-references.bvep.base64?raw'
import fixtureV14BackgroundFillReferencesBase64 from './fixtures/project-v14-background-fill-references.bvep.base64?raw'
import fixtureV15ShapeMaskReferencesBase64 from './fixtures/project-v15-shape-mask-references.bvep.base64?raw'
import fixtureV16CanvasPresetReferencesBase64 from './fixtures/project-v16-canvas-preset-references.bvep.base64?raw'
import fixtureV17ImageOverlayReferencesBase64 from './fixtures/project-v17-image-overlay-references.bvep.base64?raw'
import type { MediaLibraryState } from './mediaLibrary'
import { timelineReducer } from './timeline'
import type { TimelineState } from './timeline'
import type { TextOverlay } from './textOverlay'
import {
  AUDIO_FADES_SCHEMA_VERSION,
  DUCKING_SCHEMA_VERSION,
  SUBTITLE_SCHEMA_VERSION,
  CROP_SCHEMA_VERSION,
  SUBTITLE_STYLE_SCHEMA_VERSION,
  BACKGROUND_FILL_SCHEMA_VERSION,
  CANVAS_PRESET_SCHEMA_VERSION,
  IMAGE_OVERLAYS_SCHEMA_VERSION,
  SHAPE_MASK_SCHEMA_VERSION,
  COLOR_ADJUSTMENTS_SCHEMA_VERSION,
  ORIENTATION_SCHEMA_VERSION,
  EMBEDDED_SCHEMA_VERSION,
  IMAGE_ENTRIES_SCHEMA_VERSION,
  IMAGES_SCHEMA_VERSION,
  SLATE_ENTRIES_SCHEMA_VERSION,
  PLUGINS_SCHEMA_VERSION,
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  REFERENCES_SCHEMA_VERSION,
  deserializeProject,
  serializeProject,
} from './projectFile'
import type { ClipMedia, Project } from './projectFile'

/** Gzips a JSON document the way the serializer does, to craft bad files. */
async function gzipJson(document: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const stream = new CompressionStream('gzip')
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const library: MediaLibraryState = {
  clips: [
    { id: 'c1', name: 'holiday.mp4', duration: 12.375, url: 'blob:session/c1', kind: 'video' },
    { id: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2', kind: 'video' },
  ],
  failures: [{ id: 'f1', name: 'broken.avi', reason: 'not decodable' }],
}

// A non-trivial editing state: the same clip used twice, trims, transitions
// of several types (including a #80 direction), and a zoom.
const timeline: TimelineState = {
  entries: [
    { id: 'e1', clipId: 'c1', name: 'holiday.mp4', duration: 12.375, url: 'blob:session/c1', inPoint: 0.5, outPoint: 9 },
    { id: 'e2', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2', inPoint: 0, outPoint: 4 },
    { id: 'e3', clipId: 'c1', name: 'holiday.mp4', duration: 12.375, url: 'blob:session/c1', inPoint: 2, outPoint: 3.25 },
  ],
  transitions: [
    { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
    { beforeId: 'e2', afterId: 'e3', type: 'slide-from-left', duration: 0.5 },
  ],
  zooms: [
    { id: 'z1', entryId: 'e2', start: 0.5, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.25, centerY: 0.5 },
  ],
}

/** What deserializing a file written from `library` + `timeline` yields. */
const expectedProject: Project = {
  clips: [
    { id: 'c1', name: 'holiday.mp4', duration: 12.375, kind: 'video' },
    { id: 'c2', name: 'city.webm', duration: 4, kind: 'video' },
  ],
  timeline: {
    entries: [
      { id: 'e1', clipId: 'c1', name: 'holiday.mp4', duration: 12.375, inPoint: 0.5, outPoint: 9 },
      { id: 'e2', clipId: 'c2', name: 'city.webm', duration: 4, inPoint: 0, outPoint: 4 },
      { id: 'e3', clipId: 'c1', name: 'holiday.mp4', duration: 12.375, inPoint: 2, outPoint: 3.25 },
    ],
    transitions: timeline.transitions!,
    zooms: timeline.zooms!,
    audioTracks: [],
  },
}

/**
 * What deserializing the committed fixtures yields: they were written before
 * zooms had identity (#129), so the validator generates the deterministic
 * `zoom-1` for their single id-less zoom.
 */
const fixtureExpectedProject: Project = {
  ...expectedProject,
  timeline: {
    ...expectedProject.timeline,
    zooms: [{ ...expectedProject.timeline.zooms[0], id: 'zoom-1' }],
  },
}

/** A structurally valid references-only document to mutate one field at a time. */
const validDocument = () => ({
  format: PROJECT_FORMAT,
  schemaVersion: REFERENCES_SCHEMA_VERSION,
  clips: structuredClone(expectedProject.clips),
  timeline: structuredClone(expectedProject.timeline),
})

/**
 * Deterministic media-like bytes: high-entropy (so the size test measures
 * the honest incompressible case) yet reproducible, so the committed v2
 * fixture's expected bytes can be re-derived here forever.
 */
function pseudoRandomBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0
  for (let index = 0; index < length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0
    bytes[index] = state >>> 24
  }
  return bytes
}

/** The media used by embedded-serialization tests and the v2 fixture. */
const fixtureMedia = (): Map<string, ClipMedia> =>
  new Map([
    ['c1', { bytes: pseudoRandomBytes(2048, 1), mimeType: 'video/mp4' }],
    ['c2', { bytes: pseudoRandomBytes(1024, 2), mimeType: 'video/webm' }],
  ])

/** Decompresses a project file back to its JSON document, for inspection. */
async function gunzipJson(bytes: Uint8Array<ArrayBuffer>): Promise<Record<string, unknown>> {
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  let json = ''
  const decoder = new TextDecoder()
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    json += decoder.decode(value, { stream: true })
  }
  return JSON.parse(json) as Record<string, unknown>
}

async function expectRefusal(bytes: Uint8Array<ArrayBuffer>, ...mentions: string[]) {
  const result = await deserializeProject(bytes)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    for (const mention of mentions) expect(result.error).toContain(mention)
  }
}

describe('project file round-trip', () => {
  it('reproduces clips, trims, transitions, and zooms exactly', async () => {
    const bytes = await serializeProject(library, timeline)
    const result = await deserializeProject(bytes)
    expect(result).toEqual({ ok: true, project: expectedProject })
  })

  it('a duplicated entry survives save → open with its settings and cloned zoom (#314)', async () => {
    const duplicated = timelineReducer(timeline, {
      type: 'element-duplicated',
      kind: 'entry',
      id: 'e2',
      newId: 'e2-copy',
    })
    const result = await deserializeProject(await serializeProject(library, duplicated))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.timeline.entries.map(({ id }) => id)).toEqual([
      'e1',
      'e2',
      'e2-copy',
      'e3',
    ])
    const original = result.project.timeline.entries[1]
    const copy = result.project.timeline.entries[2]
    expect({ ...copy, id: 'e2' }).toEqual(original)
    // The cloned zoom rides along under the copy's id, and the boundary the
    // copy separated (e2 → e3) carries no transition, per the reducer rule.
    expect(
      result.project.timeline.zooms.filter((zoom) => zoom.entryId === 'e2-copy'),
    ).toHaveLength(1)
    expect(
      result.project.timeline.transitions.map(
        ({ beforeId, afterId }) => `${beforeId}→${afterId}`,
      ),
    ).toEqual(['e1→e2'])
  })

  it('round-trips two zooms on one entry without collapsing them (#129)', async () => {
    const zoomSpec = { rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 }
    const twoZooms: TimelineState = {
      ...timeline,
      zooms: [
        { id: 'zA', entryId: 'e1', start: 0, ...zoomSpec },
        { id: 'zB', entryId: 'e1', start: 3, ...zoomSpec },
      ],
    }
    const result = await deserializeProject(await serializeProject(library, twoZooms))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.zooms).toEqual(twoZooms.zooms)
    }
  })

  it('round-trips a state predating the optional effect lists', async () => {
    const bytes = await serializeProject(library, { entries: timeline.entries })
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries).toEqual(expectedProject.timeline.entries)
      expect(result.project.timeline.transitions).toEqual([])
      expect(result.project.timeline.zooms).toEqual([])
    }
  })

  it('round-trips an empty project', async () => {
    const bytes = await serializeProject({ clips: [], failures: [] }, { entries: [] })
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: { clips: [], timeline: { entries: [], transitions: [], zooms: [], audioTracks: [] } },
    })
  })

  it('never stores runtime object URLs or transient import failures', async () => {
    const bytes = await serializeProject(library, timeline)
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    void writer.write(bytes)
    void writer.close()
    let json = ''
    const decoder = new TextDecoder()
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      json += decoder.decode(value, { stream: true })
    }
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('broken.avi')
  })

  it('refuses to serialize an entry whose clip is not in the library', async () => {
    const orphaned: TimelineState = {
      entries: [{ ...timeline.entries[0], clipId: 'gone' }],
    }
    await expect(serializeProject(library, orphaned)).rejects.toThrow('not in the library')
  })
})

describe('clip kinds (#101)', () => {
  const mixedLibrary: MediaLibraryState = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' },
      { id: 'a1', name: 'music.mp3', duration: 185, url: 'blob:a1', kind: 'audio' },
    ],
    failures: [],
  }
  const videoOnlyTimeline: TimelineState = {
    entries: [
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 12 },
    ],
    transitions: [],
    zooms: [],
  }

  it('round-trips a library holding both video and audio clips', async () => {
    const bytes = await serializeProject(mixedLibrary, videoOnlyTimeline)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips.map(({ id, kind }) => ({ id, kind }))).toEqual([
        { id: 'v1', kind: 'video' },
        { id: 'a1', kind: 'audio' },
      ])
    }
  })

  it('round-trips audio media in an embedded (version 2) file', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 3), mimeType: 'video/mp4' }],
      ['a1', { bytes: pseudoRandomBytes(48, 4), mimeType: 'audio/mpeg' }],
    ])
    const result = await deserializeProject(
      await serializeProject(mixedLibrary, videoOnlyTimeline, media),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips[1].kind).toBe('audio')
      expect(result.media).toEqual(media)
    }
  })

  it('round-trips an extracted audio clip with its provenance (#154)', async () => {
    const withExtracted: MediaLibraryState = {
      clips: [
        ...mixedLibrary.clips,
        {
          id: 'x1',
          name: 'holiday.mp4 (audio)',
          duration: 12,
          url: 'blob:x1',
          kind: 'audio',
          extractedFrom: 'holiday.mp4',
        },
      ],
      failures: [],
    }
    const result = await deserializeProject(
      await serializeProject(withExtracted, videoOnlyTimeline),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      // extractedFrom survives — it is what lets a references-only reopen
      // link this clip from the original video file (openProject.ts) —
      // and clips without it stay without it.
      expect(result.project.clips[2]).toMatchObject({
        id: 'x1',
        kind: 'audio',
        extractedFrom: 'holiday.mp4',
      })
      expect(result.project.clips[0].extractedFrom).toBeUndefined()
    }
  })

  it('refuses a non-string extractedFrom (#154)', async () => {
    const document = validDocument()
    ;(document.clips[0] as { extractedFrom?: unknown }).extractedFrom = 7
    await expectRefusal(
      await gzipJson(document),
      'clips[0].extractedFrom must be a non-empty string',
    )
  })

  it('defaults a clip without a kind key to video (pre-#101 files)', async () => {
    const document = validDocument()
    for (const clip of document.clips as { kind?: unknown }[]) delete clip.kind
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips.every((clip) => clip.kind === 'video')).toBe(true)
    }
  })

  it('refuses an unknown kind value', async () => {
    const document = validDocument()
    ;(document.clips[0] as { kind?: unknown }).kind = 'hologram'
    await expectRefusal(
      await gzipJson(document),
      'clips[0].kind must be "video", "audio", or "image"',
    )
  })

  it('refuses a sequence entry that references an audio clip', async () => {
    const document = validDocument()
    ;(document.clips[0] as { kind?: unknown }).kind = 'audio'
    await expectRefusal(
      await gzipJson(document),
      'references an audio clip',
      'the sequence carries video and stills only',
    )
  })
})

describe('still images (#137)', () => {
  const imageLibrary: MediaLibraryState = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' },
      { id: 'i1', name: 'logo.png', duration: 0, url: 'blob:i1', kind: 'image', width: 640, height: 480 },
    ],
    failures: [],
  }
  const videoOnlyTimeline: TimelineState = {
    entries: [
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 12 },
    ],
  }
  const expectedImageClips = [
    { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
    { id: 'i1', name: 'logo.png', duration: 0, kind: 'image', width: 640, height: 480 },
  ]

  it('writes a references-only file with images at version 3, with no media section', async () => {
    const document = await gunzipJson(await serializeProject(imageLibrary, videoOnlyTimeline))
    expect(document.schemaVersion).toBe(IMAGES_SCHEMA_VERSION)
    expect(document).not.toHaveProperty('media')
  })

  it('stores images without a duration key — dimensions are their metadata', async () => {
    const document = await gunzipJson(await serializeProject(imageLibrary, videoOnlyTimeline))
    const clips = document.clips as Record<string, unknown>[]
    expect(clips[1]).toEqual({ id: 'i1', name: 'logo.png', kind: 'image', width: 640, height: 480 })
    expect(clips[1]).not.toHaveProperty('duration')
    // The video clip next to it keeps the exact shape files always had.
    expect(clips[0]).toEqual({ id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' })
  })

  it('round-trips a references-only project holding an image', async () => {
    const result = await deserializeProject(await serializeProject(imageLibrary, videoOnlyTimeline))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips).toEqual(expectedImageClips)
      expect(result.media).toBeUndefined()
    }
  })

  it('round-trips an embedded project holding an image, at version 3 with media', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 5), mimeType: 'video/mp4' }],
      ['i1', { bytes: pseudoRandomBytes(48, 6), mimeType: 'image/png' }],
    ])
    const bytes = await serializeProject(imageLibrary, videoOnlyTimeline, media)
    const document = await gunzipJson(bytes)
    expect(document.schemaVersion).toBe(IMAGES_SCHEMA_VERSION)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips).toEqual(expectedImageClips)
      expect(result.media).toEqual(media)
    }
  })

  it('still refuses a version-2 file without a media section', async () => {
    // Media-optional is a version-3 rule: at version 2 the version itself
    // declares embedding, so a missing section stays a refusal.
    const document = {
      ...validDocument(),
      schemaVersion: EMBEDDED_SCHEMA_VERSION,
    }
    await expectRefusal(await gzipJson(document), 'the "media" section is missing')
  })

  it('validates an embedded media section on a version-3 file', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 5) }],
      ['i1', { bytes: pseudoRandomBytes(48, 6) }],
    ])
    const bytes = await serializeProject(imageLibrary, videoOnlyTimeline, media)
    // Corrupt one media entry: version 3 with media present must still be
    // integrity-checked exactly like version 2.
    const document = await gunzipJson(bytes)
    ;((document.media as Record<string, Record<string, unknown>>).i1).crc32 = '00000000'
    await expectRefusal(await gzipJson(document), 'failed its integrity check', 'logo.png')
  })

  it('refuses non-integer or non-positive image dimensions', async () => {
    const withImage = () => ({
      ...validDocument(),
      schemaVersion: IMAGES_SCHEMA_VERSION,
      clips: [
        ...structuredClone(expectedProject.clips),
        { id: 'i1', name: 'logo.png', kind: 'image', width: 640, height: 480 },
      ],
    })
    const zeroWidth = withImage()
    ;(zeroWidth.clips[2] as { width: unknown }).width = 0
    await expectRefusal(await gzipJson(zeroWidth), 'clips[2].width must be a positive integer')
    const fractionalHeight = withImage()
    ;(fractionalHeight.clips[2] as { height: unknown }).height = 1.5
    await expectRefusal(
      await gzipJson(fractionalHeight),
      'clips[2].height must be a positive integer',
    )
  })

  it('accepts an image clip with no dimensions (a foreign writer may omit them)', async () => {
    const document = {
      ...validDocument(),
      schemaVersion: IMAGES_SCHEMA_VERSION,
      clips: [
        ...structuredClone(expectedProject.clips),
        { id: 'i1', name: 'logo.png', kind: 'image' },
      ],
    }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips[2]).toEqual({ id: 'i1', name: 'logo.png', duration: 0, kind: 'image' })
    }
  })

  it('accepts a sequence entry that references an image clip, marking it a still (#140)', async () => {
    const document = {
      ...validDocument(),
      schemaVersion: IMAGE_ENTRIES_SCHEMA_VERSION,
      clips: structuredClone(expectedProject.clips),
    }
    ;(document.clips[0] as { kind?: unknown }).kind = 'image'
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      // e1 and e3 reference c1 (now an image): stillness is derived from the
      // clip's kind, never stored in the entry itself.
      expect(result.project.timeline.entries.map((entry) => entry.kind)).toEqual([
        'image',
        undefined,
        'image',
      ])
    }
  })

  it('refuses an audio track that references an image clip', async () => {
    const document = {
      format: PROJECT_FORMAT,
      schemaVersion: IMAGES_SCHEMA_VERSION,
      clips: [{ id: 'i1', name: 'logo.png', kind: 'image', width: 8, height: 8 }],
      timeline: {
        entries: [],
        transitions: [],
        zooms: [],
        audioTracks: [
          { id: 't1', clipId: 'i1', name: 'logo.png', duration: 5, offset: 0, inPoint: 0, outPoint: 5 },
        ],
      },
    }
    await expectRefusal(
      await gzipJson(document),
      'references an image clip',
      'audio tracks carry audio only',
    )
  })
})

describe('images on the timeline (#140)', () => {
  const imageEntryLibrary: MediaLibraryState = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' },
      { id: 'i1', name: 'logo.png', duration: 0, url: 'blob:i1', kind: 'image', width: 640, height: 480 },
    ],
    failures: [],
  }
  // A trimmed video, a 5s still, a crossfade between them, and a zoom on the
  // still — the still-specific surface the format must carry.
  const imageEntryTimeline: TimelineState = {
    entries: [
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 4 },
      { id: 'e2', clipId: 'i1', name: 'logo.png', duration: 5, url: 'blob:i1', inPoint: 0, outPoint: 5, kind: 'image' },
    ],
    transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
    zooms: [
      { id: 'z1', entryId: 'e2', start: 1, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 },
    ],
  }
  const expectedImageEntryProject: Project = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
      { id: 'i1', name: 'logo.png', duration: 0, kind: 'image', width: 640, height: 480 },
    ],
    timeline: {
      entries: [
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 4 },
        // Stillness is derived from the clip's kind on open, never stored.
        { id: 'e2', clipId: 'i1', name: 'logo.png', duration: 5, inPoint: 0, outPoint: 5, kind: 'image' },
      ],
      transitions: imageEntryTimeline.transitions!,
      zooms: imageEntryTimeline.zooms!,
      audioTracks: [],
    },
  }

  it('writes version 4 exactly when an image is on the timeline, in both save modes', async () => {
    const references = await gunzipJson(
      await serializeProject(imageEntryLibrary, imageEntryTimeline),
    )
    expect(references.schemaVersion).toBe(IMAGE_ENTRIES_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 7), mimeType: 'video/mp4' }],
      ['i1', { bytes: pseudoRandomBytes(48, 8), mimeType: 'image/png' }],
    ])
    const embedded = await gunzipJson(
      await serializeProject(imageEntryLibrary, imageEntryTimeline, media),
    )
    expect(embedded.schemaVersion).toBe(IMAGE_ENTRIES_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
  })

  it('stores a still entry in the shape entries always had — no extra keys', async () => {
    const document = await gunzipJson(await serializeProject(imageEntryLibrary, imageEntryTimeline))
    const entries = (document.timeline as { entries: Record<string, unknown>[] }).entries
    expect(entries[1]).toEqual({
      id: 'e2',
      clipId: 'i1',
      name: 'logo.png',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    })
  })

  it('an image merely in the library (not on the timeline) still writes version 3', async () => {
    const videoOnlyTimeline: TimelineState = {
      entries: [imageEntryTimeline.entries[0]],
    }
    const document = await gunzipJson(await serializeProject(imageEntryLibrary, videoOnlyTimeline))
    expect(document.schemaVersion).toBe(IMAGES_SCHEMA_VERSION)
  })

  it('round-trips a references-only project with a still entry, transition, and zoom', async () => {
    const result = await deserializeProject(
      await serializeProject(imageEntryLibrary, imageEntryTimeline),
    )
    expect(result).toEqual({ ok: true, project: expectedImageEntryProject })
  })

  it('round-trips an embedded project with a still entry', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 7), mimeType: 'video/mp4' }],
      ['i1', { bytes: pseudoRandomBytes(48, 8), mimeType: 'image/png' }],
    ])
    const result = await deserializeProject(
      await serializeProject(imageEntryLibrary, imageEntryTimeline, media),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedImageEntryProject)
      expect(result.media).toEqual(media)
    }
  })
})

describe('color slates (#143)', () => {
  const slateLibrary: MediaLibraryState = {
    clips: [{ id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' }],
    failures: [],
  }
  // The customer's own example: a red slate crossfading into a clip.
  const slateTimeline: TimelineState = {
    entries: [
      { id: 's1', clipId: '', name: 'Color slate', duration: 5, url: '', inPoint: 0, outPoint: 5, kind: 'slate', color: '#ff0000' },
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 4 },
    ],
    transitions: [{ beforeId: 's1', afterId: 'e1', type: 'crossfade', duration: 1 }],
    zooms: [],
  }
  const expectedSlateProject: Project = {
    clips: [{ id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' }],
    timeline: {
      entries: [
        // Slateness is derived from the stored color on open, never stored
        // as a kind; the model's empty clipId is reconstructed.
        { id: 's1', clipId: '', name: 'Color slate', duration: 5, inPoint: 0, outPoint: 5, kind: 'slate', color: '#ff0000' },
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 4 },
      ],
      transitions: slateTimeline.transitions!,
      zooms: [],
      audioTracks: [],
    },
  }

  it('writes version 5 exactly when a slate is on the timeline, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(slateLibrary, slateTimeline))
    expect(references.schemaVersion).toBe(SLATE_ENTRIES_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 9), mimeType: 'video/mp4' }],
    ])
    const embedded = await gunzipJson(await serializeProject(slateLibrary, slateTimeline, media))
    expect(embedded.schemaVersion).toBe(SLATE_ENTRIES_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
  })

  it('stores a slate as color without clipId, and no kind key', async () => {
    const document = await gunzipJson(await serializeProject(slateLibrary, slateTimeline))
    const entries = (document.timeline as { entries: Record<string, unknown>[] }).entries
    expect(entries[0]).toEqual({
      id: 's1',
      name: 'Color slate',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      color: '#ff0000',
    })
  })

  it('a slate-free timeline keeps writing the version its content forces', async () => {
    const videoOnly: TimelineState = { entries: [slateTimeline.entries[1]] }
    const document = await gunzipJson(await serializeProject(slateLibrary, videoOnly))
    expect(document.schemaVersion).toBe(1)
  })

  it('round-trips a references-only project with a slate and its transition', async () => {
    const result = await deserializeProject(await serializeProject(slateLibrary, slateTimeline))
    expect(result).toEqual({ ok: true, project: expectedSlateProject })
  })

  it('round-trips an embedded project with a slate — no media entry for the slate', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 9), mimeType: 'video/mp4' }],
    ])
    const result = await deserializeProject(
      await serializeProject(slateLibrary, slateTimeline, media),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedSlateProject)
      expect(result.media).toEqual(media)
    }
  })

  it('a slate-only project (no clips at all) serializes and round-trips', async () => {
    const slateOnly: TimelineState = { entries: [slateTimeline.entries[0]] }
    const empty: MediaLibraryState = { clips: [], failures: [] }
    const result = await deserializeProject(await serializeProject(empty, slateOnly))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips).toEqual([])
      expect(result.project.timeline.entries).toEqual([expectedSlateProject.timeline.entries[0]])
    }
  })

  it('refuses an entry carrying both a clipId and a color', async () => {
    const document = validDocument()
    ;(document.timeline as { entries: Record<string, unknown>[] }).entries[0].color = '#ff0000'
    await expectRefusal(
      await gzipJson(document),
      'carries both a clipId and a color',
    )
  })

  it('refuses a slate whose color is not lowercase #rrggbb', async () => {
    for (const bad of ['#FF0000', 'red', '#f00', 'ff0000']) {
      const document = validDocument()
      ;(document.timeline as { entries: Record<string, unknown>[] }).entries.push({
        id: 's1',
        name: 'Color slate',
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        color: bad,
      })
      await expectRefusal(await gzipJson(document), 'is not a lowercase #rrggbb color')
    }
  })

  it('still refuses an entry with neither clipId nor color', async () => {
    const document = validDocument()
    delete (document.timeline as { entries: Record<string, unknown>[] }).entries[0].clipId
    await expectRefusal(await gzipJson(document), 'timeline.entries[0].clipId')
  })
})

describe('audio tracks (#102)', () => {
  const audioLibrary: MediaLibraryState = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' },
      { id: 'a1', name: 'music.mp3', duration: 185, url: 'blob:a1', kind: 'audio' },
      { id: 'a2', name: 'voice.wav', duration: 30, url: 'blob:a2', kind: 'audio' },
    ],
    failures: [],
  }
  const audioTimeline: TimelineState = {
    entries: [
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 12 },
    ],
    transitions: [],
    zooms: [],
    audioTracks: [
      // Overlapping on purpose: both audible from 5s to 8.5s.
      { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, url: 'blob:a1', offset: 0, inPoint: 10, outPoint: 40 },
      { id: 't2', clipId: 'a2', name: 'voice.wav', duration: 30, url: 'blob:a2', offset: 5, inPoint: 0, outPoint: 3.5 },
    ],
  }

  const trackDocument = () => {
    const document = validDocument()
    ;(document.clips as unknown[]).push({ id: 'a1', name: 'music.mp3', duration: 185, kind: 'audio' })
    ;(document.timeline as { audioTracks?: unknown[] }).audioTracks = [
      { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 2, inPoint: 10, outPoint: 40 },
    ]
    return document
  }

  it('round-trips overlapping audio tracks, offsets and trims intact', async () => {
    const result = await deserializeProject(await serializeProject(audioLibrary, audioTimeline))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.audioTracks).toEqual([
        { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 0, inPoint: 10, outPoint: 40 },
        { id: 't2', clipId: 'a2', name: 'voice.wav', duration: 30, offset: 5, inPoint: 0, outPoint: 3.5 },
      ])
    }
  })

  it('round-trips audio tracks in an embedded (version 2) file', async () => {
    const media = new Map<string, ClipMedia>([
      ['v1', { bytes: pseudoRandomBytes(64, 5), mimeType: 'video/mp4' }],
      ['a1', { bytes: pseudoRandomBytes(48, 6), mimeType: 'audio/mpeg' }],
      ['a2', { bytes: pseudoRandomBytes(32, 7), mimeType: 'audio/wav' }],
    ])
    const result = await deserializeProject(await serializeProject(audioLibrary, audioTimeline, media))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.audioTracks).toHaveLength(2)
      expect(result.media).toEqual(media)
    }
  })

  it('defaults a file without an audioTracks key to none (pre-#102 files)', async () => {
    const document = validDocument()
    delete (document.timeline as { audioTracks?: unknown }).audioTracks
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.audioTracks).toEqual([])
  })

  it('refuses a track referencing a video clip', async () => {
    const document = trackDocument()
    ;(document.timeline as { audioTracks: { clipId: string }[] }).audioTracks[0].clipId = 'c1'
    await expectRefusal(
      await gzipJson(document),
      'timeline.audioTracks[0].clipId "c1" references a video clip',
    )
  })

  it('refuses a track referencing an unknown clip', async () => {
    const document = trackDocument()
    ;(document.timeline as { audioTracks: { clipId: string }[] }).audioTracks[0].clipId = 'ghost'
    await expectRefusal(
      await gzipJson(document),
      'timeline.audioTracks[0].clipId "ghost" does not match any clip',
    )
  })

  it('refuses a negative offset', async () => {
    const document = trackDocument()
    ;(document.timeline as { audioTracks: { offset: number }[] }).audioTracks[0].offset = -1
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[0].offset must not be negative')
  })

  it('refuses an empty trim range', async () => {
    const document = trackDocument()
    ;(document.timeline as { audioTracks: { inPoint: number; outPoint: number }[] }).audioTracks[0].inPoint = 40
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[0] trim range is empty')
  })

  it('refuses a trim past the clip duration', async () => {
    const document = trackDocument()
    ;(document.timeline as { audioTracks: { outPoint: number }[] }).audioTracks[0].outPoint = 186
    await expectRefusal(
      await gzipJson(document),
      'timeline.audioTracks[0].outPoint must not exceed the clip duration',
    )
  })

  it('refuses a duplicated track id', async () => {
    const document = trackDocument()
    const tracks = (document.timeline as { audioTracks: { id: string }[] }).audioTracks
    tracks.push({ ...tracks[0] })
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[1].id "t1" is duplicated')
  })

  it('refuses serializing a track whose clip is not in the library', async () => {
    const orphaned: TimelineState = {
      ...audioTimeline,
      audioTracks: [{ ...audioTimeline.audioTracks![0], clipId: 'gone' }],
    }
    await expect(serializeProject(audioLibrary, orphaned)).rejects.toThrow(
      'audio track "t1" references clip "gone" which is not in the library',
    )
  })
})

describe('gain fields (#104)', () => {
  const gainLibrary: MediaLibraryState = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', kind: 'video' },
      { id: 'a1', name: 'music.mp3', duration: 185, url: 'blob:a1', kind: 'audio' },
    ],
    failures: [],
  }
  const gainTimeline: TimelineState = {
    entries: [
      { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 12, volume: 0.75 },
      { id: 'e2', clipId: 'v1', name: 'holiday.mp4', duration: 12, url: 'blob:v1', inPoint: 0, outPoint: 6, muted: true },
    ],
    transitions: [],
    zooms: [],
    audioTracks: [
      { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, url: 'blob:a1', offset: 2, inPoint: 10, outPoint: 40, volume: 0.5, fadeIn: 2, fadeOut: 3 },
    ],
  }

  const entryDocument = () => {
    const document = validDocument()
    ;(document.clips as unknown[]).push({ id: 'a1', name: 'music.mp3', duration: 185, kind: 'audio' })
    ;(document.timeline as { audioTracks?: unknown[] }).audioTracks = [
      { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 2, inPoint: 10, outPoint: 40 },
    ]
    return document as {
      timeline: {
        entries: Record<string, unknown>[]
        audioTracks: Record<string, unknown>[]
      }
    } & Record<string, unknown>
  }

  it('round-trips entry volume/mute and track volume/fades', async () => {
    const result = await deserializeProject(await serializeProject(gainLibrary, gainTimeline))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries).toEqual([
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 12, volume: 0.75 },
        { id: 'e2', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 6, muted: true },
      ])
      expect(result.project.timeline.audioTracks).toEqual([
        { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 2, inPoint: 10, outPoint: 40, volume: 0.5, fadeIn: 2, fadeOut: 3 },
      ])
    }
  })

  it('omits gain keys entirely when no volume, mute, or fade was ever set', async () => {
    // Pre-#104 states keep producing byte-identical documents: the keys are
    // written only when present, not as explicit defaults.
    const document = (await gunzipJson(await serializeProject(library, timeline))) as {
      timeline: { entries: Record<string, unknown>[]; audioTracks: Record<string, unknown>[] }
    }
    for (const entry of document.timeline.entries) {
      expect(entry).not.toHaveProperty('volume')
      expect(entry).not.toHaveProperty('muted')
    }
  })

  it('refuses an out-of-range entry volume', async () => {
    const document = entryDocument()
    document.timeline.entries[0].volume = 1.5
    await expectRefusal(await gzipJson(document), 'timeline.entries[0].volume must be between 0 and 1')
    document.timeline.entries[0].volume = -0.1
    await expectRefusal(await gzipJson(document), 'timeline.entries[0].volume must be between 0 and 1')
  })

  it('refuses a non-boolean mute flag', async () => {
    const document = entryDocument()
    document.timeline.entries[0].muted = 'yes'
    await expectRefusal(await gzipJson(document), 'timeline.entries[0].muted must be a boolean')
  })

  it('refuses an out-of-range track volume and negative fades', async () => {
    const document = entryDocument()
    document.timeline.audioTracks[0].volume = 2
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[0].volume must be between 0 and 1')
    delete document.timeline.audioTracks[0].volume
    document.timeline.audioTracks[0].fadeIn = -1
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[0].fadeIn must not be negative')
    delete document.timeline.audioTracks[0].fadeIn
    document.timeline.audioTracks[0].fadeOut = 'long'
    await expectRefusal(await gzipJson(document), 'timeline.audioTracks[0].fadeOut must be a finite number')
  })
})

describe('plugin dependencies (#197, schema version 6)', () => {
  it('writes version 6 with a plugins key exactly when dependencies exist, in both save modes', async () => {
    const references = await gunzipJson(
      await serializeProject(library, timeline, undefined, ['sample-webm']),
    )
    expect(references.schemaVersion).toBe(PLUGINS_SCHEMA_VERSION)
    expect(references.plugins).toEqual(['sample-webm'])
    expect(references).not.toHaveProperty('media')

    const embedded = await gunzipJson(
      await serializeProject(library, timeline, fixtureMedia(), ['sample-webm']),
    )
    expect(embedded.schemaVersion).toBe(PLUGINS_SCHEMA_VERSION)
    expect(embedded.plugins).toEqual(['sample-webm'])
    expect(embedded).toHaveProperty('media')
  })

  it('a project with no plugin dependencies stays byte-identical to earlier output', async () => {
    // The enabled set must not leak into files that use no plugin features.
    const withEmptyList = await serializeProject(library, timeline, undefined, [])
    const withoutArgument = await serializeProject(library, timeline)
    expect(withEmptyList).toEqual(withoutArgument)
    const document = await gunzipJson(withEmptyList)
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(document).not.toHaveProperty('plugins')
  })

  it('round-trips the plugin list', async () => {
    const result = await deserializeProject(
      await serializeProject(library, timeline, undefined, ['a-plugin', 'b-plugin']),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.plugins).toEqual(['a-plugin', 'b-plugin'])
      // Everything else is unchanged by the plugins key.
      expect(result.project.clips).toEqual(expectedProject.clips)
      expect(result.project.timeline).toEqual(expectedProject.timeline)
    }
  })

  it('rejects a duplicated dependency list at the source', async () => {
    await expect(
      serializeProject(library, timeline, undefined, ['p', 'p']),
    ).rejects.toThrow(/duplicates/)
  })

  it('refuses a malformed plugins key by name', async () => {
    const notArray = { ...validDocument(), schemaVersion: PLUGINS_SCHEMA_VERSION, plugins: 'gif' }
    await expectRefusal(await gzipJson(notArray), 'plugins must be an array')

    const badEntry = { ...validDocument(), schemaVersion: PLUGINS_SCHEMA_VERSION, plugins: ['ok', 7] }
    await expectRefusal(await gzipJson(badEntry), 'plugins[1] must be a non-empty string')

    const duplicated = {
      ...validDocument(),
      schemaVersion: PLUGINS_SCHEMA_VERSION,
      plugins: ['p', 'p'],
    }
    await expectRefusal(await gzipJson(duplicated), 'plugins[1] "p" is duplicated')
  })

  it('treats an empty plugins array as no dependencies', async () => {
    const empty = { ...validDocument(), plugins: [] }
    const result = await deserializeProject(await gzipJson(empty))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.plugins).toBeUndefined()
  })
})

describe('project file versioning', () => {
  it('carries the schema version', async () => {
    // Deserializing proves the marker + version were present and accepted;
    // this pins the constants so a bump is a conscious, reviewed change.
    // Version 2 added embedded media (#97); version 3 added images (#137);
    // version 4 added images on the timeline (#140); version 5 added color
    // slates (#143); version 6 added plugin dependencies (#197); version 7
    // added per-clip color adjustments (#192); version 8 added entry and
    // overlay audio fades (#220); version 9 added entry and overlay
    // orientation (#232); version 10 added audio-track ducking (#241);
    // version 11 added the subtitle-import marker on text overlays (#249);
    // version 12 added entry and overlay crop (#255); version 13 added the
    // default subtitle style and per-overlay style overrides (#250);
    // version 14 added entry background fill (#259); version 15 added
    // overlay shape masks (#266); version 16 added the project's canvas
    // preset (#273); version 17 added image overlay layers (#294).
    expect(PROJECT_SCHEMA_VERSION).toBe(17)
    expect(REFERENCES_SCHEMA_VERSION).toBe(1)
    expect(EMBEDDED_SCHEMA_VERSION).toBe(2)
    expect(IMAGES_SCHEMA_VERSION).toBe(3)
    expect(IMAGE_ENTRIES_SCHEMA_VERSION).toBe(4)
    expect(SLATE_ENTRIES_SCHEMA_VERSION).toBe(5)
    expect(PLUGINS_SCHEMA_VERSION).toBe(6)
    expect(COLOR_ADJUSTMENTS_SCHEMA_VERSION).toBe(7)
    expect(AUDIO_FADES_SCHEMA_VERSION).toBe(8)
    expect(ORIENTATION_SCHEMA_VERSION).toBe(9)
    expect(DUCKING_SCHEMA_VERSION).toBe(10)
    expect(SUBTITLE_SCHEMA_VERSION).toBe(11)
    expect(CROP_SCHEMA_VERSION).toBe(12)
    expect(SUBTITLE_STYLE_SCHEMA_VERSION).toBe(13)
    expect(BACKGROUND_FILL_SCHEMA_VERSION).toBe(14)
    expect(SHAPE_MASK_SCHEMA_VERSION).toBe(15)
    expect(CANVAS_PRESET_SCHEMA_VERSION).toBe(16)
    expect(IMAGE_OVERLAYS_SCHEMA_VERSION).toBe(17)
    expect(PROJECT_FORMAT).toBe('browser-video-editor-project')
  })

  it('still writes references-only files at version 1, with no media section', async () => {
    // Older builds must keep opening files that embed nothing — the lowest
    // version that can represent the content is the one written.
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(document).not.toHaveProperty('media')
  })

  it('refuses a file from a newer schema version with a clear error', async () => {
    const newer = { ...validDocument(), schemaVersion: PROJECT_SCHEMA_VERSION + 1 }
    await expectRefusal(await gzipJson(newer), 'newer version', `version ${PROJECT_SCHEMA_VERSION + 1}`)
  })

  it('ignores unknown extra keys within a known version', async () => {
    const withExtras = {
      ...validDocument(),
      futureField: { anything: true },
    }
    const result = await deserializeProject(await gzipJson(withExtras))
    expect(result).toEqual({ ok: true, project: expectedProject })
  })

  it('ignores a media key on a version-1 file', async () => {
    // Only version 2 declares embedded media; on version 1 the key is an
    // unknown extra from some foreign writer, not something to validate.
    const foreign = { ...validDocument(), media: { c1: 'nonsense' } }
    const result = await deserializeProject(await gzipJson(foreign))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.media).toBeUndefined()
  })
})

describe('embedded media (schema version 2)', () => {
  const base64Of = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))

  /** A valid embedded document to mutate — honest: taken from the serializer. */
  const embeddedDocument = async () =>
    (await gunzipJson(await serializeProject(library, timeline, fixtureMedia()))) as {
      schemaVersion: number
      media: Record<
        string,
        { byteLength: number; crc32: string; mimeType?: string; data: string }
      >
    } & Record<string, unknown>

  it('round-trips media byte-for-byte, alongside the full editing state', async () => {
    const media = fixtureMedia()
    const bytes = await serializeProject(library, timeline, media)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedProject)
      expect(result.media).toEqual(media)
    }
  })

  it('writes schema version 2 with a media entry per clip', async () => {
    const document = await embeddedDocument()
    expect(document.schemaVersion).toBe(EMBEDDED_SCHEMA_VERSION)
    expect(Object.keys(document.media).sort()).toEqual(['c1', 'c2'])
    expect(document.media.c1.byteLength).toBe(2048)
    expect(document.media.c1.mimeType).toBe('video/mp4')
    expect(document.media.c2.byteLength).toBe(1024)
  })

  it('round-trips media with no mimeType', async () => {
    const media = new Map<string, ClipMedia>([
      ['c1', { bytes: pseudoRandomBytes(64, 7) }],
      ['c2', { bytes: pseudoRandomBytes(32, 8) }],
    ])
    const result = await deserializeProject(await serializeProject(library, timeline, media))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.media).toEqual(media)
  })

  it('refuses to serialize when a clip has no media bytes', async () => {
    const partial = new Map([['c1', { bytes: pseudoRandomBytes(16, 1) }]])
    await expect(serializeProject(library, timeline, partial)).rejects.toThrow(
      'no media bytes supplied for clip "c2"',
    )
  })

  it('refuses to serialize media for a clip that is not in the library', async () => {
    const extra = fixtureMedia()
    extra.set('c3', { bytes: pseudoRandomBytes(16, 3) })
    await expect(serializeProject(library, timeline, extra)).rejects.toThrow(
      'media bytes supplied for clip "c3" which is not in the library',
    )
  })

  const embeddedMutations: [
    string,
    (document: Awaited<ReturnType<typeof embeddedDocument>>) => void,
    string,
  ][] = [
    [
      'a version-2 file without a media section',
      (d) => delete (d as Record<string, unknown>).media,
      'the "media" section is missing',
    ],
    [
      'media missing one clip',
      (d) => delete d.media.c2,
      'media is missing the bytes for clip "c2" ("city.webm")',
    ],
    [
      'media for an unknown clip',
      (d) => (d.media.zzz = { ...d.media.c1 }),
      'media["zzz"] does not match any clip',
    ],
    [
      'media that is not base64',
      (d) => (d.media.c1.data = '!!! not base64 !!!'),
      'media["c1"].data is not valid base64',
    ],
    [
      'a truncated media payload',
      (d) => (d.media.c1.data = base64Of(pseudoRandomBytes(2048, 1).subarray(0, 512))),
      'media["c1"] is truncated: it declares 2048 bytes but 512 decoded',
    ],
    [
      'a mutated media payload of the right length',
      (d) => (d.media.c1.data = base64Of(pseudoRandomBytes(2048, 99))),
      'media["c1"] failed its integrity check',
    ],
    [
      'a non-integer declared byteLength',
      (d) => (d.media.c1.byteLength = 1.5),
      'media["c1"].byteLength must be an integer',
    ],
    [
      'a malformed crc32',
      (d) => (d.media.c1.crc32 = 'not hex!'),
      'media["c1"].crc32 must be an 8-digit lowercase hex string',
    ],
    [
      'media data that is not a string',
      (d) => ((d.media.c1 as Record<string, unknown>).data = 42),
      'media["c1"].data must be a string',
    ],
  ]
  for (const [label, mutate, mention] of embeddedMutations) {
    it(`refuses ${label}`, async () => {
      const document = await embeddedDocument()
      mutate(document)
      await expectRefusal(await gzipJson(document), mention)
    })
  }

  it('costs little beyond the media itself (#97 size budget)', async () => {
    // Incompressible media is the honest worst case: gzip cannot shrink it,
    // so the budget measures pure format overhead — chiefly how much of
    // base64's 4/3 inflation the gzip stage wins back.
    const mediaBytes = 300_000
    const media = new Map<string, ClipMedia>([
      ['c1', { bytes: pseudoRandomBytes(200_000, 11), mimeType: 'video/mp4' }],
      ['c2', { bytes: pseudoRandomBytes(100_000, 12), mimeType: 'video/webm' }],
    ])
    const references = await serializeProject(library, timeline)
    const embedded = await serializeProject(library, timeline, media)
    expect(embedded.length).toBeLessThanOrEqual(1.15 * (mediaBytes + references.length))
  })
})

describe('project file corruption', () => {
  it('refuses bytes that are not gzip', async () => {
    await expectRefusal(
      Uint8Array.from('not gzip at all', (char) => char.charCodeAt(0)),
      'not valid gzip',
    )
  })

  it('refuses a truncated file', async () => {
    const bytes = await serializeProject(library, timeline)
    await expectRefusal(bytes.slice(0, Math.floor(bytes.length / 2)))
  })

  it('refuses gzip of invalid JSON', async () => {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    void writer.write(new TextEncoder().encode('{"format": '))
    void writer.close()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    await expectRefusal(out, 'not valid JSON')
  })

  it('refuses a gzip whose JSON lacks the format marker', async () => {
    await expectRefusal(await gzipJson({ some: 'other file' }), 'format marker')
  })

  it('refuses a non-integer schema version', async () => {
    await expectRefusal(
      await gzipJson({ ...validDocument(), schemaVersion: 1.5 }),
      'schemaVersion',
    )
  })

  const mutations: [string, (document: ReturnType<typeof validDocument>) => void, string][] = [
    ['a clip without a name', (d) => delete (d.clips[0] as Partial<(typeof d.clips)[0]>).name, 'clips[0].name'],
    ['a non-finite duration', (d) => (d.clips[0].duration = Number.NaN), 'clips[0].duration'],
    ['a duplicated clip id', (d) => (d.clips[1].id = d.clips[0].id), 'duplicated'],
    ['an entry with an empty trim range', (d) => (d.timeline.entries[0].inPoint = 9), 'inPoint must be less than outPoint'],
    ['an entry trimmed past its duration', (d) => (d.timeline.entries[0].outPoint = 100), 'must not exceed the clip duration'],
    ['an entry referencing a missing clip', (d) => (d.timeline.entries[0].clipId = 'nope'), 'does not match any clip'],
    ['an unknown transition type', (d) => ((d.timeline.transitions[0] as { type: string }).type = 'star-wipe'), '"star-wipe" is unknown'],
    ['a transition referencing a missing entry', (d) => (d.timeline.transitions[0].afterId = 'nope'), 'does not match any timeline entry'],
    ['duplicate transitions on one boundary', (d) => d.timeline.transitions.push({ ...d.timeline.transitions[0] }), 'duplicates the transition'],
    ['a zoom that does not magnify', (d) => (d.timeline.zooms[0].scale = 1), 'scale must be greater than 1'],
    ['a zoom centre outside the frame', (d) => (d.timeline.zooms[0].centerX = 1.2), 'between 0 and 1'],
    ['a duplicated zoom id', (d) => d.timeline.zooms.push({ ...d.timeline.zooms[0] }), 'is duplicated'],
    ['entries that are not an array', (d) => ((d.timeline as { entries: unknown }).entries = 'zero'), 'must be an array'],
  ]
  for (const [label, mutate, mention] of mutations) {
    it(`refuses ${label}`, async () => {
      const document = validDocument()
      mutate(document)
      await expectRefusal(await gzipJson(document), mention)
    })
  }
})

describe('project file compression', () => {
  it('is materially smaller than the raw JSON of a representative project', async () => {
    // A representative session: dozens of clips and entries with trims,
    // transitions, and zooms. The compressed file must beat half the raw
    // JSON size — in practice gzip does far better on JSON's repetition.
    const clips = Array.from({ length: 30 }, (_, index) => ({
      id: `clip-${index}`,
      name: `recording-2026-08-${String(index + 1).padStart(2, '0')}.webm`,
      duration: 30 + index * 0.775,
      url: `blob:session/${index}`,
      kind: 'video' as const,
    }))
    const entries = clips.map((clip, index) => ({
      id: `entry-${index}`,
      clipId: clip.id,
      name: clip.name,
      duration: clip.duration,
      url: clip.url,
      inPoint: index * 0.125,
      outPoint: clip.duration - index * 0.25,
    }))
    const big: TimelineState = {
      entries,
      transitions: entries.slice(1).map((entry, index) => ({
        beforeId: entries[index].id,
        afterId: entry.id,
        type: index % 2 === 0 ? 'crossfade' : 'slide-from-right',
        duration: 0.5,
      })),
      zooms: entries
        .filter((_, index) => index % 3 === 0)
        .map((entry) => ({
          id: `zoom-of-${entry.id}`,
          entryId: entry.id,
          start: 1,
          rampIn: 0.5,
          hold: 2,
          rampOut: 0.5,
          scale: 2.5,
          centerX: 0.3,
          centerY: 0.6,
        })),
    }
    const bytes = await serializeProject({ clips, failures: [] }, big)
    const raw = JSON.stringify({
      clips: clips.map(({ id, name, duration }) => ({ id, name, duration })),
      timeline: big,
    })
    expect(bytes.length).toBeLessThan(raw.length / 2)
    // And it still round-trips.
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
  })
})

describe('backwards compatibility', () => {
  // The committed v1 fixture must deserialize forever: any future format
  // change has to keep this test passing (adding fixtures for new versions,
  // never deleting old ones) — that is what makes "older saved files still
  // open" (#71) permanently checkable. The fixture was produced by
  // serializeProject at schema version 1; regenerate ONLY by adding a new
  // fixture for a NEW version, never by rewriting this one.
  it('deserializes the committed v1 fixture', async () => {
    // The fixture is committed base64-encoded (a text file survives every
    // tool in the chain; the app tsconfig has no node:fs types for reading
    // a binary directly).
    const bytes = Uint8Array.from(atob(fixtureV1Base64.trim()), (char) => char.charCodeAt(0))
    const result = await deserializeProject(bytes)
    expect(result).toEqual({ ok: true, project: fixtureExpectedProject })
  })

  it('deserializes the committed v1 audio-tracks fixture (#102)', async () => {
    // Same never-rewrite contract as the other fixtures: this pins that
    // files saved when audio tracks landed keep opening forever.
    const bytes = Uint8Array.from(atob(fixtureV1AudioBase64.trim()), (char) => char.charCodeAt(0))
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: [
          { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
          { id: 'a1', name: 'music.mp3', duration: 185, kind: 'audio' },
          { id: 'a2', name: 'voice.wav', duration: 30, kind: 'audio' },
        ],
        timeline: {
          entries: [
            { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 12 },
          ],
          transitions: [],
          zooms: [],
          audioTracks: [
            { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 0, inPoint: 10, outPoint: 40 },
            { id: 't2', clipId: 'a2', name: 'voice.wav', duration: 30, offset: 5, inPoint: 0, outPoint: 3.5 },
          ],
        },
      },
    })
  })

  it('deserializes the committed v1 gain fixture (#104)', async () => {
    // Same never-rewrite contract as the other fixtures: this pins that
    // files saved when volume/mute/fade fields landed keep opening forever.
    const bytes = Uint8Array.from(atob(fixtureV1GainBase64.trim()), (char) => char.charCodeAt(0))
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: [
          { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
          { id: 'a1', name: 'music.mp3', duration: 185, kind: 'audio' },
        ],
        timeline: {
          entries: [
            { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 12, volume: 0.75 },
            { id: 'e2', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 6, muted: true },
          ],
          transitions: [],
          zooms: [],
          audioTracks: [
            { id: 't1', clipId: 'a1', name: 'music.mp3', duration: 185, offset: 2, inPoint: 10, outPoint: 40, volume: 0.5, fadeIn: 2, fadeOut: 3 },
          ],
        },
      },
    })
  })

  it('deserializes the committed v2 embedded-media fixture, media byte-for-byte', async () => {
    // Same never-rewrite contract as the v1 fixture. Its media bytes are
    // pseudoRandomBytes(2048, 1) / (1024, 2) — re-derived here rather than
    // committed separately, so byte-identity stays checkable forever.
    const bytes = Uint8Array.from(atob(fixtureV2Base64.trim()), (char) => char.charCodeAt(0))
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(fixtureExpectedProject)
      expect(result.media).toEqual(fixtureMedia())
    }
  })

  /** What both committed v3 image fixtures (#137) deserialize to. */
  const fixtureV3ExpectedProject: Project = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
      { id: 'i1', name: 'logo.png', duration: 0, kind: 'image', width: 640, height: 480 },
    ],
    timeline: {
      entries: [
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 12 },
      ],
      transitions: [],
      zooms: [],
      audioTracks: [],
    },
  }

  it('deserializes the committed v3 image references-only fixture (#137)', async () => {
    // Same never-rewrite contract as the other fixtures: this pins that
    // references-only files saved when images landed keep opening forever —
    // including that version 3 with no media section means references-only.
    const bytes = Uint8Array.from(atob(fixtureV3ImageReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({ ok: true, project: fixtureV3ExpectedProject })
  })

  it('deserializes the committed v3 image embedded fixture, media byte-for-byte (#137)', async () => {
    // Its media bytes are pseudoRandomBytes(64, 5) / (48, 6), re-derived
    // here so byte-identity stays checkable forever.
    const bytes = Uint8Array.from(atob(fixtureV3ImageEmbeddedBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(fixtureV3ExpectedProject)
      expect(result.media).toEqual(
        new Map<string, ClipMedia>([
          ['v1', { bytes: pseudoRandomBytes(64, 5), mimeType: 'video/mp4' }],
          ['i1', { bytes: pseudoRandomBytes(48, 6), mimeType: 'image/png' }],
        ]),
      )
    }
  })

  /** What both committed v4 image-entry fixtures (#140) deserialize to. */
  const fixtureV4ExpectedProject: Project = {
    clips: [
      { id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' },
      { id: 'i1', name: 'logo.png', duration: 0, kind: 'image', width: 640, height: 480 },
    ],
    timeline: {
      entries: [
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 4 },
        { id: 'e2', clipId: 'i1', name: 'logo.png', duration: 5, inPoint: 0, outPoint: 5, kind: 'image' },
      ],
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
      zooms: [
        { id: 'z1', entryId: 'e2', start: 1, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
      audioTracks: [],
    },
  }

  it('deserializes the committed v4 image-entry references-only fixture (#140)', async () => {
    // Pins that files placing stills on the timeline — with a transition
    // into the still and a zoom on it — keep opening forever, and that
    // version 4 with no media section means references-only.
    const bytes = Uint8Array.from(atob(fixtureV4ImageEntryReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({ ok: true, project: fixtureV4ExpectedProject })
  })

  it('deserializes the committed v4 image-entry embedded fixture, media byte-for-byte (#140)', async () => {
    // Its media bytes are pseudoRandomBytes(64, 7) / (48, 8), re-derived
    // here so byte-identity stays checkable forever.
    const bytes = Uint8Array.from(atob(fixtureV4ImageEntryEmbeddedBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(fixtureV4ExpectedProject)
      expect(result.media).toEqual(
        new Map<string, ClipMedia>([
          ['v1', { bytes: pseudoRandomBytes(64, 7), mimeType: 'video/mp4' }],
          ['i1', { bytes: pseudoRandomBytes(48, 8), mimeType: 'image/png' }],
        ]),
      )
    }
  })

  /** What both committed v5 slate fixtures (#143) deserialize to. */
  const fixtureV5ExpectedProject: Project = {
    clips: [{ id: 'v1', name: 'holiday.mp4', duration: 12, kind: 'video' }],
    timeline: {
      entries: [
        { id: 's1', clipId: '', name: 'Color slate', duration: 5, inPoint: 0, outPoint: 5, kind: 'slate', color: '#ff0000' },
        { id: 'e1', clipId: 'v1', name: 'holiday.mp4', duration: 12, inPoint: 0, outPoint: 4 },
      ],
      transitions: [{ beforeId: 's1', afterId: 'e1', type: 'crossfade', duration: 1 }],
      zooms: [],
      audioTracks: [],
    },
  }

  it('deserializes the committed v5 slate references-only fixture (#143)', async () => {
    // Pins that files carrying a color slate — the customer's red-opener
    // example, crossfading into a clip — keep opening forever, and that
    // version 5 with no media section means references-only.
    const bytes = Uint8Array.from(atob(fixtureV5SlateReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({ ok: true, project: fixtureV5ExpectedProject })
  })

  it('deserializes the committed v6 plugin-dependencies fixture (#197)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // recording plugin dependencies keep opening forever. The fixture is the
    // standard references project plus plugins: ["sample-webm"], so its
    // expectation re-derives from expectedProject (the fixture was written
    // by the current serializer, whose zooms carry ids).
    const bytes = Uint8Array.from(atob(fixtureV6PluginsReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: { ...expectedProject, plugins: ['sample-webm'] },
    })
  })

  it('deserializes the committed v5 slate embedded fixture, media byte-for-byte (#143)', async () => {
    // Its media bytes are pseudoRandomBytes(64, 9), re-derived here so
    // byte-identity stays checkable forever; the slate itself embeds nothing.
    const bytes = Uint8Array.from(atob(fixtureV5SlateEmbeddedBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(fixtureV5ExpectedProject)
      expect(result.media).toEqual(
        new Map<string, ClipMedia>([
          ['v1', { bytes: pseudoRandomBytes(64, 9), mimeType: 'video/mp4' }],
        ]),
      )
    }
  })
})

describe('time-remap effects in project files (#138)', () => {
  const remappedTimeline: TimelineState = {
    ...timeline,
    remaps: [
      { id: 'r1', entryId: 'e1', kind: 'speed', start: 1, end: 3, factor: 0.5 },
      { id: 'r2', entryId: 'e2', kind: 'pause', at: 2, hold: 1.5 },
    ],
  }
  const expectedRemappedProject: Project = {
    ...expectedProject,
    timeline: { ...expectedProject.timeline, remaps: remappedTimeline.remaps! },
  }

  it('round-trips remap effects in a references-only file without a version bump', async () => {
    const bytes = await serializeProject(library, remappedTimeline)
    const document = await gunzipJson(bytes)
    // Additive within the version, exactly like transitions and zooms: an
    // older build ignores the unknown key rather than refusing the file.
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(await deserializeProject(bytes)).toEqual({ ok: true, project: expectedRemappedProject })
  })

  it('round-trips remap effects in an embedded file', async () => {
    const media = fixtureMedia()
    const bytes = await serializeProject(library, remappedTimeline, media)
    const document = await gunzipJson(bytes)
    expect(document.schemaVersion).toBe(EMBEDDED_SCHEMA_VERSION)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedRemappedProject)
      expect(result.media).toBeDefined()
    }
  })

  it('writes the remaps key only while effects exist, keeping remap-free files unchanged', async () => {
    const withRemaps = await gunzipJson(await serializeProject(library, remappedTimeline))
    expect((withRemaps.timeline as Record<string, unknown>).remaps).toEqual([
      { id: 'r1', entryId: 'e1', kind: 'speed', start: 1, end: 3, factor: 0.5 },
      { id: 'r2', entryId: 'e2', kind: 'pause', at: 2, hold: 1.5 },
    ])
    const without = await gunzipJson(await serializeProject(library, timeline))
    expect(without.timeline as Record<string, unknown>).not.toHaveProperty('remaps')
  })

  it('a file without the remaps key parses without one, like every pre-#138 file', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result).toEqual({ ok: true, project: expectedProject })
    if (result.ok) expect(result.project.timeline).not.toHaveProperty('remaps')
  })

  it('refuses an effect for an unknown timeline entry', async () => {
    const document = validDocument()
    ;(document.timeline as { remaps?: unknown }).remaps = [
      { id: 'r1', entryId: 'ghost', kind: 'pause', at: 0, hold: 1 },
    ]
    await expectRefusal(await gzipJson(document), 'does not match any timeline entry')
  })

  it('refuses an effect on a still entry', async () => {
    const document = validDocument()
    ;(document.timeline as { entries: Record<string, unknown>[] }).entries.push({
      id: 's1',
      name: 'Color slate',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      color: '#ff0000',
    })
    ;(document.timeline as { remaps?: unknown }).remaps = [
      { id: 'r1', entryId: 's1', kind: 'pause', at: 0, hold: 1 },
    ]
    await expectRefusal(
      await gzipJson(document),
      'references a still entry, but time remapping applies to video entries only',
    )
  })

  it('refuses an unknown effect kind', async () => {
    const document = validDocument()
    ;(document.timeline as { remaps?: unknown }).remaps = [
      { id: 'r1', entryId: 'e1', kind: 'reverse', at: 0, hold: 1 },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.remaps[0].kind "reverse" is unknown')
  })

  it('refuses malformed effects field by field', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 1, end: 3, factor: 0 }, 'factor must be greater than 0'],
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 1, end: 3, factor: -2 }, 'factor must be greater than 0'],
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 3, end: 3, factor: 1 }, 'source range is empty'],
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 4, end: 3, factor: 1 }, 'source range is empty'],
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: -1, end: 3, factor: 1 }, 'must not be negative'],
      [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 1, end: 'x', factor: 1 }, 'must be a finite number'],
      [{ id: 'r1', entryId: 'e1', kind: 'pause', at: 0, hold: 0 }, 'hold must be greater than 0'],
      [{ id: 'r1', entryId: 'e1', kind: 'pause', at: -1, hold: 1 }, 'must not be negative'],
      [{ id: 'r1', entryId: 'e1', kind: 'pause', at: 0 }, 'must be a finite number'],
      [{ id: 'r1', entryId: 'e1', kind: 'pause', hold: 1 }, 'at must be a finite number'],
      [{ entryId: 'e1', kind: 'pause', at: 0, hold: 1 }, 'timeline.remaps[0].id'],
      [{ id: 'r1', kind: 'pause', at: 0, hold: 1 }, 'timeline.remaps[0].entryId'],
    ]
    for (const [remap, mention] of cases) {
      const document = validDocument()
      ;(document.timeline as { remaps?: unknown }).remaps = [remap]
      await expectRefusal(await gzipJson(document), mention)
    }
  })

  it('refuses duplicated effect ids', async () => {
    const document = validDocument()
    ;(document.timeline as { remaps?: unknown }).remaps = [
      { id: 'r1', entryId: 'e1', kind: 'pause', at: 0, hold: 1 },
      { id: 'r1', entryId: 'e2', kind: 'speed', start: 0, end: 1, factor: 2 },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.remaps[1].id "r1" is duplicated')
  })

  it('does not refuse overlapping windows — open-time normalization resolves them', async () => {
    const document = validDocument()
    ;(document.timeline as { remaps?: unknown }).remaps = [
      { id: 'r1', entryId: 'e1', kind: 'speed', start: 0, end: 5, factor: 0.5 },
      { id: 'r2', entryId: 'e1', kind: 'speed', start: 3, end: 7, factor: 2 },
    ]
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
  })
})

describe('text overlays in project files (#139)', () => {
  const overlay = {
    id: 't1',
    content: 'Hello\nworld',
    offset: 1,
    duration: 3,
    x: 0.5,
    y: 0.25,
    font: 'serif',
    size: 0.1,
    color: '#00ff88',
    bold: true,
    italic: false,
  } as const
  const textTimeline: TimelineState = { ...timeline, texts: [overlay] }
  const expectedTextProject: Project = {
    ...expectedProject,
    timeline: { ...expectedProject.timeline, texts: [overlay] },
  }

  it('round-trips overlays in a references-only file without a version bump', async () => {
    const bytes = await serializeProject(library, textTimeline)
    const document = await gunzipJson(bytes)
    // Additive within the version, exactly like remaps (#138): an older
    // build ignores the unknown key rather than refusing the file.
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(await deserializeProject(bytes)).toEqual({ ok: true, project: expectedTextProject })
  })

  it('round-trips overlays in an embedded file', async () => {
    const media = fixtureMedia()
    const bytes = await serializeProject(library, textTimeline, media)
    const document = await gunzipJson(bytes)
    expect(document.schemaVersion).toBe(EMBEDDED_SCHEMA_VERSION)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedTextProject)
      expect(result.media).toBeDefined()
    }
  })

  it('writes the texts key only while overlays exist, keeping text-free files unchanged', async () => {
    const withTexts = await gunzipJson(await serializeProject(library, textTimeline))
    expect((withTexts.timeline as Record<string, unknown>).texts).toEqual([overlay])
    const without = await gunzipJson(await serializeProject(library, timeline))
    expect(without.timeline as Record<string, unknown>).not.toHaveProperty('texts')
  })

  it('a file without the texts key parses without one, like every pre-#139 file', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result).toEqual({ ok: true, project: expectedProject })
    if (result.ok) expect(result.project.timeline).not.toHaveProperty('texts')
  })

  it('refuses an unknown font and a malformed color by name', async () => {
    for (const [patch, mention] of [
      [{ font: 'papyrus' }, 'timeline.texts[0].font "papyrus" is unknown'],
      [{ color: '#FFFFFF' }, 'is not a lowercase #rrggbb color'],
      [{ color: 'white' }, 'is not a lowercase #rrggbb color'],
    ] as const) {
      const document = validDocument()
      ;(document.timeline as { texts?: unknown }).texts = [{ ...overlay, ...patch }]
      await expectRefusal(await gzipJson(document), mention)
    }
  })

  it('refuses malformed overlays field by field', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...overlay, content: '' }, 'content must be a non-empty string'],
      [{ ...overlay, duration: 0 }, 'duration must be greater than 0'],
      [{ ...overlay, offset: -1 }, 'must not be negative'],
      [{ ...overlay, x: 1.5 }, 'x must be between 0 and 1'],
      [{ ...overlay, y: -0.5 }, 'y must be between 0 and 1'],
      [{ ...overlay, size: 0 }, 'size must be between'],
      [{ ...overlay, size: 2 }, 'size must be between'],
      [{ ...overlay, bold: 'yes' }, 'bold must be a boolean'],
      [{ ...overlay, italic: 1 }, 'italic must be a boolean'],
      [{ ...overlay, id: undefined }, 'timeline.texts[0].id'],
    ]
    for (const [text, mention] of cases) {
      const document = validDocument()
      ;(document.timeline as { texts?: unknown }).texts = [text]
      await expectRefusal(await gzipJson(document), mention)
    }
  })

  it('refuses duplicated overlay ids', async () => {
    const document = validDocument()
    ;(document.timeline as { texts?: unknown }).texts = [overlay, { ...overlay, content: 'Again' }]
    await expectRefusal(await gzipJson(document), 'timeline.texts[1].id "t1" is duplicated')
  })

  it('round-trips fades, writes them only when set, and refuses negatives (#177)', async () => {
    const fading = { ...overlay, fadeIn: 0.5, fadeOut: 1 }
    const bytes = await serializeProject(library, { ...timeline, texts: [fading] })
    expect((await gunzipJson(bytes)).timeline).toMatchObject({ texts: [fading] })
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.texts).toEqual([fading])

    // Fade-free overlays keep the file's shape from before #177 — the keys
    // are simply absent, and parse as absent (meaning 0).
    const withoutFades = await gunzipJson(await serializeProject(library, textTimeline))
    expect((withoutFades.timeline as { texts: object[] }).texts[0]).not.toHaveProperty('fadeIn')
    expect((withoutFades.timeline as { texts: object[] }).texts[0]).not.toHaveProperty('fadeOut')

    const document = validDocument()
    ;(document.timeline as { texts?: unknown }).texts = [{ ...overlay, fadeIn: -1 }]
    await expectRefusal(await gzipJson(document), 'timeline.texts[0].fadeIn must not be negative')
  })
})

describe('overlay video layers in project files (#145)', () => {
  const stored = {
    id: 'v1',
    clipId: 'c2',
    name: 'city.webm',
    duration: 4,
    offset: 1.5,
    inPoint: 0.5,
    outPoint: 3,
    x: 0.6,
    y: 0.6,
    width: 0.35,
    height: 0.35,
    volume: 0.5,
    muted: true,
  } as const
  const overlayTimeline: TimelineState = {
    ...timeline,
    videoOverlays: [{ ...stored, url: 'blob:session/c2' }],
  }
  const expectedOverlayProject: Project = {
    ...expectedProject,
    timeline: { ...expectedProject.timeline, videoOverlays: [stored] },
  }

  it('round-trips overlays in a references-only file without a version bump or url', async () => {
    const bytes = await serializeProject(library, overlayTimeline)
    const document = await gunzipJson(bytes)
    // Additive within the version, like remaps (#138) and texts (#139).
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(await deserializeProject(bytes)).toEqual({ ok: true, project: expectedOverlayProject })
    // The session-bound object URL never reaches the file.
    const written = (document.timeline as { videoOverlays: unknown[] }).videoOverlays[0]
    expect(written).not.toHaveProperty('url')
  })

  it('round-trips overlays in an embedded file', async () => {
    const bytes = await serializeProject(library, overlayTimeline, fixtureMedia())
    expect((await gunzipJson(bytes)).schemaVersion).toBe(EMBEDDED_SCHEMA_VERSION)
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project).toEqual(expectedOverlayProject)
  })

  it('omits absent gain fields, and the key itself while no overlays exist', async () => {
    const bare = { ...stored, url: 'blob:session/c2' } as Record<string, unknown>
    delete bare.volume
    delete bare.muted
    const document = await gunzipJson(
      await serializeProject(library, { ...timeline, videoOverlays: [bare as never] }),
    )
    const written = (document.timeline as { videoOverlays: Record<string, unknown>[] })
      .videoOverlays[0]
    expect(written).not.toHaveProperty('volume')
    expect(written).not.toHaveProperty('muted')
    const without = await gunzipJson(await serializeProject(library, timeline))
    expect(without.timeline as Record<string, unknown>).not.toHaveProperty('videoOverlays')
  })

  it('a file without the key parses without one, like every pre-#145 file', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result).toEqual({ ok: true, project: expectedProject })
    if (result.ok) expect(result.project.timeline).not.toHaveProperty('videoOverlays')
  })

  it('refuses malformed overlays field by field', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...stored, clipId: 'missing' }, 'does not match any clip'],
      [{ ...stored, clipId: 'c9' }, 'does not match any clip'],
      [{ ...stored, duration: 0 }, 'duration must be greater than 0'],
      [{ ...stored, offset: -1 }, 'must not be negative'],
      [{ ...stored, inPoint: 3, outPoint: 3 }, 'trim range is empty'],
      [{ ...stored, outPoint: 99 }, 'outPoint must not exceed the clip duration'],
      [{ ...stored, width: 0 }, 'width must be within (0, 1]'],
      [{ ...stored, height: 1.5 }, 'height must be within (0, 1]'],
      [{ ...stored, x: 0.8 }, 'places the rectangle beyond the frame edge'],
      [{ ...stored, y: 0.9 }, 'places the rectangle beyond the frame edge'],
      [{ ...stored, volume: 2 }, 'volume'],
      [{ ...stored, muted: 'yes' }, 'muted must be a boolean'],
      [{ ...stored, id: undefined }, 'timeline.videoOverlays[0].id'],
    ]
    for (const [overlay, mention] of cases) {
      const document = validDocument()
      ;(document.timeline as { videoOverlays?: unknown }).videoOverlays = [overlay]
      await expectRefusal(await gzipJson(document), mention)
    }
  })

  it('refuses an overlay referencing a non-video clip', async () => {
    const document = validDocument()
    ;(document.clips as unknown as Record<string, unknown>[]).push({
      id: 'a1',
      name: 'song.mp3',
      duration: 30,
      kind: 'audio',
    })
    ;(document.timeline as { videoOverlays?: unknown }).videoOverlays = [
      { ...stored, clipId: 'a1', duration: 30, outPoint: 3 },
    ]
    await expectRefusal(
      await gzipJson(document),
      'references an audio clip, but overlay layers carry video only',
    )
  })

  it('refuses duplicated overlay ids', async () => {
    const document = validDocument()
    ;(document.timeline as { videoOverlays?: unknown }).videoOverlays = [
      stored,
      { ...stored, x: 0.1 },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.videoOverlays[1].id "v1" is duplicated')
  })
})

describe('color adjustments in project files (#192, schema version 7)', () => {
  const adjustedTimeline = (): TimelineState => ({
    ...timeline,
    entries: [
      { ...timeline.entries[0], colorAdjustments: { brightness: 150, look: 'sepia' } },
      ...timeline.entries.slice(1),
    ],
  })
  const overlayAdjustedTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        colorAdjustments: { saturation: 0 },
      },
    ],
  })

  it('writes version 7 with the adjustments exactly when any exist, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, adjustedTimeline()))
    expect(references.schemaVersion).toBe(COLOR_ADJUSTMENTS_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const embedded = await gunzipJson(
      await serializeProject(library, adjustedTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(COLOR_ADJUSTMENTS_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
    // An adjusted overlay alone forces version 7 too.
    const overlayOnly = await gunzipJson(await serializeProject(library, overlayAdjustedTimeline()))
    expect(overlayOnly.schemaVersion).toBe(COLOR_ADJUSTMENTS_SCHEMA_VERSION)
  })

  it('an adjustment-free project stays byte-identical to earlier output', async () => {
    const withKeylessEntries = await serializeProject(library, timeline)
    const document = await gunzipJson(withKeylessEntries)
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document)).not.toContain('colorAdjustments')
  })

  it('round-trips adjustments on entries and overlays', async () => {
    const result = await deserializeProject(
      await serializeProject(library, {
        ...adjustedTimeline(),
        videoOverlays: overlayAdjustedTimeline().videoOverlays,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0].colorAdjustments).toEqual({
        brightness: 150,
        look: 'sepia',
      })
      expect(result.project.timeline.entries[1].colorAdjustments).toBeUndefined()
      expect(result.project.timeline.videoOverlays?.[0].colorAdjustments).toEqual({ saturation: 0 })
    }
  })

  it('pre-#192 files (and adjustment-free files since) open unadjusted', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.project.timeline.entries.every((entry) => entry.colorAdjustments === undefined),
      ).toBe(true)
    }
  })

  it('refuses malformed adjustments by name', async () => {
    const notRecord = validDocument()
    ;(notRecord.timeline.entries[0] as Record<string, unknown>).colorAdjustments = 'sepia'
    await expectRefusal(
      await gzipJson(notRecord),
      'timeline.entries[0].colorAdjustments must be an object',
    )

    const outOfRange = validDocument()
    ;(outOfRange.timeline.entries[0] as Record<string, unknown>).colorAdjustments = { brightness: 300 }
    await expectRefusal(
      await gzipJson(outOfRange),
      'timeline.entries[0].colorAdjustments.brightness must be between 0 and 200',
    )

    const unknownLook = validDocument()
    ;(unknownLook.timeline.entries[0] as Record<string, unknown>).colorAdjustments = { look: 'blur' }
    await expectRefusal(
      await gzipJson(unknownLook),
      'timeline.entries[0].colorAdjustments.look "blur" is unknown',
    )
  })

  it('refuses adjustments on a slate entry — its color is set directly (#143)', async () => {
    const document = validDocument()
    ;(document.timeline.entries as Record<string, unknown>[]).push({
      id: 's1',
      name: 'Color slate',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      color: '#ff0000',
      colorAdjustments: { brightness: 150 },
    })
    await expectRefusal(await gzipJson(document), 'slate entry', 'video and image entries only')
  })

  it("normalizes a foreign writer's identity values away instead of refusing", async () => {
    const document = validDocument()
    ;(document.timeline.entries[0] as Record<string, unknown>).colorAdjustments = {
      brightness: 100,
      contrast: 100,
      saturation: 100,
    }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0].colorAdjustments).toBeUndefined()
    }
  })

  it('deserializes the committed v7 color-adjustments fixture (#192)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // carrying color adjustments keep opening forever. The fixture holds an
    // adjusted first entry (brightness + sepia), an unadjusted second, and a
    // desaturated overlay, references-only.
    const bytes = Uint8Array.from(atob(fixtureV7ColorReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: [
            { ...expectedProject.timeline.entries[0], colorAdjustments: { brightness: 150, look: 'sepia' } },
            expectedProject.timeline.entries[1],
          ],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
          zooms: [],
          audioTracks: [],
          videoOverlays: [
            {
              id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
              offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
              colorAdjustments: { saturation: 0 },
            },
          ],
        },
      },
    })
  })
})

describe('entry and overlay audio fades in project files (#220, schema version 8)', () => {
  const fadingTimeline = (): TimelineState => ({
    ...timeline,
    entries: [
      { ...timeline.entries[0], fadeIn: 1.5, fadeOut: 2 },
      ...timeline.entries.slice(1),
    ],
  })
  const overlayFadingTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        fadeIn: 0.75,
      },
    ],
  })

  it('writes version 8 with the fades exactly when any exist, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, fadingTimeline()))
    expect(references.schemaVersion).toBe(AUDIO_FADES_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const embedded = await gunzipJson(
      await serializeProject(library, fadingTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(AUDIO_FADES_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
    // A fading overlay alone forces version 8 too.
    const overlayOnly = await gunzipJson(await serializeProject(library, overlayFadingTimeline()))
    expect(overlayOnly.schemaVersion).toBe(AUDIO_FADES_SCHEMA_VERSION)
  })

  it('a fade-free project stays byte-identical to earlier output', async () => {
    // Audio-track fades (#104) and text fades (#177) predate version 8 and
    // must not force it — only entry/overlay fades are new.
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('fadeIn')
    expect(JSON.stringify(document.timeline)).not.toContain('fadeOut')
  })

  it('audio-track fades alone stay at their pre-#220 version', async () => {
    const withTrackFades: TimelineState = {
      ...timeline,
      audioTracks: [
        {
          id: 't1', clipId: 'c1', name: 'holiday.mp4', duration: 12.375, url: 'blob:session/c1',
          offset: 0, inPoint: 0, outPoint: 10, fadeIn: 1, fadeOut: 1,
        },
      ],
    }
    const document = await gunzipJson(await serializeProject(library, withTrackFades))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
  })

  it('round-trips fades on entries and overlays', async () => {
    const result = await deserializeProject(
      await serializeProject(library, {
        ...fadingTimeline(),
        videoOverlays: overlayFadingTimeline().videoOverlays,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0]).toMatchObject({ fadeIn: 1.5, fadeOut: 2 })
      expect(result.project.timeline.entries[1].fadeIn).toBeUndefined()
      expect(result.project.timeline.entries[1].fadeOut).toBeUndefined()
      expect(result.project.timeline.videoOverlays?.[0].fadeIn).toBe(0.75)
      expect(result.project.timeline.videoOverlays?.[0].fadeOut).toBeUndefined()
    }
  })

  it('pre-#220 files (and fade-free files since) open unfaded', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.project.timeline.entries.every(
          (entry) => entry.fadeIn === undefined && entry.fadeOut === undefined,
        ),
      ).toBe(true)
    }
  })

  it('refuses malformed fades by name', async () => {
    const negative = validDocument()
    ;(negative.timeline.entries[0] as Record<string, unknown>).fadeIn = -1
    await expectRefusal(await gzipJson(negative), 'timeline.entries[0].fadeIn must not be negative')

    const notANumber = validDocument()
    ;(notANumber.timeline.entries[0] as Record<string, unknown>).fadeOut = 'long'
    await expectRefusal(await gzipJson(notANumber), 'timeline.entries[0].fadeOut')
  })

  it('refuses fades on slate and image entries — they are soundless', async () => {
    const slate = validDocument()
    ;(slate.timeline.entries as Record<string, unknown>[]).push({
      id: 's1',
      name: 'Color slate',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      color: '#ff0000',
      fadeIn: 1,
    })
    await expectRefusal(await gzipJson(slate), 'slate entry is soundless', 'video entries only')
  })

  it('refuses malformed overlay fades by name', async () => {
    const document = validDocument()
    ;(document.timeline as unknown as Record<string, unknown>).videoOverlays = [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        fadeOut: Number.NaN,
      },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.videoOverlays[0].fadeOut')
  })

  it('deserializes the committed v8 audio-fades fixture (#220)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // carrying entry/overlay audio fades keep opening forever. The fixture
    // holds a fading first entry (fadeIn 1.5, fadeOut 2), an unfaded second,
    // and an overlay with fadeIn 0.75, references-only.
    const bytes = Uint8Array.from(atob(fixtureV8FadesReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: [
            { ...expectedProject.timeline.entries[0], fadeIn: 1.5, fadeOut: 2 },
            expectedProject.timeline.entries[1],
          ],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
          zooms: [],
          audioTracks: [],
          videoOverlays: [
            {
              id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
              offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
              fadeIn: 0.75,
            },
          ],
        },
      },
    })
  })
})

describe('entry and overlay orientation in project files (#232, schema version 9)', () => {
  const orientedTimeline = (): TimelineState => ({
    ...timeline,
    entries: [
      { ...timeline.entries[0], orientation: { rotation: 90, flipH: true } },
      ...timeline.entries.slice(1),
    ],
  })
  const overlayOrientedTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        orientation: { rotation: 180 },
      },
    ],
  })

  it('writes version 9 with the orientation exactly when any exists, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, orientedTimeline()))
    expect(references.schemaVersion).toBe(ORIENTATION_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const embedded = await gunzipJson(
      await serializeProject(library, orientedTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(ORIENTATION_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
    // An oriented overlay alone forces version 9 too.
    const overlayOnly = await gunzipJson(await serializeProject(library, overlayOrientedTimeline()))
    expect(overlayOnly.schemaVersion).toBe(ORIENTATION_SCHEMA_VERSION)
  })

  it('an orientation-free project stays byte-identical to earlier output', async () => {
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('orientation')
  })

  it('audio fades without orientation stay at version 8 — the chain orders by newest feature', async () => {
    const faded: TimelineState = {
      ...timeline,
      entries: [{ ...timeline.entries[0], fadeIn: 1 }, ...timeline.entries.slice(1)],
    }
    const document = await gunzipJson(await serializeProject(library, faded))
    expect(document.schemaVersion).toBe(AUDIO_FADES_SCHEMA_VERSION)
  })

  it('round-trips orientation on entries and overlays', async () => {
    const result = await deserializeProject(
      await serializeProject(library, {
        ...orientedTimeline(),
        videoOverlays: overlayOrientedTimeline().videoOverlays,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0].orientation).toEqual({
        rotation: 90,
        flipH: true,
      })
      expect(result.project.timeline.entries[1].orientation).toBeUndefined()
      expect(result.project.timeline.videoOverlays?.[0].orientation).toEqual({ rotation: 180 })
    }
  })

  it('pre-#232 files (and orientation-free files since) open unoriented', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(
        result.project.timeline.entries.every((entry) => entry.orientation === undefined),
      ).toBe(true)
    }
  })

  it("normalizes a foreign writer's identity-only orientation away", async () => {
    const document = validDocument()
    ;(document.timeline.entries[0] as Record<string, unknown>).orientation = {
      flipH: false,
      flipV: false,
    }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.entries[0].orientation).toBeUndefined()
  })

  it('refuses malformed orientation by name', async () => {
    const angle = validDocument()
    ;(angle.timeline.entries[0] as Record<string, unknown>).orientation = { rotation: 45 }
    await expectRefusal(
      await gzipJson(angle),
      'timeline.entries[0].orientation.rotation must be one of 90, 180, 270',
    )

    const flip = validDocument()
    ;(flip.timeline.entries[0] as Record<string, unknown>).orientation = { flipH: 'yes' }
    await expectRefusal(
      await gzipJson(flip),
      'timeline.entries[0].orientation.flipH must be a boolean',
    )
  })

  it('refuses orientation on slate entries — a flat color has no sideways', async () => {
    const slate = validDocument()
    ;(slate.timeline.entries as Record<string, unknown>[]).push({
      id: 's1',
      name: 'Color slate',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      color: '#ff0000',
      orientation: { rotation: 90 },
    })
    await expectRefusal(await gzipJson(slate), 'slate entry', 'video and image entries only')
  })

  it('accepts orientation on image entries — a sideways photo is the use case', async () => {
    const document = validDocument()
    ;(document.clips as unknown as Record<string, unknown>[]).push({
      id: 'c3',
      name: 'photo.png',
      duration: 0,
      kind: 'image',
    })
    ;(document.timeline.entries as Record<string, unknown>[]).push({
      id: 'e4',
      clipId: 'c3',
      name: 'photo.png',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      kind: 'image',
      orientation: { rotation: 270, flipV: true },
    })
    ;(document as Record<string, unknown>).schemaVersion = ORIENTATION_SCHEMA_VERSION
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[3].orientation).toEqual({
        rotation: 270,
        flipV: true,
      })
    }
  })

  it('refuses malformed overlay orientation by name', async () => {
    const document = validDocument()
    ;(document.timeline as unknown as Record<string, unknown>).videoOverlays = [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        orientation: { rotation: 'sideways' },
      },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.videoOverlays[0].orientation.rotation')
  })

  it('deserializes the committed v9 orientation fixture (#232)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced orientation keep opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV9OrientationReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: [
            { ...expectedProject.timeline.entries[0], orientation: { rotation: 90, flipH: true } },
            expectedProject.timeline.entries[1],
          ],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
          zooms: [],
          audioTracks: [],
          videoOverlays: [
            {
              id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
              offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
              orientation: { rotation: 180 },
            },
          ],
        },
      },
    })
  })
})

describe('audio ducking in project files (#241, schema version 10)', () => {
  const duckLibrary: MediaLibraryState = {
    clips: [
      ...library.clips,
      { id: 'c3', name: 'voice.webm', duration: 6, url: 'blob:session/c3', kind: 'audio' },
    ],
    failures: [],
  }
  const duckedTimeline = (): TimelineState => ({
    ...timeline,
    audioTracks: [
      {
        id: 'a1', clipId: 'c3', name: 'voice.webm', duration: 6, url: 'blob:session/c3',
        offset: 1, inPoint: 0.5, outPoint: 5.5, volume: 0.8, duck: true, duckLevel: 0.4,
      },
    ],
  })

  it('writes version 10 exactly when a track ducks, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(duckLibrary, duckedTimeline()))
    expect(references.schemaVersion).toBe(DUCKING_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const media = new Map<string, ClipMedia>([
      ['c1', { bytes: pseudoRandomBytes(64, 7), mimeType: 'video/mp4' }],
      ['c2', { bytes: pseudoRandomBytes(64, 8), mimeType: 'video/webm' }],
      ['c3', { bytes: pseudoRandomBytes(64, 9), mimeType: 'audio/webm' }],
    ])
    const embedded = await gunzipJson(await serializeProject(duckLibrary, duckedTimeline(), media))
    expect(embedded.schemaVersion).toBe(DUCKING_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
  })

  it('a duck-free project keeps its earlier version and carries no duck keys', async () => {
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('duck')
  })

  it('round-trips duck fields through serialize/deserialize', async () => {
    const result = await deserializeProject(await serializeProject(duckLibrary, duckedTimeline()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.audioTracks).toEqual([
        {
          id: 'a1', clipId: 'c3', name: 'voice.webm', duration: 6,
          offset: 1, inPoint: 0.5, outPoint: 5.5, volume: 0.8, duck: true, duckLevel: 0.4,
        },
      ])
    }
  })

  it('normalizes a foreign duck:false to absent and drops a level without the toggle', async () => {
    const document = validDocument()
    ;(document as Record<string, unknown>).schemaVersion = DUCKING_SCHEMA_VERSION
    ;(document.clips as unknown as Record<string, unknown>[]).push({
      id: 'c3', name: 'voice.webm', duration: 6, kind: 'audio',
    })
    ;(document.timeline as { audioTracks?: unknown[] }).audioTracks = [
      {
        id: 'a1', clipId: 'c3', name: 'voice.webm', duration: 6,
        offset: 0, inPoint: 0, outPoint: 6, duck: false, duckLevel: 0.4,
      },
    ]
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const track = result.project.timeline.audioTracks[0]
      expect(track.duck).toBeUndefined()
      expect(track.duckLevel).toBeUndefined()
    }
  })

  it('refuses malformed duck fields by name', async () => {
    const document = validDocument()
    ;(document as Record<string, unknown>).schemaVersion = DUCKING_SCHEMA_VERSION
    ;(document.clips as unknown as Record<string, unknown>[]).push({
      id: 'c3', name: 'voice.webm', duration: 6, kind: 'audio',
    })
    const withTrack = (fields: Record<string, unknown>) => {
      const copy = structuredClone(document)
      ;(copy.timeline as { audioTracks?: unknown[] }).audioTracks = [
        {
          id: 'a1', clipId: 'c3', name: 'voice.webm', duration: 6,
          offset: 0, inPoint: 0, outPoint: 6, ...fields,
        },
      ]
      return copy
    }
    await expectRefusal(await gzipJson(withTrack({ duck: 'yes' })), 'timeline.audioTracks[0].duck')
    await expectRefusal(
      await gzipJson(withTrack({ duck: true, duckLevel: 2 })),
      'timeline.audioTracks[0].duckLevel',
    )
  })

  it('deserializes the committed v10 ducking fixture (#241)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced ducking keep opening identically
    // forever.
    const bytes = Uint8Array.from(atob(fixtureV10DuckingReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: [
          ...expectedProject.clips,
          { id: 'c3', name: 'voice.webm', duration: 6, kind: 'audio' },
        ],
        timeline: {
          entries: [expectedProject.timeline.entries[0], expectedProject.timeline.entries[1]],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
          zooms: [],
          audioTracks: [
            {
              id: 'a1', clipId: 'c3', name: 'voice.webm', duration: 6,
              offset: 1, inPoint: 0.5, outPoint: 5.5, volume: 0.8, duck: true, duckLevel: 0.4,
            },
            {
              id: 'a2', clipId: 'c3', name: 'voice.webm', duration: 6,
              offset: 8, inPoint: 0, outPoint: 6, duck: true,
            },
          ],
        },
      },
    })
  })
})

describe('subtitle text overlays in project files (#249, schema version 11)', () => {
  const subtitleOverlay = {
    id: 't1',
    content: 'Hello there',
    offset: 1,
    duration: 2,
    x: 0.5,
    y: 0.9,
    font: 'sans',
    size: 0.05,
    color: '#ffffff',
    bold: false,
    italic: false,
    subtitle: true,
  } as const
  const plainOverlay = {
    id: 't2',
    content: 'Hand-made title',
    offset: 4,
    duration: 2,
    x: 0.5,
    y: 0.5,
    font: 'serif',
    size: 0.08,
    color: '#00ff88',
    bold: true,
    italic: false,
  } as const
  const subtitleTimeline = (): TimelineState => ({
    ...timeline,
    texts: [subtitleOverlay, plainOverlay],
  })

  it('writes version 11 exactly when a subtitle-marked overlay exists, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, subtitleTimeline()))
    expect(references.schemaVersion).toBe(SUBTITLE_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const media = fixtureMedia()
    const embedded = await gunzipJson(await serializeProject(library, subtitleTimeline(), media))
    expect(embedded.schemaVersion).toBe(SUBTITLE_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
  })

  it('a subtitle-free project keeps its earlier version and carries no subtitle keys', async () => {
    const document = await gunzipJson(
      await serializeProject(library, { ...timeline, texts: [plainOverlay] }),
    )
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('subtitle')
  })

  it('round-trips the subtitle marker through serialize/deserialize', async () => {
    const result = await deserializeProject(await serializeProject(library, subtitleTimeline()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.texts).toEqual([subtitleOverlay, plainOverlay])
    }
  })

  it('normalizes a foreign subtitle:false to absent', async () => {
    const document = validDocument()
    ;(document as Record<string, unknown>).schemaVersion = SUBTITLE_SCHEMA_VERSION
    ;(document.timeline as { texts?: unknown[] }).texts = [
      { ...plainOverlay, subtitle: false },
    ]
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.texts?.[0].subtitle).toBeUndefined()
    }
  })

  it('refuses a malformed subtitle field by name', async () => {
    const document = validDocument()
    ;(document as Record<string, unknown>).schemaVersion = SUBTITLE_SCHEMA_VERSION
    ;(document.timeline as { texts?: unknown[] }).texts = [
      { ...plainOverlay, subtitle: 'yes' },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.texts[0].subtitle')
  })

  it('deserializes the committed v11 subtitle fixture (#249)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced the subtitle marker keep opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV11SubtitleReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          ...expectedProject.timeline,
          texts: [subtitleOverlay, plainOverlay],
        },
      },
    })
  })
})

describe('entry and overlay crop in project files (#255, schema version 12)', () => {
  const croppedTimeline = (): TimelineState => ({
    ...timeline,
    entries: [
      { ...timeline.entries[0], crop: { left: 0.25, top: 0.1 } },
      ...timeline.entries.slice(1),
    ],
  })
  const overlayCroppedTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        crop: { right: 0.2 },
      },
    ],
  })

  it('writes version 12 with the crop exactly when any exists, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, croppedTimeline()))
    expect(references.schemaVersion).toBe(CROP_SCHEMA_VERSION)
    expect(references).not.toHaveProperty('media')
    const embedded = await gunzipJson(
      await serializeProject(library, croppedTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(CROP_SCHEMA_VERSION)
    expect(embedded).toHaveProperty('media')
    // A cropped overlay alone forces version 12 too.
    const overlayOnly = await gunzipJson(await serializeProject(library, overlayCroppedTimeline()))
    expect(overlayOnly.schemaVersion).toBe(CROP_SCHEMA_VERSION)
  })

  it('a crop-free project stays byte-identical to earlier output', async () => {
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('crop')
  })

  it('a subtitle without crop stays at version 11 — the chain orders by newest feature', async () => {
    const subtitled: TimelineState = {
      ...timeline,
      texts: [
        {
          id: 't1', content: 'Cue', offset: 0, duration: 1, x: 0.5, y: 0.9,
          font: 'sans', size: 0.05, color: '#ffffff', bold: false, italic: false,
          subtitle: true,
        },
      ],
    }
    const document = await gunzipJson(await serializeProject(library, subtitled))
    expect(document.schemaVersion).toBe(SUBTITLE_SCHEMA_VERSION)
  })

  it('round-trips crop on entries and overlays', async () => {
    const result = await deserializeProject(
      await serializeProject(library, {
        ...croppedTimeline(),
        videoOverlays: overlayCroppedTimeline().videoOverlays,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0].crop).toEqual({ left: 0.25, top: 0.1 })
      expect(result.project.timeline.entries[1].crop).toBeUndefined()
      expect(result.project.timeline.videoOverlays?.[0].crop).toEqual({ right: 0.2 })
    }
  })

  it('pre-#255 files (and crop-free files since) open uncropped', async () => {
    const result = await deserializeProject(await gzipJson(validDocument()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries.every((entry) => entry.crop === undefined)).toBe(true)
    }
  })

  it("normalizes a foreign writer's zero-edge crop away", async () => {
    const document = validDocument()
    ;(document.timeline.entries[0] as Record<string, unknown>).crop = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.entries[0].crop).toBeUndefined()
  })

  it("clamps a foreign writer's over-deep pair to the minimum kept fraction", async () => {
    const document = validDocument()
    ;(document.timeline.entries[0] as Record<string, unknown>).crop = { left: 0.6, right: 0.5 }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const { left = 0, right = 0 } = result.project.timeline.entries[0].crop!
      expect(1 - left - right).toBeCloseTo(0.1, 10)
    }
  })

  it('refuses malformed crop by name', async () => {
    const outOfRange = validDocument()
    ;(outOfRange.timeline.entries[0] as Record<string, unknown>).crop = { left: 1.5 }
    await expectRefusal(
      await gzipJson(outOfRange),
      'timeline.entries[0].crop.left must be a fraction at least 0 and below 1',
    )
    const negative = validDocument()
    ;(negative.timeline.entries[0] as Record<string, unknown>).crop = { top: -0.2 }
    await expectRefusal(
      await gzipJson(negative),
      'timeline.entries[0].crop.top must be a fraction at least 0 and below 1',
    )
    const wrongType = validDocument()
    ;(wrongType.timeline.entries[0] as Record<string, unknown>).crop = { bottom: 'deep' }
    await expectRefusal(await gzipJson(wrongType), 'timeline.entries[0].crop.bottom')
  })

  it('refuses crop on slate entries — a flat color has nothing to trim', async () => {
    const document = validDocument()
    ;(document.timeline.entries as unknown[]).push({
      id: 's1',
      name: 'Slate',
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      color: '#112233',
      crop: { left: 0.5 },
    })
    await expectRefusal(await gzipJson(document), 'timeline.entries[3].crop is set on a slate entry')
  })

  it('refuses malformed overlay crop by name', async () => {
    const document = validDocument()
    ;(document.timeline as unknown as Record<string, unknown>).videoOverlays = [
      {
        id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
        offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
        crop: { right: 2 },
      },
    ]
    await expectRefusal(await gzipJson(document), 'timeline.videoOverlays[0].crop.right')
  })

  it('deserializes the committed v12 crop fixture (#255)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced crop keep opening identically
    // forever.
    const bytes = Uint8Array.from(atob(fixtureV12CropReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: [
            { ...expectedProject.timeline.entries[0], crop: { left: 0.25, top: 0.1 } },
            expectedProject.timeline.entries[1],
          ],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
          zooms: [],
          audioTracks: [],
          videoOverlays: [
            {
              id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4,
              offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
              crop: { right: 0.2 },
            },
          ],
        },
      },
    })
  })
})

describe('default subtitle style in project files (#250, schema version 13)', () => {
  const customStyle = {
    x: 0.5,
    y: 0.9,
    font: 'serif',
    size: 0.06,
    color: '#ffff00',
    bold: true,
    italic: false,
  } as const

  const subtitleText = (overrides: Partial<TextOverlay> = {}): TextOverlay => ({
    id: 't-sub',
    content: 'Hello there',
    offset: 1,
    duration: 2,
    x: 0.5,
    y: 0.9,
    font: 'sans',
    size: 0.05,
    color: '#ffffff',
    bold: false,
    italic: false,
    subtitle: true,
    ...overrides,
  })

  const styledTimeline = (): TimelineState => ({
    ...timeline,
    texts: [subtitleText()],
    subtitleStyle: { ...customStyle },
  })

  it('writes version 13 with the style exactly when customized, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, styledTimeline()))
    expect(references.schemaVersion).toBe(SUBTITLE_STYLE_SCHEMA_VERSION)
    expect((references.timeline as Record<string, unknown>).subtitleStyle).toEqual(customStyle)
    const embedded = await gunzipJson(
      await serializeProject(library, styledTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(SUBTITLE_STYLE_SCHEMA_VERSION)

    // A style override alone forces version 13 too — the file must reach a
    // build that knows to honor it.
    const overridesOnly = await gunzipJson(
      await serializeProject(library, {
        ...timeline,
        texts: [subtitleText({ color: '#00ff00', styleOverrides: ['color'] })],
      }),
    )
    expect(overridesOnly.schemaVersion).toBe(SUBTITLE_STYLE_SCHEMA_VERSION)
  })

  it('a style-free project stays byte-identical to earlier output', async () => {
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('subtitleStyle')
    expect(JSON.stringify(document.timeline)).not.toContain('styleOverrides')
    // An imported subtitle that never diverged from the default carries no
    // style data either — it stays at the subtitle marker's own version.
    const subtitled = await gunzipJson(
      await serializeProject(library, { ...timeline, texts: [subtitleText()] }),
    )
    expect(subtitled.schemaVersion).toBe(SUBTITLE_SCHEMA_VERSION)
  })

  it('a crop without style data stays at version 12 — the chain orders by newest feature', async () => {
    const document = await gunzipJson(
      await serializeProject(library, {
        ...timeline,
        entries: [{ ...timeline.entries[0], crop: { left: 0.25 } }, ...timeline.entries.slice(1)],
      }),
    )
    expect(document.schemaVersion).toBe(CROP_SCHEMA_VERSION)
  })

  it('round-trips the style and per-overlay overrides', async () => {
    const styled: TimelineState = {
      ...timeline,
      texts: [
        subtitleText({ color: '#00ff00', styleOverrides: ['color'] }),
        subtitleText({ id: 't-hand', subtitle: undefined, content: 'Hand-made title' }),
      ],
      subtitleStyle: { ...customStyle },
    }
    const result = await deserializeProject(await serializeProject(library, styled))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.subtitleStyle).toEqual(customStyle)
      expect(result.project.timeline.texts?.[0].styleOverrides).toEqual(['color'])
      expect(result.project.timeline.texts?.[1].styleOverrides).toBeUndefined()
      expect(result.project.timeline.texts?.[1].subtitle).toBeUndefined()
    }
  })

  it('pre-#250 files (and style-free files since) open with no stored style', async () => {
    const result = await deserializeProject(await serializeProject(library, timeline))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.subtitleStyle).toBeUndefined()
  })

  it("normalizes a foreign writer's built-in-default style away", async () => {
    const document = validDocument()
    ;(document.timeline as unknown as Record<string, unknown>).subtitleStyle = {
      x: 0.5,
      y: 0.9,
      font: 'sans',
      size: 0.05,
      color: '#ffffff',
      bold: false,
      italic: false,
    }
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.timeline.subtitleStyle).toBeUndefined()
  })

  it('normalizes foreign override lists to canonical order and drops empty ones', async () => {
    const document = validDocument()
    ;(document.timeline as unknown as Record<string, unknown>).texts = [
      { ...subtitleText({ styleOverrides: ['italic', 'x'] as never }) },
      { ...subtitleText({ id: 't2', styleOverrides: [] as never }) },
    ]
    const result = await deserializeProject(await gzipJson(document))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.texts?.[0].styleOverrides).toEqual(['x', 'italic'])
      expect(result.project.timeline.texts?.[1].styleOverrides).toBeUndefined()
    }
  })

  it('refuses a malformed style by name', async () => {
    const badFont = validDocument()
    ;(badFont.timeline as unknown as Record<string, unknown>).subtitleStyle = { ...customStyle, font: 'comic-sans' }
    await expectRefusal(await gzipJson(badFont), 'timeline.subtitleStyle.font "comic-sans" is unknown')

    const badColor = validDocument()
    ;(badColor.timeline as unknown as Record<string, unknown>).subtitleStyle = { ...customStyle, color: 'yellow' }
    await expectRefusal(
      await gzipJson(badColor),
      'timeline.subtitleStyle.color "yellow" is not a lowercase #rrggbb color',
    )

    const outOfRange = validDocument()
    ;(outOfRange.timeline as unknown as Record<string, unknown>).subtitleStyle = { ...customStyle, y: 1.5 }
    await expectRefusal(await gzipJson(outOfRange), 'timeline.subtitleStyle.y must be between 0 and 1')

    const badSize = validDocument()
    ;(badSize.timeline as unknown as Record<string, unknown>).subtitleStyle = { ...customStyle, size: 2 }
    await expectRefusal(await gzipJson(badSize), 'timeline.subtitleStyle.size must be between')
  })

  it('refuses malformed or misplaced style overrides by name', async () => {
    const unknownField = validDocument()
    ;(unknownField.timeline as unknown as Record<string, unknown>).texts = [
      subtitleText({ styleOverrides: ['shadow'] as never }),
    ]
    await expectRefusal(
      await gzipJson(unknownField),
      'timeline.texts[0].styleOverrides[0] "shadow" is not a subtitle style field',
    )

    const onHandMade = validDocument()
    ;(onHandMade.timeline as unknown as Record<string, unknown>).texts = [
      subtitleText({ id: 't-hand', subtitle: undefined, styleOverrides: ['color'] }),
    ]
    await expectRefusal(
      await gzipJson(onHandMade),
      'timeline.texts[0].styleOverrides is set on a non-subtitle text overlay',
    )
  })

  it('deserializes the committed v13 subtitle-style fixture (#250)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced the default subtitle style keep
    // opening identically forever.
    const bytes = Uint8Array.from(atob(fixtureV13SubtitleStyleReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: expectedProject.timeline.entries,
          transitions: expectedProject.timeline.transitions,
          zooms: expectedProject.timeline.zooms,
          texts: [subtitleText({ color: '#00ff00', styleOverrides: ['color'] })],
          subtitleStyle: customStyle,
          audioTracks: [],
        },
      },
    })
  })
})

describe('background fill in project files (#259, schema version 14)', () => {
  const filledTimeline = (): TimelineState => ({
    ...timeline,
    entries: [
      { ...timeline.entries[0], backgroundFill: { kind: 'blur' } },
      { ...timeline.entries[1], backgroundFill: { kind: 'color', color: '#112233' } },
      ...timeline.entries.slice(2),
    ],
  })

  it('writes version 14 with the fill exactly when set, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, filledTimeline()))
    expect(references.schemaVersion).toBe(BACKGROUND_FILL_SCHEMA_VERSION)
    const entries = (references.timeline as { entries: Record<string, unknown>[] }).entries
    expect(entries[0].backgroundFill).toEqual({ kind: 'blur' })
    expect(entries[1].backgroundFill).toEqual({ kind: 'color', color: '#112233' })
    expect('backgroundFill' in entries[2]).toBe(false)
    const embedded = await gunzipJson(
      await serializeProject(library, filledTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(BACKGROUND_FILL_SCHEMA_VERSION)
  })

  it('a fill-free project stays byte-identical to earlier output', async () => {
    const document = await gunzipJson(await serializeProject(library, timeline))
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('backgroundFill')
  })

  it('subtitle-style data without a fill stays at version 13 — the chain orders by newest feature', async () => {
    const document = await gunzipJson(
      await serializeProject(library, {
        ...timeline,
        subtitleStyle: { x: 0.5, y: 0.9, font: 'serif', size: 0.05, color: '#ffffff', bold: false, italic: false },
      }),
    )
    expect(document.schemaVersion).toBe(SUBTITLE_STYLE_SCHEMA_VERSION)
  })

  it('round-trips both fill kinds and leaves fill-free entries bare', async () => {
    const result = await deserializeProject(await serializeProject(library, filledTimeline()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries[0].backgroundFill).toEqual({ kind: 'blur' })
      expect(result.project.timeline.entries[1].backgroundFill).toEqual({
        kind: 'color',
        color: '#112233',
      })
      expect(result.project.timeline.entries[2].backgroundFill).toBeUndefined()
    }
  })

  it('pre-#259 files (and fill-free files since) open with no fill', async () => {
    const result = await deserializeProject(await serializeProject(library, timeline))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.entries.every((entry) => entry.backgroundFill === undefined)).toBe(true)
    }
  })

  it('refuses unknown kinds, malformed colors, and fills on slates by name', async () => {
    const unknownKind = validDocument()
    ;(unknownKind.timeline.entries[0] as unknown as Record<string, unknown>).backgroundFill = {
      kind: 'gradient',
    }
    await expectRefusal(
      await gzipJson(unknownKind),
      'timeline.entries[0].backgroundFill.kind "gradient" is not a background fill kind',
    )

    const badColor = validDocument()
    ;(badColor.timeline.entries[0] as unknown as Record<string, unknown>).backgroundFill = {
      kind: 'color',
      color: '#ABCDEF',
    }
    await expectRefusal(
      await gzipJson(badColor),
      'timeline.entries[0].backgroundFill.color "#ABCDEF" is not a lowercase #rrggbb color',
    )

    const onSlate = validDocument()
    ;(onSlate.timeline as unknown as { entries: unknown[] }).entries = [
      {
        id: 's1',
        name: 'Color slate',
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        kind: 'slate',
        color: '#ff0000',
        backgroundFill: { kind: 'blur' },
      },
    ]
    await expectRefusal(
      await gzipJson(onSlate),
      'timeline.entries[0].backgroundFill is set on a slate entry',
    )
  })

  it('deserializes the committed v14 background-fill fixture (#259)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced background fill keep opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV14BackgroundFillReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: [
            { ...expectedProject.timeline.entries[0], backgroundFill: { kind: 'blur' } },
            {
              ...expectedProject.timeline.entries[1],
              backgroundFill: { kind: 'color', color: '#112233' },
            },
            expectedProject.timeline.entries[2],
          ],
          transitions: expectedProject.timeline.transitions,
          zooms: expectedProject.timeline.zooms,
          audioTracks: [],
        },
      },
    })
  })
})

describe('overlay shape mask in project files (#266, schema version 15)', () => {
  const overlayBase = {
    clipId: 'c2',
    name: 'city.webm',
    duration: 4,
    url: 'blob:session/c2',
    offset: 1,
    inPoint: 0,
    outPoint: 4,
    y: 0.55,
    width: 0.35,
    height: 0.4,
  }
  const maskedTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [
      { id: 'v1', x: 0.6, ...overlayBase, shapeMask: { kind: 'ellipse' } },
      { id: 'v2', x: 0.05, ...overlayBase, shapeMask: { kind: 'rounded', radius: 0.2 } },
      { id: 'v3', x: 0.3, ...overlayBase },
    ],
  })
  // The stored form omits `url` (an object URL never survives a session).
  const { url: overlayUrl, ...storedFixtureOverlay } = overlayBase
  void overlayUrl

  it('writes version 15 with the mask exactly when set, in both save modes', async () => {
    const references = await gunzipJson(await serializeProject(library, maskedTimeline()))
    expect(references.schemaVersion).toBe(SHAPE_MASK_SCHEMA_VERSION)
    const overlays = (references.timeline as { videoOverlays: Record<string, unknown>[] })
      .videoOverlays
    expect(overlays[0].shapeMask).toEqual({ kind: 'ellipse' })
    expect(overlays[1].shapeMask).toEqual({ kind: 'rounded', radius: 0.2 })
    expect('shapeMask' in overlays[2]).toBe(false)
    const embedded = await gunzipJson(
      await serializeProject(library, maskedTimeline(), fixtureMedia()),
    )
    expect(embedded.schemaVersion).toBe(SHAPE_MASK_SCHEMA_VERSION)
  })

  it('a mask-free project stays byte-identical to earlier output', async () => {
    const overlaysNoMask: TimelineState = {
      ...timeline,
      videoOverlays: [{ id: 'v1', x: 0.6, ...overlayBase }],
    }
    const document = await gunzipJson(await serializeProject(library, overlaysNoMask))
    // Overlays alone are additive within version 1 (#145); no mask, no bump.
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(JSON.stringify(document.timeline)).not.toContain('shapeMask')
  })

  it('background-fill data without a mask stays at version 14 — the chain orders by newest feature', async () => {
    const document = await gunzipJson(
      await serializeProject(library, {
        ...timeline,
        entries: [
          { ...timeline.entries[0], backgroundFill: { kind: 'blur' } },
          ...timeline.entries.slice(1),
        ],
      }),
    )
    expect(document.schemaVersion).toBe(BACKGROUND_FILL_SCHEMA_VERSION)
  })

  it('round-trips both mask kinds and leaves mask-free overlays bare', async () => {
    const result = await deserializeProject(await serializeProject(library, maskedTimeline()))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const overlays = result.project.timeline.videoOverlays!
      expect(overlays[0].shapeMask).toEqual({ kind: 'ellipse' })
      expect(overlays[1].shapeMask).toEqual({ kind: 'rounded', radius: 0.2 })
      expect(overlays[2].shapeMask).toBeUndefined()
    }
  })

  it('pre-#266 files (and mask-free files since) open with no mask', async () => {
    const result = await deserializeProject(
      await serializeProject(library, {
        ...timeline,
        videoOverlays: [{ id: 'v1', x: 0.6, ...overlayBase }],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.timeline.videoOverlays![0].shapeMask).toBeUndefined()
    }
  })

  it('refuses unknown kinds, bad radii, and masks on sequence entries by name', async () => {
    const storedOverlay = () => ({
      id: 'v1',
      clipId: 'c2',
      name: 'city.webm',
      duration: 4,
      offset: 1,
      inPoint: 0,
      outPoint: 4,
      x: 0.6,
      y: 0.55,
      width: 0.35,
      height: 0.4,
    })
    const withMask = (shapeMask: unknown) => {
      const document = validDocument()
      ;(document.timeline as unknown as { videoOverlays: unknown[] }).videoOverlays = [
        { ...storedOverlay(), shapeMask },
      ]
      return document
    }
    await expectRefusal(
      await gzipJson(withMask({ kind: 'star' })),
      'timeline.videoOverlays[0].shapeMask.kind "star" is not a shape mask kind',
    )
    for (const radius of [0, -0.2, 0.75]) {
      await expectRefusal(
        await gzipJson(withMask({ kind: 'rounded', radius })),
        "timeline.videoOverlays[0].shapeMask.radius must be within (0, 0.5] of the rectangle's shorter side",
      )
    }
    const onEntry = validDocument()
    ;(onEntry.timeline.entries[0] as unknown as Record<string, unknown>).shapeMask = {
      kind: 'ellipse',
    }
    await expectRefusal(
      await gzipJson(onEntry),
      'timeline.entries[0].shapeMask is set on a sequence entry, but shape masks apply to video overlays only',
    )
  })

  it('deserializes the committed v15 shape-mask fixture (#266)', async () => {
    // Same never-rewrite contract as the other fixtures: pins that files
    // written by the build that introduced shape masks keep opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV15ShapeMaskReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: expectedProject.timeline.entries,
          transitions: expectedProject.timeline.transitions,
          zooms: expectedProject.timeline.zooms,
          audioTracks: [],
          videoOverlays: [
            { id: 'v1', x: 0.6, ...storedFixtureOverlay, shapeMask: { kind: 'ellipse' } },
            { id: 'v2', x: 0.05, ...storedFixtureOverlay, shapeMask: { kind: 'rounded', radius: 0.2 } },
            { id: 'v3', x: 0.3, ...storedFixtureOverlay },
          ],
        },
      },
    })
  })
})

// The project's canvas preset (#273, schema version 16). The persistence
// rules it must obey are the ones every optional field before it obeys: the
// key is written only when set, an Auto project stays byte-identical at its
// lower version, and an unknown identifier is refused by name rather than
// quietly becoming Auto — which would reshape the frame the file was built
// against without saying so.
describe('canvas preset persistence (#273)', () => {
  const preset = (value: string) => ({ ...timeline, canvasPreset: value as never })

  it('round-trips a set preset at the new version', async () => {
    for (const value of ['16:9', '9:16', '1:1', '4:5'] as const) {
      const bytes = await serializeProject(library, { ...timeline, canvasPreset: value })
      const document = await gunzipJson(bytes)
      expect(document.schemaVersion).toBe(CANVAS_PRESET_SCHEMA_VERSION)
      expect((document.timeline as Record<string, unknown>).canvasPreset).toBe(value)
      const result = await deserializeProject(bytes)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.project.timeline.canvasPreset).toBe(value)
    }
  })

  it('writes no key and no version bump for an Auto project', async () => {
    // Byte-identity, not merely an absent key: an Auto project must produce
    // exactly the file it produced before presets existed, so older builds
    // keep opening it.
    const withoutPreset = await serializeProject(library, timeline)
    const explicitlyAuto = await serializeProject(library, { ...timeline, canvasPreset: undefined })
    expect(new Uint8Array(explicitlyAuto)).toEqual(new Uint8Array(withoutPreset))
    const document = await gunzipJson(withoutPreset)
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect(document.timeline as Record<string, unknown>).not.toHaveProperty('canvasPreset')
  })

  it('opens a pre-preset file as Auto', async () => {
    // No key at all is what every file written before version 16 has.
    const result = await deserializeProject(await serializeProject(library, timeline))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.timeline).not.toHaveProperty('canvasPreset')
  })

  it('refuses an unknown preset by name', async () => {
    // 'auto' in particular: Auto is the absent key, never an identifier, so
    // a file naming it is malformed rather than meaning the default.
    for (const value of ['auto', '3:2', '16:10', 'AUTO', '9-16']) {
      await expectRefusal(
        await gzipJson({
          ...validDocument(),
          schemaVersion: CANVAS_PRESET_SCHEMA_VERSION,
          timeline: { ...validDocument().timeline, canvasPreset: value },
        }),
        `timeline.canvasPreset "${value}" is unknown`,
      )
    }
  })

  it('refuses a preset that is not a non-empty string', async () => {
    // The shared string validator catches these before the name check, so
    // both a wrong type and an empty value are refused by path.
    for (const value of [169, true, {}, [], null, '']) {
      await expectRefusal(
        await gzipJson({
          ...validDocument(),
          schemaVersion: CANVAS_PRESET_SCHEMA_VERSION,
          timeline: { ...validDocument().timeline, canvasPreset: value },
        }),
        'timeline.canvasPreset must be a non-empty string',
      )
    }
  })

  it('deserializes the committed v16 canvas-preset fixture', async () => {
    // The never-rewrite contract, as for every fixture before it: a file
    // written by the build that introduced presets keeps opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV16CanvasPresetReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedProject.clips,
        timeline: {
          entries: expectedProject.timeline.entries,
          transitions: expectedProject.timeline.transitions,
          zooms: expectedProject.timeline.zooms,
          audioTracks: [],
          canvasPreset: '9:16',
        },
      },
    })
  })

  it('lets a lower-version feature keep its version when the preset is Auto', async () => {
    // The version chain puts the preset first, so this pins that it only
    // wins when a preset is actually set — a shape-mask project with no
    // preset must still write version 15.
    void preset
    const masked: TimelineState = {
      ...timeline,
      videoOverlays: [
        {
          id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
          offset: 0, inPoint: 0, outPoint: 4, x: 0.6, y: 0.6, width: 0.3, height: 0.3,
          shapeMask: { kind: 'ellipse' },
        },
      ],
    }
    expect((await gunzipJson(await serializeProject(library, masked))).schemaVersion).toBe(
      SHAPE_MASK_SCHEMA_VERSION,
    )
    expect(
      (await gunzipJson(await serializeProject(library, { ...masked, canvasPreset: '1:1' })))
        .schemaVersion,
    ).toBe(CANVAS_PRESET_SCHEMA_VERSION)
  })
})

describe('image overlay layers in project files (#294, schema version 17)', () => {
  // The library needs an image to overlay; the base one carries video only.
  const overlayLibrary: MediaLibraryState = {
    ...library,
    clips: [
      ...library.clips,
      { id: 'i1', name: 'logo.png', duration: 0, url: 'blob:session/i1', kind: 'image', width: 64, height: 48 },
    ],
  }
  const stored = {
    id: 'io1',
    kind: 'image' as const,
    clipId: 'i1',
    name: 'logo.png',
    duration: 6,
    offset: 2,
    inPoint: 0,
    outPoint: 6,
    x: 0.6,
    y: 0.6,
    width: 0.35,
    height: 0.35,
    crop: { top: 0.1 },
    colorAdjustments: { saturation: 140 },
  }
  const stillTimeline = (): TimelineState => ({
    ...timeline,
    videoOverlays: [{ ...stored, url: 'blob:session/i1' }],
  })
  const expectedClips = [
    ...expectedProject.clips,
    { id: 'i1', name: 'logo.png', duration: 0, kind: 'image' as const, width: 64, height: 48 },
  ]

  /** A valid document whose library carries the image clip. */
  const documentWithImage = () => {
    const document = validDocument()
    ;(document.clips as unknown as Record<string, unknown>[]).push({
      id: 'i1', name: 'logo.png', kind: 'image', width: 64, height: 48,
    })
    return document
  }

  it('round-trips a still overlay, writing version 17 and no url', async () => {
    const bytes = await serializeProject(overlayLibrary, stillTimeline())
    const document = await gunzipJson(bytes)
    // Unlike remaps and texts this is NOT additive within a version: an
    // older build would read the kind key as an unknown extra and load a
    // still as a video overlay, so the version has to move.
    expect(document.schemaVersion).toBe(IMAGE_OVERLAYS_SCHEMA_VERSION)
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedClips,
        timeline: { ...expectedProject.timeline, videoOverlays: [stored] },
      },
    })
    const written = (document.timeline as { videoOverlays: Record<string, unknown>[] }).videoOverlays[0]
    expect(written.kind).toBe('image')
    expect(written).not.toHaveProperty('url')
  })

  it('leaves a video overlay byte-identical: no kind key, no version bump', async () => {
    // The whole point of absent-as-default: adding image overlays must not
    // change one byte of a project that has none.
    const videoOverlay = {
      id: 'v1', clipId: 'c2', name: 'city.webm', duration: 4, url: 'blob:session/c2',
      offset: 1.5, inPoint: 0.5, outPoint: 3, x: 0.6, y: 0.6, width: 0.35, height: 0.35,
    }
    const document = await gunzipJson(
      await serializeProject(library, { ...timeline, videoOverlays: [videoOverlay] }),
    )
    expect(document.schemaVersion).toBe(REFERENCES_SCHEMA_VERSION)
    expect((document.timeline as { videoOverlays: Record<string, unknown>[] }).videoOverlays[0])
      .not.toHaveProperty('kind')
  })

  it('refuses audio on a still overlay by field name', async () => {
    // A still is soundless (#220). Naming the field is the point: a file
    // that disagrees with the model is a writer's bug, and silently loading
    // the half of it we like is how corruption hides.
    for (const [field, value] of [
      ['volume', 0.5], ['muted', true], ['fadeIn', 1], ['fadeOut', 1], ['duck', true], ['duckLevel', 0.2],
    ] as const) {
      const document = documentWithImage()
      ;(document.timeline as { videoOverlays?: unknown }).videoOverlays = [{ ...stored, [field]: value }]
      await expectRefusal(
        await gzipJson(document),
        `timeline.videoOverlays[0].${field} is not allowed on an image overlay: a still has no audio`,
      )
    }
  })

  it('refuses a mismatched clip kind, either way round', async () => {
    const wrongWay = documentWithImage()
    ;(wrongWay.timeline as { videoOverlays?: unknown }).videoOverlays = [{ ...stored, clipId: 'c2' }]
    await expectRefusal(
      await gzipJson(wrongWay),
      'references a video clip, but image overlay layers carry images only',
    )
    const otherWay = documentWithImage()
    ;(otherWay.timeline as { videoOverlays?: unknown }).videoOverlays = [
      { ...stored, kind: undefined, clipId: 'i1', duration: 6, inPoint: 0, outPoint: 6 },
    ]
    await expectRefusal(
      await gzipJson(otherWay),
      'references an image clip, but overlay layers carry video only',
    )
  })

  it('refuses an unknown overlay kind and a window that is not the whole still', async () => {
    const unknown = documentWithImage()
    ;(unknown.timeline as { videoOverlays?: unknown }).videoOverlays = [{ ...stored, kind: 'slate' }]
    await expectRefusal(await gzipJson(unknown), 'timeline.videoOverlays[0].kind must be "image" when present')
    for (const window of [{ inPoint: 1 }, { outPoint: 5 }]) {
      const document = documentWithImage()
      ;(document.timeline as { videoOverlays?: unknown }).videoOverlays = [{ ...stored, ...window }]
      await expectRefusal(await gzipJson(document), 'window must be the whole still')
    }
  })

  it('deserializes the committed v17 image-overlay fixture', async () => {
    // The never-rewrite contract, as for every fixture before it: a file
    // written by the build that introduced image overlays keeps opening
    // identically forever.
    const bytes = Uint8Array.from(atob(fixtureV17ImageOverlayReferencesBase64.trim()), (char) =>
      char.charCodeAt(0),
    )
    const result = await deserializeProject(bytes)
    expect(result).toEqual({
      ok: true,
      project: {
        clips: expectedClips,
        timeline: { ...expectedProject.timeline, videoOverlays: [stored] },
      },
    })
  })

  it('lets a lower-version feature keep its version when no still overlay exists', async () => {
    // The version chain puts image overlays first, so this pins that they
    // only win when one is actually present.
    expect(
      (await gunzipJson(await serializeProject(overlayLibrary, timeline))).schemaVersion,
    ).toBe(IMAGES_SCHEMA_VERSION)
  })
})
