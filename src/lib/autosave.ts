import type { LibraryClip, MediaLibraryState } from './mediaLibrary'
import { audioTracksOf, textsOf } from './timeline'
import type { TimelineState } from './timeline'

/**
 * Crash-safe autosave (#194): the editor periodically snapshots the full
 * session — project structure AND the media library's blobs — into
 * IndexedDB, so reopening the page after a crash or refresh can offer
 * "Restore last session?" and bring everything back with no file
 * re-picking.
 *
 * Shape of the snapshot:
 *
 * - **Structure** is one record: the bytes `serializeProject` produces in
 *   references mode (clip metadata, timeline, plugin dependencies — no
 *   media). Restore runs them back through `deserializeProject`, so the
 *   snapshot round-trips exactly what project files round-trip, validator
 *   and all, with no parallel serialization code.
 * - **Media** is one blob per library clip, keyed by clip id. Object URLs
 *   die with the page, but the underlying Blobs are structured-clonable
 *   and IndexedDB stores them; restore mints fresh object URLs.
 *
 * Cadence (#194's "state the cadence"): the structure is re-serialized and
 * written `AUTOSAVE_DEBOUNCE_MS` after the last committed change — heavy
 * media is never rewritten on a structure edit. Each clip's blob is
 * written **once**, when the clip first appears in a snapshot pass, and
 * deleted when the clip leaves the library. An empty session (no clips,
 * no timeline content) clears the snapshot entirely — which is also what
 * implements the replace rule: New Project empties the state and the
 * snapshot follows; opening a project replaces the state and the snapshot
 * mirrors the opened project on the next pass.
 *
 * Failure policy (#194): storage problems must never break editing and
 * never silently lose autosave. A failed blob write (quota — media too
 * large) degrades the session to structure-only autosave and reports
 * 'structure-only' so the UI can unobtrusively say so; restore of a
 * structure-only snapshot goes through the existing re-link flow instead
 * of failing. A failed structure write reports 'unavailable'. IndexedDB
 * being entirely absent means `openAutosaveStore` rejects and autosave is
 * simply off — nothing was ever stored, so there is nothing to lose.
 */

/** Milliseconds of quiet after the last change before a snapshot pass. */
export const AUTOSAVE_DEBOUNCE_MS = 1500

const DB_NAME = 'bvep-autosave'
const DB_VERSION = 1
const STRUCTURE_STORE = 'structure'
const MEDIA_STORE = 'media'
/** The single structure record's key — one snapshot per browser profile. */
const STRUCTURE_KEY = 'current'
/** The saved marker's key (#288), in the structure store so the structure
 * and its marker commit in one transaction. */
const SAVED_KEY = 'saved'

/**
 * The persistence surface the autosaver and the restore flow use. An
 * interface (rather than the IndexedDB implementation directly) so unit
 * tests can drive the orchestration against an in-memory fake — jsdom has
 * no IndexedDB.
 */
export interface AutosaveStore {
  /**
   * Writes the structure bytes together with whether the snapshotted state
   * matched the last saved project (#288) — one atomic write, so a refresh
   * can never observe a new structure with a stale saved marker.
   */
  writeStructure(bytes: Uint8Array<ArrayBuffer>, saved: boolean): Promise<void>
  /** The stored structure bytes, or null when no snapshot exists. */
  readStructure(): Promise<Uint8Array<ArrayBuffer> | null>
  /**
   * The stored saved marker, or null when none was recorded (a snapshot
   * from before #288). Callers treat null as unsaved — the safe direction:
   * a false "unsaved" costs one redundant save, a false "saved" hides that
   * restored work was never written to a file.
   */
  readSaved(): Promise<boolean | null>
  writeMedia(clipId: string, blob: Blob): Promise<void>
  /** Ids of every stored media blob. */
  listMediaIds(): Promise<string[]>
  /** Every stored media blob, keyed by clip id. */
  readAllMedia(): Promise<Map<string, Blob>>
  deleteMedia(clipIds: readonly string[]): Promise<void>
  /** Removes the whole snapshot (structure and media). */
  clear(): Promise<void>
}

const requested = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })

/**
 * Opens the IndexedDB-backed snapshot store. Rejects when IndexedDB is
 * unavailable (jsdom, or a browser profile that blocks storage) — the
 * caller treats that as "autosave off", never as an editing failure.
 */
export async function openAutosaveStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<AutosaveStore> {
  if (factory === undefined) throw new Error('IndexedDB is unavailable')
  const openRequest = factory.open(DB_NAME, DB_VERSION)
  openRequest.onupgradeneeded = () => {
    const db = openRequest.result
    if (!db.objectStoreNames.contains(STRUCTURE_STORE)) db.createObjectStore(STRUCTURE_STORE)
    if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE)
  }
  const db = await requested(openRequest)
  return {
    async writeStructure(bytes, saved) {
      const tx = db.transaction(STRUCTURE_STORE, 'readwrite')
      tx.objectStore(STRUCTURE_STORE).put(bytes, STRUCTURE_KEY)
      tx.objectStore(STRUCTURE_STORE).put(saved, SAVED_KEY)
      await transactionDone(tx)
    },
    async readStructure() {
      const tx = db.transaction(STRUCTURE_STORE, 'readonly')
      const stored = await requested(tx.objectStore(STRUCTURE_STORE).get(STRUCTURE_KEY))
      return stored instanceof Uint8Array ? (stored as Uint8Array<ArrayBuffer>) : null
    },
    async readSaved() {
      const tx = db.transaction(STRUCTURE_STORE, 'readonly')
      const stored = await requested(tx.objectStore(STRUCTURE_STORE).get(SAVED_KEY))
      return typeof stored === 'boolean' ? stored : null
    },
    async writeMedia(clipId, blob) {
      const tx = db.transaction(MEDIA_STORE, 'readwrite')
      tx.objectStore(MEDIA_STORE).put(blob, clipId)
      await transactionDone(tx)
    },
    async listMediaIds() {
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const keys = await requested(tx.objectStore(MEDIA_STORE).getAllKeys())
      return keys.filter((key): key is string => typeof key === 'string')
    },
    async readAllMedia() {
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const store = tx.objectStore(MEDIA_STORE)
      const [keys, values] = await Promise.all([
        requested(store.getAllKeys()),
        requested(store.getAll()),
      ])
      const media = new Map<string, Blob>()
      keys.forEach((key, index) => {
        const value = values[index] as unknown
        if (typeof key === 'string' && value instanceof Blob) media.set(key, value)
      })
      return media
    },
    async deleteMedia(clipIds) {
      if (clipIds.length === 0) return
      const tx = db.transaction(MEDIA_STORE, 'readwrite')
      for (const clipId of clipIds) tx.objectStore(MEDIA_STORE).delete(clipId)
      await transactionDone(tx)
    },
    async clear() {
      const tx = db.transaction([STRUCTURE_STORE, MEDIA_STORE], 'readwrite')
      tx.objectStore(STRUCTURE_STORE).clear()
      tx.objectStore(MEDIA_STORE).clear()
      await transactionDone(tx)
    },
  }
}

/**
 * Which media blobs a snapshot pass writes and deletes (#194): write each
 * clip whose blob is not stored yet (and has not already failed this
 * session — retrying an over-quota blob on every keystroke would thrash),
 * delete blobs whose clips left the library. Pure, for unit tests.
 */
export function planMediaSync(
  clips: readonly LibraryClip[],
  storedIds: readonly string[],
  failedIds: ReadonlySet<string>,
): { write: LibraryClip[]; prune: string[] } {
  const stored = new Set(storedIds)
  const clipIds = new Set(clips.map((clip) => clip.id))
  return {
    write: clips.filter((clip) => !stored.has(clip.id) && !failedIds.has(clip.id)),
    prune: storedIds.filter((id) => !clipIds.has(id)),
  }
}

/**
 * Whether the session is empty (#194): nothing worth snapshotting, and an
 * existing snapshot should be cleared. Timeline content that can exist
 * without clips (slates, text overlays) counts as content.
 */
export function sessionIsEmpty(library: MediaLibraryState, timeline: TimelineState): boolean {
  return (
    library.clips.length === 0 &&
    timeline.entries.length === 0 &&
    textsOf(timeline).length === 0 &&
    audioTracksOf(timeline).length === 0
  )
}

/**
 * What the UI should say about autosave: 'ok' (nothing to show), or the
 * two degradations the user must not learn about only after a crash —
 * 'structure-only' (media no longer fits; restore will re-link) and
 * 'unavailable' (nothing is being written at all).
 */
export type AutosaveStatus = 'ok' | 'structure-only' | 'unavailable'

export interface Autosaver {
  /**
   * Feed every committed state change; passes are debounced internally.
   * `saved` says whether this state matches the last saved project (#288),
   * so a restore can re-show the unsaved indicator; omitted means unsaved —
   * the safe default (see readSaved).
   */
  stateChanged(library: MediaLibraryState, timeline: TimelineState, saved?: boolean): void
  /** Resolves when the debounced pass (if any) has fully run — for tests. */
  flush(): Promise<void>
  /** Cancels any pending pass. */
  dispose(): void
}

export interface AutosaverOptions {
  store: AutosaveStore
  /** Produces the structure bytes — `serializeProject` in references mode. */
  serialize: (library: MediaLibraryState, timeline: TimelineState) => Promise<Uint8Array<ArrayBuffer>>
  /** Reads one clip's media back as a Blob (from its object URL). */
  fetchBlob: (clip: LibraryClip) => Promise<Blob>
  onStatus?: (status: AutosaveStatus) => void
  debounceMs?: number
}

/**
 * The autosave loop (#194): debounced snapshot passes over the latest
 * committed state. One pass runs at a time; a change landing mid-pass
 * schedules a fresh pass rather than interleaving. See the module doc for
 * the cadence and failure policy this implements.
 */
export function createAutosaver({
  store,
  serialize,
  fetchBlob,
  onStatus,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: AutosaverOptions): Autosaver {
  let latest: { library: MediaLibraryState; timeline: TimelineState; saved: boolean } | null =
    null
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let disposed = false
  // Blobs that failed to store this session (quota): structure-only mode.
  const failed = new Set<string>()
  let status: AutosaveStatus = 'ok'

  const report = (next: AutosaveStatus) => {
    if (next === status) return
    status = next
    onStatus?.(next)
  }

  const pass = async (): Promise<void> => {
    const state = latest
    if (state === null || disposed) return
    try {
      if (sessionIsEmpty(state.library, state.timeline)) {
        await store.clear()
        report(failed.size > 0 ? 'structure-only' : 'ok')
        return
      }
      await store.writeStructure(await serialize(state.library, state.timeline), state.saved)
      const plan = planMediaSync(state.library.clips, await store.listMediaIds(), failed)
      await store.deleteMedia(plan.prune)
      for (const clip of plan.write) {
        try {
          await store.writeMedia(clip.id, await fetchBlob(clip))
        } catch {
          // Quota (or an unreadable blob): keep the structure snapshot,
          // skip this blob for the rest of the session, and say so.
          failed.add(clip.id)
        }
      }
      report(failed.size > 0 ? 'structure-only' : 'ok')
    } catch {
      // The structure write itself failed: autosave is not protecting the
      // session right now, and the user must not find out after a crash.
      report('unavailable')
    }
  }

  const runPass = () => {
    timer = null
    // Serialize passes: a pass reads `latest` when it starts, so a change
    // arriving mid-pass re-debounces (stateChanged below) instead of racing.
    running = (running ?? Promise.resolve()).then(pass).finally(() => {
      running = null
    })
  }

  return {
    stateChanged(library, timeline, saved = false) {
      if (disposed) return
      latest = { library, timeline, saved }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(runPass, debounceMs)
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer)
        runPass()
      }
      await running
    },
    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

/** A stored snapshot, as the restore offer reads it. */
export interface AutosaveSnapshot {
  structure: Uint8Array<ArrayBuffer>
  media: Map<string, Blob>
  /**
   * Whether the snapshotted state matched the last saved project (#288).
   * A missing marker (pre-#288 snapshot) reads as false: restoring then
   * shows the unsaved indicator — the safe direction.
   */
  saved: boolean
}

/**
 * Reads the stored snapshot, or null when none exists. Media may cover
 * only some clips (a structure-only degrade mid-session) — the restore
 * flow decides between the embedded path and the re-link path from that.
 */
export async function readAutosaveSnapshot(store: AutosaveStore): Promise<AutosaveSnapshot | null> {
  const structure = await store.readStructure()
  if (structure === null) return null
  return { structure, media: await store.readAllMedia(), saved: (await store.readSaved()) === true }
}
