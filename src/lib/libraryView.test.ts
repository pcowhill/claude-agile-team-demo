import { describe, expect, it } from 'vitest'
import { LIBRARY_VIEW_KEY, loadLibraryView, saveLibraryView } from './libraryView'
import type { LibraryViewStorage } from './libraryView'

function fakeStorage(initial: Record<string, string> = {}): LibraryViewStorage & {
  values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('media library view persistence (#311)', () => {
  it('defaults to the row list with nothing stored', () => {
    expect(loadLibraryView(fakeStorage())).toBe('list')
    expect(loadLibraryView(null)).toBe('list')
  })

  it('round-trips both views', () => {
    const storage = fakeStorage()
    saveLibraryView('thumbnails', storage)
    expect(loadLibraryView(storage)).toBe('thumbnails')
    saveLibraryView('list', storage)
    expect(loadLibraryView(storage)).toBe('list')
  })

  it('stores the view under its own key, not the preview layout key', () => {
    const storage = fakeStorage()
    saveLibraryView('thumbnails', storage)
    expect(storage.values.get(LIBRARY_VIEW_KEY)).toBe('thumbnails')
    expect([...storage.values.keys()]).toEqual([LIBRARY_VIEW_KEY])
  })

  it('degrades an unrecognized stored value to the list', () => {
    expect(loadLibraryView(fakeStorage({ [LIBRARY_VIEW_KEY]: 'grid' }))).toBe('list')
    expect(loadLibraryView(fakeStorage({ [LIBRARY_VIEW_KEY]: '' }))).toBe('list')
  })

  it('tolerates a throwing store on both paths', () => {
    const throwing: LibraryViewStorage = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage full')
      },
    }
    expect(loadLibraryView(throwing)).toBe('list')
    expect(() => saveLibraryView('thumbnails', throwing)).not.toThrow()
  })
})
