# Undo and redo

Every edit to the timeline can be taken back, and taken back again. This page covers [the buttons and keys](#undo-and-redo), [what counts as an edit](#what-is-an-edit) and [what does not](#what-is-not-an-edit), [how many steps are kept](#the-history-limit), what [New Project, Open Project and Restore](#new-project-open-project-and-restore-last-session) do to the history, and whether it [survives a save](#undo-history-and-project-files). The short version of the whole page: **Undo affects timeline edits; it does not affect view choices, settings or library changes; the last {{HISTORY_LIMIT}} edits are kept; and the history never survives a save and open — a reopened project starts with nothing to undo.** The definition of an edit is in [Concepts](concepts.md#edits-and-everything-else).

## Undo and Redo

**Where to find it.** Timeline header › **↺ Undo** and **↻ Redo**, or Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y (Cmd on a Mac).

**What it does.** Walks the history of timeline edits one step back, or one step forward again.

**Details.** Each button is disabled while there is nothing in its direction. The keys work wherever you are on the page — over a button, a slider, a checkbox — with two exceptions: while typing in a text field, where Ctrl+Z stays the browser's own text undo for what you are typing; and while a dialog is open — the export dialog, a confirmation, the project dialogs, the cheat sheet — where the keys wait, like every other shortcut, so a dialog always describes the project it opened on. Close the dialog and they are back. A new edit after an Undo discards the steps that could have been redone, the standard rule. Undo restores exactly the state before the edit: a removed element comes back with every setting, a renamed row gets its old name.

**Related.** [What is an edit](#what-is-an-edit) · [Keyboard control](preview-and-playback.md#keyboard-control)

**Shortcuts.** Ctrl+Z / Cmd+Z undoes; Ctrl+Shift+Z, Ctrl+Y / Cmd+Shift+Z, Cmd+Y redoes.

## What is an edit

**Where to find it.** Nothing to operate; the rule Undo follows.

**What it does.** Says which actions become undo steps.

**Details.** Every change to the timeline is an edit, and every edit is exactly one undo step:

- placing, trimming, retiming, reordering, renaming and removing an element — a sequence entry, an audio track, an overlay layer or a text overlay — and adding a slate or a text overlay;
- a transition set, changed or removed; a zoom, speed segment or pause added, changed or removed;
- a colour, orientation, crop, background-fill or shape-mask change; a volume, mute, fade or duck change; any text property;
- the canvas preset; the default subtitle style; a chapter marker added, renamed, moved or removed;
- Split at playhead, Freeze frame, Duplicate and Paste settings, each as one step;
- adding several selected clips from the library at once, and the Screen + camera take landing as a screen entry plus a camera overlay — one step each;
- importing an `.srt` file, however many cues it holds — one step;
- a whole drag of the slider beside a number field, which commits once on release, and each drag or key press in a visual editor.

An action that changes nothing — committing the value a field already had, dropping a rectangle where it was — records no step.

**Related.** [Edits and everything else](concepts.md#edits-and-everything-else) · [What commits as an edit](visual-editors.md#what-commits-as-an-edit)

## What is not an edit

**Where to find it.** Nothing to operate; the other half of the rule.

**What it does.** Says what Undo never touches.

**Details.** Undo does not affect anything that changes what you see rather than what the video is, or that lives outside the timeline:

- collapsing rows and folding sections, opening a Picture ▸ or Subtitle style disclosure, the library's List or Thumbnail view, the preview's expanded size;
- **Settings**, which are per device and apply at once;
- the export **marks** and **Loop**, which are session-only, and the export dialog's own fields;
- sorting the library, and *Copy settings* — the copy itself changes nothing; the paste is the edit;
- **library changes**: importing, renaming and removing clips are not undo steps. Removing a clip that had been placed, or that an earlier state in the history still used, **clears the history** — so Undo can never bring back an element whose media is gone. See [Removing a clip](media-library.md#removing-a-clip).

Undo also never touches a saved file or the autosave: it acts on the timeline in front of you.

**Related.** [Edits and everything else](concepts.md#edits-and-everything-else) · [What is saved where](concepts.md#what-is-saved-where)

## The history limit

**Where to find it.** Nothing to operate.

**What it does.** Bounds how far back Undo reaches.

**Details.** The last **{{HISTORY_LIMIT}}** edits are kept. Past that, the oldest step falls off the far end as each new edit is made, so the newest {{HISTORY_LIMIT}} are always undoable. Redo keeps every step undone since the last new edit, and a new edit clears the redo line.

**Related.** [Undo and Redo](#undo-and-redo)

## New Project, Open Project and Restore last session

**Where to find it.** **File ▾** › **New Project** and **Open Project…**; the *Restore last session?* bar.

**What it does.** Each replaces the timeline, and each starts the history empty.

**Details.** A new, opened or restored project has nothing to undo: the previous session's steps referred to media that may no longer be loaded, and undoing "across" an open would splice two projects together. There is no undo for New Project or Open Project themselves — they ask about unsaved changes first instead.

**Related.** [New Project](projects.md#new-project) · [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media) · [Autosave and Restore last session](projects.md#autosave-and-restore-last-session)

## Undo history and project files

**Where to find it.** Nothing to operate.

**What it does.** Answers whether undo survives saving and loading. It does not.

**Details.** The undo history is never written into a project file, embedded or references-only, and never into the autosave snapshot; a reopened or restored project starts with nothing to undo. Saving itself is not an edit and does not touch the history — after a save you can still undo the edits made before it, for as long as the page stays open. The history lasts for this page load only.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [What is never in a project file](projects.md#what-is-never-in-a-project-file)
