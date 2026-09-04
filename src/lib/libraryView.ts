/**
 * Remembered media-library view choice (#311): whether the clip list shows
 * one text row per clip or a grid of thumbnail cards. The customer asked to
 * toggle back and forth (#309), and a view preference is not part of the
 * work — so it persists in localStorage, per browser, exactly like the
 * preview's expanded state (#128) and deliberately outside the project file
 * and the autosave snapshot.
 */

export const LIBRARY_VIEW_KEY = 'browser-video-editor.library-view'

/** The two layouts of the same clip list. `list` is the default. */
export type LibraryView = 'list' | 'thumbnails'

/**
 * The slice of Storage this needs; injectable so tests stay deterministic.
 * Structurally identical to `PreviewLayoutStorage`, so `App`'s single
 * `layoutStorage` prop serves both without either module depending on the
 * other.
 */
export type LibraryViewStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): LibraryViewStorage | null {
  // Accessing localStorage itself can throw (storage disabled entirely).
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The remembered view, defaulting to the row list. Never throws. */
export function loadLibraryView(
  storage: LibraryViewStorage | null = defaultStorage(),
): LibraryView {
  try {
    // Only the one recognized value switches away from the default, so a
    // stored value from a future version degrades to the list rather than
    // rendering nothing.
    return storage?.getItem(LIBRARY_VIEW_KEY) === 'thumbnails' ? 'thumbnails' : 'list'
  } catch {
    return 'list'
  }
}

/** Remembers the choice. Best-effort: a full or blocked store loses only the
 * preference, never the toggle itself. */
export function saveLibraryView(
  view: LibraryView,
  storage: LibraryViewStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(LIBRARY_VIEW_KEY, view)
  } catch {
    // Losing the preference is acceptable; breaking the toggle is not.
  }
}
