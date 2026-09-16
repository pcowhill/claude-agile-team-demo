# Text and subtitles

Words on the picture: titles, captions, labels and imported subtitles, each a **text overlay** — a block of text at a point in the frame for a window of time, drawn above everything else. This page covers [adding a text overlay](#adding-a-text-overlay), [its properties](#the-properties), [fading it in and out](#fade-in-and-fade-out), [how it renders](#how-text-renders) in the preview and the export, [importing subtitles](#subtitles-from-an-srt-file) from an `.srt` file, [the default subtitle style](#the-default-subtitle-style) that restyles them all at once, and [pinned properties](#pinned-properties). Placing the block by dragging it instead of typing its centre is the [visual text editor](visual-editors.md#what-each-editor-shows). Where the Text section sits among the timeline's rows is on [Timeline](timeline.md#the-four-sections).

## Adding a text overlay

**Where to find it.** Timeline header › **Add ▾** › **Text overlay**.

**What it does.** Adds a title reading *Title* to the Text section, centred in the frame, showing from the start of the video for {{DEFAULT_TEXT_DURATION}} s.

**Details.** The new overlay is white sans-serif at {{DEFAULT_TEXT_SIZE_PERCENT}} % of the frame's height, neither bold nor italic, with no fade. It needs no import — text is typed, not placed from the library — and adding it is one undo step. Its row shows its content — collapsed, the text on one line — so the words you type are how the row is told apart; text rows have no Rename…, since the content is the name. Take it off the timeline with the row's **✕**, which asks first.

**Related.** [The properties](#the-properties) · [Add a title](quick-start.md#5-add-a-title) · [The header](timeline.md#the-header)

## The properties

**Where to find it.** The expanded text row in the Text section.

**What it does.** Holds every property of the overlay; each committed change is one undo step.

**Details.**

- **Content** is a multi-line field: a line break in the field is a line break in the frame, and lines are never wrapped for you, so a long caption is broken where you break it. An overlay is never empty.
- **Shows at** is the second of the video the text appears, and **for** how many seconds it stays. Anything past the end of the sequence is cut off there, like every element.
- **centre** is two fractions of the frame's width and height, 0 to 1, naming the block's centre — so the block keeps its place when the output frame changes. **Adjust visually…** beside them opens the [visual text editor](visual-editors.md#what-each-editor-shows).
- **Fade in** and **out** are in seconds; see [Fade-in and fade-out](#fade-in-and-fade-out).
- **Font** offers four curated stacks — *Sans-serif*, *Serif*, *Monospace* and *Display* — chosen because every browser has a font for each, so the export draws what the preview showed.
- **Size** is the line height as a fraction of the frame's height, from {{MIN_TEXT_SIZE_PERCENT}} % to {{MAX_TEXT_SIZE_PERCENT}} %; a value in the field's step. Lines of a multi-line block are spaced at {{TEXT_LINE_HEIGHT}} × the size.
- **Color** is any colour, and **Bold** and **Italic** are two toggles.

The number fields commit on Enter or when you leave them. The row's ⋯ menu offers [Duplicate](timeline.md#duplicate) — the copy starts where the original ends — and [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings), which carry the *Text style* group (font, size, colour, bold, italic, fades) between text rows.

**Related.** [Fade-in and fade-out](#fade-in-and-fade-out) · [Visual editors](visual-editors.md) · [The output frame](concepts.md#the-output-frame)

## Fade-in and fade-out

**Where to find it.** The text row › **Fade in** and **out**.

**What it does.** Ramps the text's opacity from invisible to full over the first seconds of its window, and back to invisible over the last.

**Details.** Both are in seconds and both start at zero, which is an instant appearance and disappearance. The ramps are linear. Together they never exceed the overlay's duration: the fade-in is clamped to the duration and the fade-out to what remains, so the two meet at full opacity but never overlap. The same envelope is drawn by the preview and by the export.

**Related.** [The properties](#the-properties) · [Audio: fade-in and fade-out](audio.md#fade-in-and-fade-out)

## How text renders

**Where to find it.** Nothing to operate; how the preview and the export draw an overlay.

**What it does.** Draws the block above the composed frame — above the sequence, its transitions and zooms, and above the overlay layers — for its window, in the preview and identically in the exported file.

**Details.** Size and position are fractions of the output frame, so an overlay keeps its proportion and its place whatever the frame's pixel size, and the export draws it at the output resolution with the same font, size, position and fade envelope the preview used. Frame snapshots and the GIF plugin draw through the same rule. The block is measured from its text under its font, not stored — its width is whatever the widest line comes out as — which is why the visual editor can put a handle exactly on the text you see.

**Related.** [Preview and playback](preview-and-playback.md) · [The output frame](concepts.md#the-output-frame)

## Subtitles from an .srt file

**Where to find it.** Timeline header › **Add ▾** › **Subtitles from .srt file…**.

**What it does.** Reads a standard SubRip `.srt` file and lands every cue as an ordinary text overlay, timed to the cue.

**Details.** Each cue becomes a text overlay that starts at the cue's start, lasts until its end, and carries the cue's text with its line breaks; it is marked as a subtitle so the [default subtitle style](#the-default-subtitle-style) governs its look. New cues take that style — by default a caption at {{SUBTITLE_DEFAULT_SIZE_PERCENT}} % of the frame's height, white sans-serif, centred horizontally and {{SUBTITLE_DEFAULT_Y_PERCENT}} % of the way down the frame. The whole import is one undo step, and every imported cue is afterwards an individual overlay, editable like any other.

The reader is forgiving: a byte-order mark, any line-ending convention, extra blank lines, out-of-order or missing cue numbers, `.` instead of `,` before the milliseconds, and HTML-like tags or `{\an8}`-style positioning codes inside the text are all tolerated (the tags are stripped). A block that still cannot become a cue is skipped, and the library's failure list says so — *Imported 12 subtitles from "talk.srt" but skipped 1 cue block: …* with the block's number and the reason. A file with no usable cue at all is reported as *No subtitle cues found* and adds nothing. Importing subtitles also opens the Subtitle style disclosure so the style is one click away.

**Related.** [The default subtitle style](#the-default-subtitle-style) · [The failure list](media-library.md#the-failure-list) · [Undo and redo](undo-redo.md)

## The default subtitle style

**Where to find it.** The **Subtitle style** disclosure under the timeline header — present once the timeline holds any text overlay, opened by a click, and opened for you when subtitles are imported.

**What it does.** Restyles every imported subtitle at once: the style new cues take, and the style every subtitle's unpinned properties follow.

**Details.** The disclosure holds **Font**, **Size**, **Color**, **Bold**, **Italic** and the two **centre** fractions — the text-overlay style surface, without timing or content, which are each cue's own. Every change commits the whole style as one undo step, and rewrites the matching property on every subtitle overlay that has not [pinned](#pinned-properties) it. **Reset** returns to the built-in style, and is disabled while the project already uses it. The default subtitle style is part of the project: it saves in the file and the autosave, and a project that never changed it saves nothing for it. Fades are not part of the subtitle look; set them per cue.

**Related.** [Subtitles from an .srt file](#subtitles-from-an-srt-file) · [Pinned properties](#pinned-properties) · [What is saved where](concepts.md#what-is-saved-where)

## Pinned properties

**Where to find it.** Nothing to operate; what happens when one subtitle is edited by hand.

**What it does.** Lets one cue differ from the default style without losing the default for the rest of its properties.

**Details.** Editing a style property on one imported subtitle — its font, size, colour, bold, italic, or centre — pins that property on that cue: later changes to the default subtitle style leave it alone, while the cue's other properties keep following the default. A drag in the [visual text editor](visual-editors.md#what-each-editor-shows) pins the position exactly as typing the centre would, and pasting *Text style* onto a subtitle pins each property the paste changed. A property is pinned by an edit that actually changes it; committing the value it already had pins nothing. Which properties are pinned saves with the project. Text overlays you added yourself have no default to follow, so nothing about them is pinned or unpinned.

**Related.** [The default subtitle style](#the-default-subtitle-style) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings)
