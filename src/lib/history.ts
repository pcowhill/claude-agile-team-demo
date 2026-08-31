import type { TimelineAction, TimelineState } from './timeline'
import { emptyTimeline, timelineReducer } from './timeline'

/**
 * Undo/redo over timeline edits (#189).
 *
 * Every timeline mutation already flows through `timelineReducer` as a single
 * dispatched action — field edits commit on blur/Enter (one action per
 * committed value, never one per keystroke), adds and removals are one action
 * each — so "one action = one undo step" is exactly the grouping the customer
 * experiences, and no extra coalescing layer is needed. The reducer's
 * same-reference no-op contract carries over: an action that changes nothing
 * pushes nothing onto the history.
 *
 * The history is session-local by design: it is never serialized into
 * project files or any other persistence. States share structure (the
 * reducer copies only what changes), so a bounded stack of references is
 * cheap to hold.
 */

/**
 * How many undo steps are kept. Deep enough that a user cannot plausibly
 * edit past a mistake they still remember; small enough that even a
 * pathological session holds a bounded set of state references.
 */
export const HISTORY_LIMIT = 100

export interface TimelineHistory {
  /** Earlier states, oldest first. The last element is what undo restores. */
  past: TimelineState[]
  /** The live timeline — what the app renders and every edit acts on. */
  present: TimelineState
  /** Undone states, soonest first. The first element is what redo restores. */
  future: TimelineState[]
}

export const emptyTimelineHistory: TimelineHistory = {
  past: [],
  present: emptyTimeline,
  future: [],
}

export type TimelineHistoryAction =
  | TimelineAction
  | { type: 'edit-undone' }
  | { type: 'edit-redone' }

/**
 * Wraps `timelineReducer` with undo/redo. Timeline actions pass straight
 * through and, when they change the state, push the outgoing state onto
 * `past` and clear `future` (a new edit after undo discards the redo line —
 * standard semantics). Two actions instead **clear the whole history**:
 *
 * - `timeline-replaced` (open project / new project, #77): the replaced
 *   editing session's states belong to media that may no longer be loaded,
 *   and undoing "across" an open would silently splice two projects.
 * - `entries-removed-for-clip` (a clip removed from the media library):
 *   the clip's object URL is revoked by the same handler, so any held state
 *   still referencing it could never play again — clearing is the rule that
 *   makes "undo never resurrects references to removed media" hold. The
 *   present state is not enough to decide: an entry edited off the timeline
 *   (and so absent from the present) still lives in `past`/`future` states,
 *   which undo/redo would resurrect. The history is therefore cleared when
 *   the removal touches the present **or** any held state references the
 *   clip; only a removal no held state references keeps the history.
 */

/** Whether any item of this timeline state was created from the clip. */
function referencesClip(state: TimelineState, clipId: string): boolean {
  return (
    state.entries.some((entry) => entry.clipId === clipId) ||
    (state.audioTracks ?? []).some((track) => track.clipId === clipId) ||
    (state.videoOverlays ?? []).some((overlay) => overlay.clipId === clipId)
  )
}
export function timelineHistoryReducer(
  history: TimelineHistory,
  action: TimelineHistoryAction,
): TimelineHistory {
  switch (action.type) {
    case 'edit-undone': {
      const previous = history.past[history.past.length - 1]
      if (previous === undefined) return history
      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    }
    case 'edit-redone': {
      const [next, ...rest] = history.future
      if (next === undefined) return history
      return {
        past: [...history.past, history.present],
        present: next,
        future: rest,
      }
    }
    default: {
      const present = timelineReducer(history.present, action)
      if (action.type === 'entries-removed-for-clip') {
        const holdsClip =
          present !== history.present ||
          history.past.some((state) => referencesClip(state, action.clipId)) ||
          history.future.some((state) => referencesClip(state, action.clipId))
        return holdsClip ? { past: [], present, future: [] } : history
      }
      if (present === history.present) return history
      if (action.type === 'timeline-replaced') {
        return { past: [], present, future: [] }
      }
      return {
        past: [...history.past, history.present].slice(-HISTORY_LIMIT),
        present,
        future: [],
      }
    }
  }
}

/**
 * Whether a keydown target is a text-editing context, where Ctrl/Cmd+Z must
 * stay the browser's native text undo instead of a timeline undo (#189).
 * Non-text inputs (buttons, checkboxes, range sliders, color pickers) carry
 * no native undo, so the shortcut acts on the timeline there.
 */
export function targetEditsText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    const textless = ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color']
    return !textless.includes(target.type)
  }
  return false
}
