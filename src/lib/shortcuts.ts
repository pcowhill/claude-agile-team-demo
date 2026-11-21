/**
 * Every keyboard shortcut the app answers to, in one place (#203, #482):
 * the transport keys the cheat sheet is opened by, the #189 undo/redo
 * chords the App-level handler owns, and the help keys (#478). Both the
 * `?` cheat sheet (`ShortcutHelpDialog`) and the user guide's Keyboard
 * shortcuts page render this table, so the two can never disagree — the
 * design's §6 "generated from the same table" guarantee (#477). Update it
 * when a shortcut is added or changed.
 *
 * A function of the step sizes rather than a constant, because those are
 * settings (#286) and a sheet that still said "0.1 s" after the user chose
 * 0.25 s would be documentation that lies. `keys` lists alternative combos:
 * each renders as its own <kbd> on its own line, so a combo never wraps
 * mid-combo (#287).
 */
export interface Shortcut {
  /** Alternative key combos, each shown on its own line. */
  keys: readonly string[]
  /** What the keys do, as a short sentence without a full stop. */
  does: string
  /**
   * Where the keys work, when not everywhere: "In the shape editor" (#686)
   * for keys that act only while that editor's picture has the focus.
   * Absent for the app-wide keys. The sheet and the guide's table both
   * show each scope as its own heading after the app-wide rows.
   */
  scope?: string
}

/** The shape editor's own keys (#686): they act on its selection. */
export const SHAPE_EDITOR_SCOPE = 'In the shape editor'

/**
 * The Trim window's own keys (#707). The window is a modal dialog, so the
 * app-wide rows above are inert while it is open, and the same keys do
 * these instead.
 */
export const TRIM_WINDOW_SCOPE = 'In the Trim window'

/**
 * The Split window's own keys (#825): a modal dialog too, so the app-wide
 * rows are inert while it is open. The arrows move the split point wherever
 * the focus is in the window, but a field being typed in.
 */
export const SPLIT_WINDOW_SCOPE = 'In the Split window'

export const shortcutsFor = (stepSeconds: number, largeStepSeconds: number): readonly Shortcut[] => [
  { keys: ['Space'], does: 'Play / pause the preview' },
  { keys: ['← / →'], does: `Step the playhead ${stepSeconds} s back / forward` },
  { keys: ['Shift + ← / →'], does: `Step the playhead ${largeStepSeconds} s back / forward` },
  { keys: ['Home / End'], does: 'Jump to the sequence start / end' },
  { keys: ['↑ / ↓'], does: 'Jump to the previous / next cut or transition edge' },
  { keys: ['I / O'], does: 'Mark the export range in / out at the playhead' },
  { keys: ['M'], does: 'Add a chapter marker at the playhead' },
  { keys: ['Q / W'], does: 'Trim the clip under the playhead to start / end there' },
  { keys: ['X'], does: 'Cut the marked range out of the sequence' },
  { keys: ['R'], does: 'Step the review speed: 0.5× · 1× · 1.5× · 2×' },
  { keys: ['Esc'], does: 'Leave the source preview, back to the sequence' },
  { keys: ['Ctrl/Cmd + Z'], does: 'Undo the last timeline edit' },
  { keys: ['Ctrl/Cmd + Shift + Z', 'Ctrl/Cmd + Y'], does: 'Redo' },
  { keys: ['F1'], does: 'Open the user guide' },
  { keys: ['?'], does: 'Show the keyboard shortcuts cheat sheet' },
  { keys: ['Delete', 'Backspace'], does: 'Remove the selected shapes', scope: SHAPE_EDITOR_SCOPE },
  {
    keys: ['Ctrl/Cmd + D'],
    does: 'Duplicate the selected shapes, slightly offset',
    scope: SHAPE_EDITOR_SCOPE,
  },
  { keys: ['Space'], does: 'Play / pause Play trim', scope: TRIM_WINDOW_SCOPE },
  { keys: ['I / O'], does: 'Set the In / Out clamp at the playhead', scope: TRIM_WINDOW_SCOPE },
  {
    keys: ['← / →'],
    does: `Move the focused clamp ${stepSeconds} s back / forward`,
    scope: TRIM_WINDOW_SCOPE,
  },
  {
    keys: ['Shift + ← / →'],
    does: `Move the focused clamp ${largeStepSeconds} s back / forward`,
    scope: TRIM_WINDOW_SCOPE,
  },
  { keys: ['Esc'], does: 'Close the window without applying', scope: TRIM_WINDOW_SCOPE },
  { keys: ['Space'], does: 'Play on from the split point / pause', scope: SPLIT_WINDOW_SCOPE },
  {
    keys: ['← / →'],
    does: `Move the split point ${stepSeconds} s back / forward`,
    scope: SPLIT_WINDOW_SCOPE,
  },
  {
    keys: ['Shift + ← / →'],
    does: `Move the split point ${largeStepSeconds} s back / forward`,
    scope: SPLIT_WINDOW_SCOPE,
  },
  { keys: ['Esc'], does: 'Close the window without splitting', scope: SPLIT_WINDOW_SCOPE },
]

/**
 * The table cut into its sections (#686): the app-wide keys first, under
 * no heading, then each scope's keys under its own, in the order the
 * scopes first appear.
 */
export function shortcutSections(
  shortcuts: readonly Shortcut[],
): { scope: string | undefined; rows: Shortcut[] }[] {
  const sections: { scope: string | undefined; rows: Shortcut[] }[] = []
  for (const shortcut of shortcuts) {
    let section = sections.find((each) => each.scope === shortcut.scope)
    if (section === undefined) {
      section = { scope: shortcut.scope, rows: [] }
      if (shortcut.scope === undefined) sections.unshift(section)
      else sections.push(section)
    }
    section.rows.push(shortcut)
  }
  return sections
}
