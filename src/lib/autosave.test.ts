import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAutosaver,
  planMediaSync,
  readAutosaveSnapshot,
  sessionIsEmpty,
} from './autosave'
import type { AutosaveStatus, AutosaveStore } from './autosave'
import { emptyLibrary } from './mediaLibrary'
import type { LibraryClip, MediaLibraryState } from './mediaLibrary'
import { emptyTimeline, entryFromClip, slateEntry, timelineReducer } from './timeline'
import type { TimelineState } from './timeline'

// The IndexedDB implementation itself can only run in a real browser
// (e2e/autosave.spec.ts drives it end to end); these tests cover the
// orchestration — the debounced snapshot passes, write-once media, pruning,
// and the quota fallback — against an in-memory store.

const clip = (id: string, name = `${id}.webm`): LibraryClip => ({
  id,
  name,
  duration: 5,
  url: `blob:${id}`,
  kind: 'video',
})

const libraryOf = (...clips: LibraryClip[]): MediaLibraryState => ({ clips, failures: [] })

const timelineWith = (theClip: LibraryClip): TimelineState =>
  timelineReducer(emptyTimeline, { type: 'entry-added', entry: entryFromClip(theClip, 'e1') })

interface FakeStore extends AutosaveStore {
  structure: Uint8Array<ArrayBuffer> | null
  media: Map<string, Blob>
  log: string[]
  failMediaWrites: boolean
  failStructureWrites: boolean
}

function fakeStore(): FakeStore {
  const store: FakeStore = {
    structure: null,
    media: new Map(),
    log: [],
    failMediaWrites: false,
    failStructureWrites: false,
    writeStructure(bytes) {
      if (store.failStructureWrites) return Promise.reject(new Error('quota'))
      store.log.push('structure')
      store.structure = bytes
      return Promise.resolve()
    },
    readStructure: () => Promise.resolve(store.structure),
    writeMedia(clipId, blob) {
      if (store.failMediaWrites) return Promise.reject(new Error('quota'))
      store.log.push(`media:${clipId}`)
      store.media.set(clipId, blob)
      return Promise.resolve()
    },
    listMediaIds: () => Promise.resolve([...store.media.keys()]),
    readAllMedia: () => Promise.resolve(new Map(store.media)),
    deleteMedia(ids) {
      for (const id of ids) {
        store.log.push(`delete:${id}`)
        store.media.delete(id)
      }
      return Promise.resolve()
    },
    clear() {
      store.log.push('clear')
      store.structure = null
      store.media.clear()
      return Promise.resolve()
    },
  }
  return store
}

const bytesOf = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>

function testAutosaver(store: FakeStore, onStatus?: (status: AutosaveStatus) => void) {
  return createAutosaver({
    store,
    serialize: (library, timeline) =>
      Promise.resolve(bytesOf(`${library.clips.length}:${timeline.entries.length}`)),
    fetchBlob: (theClip) => Promise.resolve(new Blob([theClip.id], { type: 'video/webm' })),
    onStatus,
    debounceMs: 100,
  })
}

describe('planMediaSync (#194)', () => {
  it('writes unstored clips, keeps stored ones, prunes departed ones', () => {
    const clips = [clip('a'), clip('b')]
    const plan = planMediaSync(clips, ['b', 'gone'], new Set())
    expect(plan.write.map((c) => c.id)).toEqual(['a'])
    expect(plan.prune).toEqual(['gone'])
  })

  it('never retries a blob that already failed this session', () => {
    const plan = planMediaSync([clip('a')], [], new Set(['a']))
    expect(plan.write).toEqual([])
  })
})

describe('sessionIsEmpty (#194)', () => {
  it('is true for the startup state', () => {
    expect(sessionIsEmpty(emptyLibrary, emptyTimeline)).toBe(true)
  })

  it('counts clip-less timeline content (slates, texts) as content', () => {
    const withSlate = timelineReducer(emptyTimeline, {
      type: 'entry-added',
      entry: slateEntry('s1'),
    })
    expect(sessionIsEmpty(emptyLibrary, withSlate)).toBe(false)
  })

  it('counts a library-only session as content', () => {
    expect(sessionIsEmpty(libraryOf(clip('a')), emptyTimeline)).toBe(false)
  })
})

describe('createAutosaver (#194)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Runs pending timers and settles the pass's promise chain. */
  const settle = async () => {
    await vi.runAllTimersAsync()
  }

  it('debounces: rapid changes coalesce into one structure write', async () => {
    const store = fakeStore()
    const autosaver = testAutosaver(store)
    const theClip = clip('a')
    const library = libraryOf(theClip)
    autosaver.stateChanged(library, emptyTimeline)
    autosaver.stateChanged(library, timelineWith(theClip))
    await settle()
    expect(store.log.filter((entry) => entry === 'structure')).toHaveLength(1)
    expect(new TextDecoder().decode(store.structure as Uint8Array)).toBe('1:1')
  })

  it('writes each clip blob once and prunes removed clips', async () => {
    const store = fakeStore()
    const autosaver = testAutosaver(store)
    const a = clip('a')
    const b = clip('b')
    autosaver.stateChanged(libraryOf(a), emptyTimeline)
    await settle()
    expect([...store.media.keys()]).toEqual(['a'])

    // A later pass with the same clip does not rewrite its blob.
    autosaver.stateChanged(libraryOf(a, b), emptyTimeline)
    await settle()
    expect(store.log.filter((entry) => entry === 'media:a')).toHaveLength(1)
    expect([...store.media.keys()]).toEqual(['a', 'b'])

    // Removing a clip removes its blob on the next pass.
    autosaver.stateChanged(libraryOf(b), emptyTimeline)
    await settle()
    expect([...store.media.keys()]).toEqual(['b'])
  })

  it('clears the snapshot when the session empties (New Project rule)', async () => {
    const store = fakeStore()
    const autosaver = testAutosaver(store)
    autosaver.stateChanged(libraryOf(clip('a')), emptyTimeline)
    await settle()
    expect(store.structure).not.toBeNull()

    autosaver.stateChanged(emptyLibrary, emptyTimeline)
    await settle()
    expect(store.structure).toBeNull()
    expect(store.media.size).toBe(0)
  })

  it('degrades to structure-only when a blob write fails, and says so once', async () => {
    const store = fakeStore()
    const statuses: AutosaveStatus[] = []
    const autosaver = testAutosaver(store, (status) => statuses.push(status))
    store.failMediaWrites = true
    const a = clip('a')
    autosaver.stateChanged(libraryOf(a), emptyTimeline)
    await settle()
    // The structure survived; the blob did not; the UI was told.
    expect(store.structure).not.toBeNull()
    expect(store.media.size).toBe(0)
    expect(statuses).toEqual(['structure-only'])

    // Later passes keep writing structure and never thrash-retry the blob.
    autosaver.stateChanged(libraryOf(a), timelineWith(a))
    await settle()
    expect(new TextDecoder().decode(store.structure as Uint8Array)).toBe('1:1')
    expect(statuses).toEqual(['structure-only'])
  })

  it('reports unavailable when the structure write itself fails', async () => {
    const store = fakeStore()
    const statuses: AutosaveStatus[] = []
    const autosaver = testAutosaver(store, (status) => statuses.push(status))
    store.failStructureWrites = true
    autosaver.stateChanged(libraryOf(clip('a')), emptyTimeline)
    await settle()
    expect(statuses).toEqual(['unavailable'])
  })

  it('a disposed autosaver never writes', async () => {
    const store = fakeStore()
    const autosaver = testAutosaver(store)
    autosaver.stateChanged(libraryOf(clip('a')), emptyTimeline)
    autosaver.dispose()
    await settle()
    expect(store.log).toEqual([])
  })
})

describe('readAutosaveSnapshot (#194)', () => {
  it('is null with no stored structure', async () => {
    await expect(readAutosaveSnapshot(fakeStore())).resolves.toBeNull()
  })

  it('returns the structure with whatever media is stored', async () => {
    const store = fakeStore()
    store.structure = bytesOf('snapshot')
    store.media.set('a', new Blob(['a'])) // possibly partial — caller decides
    const snapshot = await readAutosaveSnapshot(store)
    expect(new TextDecoder().decode(snapshot?.structure as Uint8Array)).toBe('snapshot')
    expect([...(snapshot?.media.keys() ?? [])]).toEqual(['a'])
  })
})
