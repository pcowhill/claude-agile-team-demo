# Projects

A project is the library's clip list and the whole timeline, kept in a {{PROJECT_FILE_EXTENSION}} file you choose where to put. This page covers [New Project](#new-project), [Save and Save As…](#save-and-save-as), the choice between [embedded media and references only](#embedded-media-or-references-only), [Open Project… and re-linking](#open-project-and-re-linking-media) the media, [a file that needs plugins](#a-file-that-needs-plugins), the [autosave](#autosave-and-restore-last-session) that protects the session between saves, and [what is never in a project file](#what-is-never-in-a-project-file). The wider map of what lives in the file, in this browser and in this session is in [Concepts](concepts.md#what-is-saved-where).

## New Project

**Where to find it.** **File ▾** › **New Project**.

**What it does.** Empties the library and the timeline and starts again.

**Details.** With unsaved changes the app asks first — *Discard unsaved changes?* — and **Discard and start new** goes ahead. The new project has no file and no remembered save mode until its first save; the undo history starts empty. The autosave follows: an empty session clears the stored snapshot, so a reload after New Project offers nothing to restore.

**Related.** [Save and Save As…](#save-and-save-as) · [Autosave and Restore last session](#autosave-and-restore-last-session)

## Save and Save As…

**Where to find it.** **File ▾** › **Save** or **Save As…**, the **💾** button beside File ▾, or Ctrl+S (Cmd+S on a Mac).

**What it does.** Writes the project to a {{PROJECT_FILE_EXTENSION}} file.

**Details.** The first save of a project opens the *Save project* dialog to choose [what the file carries](#embedded-media-or-references-only), then the browser's file picker, suggesting *project*{{PROJECT_FILE_EXTENSION}} as the name. Later saves reuse the choice and the destination silently. **Save As…** always asks both again — it is also how to switch a project from references to embedded, or back. While a save runs the header says *Saving…*; afterwards it says *Saved as* and the file's name, and a failure shows *Could not save* with the reason. Only committed state is written: an edit made while the picker is open stays unsaved.

The **💾** button carries a **●** while the project has unsaved changes and the dot disappears on save. Saving is not an edit and does not touch the undo history.

**Related.** [Embedded media or references only](#embedded-media-or-references-only) · [Save the project](quick-start.md#8-save-the-project)

**Shortcuts.** Ctrl+S / Cmd+S saves.

## Embedded media or references only

**Where to find it.** The *Save project* dialog, on a project's first save and on every Save As….

**What it does.** Decides whether the media files themselves go into the project file.

**Details.** Two options, under *What the file carries*:

- **Embed media in the project file** — the default. One self-contained file that opens on any computer with no re-linking. It includes the media data, so the file is large — about the size of the media plus a little.
- **Store references only**. A small file with the edits and the clips' names, durations, kinds and — for images — pixel dimensions. Opening it asks you to re-select the original files.

Either way the file holds the whole arrangement: every element, trim, transition, effect and setting on the timeline, the names you gave clips and elements, the canvas preset, the default subtitle style, [chapter markers](preview-and-playback.md#chapter-markers), and the names of any plugins the project relies on. A project opened from an embedded file re-saves embedded, and one opened from a references file re-saves with references, until Save As… says otherwise. Recordings can only travel in an embedded file; see [Recordings and project files](recording.md#recordings-and-project-files).

**Related.** [Save and Save As…](#save-and-save-as) · [What is saved where](concepts.md#what-is-saved-where)

## Open Project… and re-linking media

**Where to find it.** **File ▾** › **Open Project…**.

**What it does.** Replaces the current project with one from a {{PROJECT_FILE_EXTENSION}} file, asking for the media files when the file does not carry them.

**Details.** With unsaved changes the app asks first — *Discard unsaved changes?*, **Discard and open**. An **embedded** file opens fully linked at once. A **references** file with clips in it opens the re-link dialog, *Open* followed by the file's name: a list of the project's clips with each one's name, its kind where it is not video, its duration, and *Missing* or *Linked ✓*. **Choose media files…** takes any number of files at a time; each is matched to a clip by filename and duration — the duration may differ by {{RELINK_DURATION_TOLERANCE_PERCENT}} % of the stored length, and by at least {{RELINK_DURATION_TOLERANCE_MIN_SECONDS}} s, since another browser may round a container's length differently — and an image by filename and pixel dimensions. A clip you renamed shows its display name with the original filename in parentheses, and matches the file. An extracted audio clip re-links from the video it came from. A file that matches nothing, or matches a clip already linked, is reported under the list. **Open project** enables once every clip is linked; **Cancel** leaves the current project untouched, as does a file that cannot be read — *Could not open* says why.

A file saved by a newer version of the editor may name a transition type or a plugin this version does not know; it is refused with a message saying so rather than opened with parts missing.

**Related.** [Renaming a clip](media-library.md#renaming-a-clip) · [A file that needs plugins](#a-file-that-needs-plugins)

## A file that needs plugins

**Where to find it.** A dialog while opening a project whose features come from a plugin that is turned off.

**What it does.** Offers to enable the plugins the file records, and refuses to open the file without them.

**Details.** A project file names the plugins whose features it uses — a GIF export setting, a shaped wipe. Opening it while one of them is disabled asks *Enable plugins to open?*, naming the file and the plugins. **Enable and open** turns them on (downloading the plugin's code if this browser has not yet) and continues; **Cancel** does not open the file, and *Could not open* explains that opening it without the plugins would drop those features. A plugin that fails to load is reported the same way, and the current project stays as it was.

**Related.** [Open Project… and re-linking media](#open-project-and-re-linking-media)

## Autosave and Restore last session

**Where to find it.** Automatic. The *Restore last session?* bar appears under the header when the page opens and a snapshot is found; the choice of whether it appears is in **File ▾** › [**Settings…**](settings.md#when-a-previous-session-is-found).

**What it does.** Keeps a copy of the session in this browser's own storage so a crash, a closed tab or a refresh loses nothing that had settled.

**Details.** {{AUTOSAVE_DEBOUNCE_SECONDS}} s after the last change, the project's structure — what a references-only file holds — is written to browser storage, and each clip's media is stored once, the first time it appears, and deleted when the clip leaves the library. The snapshot also records whether the project matched its last save. An empty session — no clips, nothing on the timeline — clears the snapshot.

Opening the page with a snapshot present shows *Restore last session? An autosaved project from a previous session was found*, with **Restore** and **Discard**. Restore brings back the library and the timeline with no file picking (a dialog on the way, if one is needed, calls it *the autosaved session*); work that had never been saved comes back showing the unsaved dot. Discard deletes the snapshot for good. Until you choose, the autosave does not overwrite the snapshot. [Settings › *When a previous session is found*](settings.md#when-a-previous-session-is-found) changes only the offer: **Ask each time** (the default), **Always restore** (no bar, straight into the restore) or **Never restore** (no bar; the autosave takes over and overwrites the old snapshot). The autosave keeps recording whichever you choose.

Two notes appear when something is wrong. *Autosave: the media no longer fits in browser storage, so only the project structure is being kept* means the media outgrew the browser's quota; restoring such a snapshot goes through the re-link dialog, asking for the media files again. *Autosave is currently unavailable* means the browser would not store even the structure — save your project to a file to keep it safe. Where the browser has no such storage at all, the autosave is simply off.

The snapshot never travels: it lives in this browser profile only, and the undo history is not part of it.

**Related.** [Open Project… and re-linking media](#open-project-and-re-linking-media) · [What is saved where](concepts.md#what-is-saved-where)

## What is never in a project file

A project file holds the project, not your preferences or your session. It never contains:

- the [**Settings**](settings.md) (step sizes, still duration, the restore choice, the export dialog's preselected format, the [Visual editors](visual-editors.md#turning-the-editors-on-and-off) switch) — these are per device, and a browser with none uses the defaults;
- **view choices** — the library's [List or Thumbnail layout](media-library.md#list-and-thumbnail-views), the preview's expanded state, which rows are collapsed and which sections folded;
- the [**export marks**](preview-and-playback.md#export-marks) and [Loop](preview-and-playback.md#loop), and settings copied with [*Copy settings*](timeline.md#copy-settings-and-paste-settings);
- the [**undo history**](undo-redo.md#undo-history-and-project-files) — a reopened project starts with nothing to undo;
- [**which plugins are enabled**](plugins.md#enabled-plugins-and-this-browser) — the file records which plugins it *needs*, and enabling is per browser.

The autosave snapshot holds the same things a project file holds, and none of these either. [What is saved where](concepts.md#what-is-saved-where) lays the three places side by side.
