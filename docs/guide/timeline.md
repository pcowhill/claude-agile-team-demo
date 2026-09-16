# Timeline

The arrangement: what plays, when, and how. This page is the map of the panel — its [four sections](#the-four-sections), the [header controls](#the-header), the [anatomy of a row](#a-row), the [⋯ menu](#the-menu) with [Duplicate](#duplicate), [Copy settings and Paste settings](#copy-settings-and-paste-settings) and [Rename…](#rename), the [Picture ▸](#picture) group, the [+ Effect ▾](#effect) menu, and [collapsing and folding](#collapsing-rows-and-folding-sections). What the controls inside a row do to the picture is on [Editing video](editing-video.md); dragging instead of typing is on [Visual editors](visual-editors.md). The words — element, entry, track, overlay — are defined in [Concepts](concepts.md#the-four-sections-of-the-timeline).

## The four sections

**Where to find it.** The timeline panel, below the library and the preview; each section has a titled heading.

**What it does.** Groups every element by what it is.

**Details.**

- **Sequence** — the video's spine: video clips, still images and colour slates, playing one after another in the order listed. Transitions sit on the boundary between two entries. The sequence's length, less the transitions that overlap it, is the video's length — the **Total** in the header.
- **Audio** — audio tracks: sound clips placed at a start time, trimmed, overlapping freely.
- **Overlays** — overlay layers: a video or an image inside a rectangle of the frame, with a start time and its own trim or duration.
- **Text** — text overlays: titles, captions and imported subtitles, each a block of text at a point in the frame for a window of time.

A section with nothing in it shows a short hint instead of rows. Anything that would play past the end of the sequence is cut off there.

**Related.** [Concepts](concepts.md#the-four-sections-of-the-timeline) · [Put them on the timeline](quick-start.md#2-put-them-on-the-timeline)

## The header

**Where to find it.** The top line of the timeline panel.

**What it does.** Holds the controls that act on the whole timeline rather than on one row.

**Details.** From left to right: **Undo** and **Redo**; the **▲** and **▼** pair that collapses or expands every row; **Add ▾**; the **Total**; and **Canvas**. Beneath the header, the **Subtitle style** disclosure appears once the timeline holds any text overlay.

- **Undo** and **Redo** walk the history of edits back and forward — the last {{HISTORY_LIMIT}} edits are kept. Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) do the same — Cmd on a Mac — except while typing in a text field, where the shortcut stays the browser's own text undo. What counts as an edit is in [Concepts](concepts.md#edits-and-everything-else).
- **Add ▾** adds an element that needs no import: **Color slate**, a solid colour of any shade with an adjustable duration; **Text overlay**, a title reading *Title* in the centre of the frame for {{DEFAULT_TEXT_DURATION}} s; and **Subtitles from .srt file…**, which lands every cue of a subtitle file as a text overlay timed to it.
- **Total** is the video's length: the sequence's entries end to end, less the transitions that overlap them.
- **Canvas** fixes the output frame's aspect — **Landscape 16:9**, **Portrait 9:16**, **Square 1:1** or **Portrait 4:5** — or leaves it at **Auto (match sources)**, where the frame follows the largest source. A fixed preset yields the smallest frame of that aspect that still contains every source, so nothing is downscaled; clips that do not fit letterbox into it. The preset saves with the project. [The output frame](concepts.md#the-output-frame) has the rule in full.
- **Subtitle style** restyles every imported subtitle at once — font, size, colour, bold, italic and position — and opens itself when subtitles are imported. A property edited on one cue is pinned and keeps its value through later changes to the default.

**Related.** [Edits and everything else](concepts.md#edits-and-everything-else) · [The output frame](concepts.md#the-output-frame)

**Shortcuts.** Ctrl+Z / Cmd+Z undoes; Ctrl+Shift+Z, Ctrl+Y / Cmd+Shift+Z, Cmd+Y redoes.

## A row

**Where to find it.** Every element in every section is one row.

**What it does.** Shows where the element plays and holds every control that adjusts it.

**Details.** The **main line** carries the row's **▾** (expand or collapse), its name — double-click it to rename where renaming is offered — a thumbnail, **↑** and **↓** to move it within its section, **✕** to take it off the timeline, and the **⋯** menu. Removing asks for confirmation first; the clip stays in the library.

Under the main line runs the **coverage bar**: where the element plays within the video, drawn against the sequence's whole length, each section in its own colour, with anything past the video's end clamped since it never plays. A sound-bearing bar — an audio track, a video entry, a video overlay — draws its clip's waveform; stills, slates and clips whose sound cannot be decoded keep a plain bar.

The **thumbnail** on a video entry or video overlay is the first frame of its trimmed range, recaptured when the in point changes; an image shows itself, a slate its colour. Thumbnails are recomputed from the media and never stored in a project file.

**Expanded**, a row shows its groups: the timing fields (In and Out for a clip, *Shows for* on a still or slate, *Starts at* on a track or overlay), the audio fields where the element has sound (Volume, Mute, Fade in and out), the [Picture ▸](#picture) disclosure on a video or image, and on a sequence entry the transitions and the [+ Effect ▾](#effect) menu. The number fields commit on Enter or when you leave them, and each carries a slider — see [The slider beside each number](editing-video.md#the-slider-beside-each-number).

**Related.** [Trimming](editing-video.md#trimming) · [Collapsing rows and folding sections](#collapsing-rows-and-folding-sections)

## The ⋯ menu

**Where to find it.** The **⋯** button on a row's main line, named *More actions for* the row.

**What it does.** Holds the row's actions that are not on its main line.

**Details.** **Duplicate**, **Copy settings**, **Paste settings** (shown while something is copied) and — on sequence entries, slates, audio tracks and overlays — **Rename…**. Copy and Paste appear only on rows that hold a group the clipboard can carry.

**Related.** [Duplicate](#duplicate) · [Copy settings and Paste settings](#copy-settings-and-paste-settings) · [Rename…](#rename)

## Duplicate

**Where to find it.** A row's **⋯** › **Duplicate**.

**What it does.** Makes an exact copy of the element carrying every adjustable setting, as one undo step.

**Details.** The copy takes the trim, volume and fades, colour, orientation, crop, background fill, speed segments and pauses, zooms, overlay placement and shape mask, or text content and style — whatever the row has. A duplicated sequence entry lands right after the original; its transitions are never copied, since a transition belongs to a boundary, and the transition on the original's next boundary is dropped because the copy now sits there. A duplicated audio track, overlay or text starts where the original ends, so the two never stack.

**Related.** [Copy settings and Paste settings](#copy-settings-and-paste-settings)

## Copy settings and Paste settings

**Where to find it.** A row's **⋯** › **Copy settings**, then another row's **⋯** › **Paste settings**.

**What it does.** Carries one row's adjustable settings onto another without touching its media, trim or position.

**Details.** Copy remembers the row's settings by group — **Color**, **Orientation**, **Crop**, **Background fill**, **Audio**, **Text style**. Paste opens a checklist of the groups both rows can hold, everything checked, so a paste is never a surprise overwrite; a row that shares no group with the copied settings says so. Each value pastes as the source's effective one, identity included — pasting an ungraded clip's Color resets the target's grade. One paste is one undo step. The copied settings live only in this session: they are never saved with the project, and a reload starts with nothing copied.

**Related.** [Duplicate](#duplicate) · [What is saved where](concepts.md#what-is-saved-where)

## Rename…

**Where to find it.** A row's **⋯** › **Rename…**, or a double-click on the row's name.

**What it does.** Gives a sequence entry, slate, audio track or overlay the name you want on the timeline.

**Details.** The name becomes a field with the current name selected; Enter or clicking away commits, Escape cancels, an empty name reverts. The new name shows everywhere the row is named — its header, its controls' labels, the preview's now-playing line — is one undo step, and saves with the project. It never touches the library clip the row came from: the clip and each element made from it keep their own names. Text overlays are named by their content and are not renamed here.

**Related.** [The ⋯ menu](#the-menu)

## Picture ▸

**Where to find it.** An expanded video or image row — a sequence entry or an overlay.

**What it does.** Gathers every treatment of the picture behind one disclosure, closed by default.

**Details.** Open, it holds **Color**, **Orientation** and **Crop**, then one more by the row's kind: **Background** on a sequence entry, **Shape** on an overlay. Closed, its summary still says what is applied — *▸ Picture · Color, Crop* — so nothing hides silently. Whether the group is open is remembered per row for this session only. Slates and audio tracks have no such group. Each treatment is explained on [Editing video](editing-video.md).

**Related.** [Colour adjustments](editing-video.md#colour-adjustments) · [Orientation](editing-video.md#orientation) · [Crop](editing-video.md#crop) · [Background fill](editing-video.md#background-fill) · [Shape mask](editing-video.md#shape-mask)

## + Effect ▾

**Where to find it.** An expanded sequence entry, below its fields.

**What it does.** Adds a **Zoom**, a **Speed segment** or a **Pause** to the entry.

**Details.** Each item is offered exactly where it can go: it is greyed once the effects already on the entry leave no room for another, and a still or slate offers Zoom alone, since its one duration is already its timing. A new effect lands with its default values and fields to adjust it; each field is one undo step. The effects themselves are on [Editing video](editing-video.md).

**Related.** [Zooms](editing-video.md#zooms) · [Speed segments and pauses](editing-video.md#speed-segments-and-pauses)

## Collapsing rows and folding sections

**Where to find it.** A row's **▾**, the header's **▲** and **▼**, and the controls on each section's heading.

**What it does.** Shrinks what you are not working on to a thin line, without changing the video.

**Details.** A collapsed row is a thin wedge of its coverage bar and main line. The header's **▲** collapses every row and folds every section; **▼** unfolds and expands everything. Each section's heading has its own **▸ / ▾** that folds the whole section down to its heading — unfolding brings every row back exactly as it was — and a pair that collapses or expands just that section's rows. Collapsing and folding are view choices, never edits: they are not undoable and not saved with the project.

**Related.** [Edits and everything else](concepts.md#edits-and-everything-else)
