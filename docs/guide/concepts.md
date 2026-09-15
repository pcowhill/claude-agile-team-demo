# Concepts

The words the app uses, and how its parts fit together. Read it once; the feature pages assume it.

## The media library and the timeline

The **media library** is the shelf: every file you import or record sits there as a **clip**, untouched. The **timeline** is the arrangement: what plays, when, and how. Placing a clip on the timeline makes an **element** — a sequence entry, an audio track, an overlay layer — that refers to the clip and carries its own settings. The same clip can be placed several times, and each placement is trimmed and adjusted on its own. Removing a clip from the library removes every element made from it; removing an element leaves the clip on the shelf.

## The four sections of the timeline

- **Sequence** — the video's spine. Its entries play one after another, and their combined length, less the transitions that overlap them, is the video's length. A sequence entry is a video clip, a still image, or a **slate**, a solid colour. Transitions live on the boundary between two entries.
- **Audio** — **audio tracks**: sound clips placed at a start time, trimmed, overlapping freely, mixed with the sequence's own sound.
- **Overlays** — **overlay layers**: a video or an image placed above the sequence inside a rectangle of the frame — picture-in-picture, a logo, a webcam bubble — with a start time and its own trim or duration.
- **Text** — **text overlays**: titles, captions and imported subtitles, each a block of text at a point in the frame for a window of time.

Anything that would play past the end of the sequence is cut off there: the sequence decides how long the video is.

## The output frame

The **output frame** is the picture's size in pixels. By default it follows the sources — the largest width and the largest height among the sequence's clips and images, so nothing is downscaled. A **canvas preset** on the timeline header fixes its aspect instead — 16:9, 9:16, 1:1 or 4:5 — and the frame becomes the smallest one of that aspect that still contains every source. A clip that does not fill the frame is letterboxed inside it, and its background fill decides what shows behind. Overlay rectangles, text positions and zoom centres are fractions of this frame, so they keep their places when the frame changes. Overlays never change the frame's size.

Preview and export draw from the same rules: what the preview shows at an instant is what the exported file contains at that instant.

## Edits and everything else

An **edit** is a change to the project: anything that alters what the exported file would contain, or the names and arrangement of what makes it. Edits are undoable — the history keeps the last {{HISTORY_LIMIT}} — and an edit marks the project as having unsaved changes.

Not everything you can do is an edit. Collapsing a row, folding a section, opening a Picture group, switching the library between list and thumbnails, setting the export marks, turning Loop on: these change what you see, not what the video is. Undo never touches them and they are never saved with the project.

## What is saved where

Three places hold state, and knowing which is which answers most "where did it go?" questions.

| Where | What lives there | How long it lasts |
|---|---|---|
| **The project file** (`.bvep`) | The library's clip list and the whole timeline — every element, trim, transition, effect and setting on it, the names you gave things, the canvas preset, the default subtitle style, and which plugins the project needs. With **embedded media**, the media files themselves; with **references only**, their names and durations, matched back to files you pick when reopening. | Until you change the file. |
| **This browser** | The preferences in Settings, the library's list or thumbnail view, the preview's expanded state, which plugins are enabled, and the **autosave**: a snapshot of the project taken shortly after every edit, offered back as *Restore last session?* when the page is next opened. | Across page loads, on this browser only. Nothing here travels with a project file. |
| **This session** | The undo history, the export marks and Loop, settings copied with *Copy settings*, which rows are collapsed and which sections folded, a clip being previewed on its own, and the thumbnails. | Until the page is reloaded. The undo history in particular never survives a save and open: a reopened project starts with nothing to undo. |

A still image, a slate or an image overlay shows for {{DEFAULT_STILL_DURATION}} s when added, unless Settings says otherwise; an audio track's duck level starts at {{DEFAULT_DUCK_LEVEL_PERCENT}}%. Those are starting points, not saved state — the value on each element is what the file keeps.

## Time on the timeline

Every element has a place in **sequence time**: seconds from the start of the video. A video clip also has **source time**: seconds into the file it came from. The **in point** and **out point** are source times, and trimming moves them. Speed segments and pauses change how source time maps onto sequence time for one entry. The **playhead** is the instant the preview shows, in sequence time; the export **marks** are two playhead positions that bound a range.
