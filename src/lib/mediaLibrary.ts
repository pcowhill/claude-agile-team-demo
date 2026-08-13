export interface LibraryClip {
  id: string
  /** Original filename, e.g. "holiday.mp4". */
  name: string
  /** Duration in seconds. Always finite and > 0. */
  duration: number
  /** Object URL pointing at the imported file, usable as a <video> src. */
  url: string
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

export type MediaLibraryAction =
  | { type: 'clip-added'; clip: LibraryClip }
  | { type: 'clip-removed'; id: string }
  | { type: 'import-failed'; failure: ImportFailure }
  | { type: 'failures-dismissed' }

export function mediaLibraryReducer(
  state: MediaLibraryState,
  action: MediaLibraryAction,
): MediaLibraryState {
  switch (action.type) {
    case 'clip-added':
      return { ...state, clips: [...state.clips, action.clip] }
    case 'clip-removed':
      return { ...state, clips: state.clips.filter((clip) => clip.id !== action.id) }
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
