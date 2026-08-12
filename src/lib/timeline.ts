import type { LibraryClip } from './mediaLibrary'

export interface TimelineEntry {
  id: string
  /** References a LibraryClip.id; the same clip may appear in many entries. */
  clipId: string
}

export interface TimelineState {
  entries: TimelineEntry[]
}

export const emptyTimeline: TimelineState = { entries: [] }

export type TimelineAction =
  | { type: 'entry-added'; entry: TimelineEntry }
  | { type: 'entry-removed'; entryId: string }
  | { type: 'entry-moved'; entryId: string; direction: 'up' | 'down' }

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'entry-added':
      return { entries: [...state.entries, action.entry] }
    case 'entry-removed':
      return { entries: state.entries.filter((entry) => entry.id !== action.entryId) }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.entryId)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return { entries }
    }
  }
}

/**
 * Total duration of the sequence in seconds. Entries whose clip is missing
 * from the library contribute 0 (defensive — the UI never removes library
 * clips yet, so this should not occur).
 */
export function timelineDuration(state: TimelineState, clips: readonly LibraryClip[]): number {
  const byId = new Map(clips.map((clip) => [clip.id, clip]))
  return state.entries.reduce((sum, entry) => sum + (byId.get(entry.clipId)?.duration ?? 0), 0)
}
