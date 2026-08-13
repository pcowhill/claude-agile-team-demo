import type { LibraryClip } from './mediaLibrary'

export interface TimelineEntry {
  /** Unique per entry — the same library clip can appear multiple times. */
  id: string
  /** The library clip this entry was created from. */
  clipId: string
  name: string
  /** Duration of the source clip in seconds. */
  duration: number
  /** Object URL of the source clip, usable as a <video> src. */
  url: string
  /** Trim start within the source clip, in seconds. 0 ≤ inPoint < outPoint. */
  inPoint: number
  /** Trim end within the source clip, in seconds. inPoint < outPoint ≤ duration. */
  outPoint: number
}

export interface TimelineState {
  entries: TimelineEntry[]
}

export const emptyTimeline: TimelineState = { entries: [] }

export type TimelineAction =
  | { type: 'entry-added'; entry: TimelineEntry }
  | { type: 'entry-removed'; id: string }
  | { type: 'entries-removed-for-clip'; clipId: string }
  | { type: 'entry-moved'; id: string; direction: 'up' | 'down' }
  | { type: 'entry-trimmed'; id: string; inPoint: number; outPoint: number }

export function entryFromClip(clip: LibraryClip, id: string): TimelineEntry {
  return {
    id,
    clipId: clip.id,
    name: clip.name,
    duration: clip.duration,
    url: clip.url,
    inPoint: 0,
    outPoint: clip.duration,
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'entry-added':
      return { entries: [...state.entries, action.entry] }
    case 'entry-removed':
      return { entries: state.entries.filter((entry) => entry.id !== action.id) }
    case 'entries-removed-for-clip': {
      const entries = state.entries.filter((entry) => entry.clipId !== action.clipId)
      // Same reference when nothing matched: a library removal that touches
      // no entries must not read as a timeline edit (which stops playback).
      return entries.length === state.entries.length ? state : { entries }
    }
    case 'entry-moved': {
      const from = state.entries.findIndex((entry) => entry.id === action.id)
      if (from === -1) return state
      const to = action.direction === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[from], entries[to]] = [entries[to], entries[from]]
      return { entries }
    }
    case 'entry-trimmed': {
      const index = state.entries.findIndex((entry) => entry.id === action.id)
      if (index === -1) return state
      if (!Number.isFinite(action.inPoint) || !Number.isFinite(action.outPoint)) return state
      const entry = state.entries[index]
      const inPoint = clamp(action.inPoint, 0, entry.duration)
      const outPoint = clamp(action.outPoint, 0, entry.duration)
      // An empty or inverted range would make the entry unplayable — reject it.
      if (inPoint >= outPoint) return state
      if (inPoint === entry.inPoint && outPoint === entry.outPoint) return state
      const entries = [...state.entries]
      entries[index] = { ...entry, inPoint, outPoint }
      return { entries }
    }
  }
}

/** The trimmed (playable) duration of one entry, in seconds. */
export function effectiveDuration(entry: TimelineEntry): number {
  return entry.outPoint - entry.inPoint
}

/** Total duration of the sequence in seconds, honoring trims. */
export function totalDuration(state: TimelineState): number {
  return state.entries.reduce((sum, entry) => sum + effectiveDuration(entry), 0)
}
