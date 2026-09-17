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
}

export const shortcutsFor = (stepSeconds: number, largeStepSeconds: number): readonly Shortcut[] => [
  { keys: ['Space'], does: 'Play / pause the preview' },
  { keys: ['← / →'], does: `Step the playhead ${stepSeconds} s back / forward` },
  { keys: ['Shift + ← / →'], does: `Step the playhead ${largeStepSeconds} s back / forward` },
  { keys: ['Home / End'], does: 'Jump to the sequence start / end' },
  { keys: ['↑ / ↓'], does: 'Jump to the previous / next cut or transition edge' },
  { keys: ['I / O'], does: 'Mark the export range in / out at the playhead' },
  { keys: ['M'], does: 'Add a chapter marker at the playhead' },
  { keys: ['R'], does: 'Step the review speed: 0.5× · 1× · 1.5× · 2×' },
  { keys: ['Esc'], does: 'Leave the source preview, back to the sequence' },
  { keys: ['Ctrl/Cmd + Z'], does: 'Undo the last timeline edit' },
  { keys: ['Ctrl/Cmd + Shift + Z', 'Ctrl/Cmd + Y'], does: 'Redo' },
  { keys: ['F1'], does: 'Open the user guide' },
  { keys: ['?'], does: 'Show the keyboard shortcuts cheat sheet' },
]
