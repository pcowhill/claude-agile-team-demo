/**
 * Remembered preview layout choice. #128 made it a toggle: the preview in
 * its place beside the media library, or expanded to the full content
 * width. #667 (from the customer's #660) adds a third, **Fit to width**: the
 * preview stays beside the library, but its picture takes the panel's whole
 * width and the row grows to fit. The customer asked for the choice to
 * survive page loads (#126, option B), so it persists in localStorage — per
 * browser, like a window-size preference, deliberately outside the project
 * file and the autosave snapshot.
 */

/** The three views View ▾ offers. `default` is the layout with nothing stored. */
export type PreviewLayout = 'default' | 'expanded' | 'fit-width'

export const PREVIEW_LAYOUT_KEY = 'browser-video-editor.preview-layout'

/**
 * #128's two-valued key, `'1'` for expanded and `'0'` for not. Read only
 * when the three-valued key above holds nothing, so a browser that chose
 * Expand before #667 keeps its layout on upgrade. Never written.
 */
export const PREVIEW_EXPANDED_KEY = 'browser-video-editor.preview-expanded'

const LAYOUTS: readonly PreviewLayout[] = ['default', 'expanded', 'fit-width']

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

function isPreviewLayout(value: string | null): value is PreviewLayout {
  return value !== null && (LAYOUTS as readonly string[]).includes(value)
}

/** The remembered layout, defaulting to `default`. Never throws. */
export function loadPreviewLayout(
  storage: PreviewLayoutStorage | null = defaultStorage(),
): PreviewLayout {
  try {
    const stored = storage?.getItem(PREVIEW_LAYOUT_KEY) ?? null
    if (isPreviewLayout(stored)) return stored
    // An unrecognized value (a future version's, say) is treated as nothing
    // stored, so the legacy key still decides rather than a blank layout.
    return storage?.getItem(PREVIEW_EXPANDED_KEY) === '1' ? 'expanded' : 'default'
  } catch {
    return 'default'
  }
}

/**
 * The preview stage's class for a layout, shared by the sequence's stage and
 * a library clip's source preview (#403) so the panel keeps its shape when
 * switching between them. Expanded (#128) and Fit to width (#667) share the
 * width-sized stage rule in PreviewPlayer.css — the stage takes the panel's
 * width and its height follows the frame's aspect — and differ only in
 * where App's grid puts the panel.
 */
export function previewStageClass(layout: PreviewLayout): string {
  switch (layout) {
    case 'default':
      return 'preview-stage'
    case 'expanded':
      return 'preview-stage preview-stage-expanded'
    case 'fit-width':
      return 'preview-stage preview-stage-fit'
  }
}

/** Remembers the choice. Best-effort: a full or blocked store loses only the
 * preference, never the choice itself. */
export function savePreviewLayout(
  layout: PreviewLayout,
  storage: PreviewLayoutStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PREVIEW_LAYOUT_KEY, layout)
  } catch {
    // Losing the preference is acceptable; breaking the menu is not.
  }
}
