import type { LibraryClip } from './mediaLibrary'

/**
 * Multi-selection over the media library (#292) — the selection model
 * behind batch actions (Add to timeline as one step; batch Remove, #293).
 *
 * The selection is **session state only**: it is owned by the library
 * component, never by the project model, so it cannot reach project files
 * (`projectFile.ts`), the autosave snapshot (#194), or layout storage.
 *
 * It is a set of clip ids plus an anchor. The *effective* selection is
 * always the intersection with the library's current clips, in the
 * library's display order (`selectedClips`): a clip removed from the
 * library drops out without any bookkeeping, and a replaced library (Open
 * Project / New Project / restore) — whose clips carry different ids —
 * starts unselected. The one theoretical exception, reopening a file whose
 * clips carry exactly the ids already selected, keeps those same clips
 * selected, which is harmless.
 *
 * Standard media-panel semantics: a click toggles one item and moves the
 * anchor to it; a Shift+click *selects* (never deselects) the whole range
 * between the anchor and the clicked item, inclusive, in display order,
 * and leaves the anchor where it was so successive Shift+clicks extend
 * from the same origin; Select-all sets or clears every listed clip.
 */
export interface LibrarySelection {
  /** Selected clip ids, unordered — order comes from the library. */
  ids: readonly string[]
  /** The last item toggled by a plain click; where a Shift+click ranges from. */
  anchorId: string | null
}

export const emptySelection: LibrarySelection = { ids: [], anchorId: null }

export type LibrarySelectionAction =
  | { type: 'toggled'; id: string }
  | {
      /**
       * Shift+click: selects every id of `order` between the anchor and
       * `id`, inclusive. `order` is the library's display order. Without a
       * usable anchor (none yet, or one no longer listed) this is a plain
       * toggle, so the first Shift+click in a fresh library still selects.
       */
      type: 'range-selected'
      id: string
      order: readonly string[]
    }
  | { type: 'all-set'; ids: readonly string[]; selected: boolean }
  | { type: 'cleared' }

export function librarySelectionReducer(
  selection: LibrarySelection,
  action: LibrarySelectionAction,
): LibrarySelection {
  switch (action.type) {
    case 'toggled':
      return toggle(selection, action.id)
    case 'range-selected': {
      const from = selection.anchorId === null ? -1 : action.order.indexOf(selection.anchorId)
      const to = action.order.indexOf(action.id)
      if (from === -1 || to === -1) return toggle(selection, action.id)
      const [start, end] = from <= to ? [from, to] : [to, from]
      const range = action.order.slice(start, end + 1)
      const ids = new Set(selection.ids)
      for (const id of range) ids.add(id)
      return { ids: [...ids], anchorId: selection.anchorId }
    }
    case 'all-set':
      return action.selected
        ? { ids: [...new Set([...selection.ids, ...action.ids])], anchorId: selection.anchorId }
        : {
            ids: selection.ids.filter((id) => !action.ids.includes(id)),
            anchorId: selection.anchorId,
          }
    case 'cleared':
      return selection.ids.length === 0 && selection.anchorId === null ? selection : emptySelection
  }
}

function toggle(selection: LibrarySelection, id: string): LibrarySelection {
  const ids = selection.ids.includes(id)
    ? selection.ids.filter((existing) => existing !== id)
    : [...selection.ids, id]
  return { ids, anchorId: id }
}

/**
 * The effective selection: the library's clips that are selected, in the
 * library's display order — what every batch action operates on and what
 * the count in the action bar reports.
 */
export function selectedClips(
  selection: LibrarySelection,
  clips: readonly LibraryClip[],
): LibraryClip[] {
  if (selection.ids.length === 0) return []
  const ids = new Set(selection.ids)
  return clips.filter((clip) => ids.has(clip.id))
}
