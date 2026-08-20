import { describe, expect, it } from 'vitest'
import { durationsMatch, matchFileToClip, restoreEmbeddedProject, restoreProject } from './openProject'
import type { ClipMedia, Project } from './projectFile'

describe('durationsMatch', () => {
  it('accepts exact and near-exact durations', () => {
    expect(durationsMatch(5, 5)).toBe(true)
    expect(durationsMatch(5, 5.09)).toBe(true)
    expect(durationsMatch(5, 4.91)).toBe(true)
  })

  it('rejects durations beyond the tolerance', () => {
    expect(durationsMatch(5, 5.2)).toBe(false)
    expect(durationsMatch(5, 4.7)).toBe(false)
    expect(durationsMatch(5, 50)).toBe(false)
  })

  it('scales the tolerance to 1% for long media', () => {
    // 1% of an hour is 36 s — container rounding across browsers can drift
    // further on long files than the 100 ms floor allows.
    expect(durationsMatch(3600, 3600 + 30)).toBe(true)
    expect(durationsMatch(3600, 3600 + 40)).toBe(false)
  })
})

describe('matchFileToClip', () => {
  const clips = [
    { id: 'a', name: 'holiday.mp4', duration: 10, kind: 'video' },
    { id: 'b', name: 'holiday.mp4', duration: 20, kind: 'video' },
    { id: 'c', name: 'city.webm', duration: 5, kind: 'video' },
    { id: 'd', name: 'music.mp3', duration: 30, kind: 'audio' },
  ] as const

  it('matches by filename and duration', () => {
    expect(matchFileToClip(clips, new Set(), 'city.webm', 5, 'video')).toEqual({
      kind: 'matched',
      clipId: 'c',
    })
  })

  it('distinguishes same-named clips by duration', () => {
    expect(matchFileToClip(clips, new Set(), 'holiday.mp4', 20.05, 'video')).toEqual({
      kind: 'matched',
      clipId: 'b',
    })
  })

  it('reports a file that is not part of the project', () => {
    const result = matchFileToClip(clips, new Set(), 'other.mp4', 5, 'video')
    expect(result.kind).toBe('no-match')
    if (result.kind === 'no-match') {
      expect(result.reason).toContain('"other.mp4" is not one of this project\'s media files')
    }
  })

  it('reports a duration mismatch instead of silently accepting the file', () => {
    const result = matchFileToClip(clips, new Set(), 'city.webm', 9, 'video')
    expect(result.kind).toBe('no-match')
    if (result.kind === 'no-match') {
      expect(result.reason).toContain('expected a duration of 5s')
      expect(result.reason).toContain('the picked file is 9s')
    }
  })

  it('reports an already-linked clip rather than re-linking it', () => {
    const result = matchFileToClip(clips, new Set(['c']), 'city.webm', 5, 'video')
    expect(result.kind).toBe('no-match')
    if (result.kind === 'no-match') expect(result.reason).toContain('already linked')
  })

  it('skips linked clips when several share a name', () => {
    expect(matchFileToClip(clips, new Set(['a']), 'holiday.mp4', 10, 'video')).toEqual({
      kind: 'no-match',
      reason: expect.stringContaining('expected a duration of 20s'),
    })
    expect(matchFileToClip(clips, new Set(['a']), 'holiday.mp4', 20, 'video')).toEqual({
      kind: 'matched',
      clipId: 'b',
    })
  })

  it('matches an audio file to its audio clip (#101)', () => {
    expect(matchFileToClip(clips, new Set(), 'music.mp3', 30, 'audio')).toEqual({
      kind: 'matched',
      clipId: 'd',
    })
  })

  it('reports a kind mismatch instead of linking the wrong sort of file', () => {
    const result = matchFileToClip(clips, new Set(), 'music.mp3', 30, 'video')
    expect(result.kind).toBe('no-match')
    if (result.kind === 'no-match') {
      expect(result.reason).toContain('"music.mp3" is a video file')
      expect(result.reason).toContain('is audio')
    }
  })
})

describe('restoreProject', () => {
  const project: Project = {
    clips: [
      { id: 'a', name: 'holiday.mp4', duration: 10, kind: 'video' },
      { id: 'b', name: 'city.webm', duration: 5, kind: 'video' },
    ],
    timeline: {
      entries: [
        { id: 'e1', clipId: 'a', name: 'holiday.mp4', duration: 10, inPoint: 1, outPoint: 8 },
        { id: 'e2', clipId: 'b', name: 'city.webm', duration: 5, inPoint: 0, outPoint: 5 },
      ],
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
      zooms: [
        {
          entryId: 'e2',
          start: 0,
          rampIn: 0.5,
          hold: 1,
          rampOut: 0.5,
          scale: 2,
          centerX: 0.5,
          centerY: 0.5,
        },
      ],
    },
  }
  const urls = new Map([
    ['a', 'blob:relinked-a'],
    ['b', 'blob:relinked-b'],
  ])

  it('rebuilds library clips and timeline entries with the re-linked URLs', () => {
    const restored = restoreProject(project, urls)
    expect(restored.clips).toEqual([
      { id: 'a', name: 'holiday.mp4', duration: 10, kind: 'video', url: 'blob:relinked-a' },
      { id: 'b', name: 'city.webm', duration: 5, kind: 'video', url: 'blob:relinked-b' },
    ])
    expect(restored.timeline.entries).toEqual([
      expect.objectContaining({ id: 'e1', clipId: 'a', url: 'blob:relinked-a', inPoint: 1, outPoint: 8 }),
      expect.objectContaining({ id: 'e2', clipId: 'b', url: 'blob:relinked-b' }),
    ])
    expect(restored.timeline.transitions).toEqual([
      { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
    ])
    expect(restored.timeline.zooms).toEqual([expect.objectContaining({ entryId: 'e2', scale: 2 })])
  })

  it('normalizes effects that no longer hold against the entry list', () => {
    // A hand-edited (but schema-valid) file can carry a transition between
    // non-adjacent entries; restoring applies the reducer's invariants.
    const crafted: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        entries: [project.timeline.entries[1], project.timeline.entries[0]],
      },
    }
    const restored = restoreProject(crafted, urls)
    expect(restored.timeline.transitions).toEqual([])
  })

  it('throws on a clip without a re-linked URL (callers gate on allLinked)', () => {
    expect(() => restoreProject(project, new Map([['a', 'blob:relinked-a']]))).toThrow(
      /no re-linked media/,
    )
  })
})

describe('restoreEmbeddedProject', () => {
  const project: Project = {
    clips: [
      { id: 'a', name: 'holiday.mp4', duration: 10, kind: 'video' },
      { id: 'b', name: 'city.webm', duration: 5, kind: 'video' },
    ],
    timeline: {
      entries: [
        { id: 'e1', clipId: 'a', name: 'holiday.mp4', duration: 10, inPoint: 1, outPoint: 8 },
        { id: 'e2', clipId: 'b', name: 'city.webm', duration: 5, inPoint: 0, outPoint: 5 },
      ],
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
      zooms: [],
    },
  }
  const media = new Map<string, ClipMedia>([
    ['a', { bytes: Uint8Array.from([1, 2, 3, 4]), mimeType: 'video/mp4' }],
    ['b', { bytes: Uint8Array.from([5, 6]) }],
  ])

  /** Records the Blobs it is handed and mints a distinct URL per clip. */
  const recordingCreateUrl = () => {
    const blobs: Blob[] = []
    const createUrl = (blob: Blob) => {
      blobs.push(blob)
      return `blob:embedded-${blobs.length}`
    }
    return { blobs, createUrl }
  }

  it('links every clip and entry to a URL minted from its embedded bytes', async () => {
    const { blobs, createUrl } = recordingCreateUrl()
    const restored = restoreEmbeddedProject(project, media, createUrl)
    expect(restored.clips).toEqual([
      { id: 'a', name: 'holiday.mp4', duration: 10, kind: 'video', url: 'blob:embedded-1' },
      { id: 'b', name: 'city.webm', duration: 5, kind: 'video', url: 'blob:embedded-2' },
    ])
    expect(restored.timeline.entries.map((entry) => entry.url)).toEqual([
      'blob:embedded-1',
      'blob:embedded-2',
    ])
    // The Blobs carry the media bytes and their stored type.
    expect(blobs.map((blob) => [blob.size, blob.type])).toEqual([
      [4, 'video/mp4'],
      [2, ''],
    ])
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    )
  })

  it('applies the same timeline normalization as a re-linked open', () => {
    const { createUrl } = recordingCreateUrl()
    const restored = restoreEmbeddedProject(project, media, createUrl)
    expect(restored.timeline.transitions).toEqual([
      { beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 },
    ])
  })

  it('throws on a clip without media (deserialization guarantees coverage)', () => {
    const { createUrl } = recordingCreateUrl()
    const partial = new Map([['a', media.get('a') as ClipMedia]])
    expect(() => restoreEmbeddedProject(project, partial, createUrl)).toThrow(
      /has no embedded media/,
    )
  })
})
