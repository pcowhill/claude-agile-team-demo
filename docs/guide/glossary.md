# Glossary

The words the app uses, each in a sentence or two with a link to the page that explains it. [Concepts](concepts.md) tells the same story as a whole.

## The library and the timeline

### Clip

A file in the media library — imported or recorded — untouched, waiting to be placed. See [Media library](media-library.md).

### Element

Anything placed on the timeline: a sequence entry, an audio track, an overlay layer or a text overlay. An element refers to a clip and carries its own settings; the same clip can be placed many times. See [The media library and the timeline](concepts.md#the-media-library-and-the-timeline).

### Sequence

The video's spine — the entries that play one after another and decide how long the video is. See [The four sections](timeline.md#the-four-sections).

### Entry

One item in the sequence: a video clip, a still image or a slate. See [The four sections](timeline.md#the-four-sections).

### Track

An audio clip placed at a start time, mixed with the sequence's sound; tracks overlap freely. See [The four sections](timeline.md#the-four-sections).

### Overlay layer

A video or an image placed above the sequence inside a rectangle of the frame — picture-in-picture, a logo, a webcam bubble. See [The four sections](timeline.md#the-four-sections).

### Text overlay

A block of text at a point in the frame for a window of time: a title, a caption or an imported subtitle. See [The four sections](timeline.md#the-four-sections).

### Still

An image placed in the sequence or as an overlay, showing for a length you set rather than a trim; also the frame a *Freeze frame* captures. See [Add](media-library.md#add) and [Freeze frame](editing-video.md#freeze-frame).

### Slate

A sequence entry that is a solid colour with a duration, added from Add ▾ with no import. See [The header](timeline.md#the-header).

### Coverage bar

The bar under each row showing where the element plays within the video, in its section's colour; a sound-bearing bar draws the clip's waveform. See [A row](timeline.md#a-row).

## Time

### Playhead

The instant the preview shows, in sequence time; where marks, splits, freezes and chapter markers are placed. See [Time on the timeline](concepts.md#time-on-the-timeline).

### Sequence time and source time

Sequence time is seconds from the start of the video; source time is seconds into the clip's file. Trimming moves source times; placing moves sequence times. See [Time on the timeline](concepts.md#time-on-the-timeline).

### In point and out point

The source times where a clip starts and stops playing; trimming sets them. See [Trimming](editing-video.md#trimming).

### Trim

Setting an element's in and out points — what part of the clip plays. The library clip is never changed. See [Trimming](editing-video.md#trimming).

### Cut and boundary

A cut is where one entry ends and the next begins; a boundary is any edit point the keys jump to — cuts, both edges of a transition's blend, the sequence's ends and chapter markers. See [The header](timeline.md#the-header) and [Split at playhead](editing-video.md#split-at-playhead).

### Transition

A blend across the boundary between two entries — a crossfade, a slide, a wipe — that overlaps them by its duration. See [Transitions](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom).

### Mark

One of the two playhead positions — in and out — that bound the range the export dialog can export and Loop repeats; session-only. See [The Range line](export.md#the-range-line).

### Chapter marker

A named point of the sequence, shown as a numbered tick under the seek bar and treated as a boundary by the keys; saved with the project. See [Time on the timeline](concepts.md#time-on-the-timeline).

## Effects

### Remap, speed segment and pause

A remap changes how a clip's source time maps onto the video's time within one entry: a speed segment plays a range at a factor, a pause holds one frame for a while. See [Speed segments and pauses](editing-video.md#speed-segments-and-pauses).

### Zoom, ramp and hold

A zoom magnifies part of the frame for a while: it ramps in, holds at its magnification, and ramps out. See [Zooms](editing-video.md#zooms).

### Crop

The part of a source kept, as a percentage trimmed off each edge, applied before orientation. See [Crop](editing-video.md#crop).

### Orientation

A clip's quarter turns and flips. See [Orientation](editing-video.md#orientation).

### Background fill

What shows behind a clip that does not fill the output frame: black bars, a blur of the clip itself, or a colour. See [Background fill](editing-video.md#background-fill).

### Placement rectangle

The rectangle of the frame an overlay layer occupies, as fractions of the frame's width and height. See [Dragging](visual-editors.md#dragging).

### Shape mask

The silhouette an overlay is cut to — its rectangle, an inscribed ellipse or a rounded rectangle. See [Shape mask](editing-video.md#shape-mask).

## The picture

### Output frame

The exported picture's size in pixels, following the sources unless a canvas preset fixes its aspect. See [The output frame](concepts.md#the-output-frame).

### Canvas preset

A fixed aspect for the output frame — 16:9, 9:16, 1:1 or 4:5 — or Auto, which follows the sources. See [The header](timeline.md#the-header).

### Visual editor

A still of the frame under a row on which a value — a zoom's region, an overlay's rectangle, a crop, a text block — is dragged into place instead of typed. See [Visual editors](visual-editors.md).

## Files and storage

### Project file

The `.bvep` file holding the library's clip list and the whole timeline, with embedded media or references only. See [Projects](projects.md).

### Embedded media and references only

Two kinds of project file: one carrying the media itself, self-contained and large; one carrying the clips' names and durations, small and re-linked to the original files on open. See [Embedded media or references only](projects.md#embedded-media-or-references-only).

### Re-link

Matching a references-only project's clips back to files on disk, by filename and duration. See [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media).

### Autosave snapshot

The copy of the session the browser keeps shortly after every change, offered back as *Restore last session?*. See [Autosave and Restore last session](projects.md#autosave-and-restore-last-session).

### Plugin

An optional feature built into the editor, downloaded and switched on from File ▾ › Plugins…; never imported from elsewhere. See [Plugins](plugins.md).

### Edit

A change to the project — anything that alters what the exported file would contain, or the names and arrangement of what makes it — and therefore an undo step. See [Edits and everything else](concepts.md#edits-and-everything-else).
