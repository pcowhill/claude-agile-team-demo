import { describe, expect, it } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import type { LibrarySelection } from './librarySelection'
import { emptySelection, librarySelectionReducer, selectedClips } from './librarySelection'

const clip = (id: string): LibraryClip => ({
  id,
  name: `${id}.mp4`,
  duration: 5,
  url: `blob:${id}`,
  kind: 'video',
})

const clips = ['a', 'b', 'c', 'd', 'e'].map(clip)
const order = clips.map((c) => c.id)

const ids = (selection: LibrarySelection) => selectedClips(selection, clips).map((c) => c.id)

describe('librarySelectionReducer (#292)', () => {
  it('a plain toggle selects, a second toggle deselects, and the anchor follows', () => {
    const one = librarySelectionReducer(emptySelection, { type: 'toggled', id: 'b' })
    expect(ids(one)).toEqual(['b'])
    expect(one.anchorId).toBe('b')
    const two = librarySelectionReducer(one, { type: 'toggled', id: 'd' })
    expect(ids(two)).toEqual(['b', 'd'])
    expect(two.anchorId).toBe('d')
    const back = librarySelectionReducer(two, { type: 'toggled', id: 'b' })
    expect(ids(back)).toEqual(['d'])
    expect(back.anchorId).toBe('b')
  })

  it('Shift+click selects the inclusive range from the anchor, in either direction', () => {
    const anchored = librarySelectionReducer(emptySelection, { type: 'toggled', id: 'b' })
    const down = librarySelectionReducer(anchored, { type: 'range-selected', id: 'd', order })
    expect(ids(down)).toEqual(['b', 'c', 'd'])
    // Upward from the same anchor: the range is [a, b]; the earlier range
    // stays selected (a range adds, never removes).
    const up = librarySelectionReducer(down, { type: 'range-selected', id: 'a', order })
    expect(ids(up)).toEqual(['a', 'b', 'c', 'd'])
    // The anchor never moved: successive Shift+clicks extend from 'b'.
    expect(up.anchorId).toBe('b')
  })

  it('a Shift+click with no usable anchor is a plain toggle', () => {
    const fresh = librarySelectionReducer(emptySelection, { type: 'range-selected', id: 'c', order })
    expect(ids(fresh)).toEqual(['c'])
    expect(fresh.anchorId).toBe('c')
    // An anchor that is no longer listed (its clip was removed) is unusable too.
    const orphaned: LibrarySelection = { ids: ['zzz'], anchorId: 'zzz' }
    const toggled = librarySelectionReducer(orphaned, { type: 'range-selected', id: 'a', order })
    expect(ids(toggled)).toEqual(['a'])
  })

  it('ranges follow the given display order, not insertion order', () => {
    // After a sort the library lists e, d, c, b, a: the range from anchor
    // 'e' to 'c' is [e, d, c] in that order.
    const sorted = [...order].reverse()
    const anchored = librarySelectionReducer(emptySelection, { type: 'toggled', id: 'e' })
    const ranged = librarySelectionReducer(anchored, { type: 'range-selected', id: 'c', order: sorted })
    expect([...ranged.ids].sort()).toEqual(['c', 'd', 'e'])
    expect(selectedClips(ranged, [...clips].reverse()).map((c) => c.id)).toEqual(['e', 'd', 'c'])
  })

  it('all-set selects or clears every listed clip without disturbing the anchor', () => {
    const anchored = librarySelectionReducer(emptySelection, { type: 'toggled', id: 'c' })
    const all = librarySelectionReducer(anchored, { type: 'all-set', ids: order, selected: true })
    expect(ids(all)).toEqual(order)
    expect(all.anchorId).toBe('c')
    const none = librarySelectionReducer(all, { type: 'all-set', ids: order, selected: false })
    expect(ids(none)).toEqual([])
    expect(none.anchorId).toBe('c')
  })

  it('cleared drops everything, and is a same-reference no-op when already empty', () => {
    const some = librarySelectionReducer(emptySelection, { type: 'toggled', id: 'a' })
    expect(librarySelectionReducer(some, { type: 'cleared' })).toEqual(emptySelection)
    expect(librarySelectionReducer(emptySelection, { type: 'cleared' })).toBe(emptySelection)
  })
})

describe('selectedClips (#292)', () => {
  it('returns the selected clips in library order, ignoring ids no longer listed', () => {
    const selection: LibrarySelection = { ids: ['d', 'gone', 'a'], anchorId: 'a' }
    expect(selectedClips(selection, clips).map((c) => c.id)).toEqual(['a', 'd'])
  })

  it('is empty against a replaced library whose clips carry other ids', () => {
    const selection: LibrarySelection = { ids: ['a', 'b'], anchorId: 'a' }
    expect(selectedClips(selection, [clip('x'), clip('y')])).toEqual([])
  })
})
