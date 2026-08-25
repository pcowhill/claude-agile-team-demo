/**
 * What a library clip's media fundamentally is (#101). Deliberately generic
 * "audio", not "music": the same import path serves music, voice-overs and
 * sound effects (#100).
 */
export type MediaKind = 'video' | 'audio'

export interface LibraryClip {
  id: string
  /** Original filename, e.g. "holiday.mp4". */
  name: string
  /** Duration in seconds. Always finite and > 0. */
  duration: number
  /** Object URL pointing at the imported file, usable as a media src. */
  url: string
  /** Whether this is a video or an audio clip (#101). */
  kind: MediaKind
}

export interface ImportFailure {
  id: string
  /** Filename of the file that could not be imported. */
  name: string
  reason: string
}

export interface MediaLibraryState {
  clips: LibraryClip[]
  failures: ImportFailure[]
}

export const emptyLibrary: MediaLibraryState = { clips: [], failures: [] }

/** Keys the library can sort by (#123). */
export type ClipSortKey = 'name' | 'kind' | 'duration'
export type ClipSortDirection = 'asc' | 'desc'

/**
 * Per-key ascending comparators (#123). Name comparison is case-insensitive
 * and locale-aware with numeric collation ("clip2" before "clip10"). Kind
 * ascending puts videos first — the primary medium here; the sequence is
 * built from them — with audio following. Every comparator returns 0 for
 * ties so the stable sort below preserves their existing relative order.
 */
const CLIP_COMPARATORS: Record<ClipSortKey, (a: LibraryClip, b: LibraryClip) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  kind: (a, b) => Number(a.kind === 'audio') - Number(b.kind === 'audio'),
  duration: (a, b) => a.duration - b.duration,
}

/**
 * Stably reorders clips by one key (#123). The customer's carry-over
 * semantics ("sort by name, then by type — each type group stays
 * alphabetical") are exactly a stable sort applied to the current order:
 * ties keep their existing relative positions, so the list itself carries
 * the history of previous sorts. Descending flips the comparator — never
 * the array — so ties keep their order in both directions.
 */
export function sortClips(
  clips: LibraryClip[],
  key: ClipSortKey,
  direction: ClipSortDirection,
): LibraryClip[] {
  const compare = CLIP_COMPARATORS[key]
  const sign = direction === 'desc' ? -1 : 1
  return [...clips].sort((a, b) => sign * compare(a, b))
}

export type MediaLibraryAction =
  | {
      /**
       * Wholesale replacement, for opening a project or starting a new one
       * (#77). Stores the action's `clips` array by reference (what the
       * unsaved-changes tracking compares, #76) and clears transient
       * failures, which belong to the session being left behind.
       */
      type: 'library-replaced'
      clips: LibraryClip[]
    }
  | { type: 'clip-added'; clip: LibraryClip }
  | { type: 'clip-removed'; id: string }
  | {
      /**
       * Reorders the stored clip list (#123) — the same order every consumer
       * sees: the rendered library, the timeline Add buttons, and saved
       * project files.
       */
      type: 'clips-sorted'
      key: ClipSortKey
      direction: ClipSortDirection
    }
  | { type: 'import-failed'; failure: ImportFailure }
  | { type: 'failures-dismissed' }

export function mediaLibraryReducer(
  state: MediaLibraryState,
  action: MediaLibraryAction,
): MediaLibraryState {
  switch (action.type) {
    case 'library-replaced':
      return { clips: action.clips, failures: [] }
    case 'clip-added':
      return { ...state, clips: [...state.clips, action.clip] }
    case 'clip-removed':
      return { ...state, clips: state.clips.filter((clip) => clip.id !== action.id) }
    case 'clips-sorted': {
      const sorted = sortClips(state.clips, action.key, action.direction)
      // An order-preserving sort returns the same state reference so it
      // cannot mark the project dirty (#76 compares references).
      return sorted.every((clip, index) => clip === state.clips[index])
        ? state
        : { ...state, clips: sorted }
    }
    case 'import-failed':
      return { ...state, failures: [...state.failures, action.failure] }
    case 'failures-dismissed':
      return { ...state, failures: [] }
  }
}

/** Formats a duration in seconds as m:ss or h:mm:ss, e.g. 7.4 → "0:07". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${m}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : mmss
}
