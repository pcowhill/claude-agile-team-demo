import type { LibraryClip } from './mediaLibrary'

export interface TimelineEntry {
  /** Unique per entry — the same library clip can appear multiple times. */
  id: string
  /** The library clip this entry was created from. */
  clipId: string
  name: string
  /** Duration in seconds. */
  duration: number
  /** Object URL of the source clip, usable as a <video> src. */
  url: string
}

export interface TimelineState {
  entries: TimelineEntry[]
}

export const emptyTimeline: TimelineState = { entries: [] }

export type TimelineAction =
  | { type: 'entry-added'; entry: TimelineEntry }
  | { type: 'entry-removed'; id: string }
  | { type: 'entry-moved'; id: string; direction: 'up' | 'down' }

export function entryFromClip(clip: LibraryClip, id: string): TimelineEntry {
  return { id, clipId: clip.id, name: clip.name, duration: clip.duration, url: clip.url }
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'entry-added':
      return { entries: [...state.entries, action.entry] }
    case 'entry-removed':
      return { entries: state.entries.filter((entry) => entry.id !== action.id) }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return { entries }
    }
  }
}

/** Total duration of the sequence in seconds. */
export function totalDuration(state: TimelineState): number {
  return state.entries.reduce((sum, entry) => sum + entry.duration, 0)
}
