# Preview and playback

The preview panel shows the video as it will export, at the instant the **playhead** stands on, and plays it. This page covers [the stage and its expanded layout](#the-stage-and-the-expanded-layout), [the transport](#the-transport), [keyboard control](#keyboard-control), [jumping to cuts](#jumping-to-cuts), [snapping on release](#snapping-on-release), the export [marks](#export-marks) and [Loop](#loop), [chapter markers](#chapter-markers), the [Frame ▾](#the-frame-menu) menu, [previewing a library clip](#previewing-a-library-clip) on its own, and [when the shortcuts pause](#when-the-shortcuts-pause). What the preview shows is what the export contains — see [The output frame](concepts.md#the-output-frame).

## The stage and the expanded layout

**Where to find it.** The **Preview** panel beside the media library; **Expand** and **Restore size** in its header.

**What it does.** Shows the composed frame — the sequence with its transitions, zooms and picture treatments, the overlays and the text — letterboxed into the output frame's shape.

**Details.** The stage keeps the output frame's aspect, so a portrait or square canvas shows as such. **Expand** makes the preview the full-width first row of the page, as wide as the window allows with its height following the frame's aspect; the library, timeline and export panels move below it, reached by scrolling. **Restore size** puts it back. The choice is remembered in this browser across page loads and is a view preference, never part of a project or the autosave. An empty timeline shows a placeholder instead of a stage.

**Related.** [The output frame](concepts.md#the-output-frame) · [What is saved where](concepts.md#what-is-saved-where)

## The transport

**Where to find it.** The row under the stage.

**What it does.** Plays, pauses and positions the playhead, and holds the marks, Loop and the Frame ▾ menu.

**Details.** From left to right: **Play** / **Pause**; **⏮** and **⏭**, which [jump to the previous or next cut](#jumping-to-cuts); **⇥** and **⇤**, which set the export [marks](#export-marks); **↻ Loop**; and, while marks are set, **✕ Marks** to clear them. Below runs the **seek bar**: dragging it scrubs the picture live, and releasing commits the position and may [snap it to a cut](#snapping-on-release). With the slider focused, its own arrow keys step it by its own small step, never snapping, so a position just beside a cut can still be reached. The **readout** shows the position and the total as minutes and seconds — hours appear past an hour — and names the chapter marker under the playhead, if any. The **now-playing line** says which entry is playing — *Clip 2 of 5: interview.mp4* — and, inside a transition, the entry it is blending into and the transition's name. The **Frame ▾** menu is in the same row.

**Related.** [Keyboard control](#keyboard-control) · [The Frame ▾ menu](#the-frame-menu)

## Keyboard control

**Where to find it.** Anywhere on the page while no field, slider or dialog has the keys.

**What it does.** Drives the transport without the mouse.

**Details.**

- **Space** plays and pauses.
- **←** and **→** step the playhead {{STEP_SECONDS}} s; with **Shift**, {{LARGE_STEP_SECONDS}} s. Both sizes are yours to change in [Settings](settings.md#step-sizes-playhead-nudge-and-jump), and this page shows the values in force.
- **Home** and **End** jump to the sequence's start and end.
- **↑** and **↓** [jump to the previous and next cut](#jumping-to-cuts).
- **I** and **O** set the export [marks](#export-marks) in and out at the playhead.
- **M** adds a [chapter marker](#chapter-markers) at the playhead.
- **?** opens the keyboard cheat sheet, **F1** the user guide; **Esc** leaves a [previewed library clip](#previewing-a-library-clip).

Undo and redo have their own keys on [Undo and redo](undo-redo.md#undo-and-redo). The same list, with the step sizes in force, is **Help ▾** › **Keyboard shortcuts…**.

**Related.** [When the shortcuts pause](#when-the-shortcuts-pause)

**Shortcuts.** Space · ← / → · Shift + ← / → · Home / End · ↑ / ↓ · I / O · M · ? · F1 · Esc.

## Jumping to cuts

**Where to find it.** The transport's **⏮** and **⏭**, or **↑** and **↓**.

**What it does.** Puts the playhead exactly on the previous or next edit point.

**Details.** The edit points are the sequence's start and end, every cut between two entries, both edges of a transition's blend, and every chapter marker inside the sequence. From exactly on one, a jump moves to the adjacent one rather than staying put; at either end the jump stays there. These are the same instants Split at playhead, Freeze frame and the marks act on, so a mark set after a jump lands exactly on the cut.

**Related.** [Snapping on release](#snapping-on-release) · [Split at playhead](editing-video.md#split-at-playhead)

## Snapping on release

**Where to find it.** The seek bar, when you let go.

**What it does.** Lands a seek that ends near an edit point exactly on it, so a cut can be found by hand.

**Details.** The reach is {{SNAP_PIXELS}} px of the slider's travel, whatever the sequence's length, so it feels the same on a ten-second and a ten-minute video. A snap shows a brief tick on the bar at the point it landed on. Scrubbing is never snapped while you drag, and a position already on an edit point is left alone. Hold **Alt** as you release to place the playhead freely, the same bypass the visual editors' guides use.

**Related.** [Jumping to cuts](#jumping-to-cuts) · [Snapping and guides](visual-editors.md#snapping-and-guides)

## Export marks

**Where to find it.** The transport's **⇥** (mark in) and **⇤** (mark out), or **I** and **O**; **✕ Marks** clears both.

**What it does.** Bounds a range of the sequence, so the export dialog can export just that range.

**Details.** Each mark is set at the playhead and shows at once as a bracket on the seek bar — opening right for in, left for out — so a lone mark is visible too. While the in mark lies before the out mark, the span between them is highlighted in amber and is the **marked range**: the [export dialog's Range line](export.md#the-range-line) offers it in every format, GIF and MP3 included. An inverted pair, or a single mark, is no range. A mark inside a transition or an effect exports exactly what the preview shows at that instant — mid-blend if that is where it sits, with no snapping. Marks are session-only: they are never saved into the project file and are gone after a reload.

**Related.** [Loop](#loop) · [What is saved where](concepts.md#what-is-saved-where)

## Loop

**Where to find it.** The transport's **↻ Loop** toggle.

**What it does.** Plays the marked range on repeat — or the whole sequence when no range is marked.

**Details.** With a valid marked range, reaching the out mark jumps back to the in mark and keeps playing until you pause; the out mark's own frame is never played twice. **Play** from outside the range starts at the in mark; from inside it, where the playhead is. With no valid range, the whole sequence loops instead of stopping at its end. Loop is session-only like the marks, and turning it on or off is not an edit.

**Related.** [Export marks](#export-marks) · [Visual editors: Loop](visual-editors.md#loop)

## Chapter markers

**Where to find it.** **Frame ▾** › **Add chapter marker at playhead**, or **M**; the numbered ticks under the seek bar.

**What it does.** Names points of the sequence — chapters a viewer can be told about — and makes them edit points the keys jump to.

**Details.** Adding a marker places it at the playhead, rounded to the millisecond, named *Chapter N* where N counts the markers so far, and opens its name for editing: Enter commits, Escape or an empty name keeps the default. Adding on an instant that already has a marker reopens that marker's name instead of doubling it. Each marker inside the sequence is a small numbered tick under the seek bar's track; its name is the tick's hover title and accessible name, and the readout appends the name while the playhead stands on it. The tick is a menu: **Rename…**, **Move to playhead** and **Remove**. Markers are edit points — ↑ / ↓ land on them and a released seek snaps to them. A marker is at a time of the sequence, not attached to a clip, so it stays where it is when clips around it are edited; one that ends up past the sequence's end is kept but not drawn, and the readout says how many are. Markers are part of the project — saved in the file and the autosave, restored on open — and adding, renaming, moving and removing one are each one undo step.

**Related.** [Jumping to cuts](#jumping-to-cuts) · [What is saved where](concepts.md#what-is-saved-where)

**Shortcuts.** M adds a marker at the playhead.

## The Frame ▾ menu

**Where to find it.** The end of the transport row.

**What it does.** Holds the actions that act on the frame under the playhead.

**Details.**

- **Split at playhead** cuts the entry under the playhead in two; disabled at a boundary and inside a transition's blend. See [Split at playhead](editing-video.md#split-at-playhead).
- **Save frame as PNG…** downloads the exact frame under the playhead as a PNG at the output resolution, composed through the export's own draw path — transitions mid-blend, zooms, colour, orientation, overlays and text as an export of that instant would have them. Disabled while the timeline is empty, and while a snapshot is already being taken. A browser whose canvas cannot apply filters refuses to save a frame from a timeline with colour adjustments, as it refuses to export one; see [Colour adjustments](editing-video.md#colour-adjustments).
- **Freeze frame — split & hold** and **Freeze frame — append after clip** capture the frame as a still on the timeline; disabled where a split would be. See [Freeze frame](editing-video.md#freeze-frame).
- **Add chapter marker at playhead** (M); disabled while the timeline is empty. See [Chapter markers](#chapter-markers).

**Related.** [Editing video](editing-video.md)

## Previewing a library clip

**Where to find it.** Media library › a row's **▶**, or a double-click on the clip's name or thumbnail.

**What it does.** Shows one clip alone in the preview panel, without placing it on the timeline.

**Details.** The panel switches to the clip with its own transport, and **Back to sequence** or **Esc** returns to the sequence exactly where it was. While a clip is previewed, **Space**, **←** / **→** and **Home** / **End** drive the previewed clip, not the sequence; **↑** / **↓**, **I**, **O** and **M** do nothing, since there is no sequence to jump in or mark; **?** and **F1** still open the cheat sheet and the guide. The full account is on [Media library](media-library.md#preview-a-clip).

**Related.** [Preview a clip](media-library.md#preview-a-clip)

**Shortcuts.** Esc returns to the sequence.

## When the shortcuts pause

**Where to find it.** Nothing to operate; the rule every transport key follows.

**What it does.** Keeps a key from doing two things at once.

**Details.** The transport keys do nothing while you are typing in a text field — a space belongs to the sentence — and while a button, slider, drop-down or link has focus and would answer the key itself: Space presses a focused button, the arrows move a focused slider. They also do nothing while any dialog is open — the export dialog, a removal confirmation, the project dialogs, the cheat sheet. Move focus off the control, or close the dialog, and the keys are back. Ctrl+Z and Ctrl+Shift+Z pause only inside text fields.

**Related.** [Keyboard control](#keyboard-control) · [Undo and Redo](undo-redo.md#undo-and-redo)
