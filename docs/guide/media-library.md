# Media library

The shelf the rest of the editor works from: every file you import or record sits here as a **clip**, untouched, until you place it on [the timeline](timeline.md). This page covers [importing](#importing-clips), the [two views](#list-and-thumbnail-views) and the [View ▾](#view-layout-and-sorting) menu, [selecting several clips at once](#selecting-several-clips), [previewing a clip](#preview-a-clip) on its own, [Add](#add) and the [⋯ menu](#the-menu), [renaming](#renaming-a-clip) and [removing](#removing-a-clip). Recording into the library has its own page: [Recording](recording.md). How the library relates to the timeline is in [Concepts](concepts.md#the-media-library-and-the-timeline).

Library changes are not undo steps. Importing, renaming and removing clips change the project (the file saves them, and the 💾 button shows the unsaved dot), but Undo and Redo cover the timeline only; see [Edits and everything else](concepts.md#edits-and-everything-else).

## Importing clips

**Where to find it.** Media library › **Import clips**, or drag files from your desktop onto the page.

**What it does.** Adds video, audio and image files to the library as clips, each shown with its name, a kind badge — *Video*, *Audio* or *Image* — and its duration (images show a dash).

**Details.** The picker accepts video, audio and image files and lets you choose several at once; dropping files anywhere on the page does the same, and the page highlights while you drag over it. The kind is read from the file's type as the browser reports it, and from the extension when the browser reports none: `mp3`, `wav`, `m4a`, `aac`, `ogg`, `oga`, `opus`, `flac` and `weba` are audio, `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp` and `avif` are images, and anything else is tried as video. A video or audio file is read for its duration, an image for its width and height in pixels. Reading a file's metadata gives up after a short wait rather than hanging, and reports the file in the failure list. The same file can be imported again, so an import that failed can be retried after the file is fixed.

**Related.** [The failure list](#the-failure-list) · [Recording](recording.md) · [Quick Start](quick-start.md#1-import-your-clips)

## The failure list

**Where to find it.** Under the library's header, only while there is something to show.

**What it does.** Lists every file the browser could not import, with the reason, so nothing disappears silently.

**Details.** A file the browser cannot decode is reported by name — for example that it *is not a video this browser can decode* — as is a file whose metadata could not be read in time. Recording failures ([Recording](recording.md#permissions-and-failures)) and a failed audio extraction land in the same list. **Dismiss** clears the list; the clips that did import are unaffected.

**Related.** [Importing clips](#importing-clips)

## List and Thumbnail views

**Where to find it.** Media library › **View ▾** › *List* or *Thumbnails*.

**What it does.** Shows the same clips as one text row each, or as a grid of square cards with a picture of the media.

**Details.** In **List** view a row has the clip's checkbox, name, kind badge, duration and its actions. In **Thumbnail** view each card is dominated by a picture — a video's first frame, the image itself, or an audio clip's waveform — with the same name, badge, duration and actions beneath, and the checkbox in the picture's top-left corner; as many cards fit per row as the panel's width allows. While a picture is still loading, or when the browser cannot decode it, the card shows a plain mark for its kind instead. The layout choice is remembered in this browser across page loads; it is a view preference, never part of a project file or the autosave snapshot.

**Related.** [View ▾: layout and sorting](#view-layout-and-sorting) · [What is saved where](concepts.md#what-is-saved-where)

## View ▾: layout and sorting

**Where to find it.** Media library › **View ▾**.

**What it does.** Switches between the two views, and sorts the clips by **Name**, **Type** or **Length**.

**Details.** The *View* group is always offered, so the layout can be chosen before anything is imported. The *Sort by* group appears only while the library holds more than one clip. Picking a key sorts ascending and marks it with ↑; picking the same key again reverses the order and shows ↓. Sorting rearranges the library's stored clip order, so the new order is what a saved project keeps; it is not a setting that keeps re-applying itself, and clips imported later join the end.

**Related.** [List and Thumbnail views](#list-and-thumbnail-views)

## Selecting several clips

**Where to find it.** The checkbox on each row or card, and **Select all** above the list.

**What it does.** Selects any number of clips so they can be added to the timeline, or removed, in one go.

**Details.** A row's checkbox is faded until you hover over it or start selecting. Clicking one selects that clip; **Shift+click** selects the range from the last clip you clicked to this one; **Select all** selects or clears every clip, and shows a partial mark while only some are selected. While anything is selected a bar appears with the count and three actions:

- **Add to timeline** places every selected clip in library order as one undo step — videos and images as sequence entries, audio clips as audio tracks — and clears the selection.
- **Remove** asks first: *Remove 3 clips?*, and the message says how many timeline entries made from them go too. Confirming removes them all at once.
- **Clear** drops the selection without doing anything.

**Related.** [Add](#add) · [Removing a clip](#removing-a-clip)

## Preview a clip

**Where to find it.** A row's **▶** button, or a double-click on the clip's name or thumbnail.

**What it does.** Shows one clip alone in the preview panel — to tell two similarly named songs apart, or to remind yourself what a recording contains — without adding it to the timeline.

**Details.** The panel switches to the clip: a video or audio clip gets its own Play/Pause, seek slider and time readout, and an image simply shows, letterboxed into the same frame shape the sequence uses. **Back to sequence** in the panel's header, or **Escape**, returns to the sequence exactly where it was — playhead, marks and all. While a clip is previewed, **Space** and the arrow keys drive the previewed clip rather than the sequence, and the panel's header offers the row's placing actions so you can add the clip from there. Nothing done here reaches the project, the autosave or the export.

**Related.** [Add](#add) · [Preview](quick-start.md#6-preview)

**Shortcuts.** Escape leaves the preview; Space plays and pauses it; ← and → step through it.

## Add

**Where to find it.** A row's **Add** button — its full name is *Add … to timeline*.

**What it does.** Places the clip on the timeline: a video or image is appended to the Sequence, an audio clip becomes an audio track.

**Details.** A clip can be added any number of times, and each placement is trimmed and adjusted on its own; removing a placement leaves the clip in the library. An image is placed as a still with the default duration from [Settings](settings.md#new-still-or-slate-duration) ({{DEFAULT_STILL_DURATION}} s unless you changed it).

**Related.** [Selecting several clips](#selecting-several-clips) · [The four sections of the timeline](concepts.md#the-four-sections-of-the-timeline)

## The ⋯ menu

**Where to find it.** The **⋯** button at the end of a row or card, named *More actions for* the clip.

**What it does.** Holds everything about a clip that is not Preview or Add.

**Details.** The items, each present only where it applies:

- **Add as overlay** (video and image clips) places the clip above the sequence as an overlay layer — picture-in-picture in the bottom-right corner, {{DEFAULT_OVERLAY_SIZE_PERCENT}} % of the frame wide and high, starting at the beginning of the sequence; a video overlay plays the whole clip and an image overlay shows for the still duration. Reposition, resize and trim it from [its timeline row](timeline.md#a-row).
- **Extract audio** (video clips) makes a new audio clip from the video's sound, named after the video with *(audio)* appended. It keeps working after the video is removed from the library, and a references-only project re-links it from the video file.
- **Rename…** opens the name for editing; see [Renaming a clip](#renaming-a-clip).
- **Remove** asks for confirmation; see [Removing a clip](#removing-a-clip).

An audio clip's menu holds only Rename… and Remove, since it has no picture to overlay and no video to extract from.

**Related.** [Add](#add) · [A row](timeline.md#a-row) · [Visual editors](visual-editors.md)

## Renaming a clip

**Where to find it.** A row's **⋯** › **Rename…**.

**What it does.** Gives the clip the name you want, everywhere the clip is named, while remembering the file it came from.

**Details.** The name becomes a field with the current name selected. **Enter** or clicking elsewhere commits; **Escape** cancels; an empty name leaves the clip as it was. The new name shows in the library, in the re-link dialog and in the preview, sorts under Name, and saves with the project. The original filename is kept underneath — hovering the name shows it — so a references-only project still re-links from the file on disk, and the re-link dialog shows both. Timeline elements already made from the clip keep the names they were placed with; new placements take the current name.

**Related.** [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media)

## Removing a clip

**Where to find it.** A row's **⋯** › **Remove**, or the selection bar's **Remove**.

**What it does.** Takes the clip out of the library, and with it every timeline element made from it.

**Details.** A dialog asks first — *Remove clip.mp4?* — and, when the clip has been placed, says how many timeline entries go with it. Removing is not an undo step, and it cannot be undone from the timeline side either: when the clip had been placed, or an earlier state in the undo history still used it, the undo history is cleared, so that Undo never brings back an element whose media is gone. The clip must be imported again to return. Removing a clip from the timeline instead — the ✕ on its row — leaves the clip on the shelf.

**Related.** [Selecting several clips](#selecting-several-clips) · [Edits and everything else](concepts.md#edits-and-everything-else)

## When the list grows

The list of clips never grows past its own panel. Once it would — at about half the window's height, or sooner when the window is short — it scrolls on its own while the title, Import clips, Record ▾, View ▾ and the selection controls stay at the top, so a large import never pushes the timeline down the page or spills over it. A small gap separates the rows from the scrollbar while the list scrolls.
