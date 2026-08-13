import { describe, expect, it } from 'vitest'
import type { LibraryClip, MediaLibraryState } from './mediaLibrary'
import { emptyLibrary, formatDuration, mediaLibraryReducer } from './mediaLibrary'

const clip = (overrides: Partial<LibraryClip> = {}): LibraryClip => ({
  id: crypto.randomUUID(),
  name: 'clip.mp4',
  duration: 12,
  url: 'blob:test',
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
