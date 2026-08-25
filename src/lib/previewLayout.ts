/**
 * Remembered preview layout choice (#128): whether the preview panel is
 * expanded to the full content width. The customer asked for the toggle's
 * state to survive page loads (#126, option B), so it persists in
 * localStorage — per browser, like a window-size preference, deliberately
 * outside the project file.
 */

export const PREVIEW_EXPANDED_KEY = 'browser-video-editor.preview-expanded'

/** The slice of Storage this needs; injectable so tests stay deterministic. */
export type PreviewLayoutStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): PreviewLayoutStorage | null {
  // Accessing localStorage itself can throw (storage disabled entirely).
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The remembered choice, defaulting to the normal layout. Never throws. */
export function loadPreviewExpanded(
  storage: PreviewLayoutStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(PREVIEW_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

/** Remembers the choice. Best-effort: a full or blocked store loses only the
 * preference, never the toggle itself. */
export function savePreviewExpanded(
  expanded: boolean,
  storage: PreviewLayoutStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PREVIEW_EXPANDED_KEY, expanded ? '1' : '0')
  } catch {
    // Losing the preference is acceptable; breaking the toggle is not.
  }
}
