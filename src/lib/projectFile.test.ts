import { describe, expect, it } from 'vitest'
import fixtureV1Base64 from './fixtures/project-v1.bvep.base64?raw'
import fixtureV2Base64 from './fixtures/project-v2-embedded.bvep.base64?raw'
import type { MediaLibraryState } from './mediaLibrary'
import type { TimelineState } from './timeline'
import {
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
    { entryId: 'e2', start: 0.5, rampIn: 0.5, hold: 1, rampOut: 0.5, scale: 2, centerX: 0.25, centerY: 0.5 },
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
      project: { clips: [], timeline: { entries: [], transitions: [], zooms: [] } },
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
    await expectRefusal(await gzipJson(document), 'clips[0].kind must be "video" or "audio"')
  })

  it('refuses a sequence entry that references an audio clip', async () => {
    const document = validDocument()
    ;(document.clips[0] as { kind?: unknown }).kind = 'audio'
    await expectRefusal(
      await gzipJson(document),
      'references an audio clip',
      'the sequence carries video only',
    )
  })
})

describe('project file versioning', () => {
  it('carries the schema version', async () => {
    // Deserializing proves the marker + version were present and accepted;
    // this pins the constants so a bump is a conscious, reviewed change.
    // Version 2 added embedded media (#97).
    expect(PROJECT_SCHEMA_VERSION).toBe(2)
    expect(REFERENCES_SCHEMA_VERSION).toBe(1)
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
    expect(document.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
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
    ['a second zoom on one entry', (d) => d.timeline.zooms.push({ ...d.timeline.zooms[0] }), 'duplicates the zoom'],
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
    expect(result).toEqual({ ok: true, project: expectedProject })
  })

  it('deserializes the committed v2 embedded-media fixture, media byte-for-byte', async () => {
    // Same never-rewrite contract as the v1 fixture. Its media bytes are
    // pseudoRandomBytes(2048, 1) / (1024, 2) — re-derived here rather than
    // committed separately, so byte-identity stays checkable forever.
    const bytes = Uint8Array.from(atob(fixtureV2Base64.trim()), (char) => char.charCodeAt(0))
    const result = await deserializeProject(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project).toEqual(expectedProject)
      expect(result.media).toEqual(fixtureMedia())
    }
  })
})
