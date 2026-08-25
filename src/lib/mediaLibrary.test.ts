import { describe, expect, it } from 'vitest'
import type { LibraryClip, MediaLibraryState } from './mediaLibrary'
import { emptyLibrary, formatDuration, mediaLibraryReducer, sortClips } from './mediaLibrary'

const clip = (overrides: Partial<LibraryClip> = {}): LibraryClip => ({
  id: crypto.randomUUID(),
  name: 'clip.mp4',
  duration: 12,
  url: 'blob:test',
  kind: 'video',
  ...overrides,
})

describe('mediaLibraryReducer', () => {
  it('adds clips in order', () => {
    const first = clip({ name: 'a.mp4' })
    const second = clip({ name: 'b.mp4' })
    let state = mediaLibraryReducer(emptyLibrary, { type: 'clip-added', clip: first })
    state = mediaLibraryReducer(state, { type: 'clip-added', clip: second })
    expect(state.clips.map((c) => c.name)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('allows the same filename to be imported twice as distinct clips', () => {
    const first = clip({ name: 'same.mp4' })
    const second = clip({ name: 'same.mp4' })
    let state = mediaLibraryReducer(emptyLibrary, { type: 'clip-added', clip: first })
    state = mediaLibraryReducer(state, { type: 'clip-added', clip: second })
    expect(state.clips).toHaveLength(2)
    expect(state.clips[0].id).not.toBe(state.clips[1].id)
  })

  it('removes only the clip with the given id', () => {
    const first = clip({ name: 'a.mp4' })
    const second = clip({ name: 'b.mp4' })
    const state: MediaLibraryState = { clips: [first, second], failures: [] }
    const next = mediaLibraryReducer(state, { type: 'clip-removed', id: first.id })
    expect(next.clips.map((c) => c.name)).toEqual(['b.mp4'])
  })

  it('leaves clips unchanged when removing an unknown id, and never touches failures', () => {
    const state: MediaLibraryState = {
      clips: [clip()],
      failures: [{ id: 'f1', name: 'bad.txt', reason: 'not a video' }],
    }
    const next = mediaLibraryReducer(state, { type: 'clip-removed', id: 'nope' })
    expect(next.clips).toHaveLength(1)
    expect(next.failures).toHaveLength(1)
  })

  it('records import failures without touching clips', () => {
    const withClip = mediaLibraryReducer(emptyLibrary, { type: 'clip-added', clip: clip() })
    const state = mediaLibraryReducer(withClip, {
      type: 'import-failed',
      failure: { id: 'f1', name: 'bad.txt', reason: 'not a video' },
    })
    expect(state.failures).toHaveLength(1)
    expect(state.clips).toHaveLength(1)
  })

  it('dismisses failures without touching clips', () => {
    const state: MediaLibraryState = {
      clips: [clip()],
      failures: [{ id: 'f1', name: 'bad.txt', reason: 'not a video' }],
    }
    const next = mediaLibraryReducer(state, { type: 'failures-dismissed' })
    expect(next.failures).toEqual([])
    expect(next.clips).toHaveLength(1)
  })

  it('does not mutate previous state', () => {
    const state = mediaLibraryReducer(emptyLibrary, { type: 'clip-added', clip: clip() })
    expect(emptyLibrary.clips).toHaveLength(0)
    expect(state).not.toBe(emptyLibrary)
  })
})

describe('formatDuration', () => {
  it('formats sub-minute durations as m:ss', () => {
    expect(formatDuration(7.4)).toBe('0:07')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(59.6)).toBe('1:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(83)).toBe('1:23')
  })

  it('formats hours as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('renders a placeholder for invalid values', () => {
    expect(formatDuration(Number.NaN)).toBe('–:––')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('–:––')
    expect(formatDuration(-1)).toBe('–:––')
  })
})

describe('library-replaced (#77)', () => {
  it('stores the given clips by reference and clears transient failures', () => {
    const state: MediaLibraryState = {
      clips: [{ id: 'old', name: 'old.mp4', duration: 2, url: 'blob:old', kind: 'video' }],
      failures: [{ id: 'f1', name: 'broken.mp4', reason: 'nope' }],
    }
    const clips: LibraryClip[] = [{ id: 'new', name: 'new.mp4', duration: 3, url: 'blob:new', kind: 'video' }]
    const next = mediaLibraryReducer(state, { type: 'library-replaced', clips })
    // Reference identity is what the unsaved-changes tracking compares (#76).
    expect(next.clips).toBe(clips)
    expect(next.failures).toEqual([])
  })
})

describe('sortClips (#123)', () => {
  const byNames = (clips: LibraryClip[]) => clips.map((c) => c.name)

  it('sorts by name case-insensitively with numeric collation', () => {
    const clips = [
      clip({ name: 'clip10.mp4' }),
      clip({ name: 'Beta.mp4' }),
      clip({ name: 'clip2.mp4' }),
      clip({ name: 'alpha.mp4' }),
    ]
    expect(byNames(sortClips(clips, 'name', 'asc'))).toEqual([
      'alpha.mp4',
      'Beta.mp4',
      'clip2.mp4',
      'clip10.mp4',
    ])
    expect(byNames(sortClips(clips, 'name', 'desc'))).toEqual([
      'clip10.mp4',
      'clip2.mp4',
      'Beta.mp4',
      'alpha.mp4',
    ])
  })

  it('sorts by kind with videos first ascending', () => {
    const clips = [
      clip({ name: 'a.mp3', kind: 'audio' }),
      clip({ name: 'v1.mp4', kind: 'video' }),
      clip({ name: 'b.mp3', kind: 'audio' }),
      clip({ name: 'v2.mp4', kind: 'video' }),
    ]
    expect(byNames(sortClips(clips, 'kind', 'asc'))).toEqual([
      'v1.mp4',
      'v2.mp4',
      'a.mp3',
      'b.mp3',
    ])
    expect(byNames(sortClips(clips, 'kind', 'desc'))).toEqual([
      'a.mp3',
      'b.mp3',
      'v1.mp4',
      'v2.mp4',
    ])
  })

  it('sorts by duration numerically', () => {
    const clips = [
      clip({ name: 'long.mp4', duration: 90 }),
      clip({ name: 'short.mp4', duration: 3 }),
      clip({ name: 'mid.mp4', duration: 30 }),
    ]
    expect(byNames(sortClips(clips, 'duration', 'asc'))).toEqual([
      'short.mp4',
      'mid.mp4',
      'long.mp4',
    ])
    expect(byNames(sortClips(clips, 'duration', 'desc'))).toEqual([
      'long.mp4',
      'mid.mp4',
      'short.mp4',
    ])
  })

  it('is stable: equal keys keep their existing relative order, both directions', () => {
    const clips = [
      clip({ name: 'first.mp4', duration: 5 }),
      clip({ name: 'second.mp4', duration: 5 }),
      clip({ name: 'third.mp4', duration: 5 }),
    ]
    expect(byNames(sortClips(clips, 'duration', 'asc'))).toEqual([
      'first.mp4',
      'second.mp4',
      'third.mp4',
    ])
    // Descending flips the comparator, never the array — ties hold still.
    expect(byNames(sortClips(clips, 'duration', 'desc'))).toEqual([
      'first.mp4',
      'second.mp4',
      'third.mp4',
    ])
  })

  it("carries previous sorts over as tie order (the customer's example)", () => {
    // Mixed import order; sort by name, then by type: each kind group must
    // come out internally alphabetical.
    const clips = [
      clip({ name: 'zebra.mp4', kind: 'video' }),
      clip({ name: 'mango.mp3', kind: 'audio' }),
      clip({ name: 'apple.mp4', kind: 'video' }),
      clip({ name: 'banana.mp3', kind: 'audio' }),
    ]
    const byName = sortClips(clips, 'name', 'asc')
    expect(byNames(byName)).toEqual(['apple.mp4', 'banana.mp3', 'mango.mp3', 'zebra.mp4'])
    const thenByKind = sortClips(byName, 'kind', 'asc')
    expect(byNames(thenByKind)).toEqual(['apple.mp4', 'zebra.mp4', 'banana.mp3', 'mango.mp3'])
  })
})

describe('clips-sorted (#123)', () => {
  it('reorders the stored list and leaves failures alone', () => {
    const state: MediaLibraryState = {
      clips: [clip({ name: 'b.mp4' }), clip({ name: 'a.mp4' })],
      failures: [{ id: 'f1', name: 'broken.mp4', reason: 'nope' }],
    }
    const next = mediaLibraryReducer(state, { type: 'clips-sorted', key: 'name', direction: 'asc' })
    expect(next.clips.map((c) => c.name)).toEqual(['a.mp4', 'b.mp4'])
    expect(next.failures).toBe(state.failures)
    expect(state.clips.map((c) => c.name)).toEqual(['b.mp4', 'a.mp4'])
  })

  it('returns the same state reference when the order is already right (#76 dirty tracking)', () => {
    const state: MediaLibraryState = {
      clips: [clip({ name: 'a.mp4' }), clip({ name: 'b.mp4' })],
      failures: [],
    }
    expect(
      mediaLibraryReducer(state, { type: 'clips-sorted', key: 'name', direction: 'asc' }),
    ).toBe(state)
  })
})
