# Editing video

What the controls on a timeline row do to the picture and its timing: [trimming](#trimming), [Split at playhead](#split-at-playhead), [Freeze frame](#freeze-frame), [transitions](#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom), [speed segments and pauses](#speed-segments-and-pauses), [zooms](#zooms), [colour adjustments](#colour-adjustments), [orientation](#orientation), [crop](#crop), [background fill](#background-fill), [shape mask](#shape-mask), and [the slider beside each number](#the-slider-beside-each-number). Every one of them renders live in the preview, saves with the project, and renders identically in the exported file — the video formats, the GIF plugin and frame snapshots draw through one shared rule. Where a row's controls live is on [Timeline](timeline.md); dragging a value on a picture instead of typing it is on [Visual editors](visual-editors.md).

## Trimming

**Where to find it.** An expanded sequence entry, audio track or video overlay › **In** and **Out**.

**What it does.** Sets where the clip starts and stops playing, in seconds into its source file.

**Details.** Type a value and press Enter, or drag the slider beside the field. The thumbnail follows the in point, the coverage bar and the **Total** follow the new length, and any transition on the entry's boundaries stays on the boundary. Trimming never touches the library clip. A still or slate has no source to trim; its **Shows for** field is its length.

**Related.** [A row](timeline.md#a-row) · [Time on the timeline](concepts.md#time-on-the-timeline)

## Split at playhead

**Where to find it.** Preview › **Frame ▾** › **Split at playhead**.

**What it does.** Cuts the sequence entry under the playhead into two entries, each trimmable and removable on its own.

**Details.** An untouched split plays and exports exactly like the original. Effects follow the cut: speed segments and pauses split exactly where the razor falls, and a zoom moves to the half that shows it or splits with it. The item is disabled at entry boundaries and inside a transition's overlap, where there is nothing to split.

**Related.** [Trimming](#trimming) · [Freeze frame](#freeze-frame)

## Freeze frame

**Where to find it.** Preview › **Frame ▾** › **Freeze frame — split & hold** or **Freeze frame — append after clip**.

**What it does.** Captures the frame under the playhead as a still and places it on the timeline.

**Details.** The frame is composed exactly as an export of that instant would be — transitions mid-blend, zooms, colour, orientation, overlays and text included — and saved into the library as an image clip named *Freeze* and the time, so it can be reused. *Split & hold* splits the entry at the playhead and holds the still between the halves; *append after clip* places it after the entry. The still shows for {{FREEZE_STILL_DURATION}} s, adjustable like any still. Both items are disabled where a split would be — at a boundary or inside a transition. The whole freeze is one undo step; the captured clip stays in the library across that undo.

**Related.** [Split at playhead](#split-at-playhead)

## Transitions: crossfade, slides, wipes, pushes, fades, irises and cross-zoom

**Where to find it.** Between two adjacent sequence entries › **+ Transition**, then the type menu and the duration field that appear.

**What it does.** Blends one entry into the next instead of cutting.

**Details.** A new transition is a **Crossfade** of {{DEFAULT_TRANSITION_DURATION}} s. The type menu offers every transition the app has: Crossfade; Slide from above, below, left and right; Wipe from left, right, above and below; Push from left, right, above and below; Fade through black; Fade through white; Iris open; Iris close; Cross-zoom. The Shaped wipes plugin adds its own kinds to the same menu while it is enabled. A transition overlaps the two entries by its duration, so the sequence gets shorter by that much, and it needs room on both sides — the duration is bounded by the shorter neighbour. Remove it with its ✕ to return to a cut. Duplicating an entry never copies a transition, since a transition belongs to a boundary.

**Related.** [Add a transition](quick-start.md#4-add-a-transition) · [Duplicate](timeline.md#duplicate)

## Speed segments and pauses

**Where to find it.** An expanded video entry › **+ Effect ▾** › **Speed segment** or **Pause**.

**What it does.** Changes how the source's time maps onto the video's time within one entry.

**Details.** A **speed segment** plays a range of the entry — *from* and *to*, in seconds into its trimmed range — at a factor: below 1 slows it down and takes longer, above 1 speeds it up. A new one runs {{DEFAULT_SPEED_LENGTH}} s at {{DEFAULT_SPEED_FACTOR}} ×. A **pause** freezes one frame — *at*, in seconds into the trimmed range — for a *hold* in output seconds; a new one holds {{DEFAULT_PAUSE_HOLD}} s. An entry can carry any number of each so long as they do not overlap; the menu greys an item when no room is left. The preview's playback, scrubbing and sequence timing honour them, and the exported file plays the same remapped timing.

**Related.** [+ Effect ▾](timeline.md#effect) · [Time on the timeline](concepts.md#time-on-the-timeline)

## Zooms

**Where to find it.** An expanded sequence entry › **+ Effect ▾** › **Zoom**.

**What it does.** Magnifies part of the frame for a while: ramps in, holds, ramps out.

**Details.** A zoom has a start (*at*, in seconds into the entry), a ramp *in*, a *hold*, a ramp *out*, a magnification (*×*) and a *centre* as fractions of the frame's width and height. A new zoom is {{DEFAULT_ZOOM_SCALE}} × on the centre of the frame, with {{DEFAULT_ZOOM_RAMP}} s ramps and a {{DEFAULT_ZOOM_HOLD}} s hold, fitted into the room the entry has. An entry may carry several zooms with windows that do not overlap. The centre is a fraction of the output frame, so it keeps its place when the frame changes; the zoomed region never leaves the frame. **Adjust visually…** beside the fields opens the [zoom editor](visual-editors.md#what-each-editor-shows).

**Related.** [+ Effect ▾](timeline.md#effect) · [Visual editors](visual-editors.md)

## Colour adjustments

**Where to find it.** An expanded video or image row › **Picture ▸** › **Color**.

**What it does.** Adjusts brightness, contrast and saturation, and applies a one-click look.

**Details.** Three dials from {{COLOR_ADJUSTMENT_MIN}} to {{COLOR_ADJUSTMENT_MAX}} %, where 100 leaves the picture as it is, and a **Look** of **Grayscale** or **Sepia**, or none. **Reset** clears the group. A browser whose canvas cannot apply filters refuses to export — or to save a frame from — a timeline with colour adjustments, with a message saying so, rather than exporting it unadjusted; the preview still shows the adjustment.

**Related.** [Picture ▸](timeline.md#picture) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings)

## Orientation

**Where to find it.** An expanded video or image row › **Picture ▸** › **Orientation**.

**What it does.** Rotates the picture by quarter turns and flips it — the fix for sideways phone footage and mirrored webcam clips.

**Details.** One button rotates 90° clockwise each press, through 90°, 180° and 270° and back; two toggles flip horizontally and vertically; **Reset** clears all three. A quarter-turned clip letterboxes into the frame like any portrait source and reshapes the output frame the same way. Orientation composes with zooms, transitions and colour, and is applied after the crop.

**Related.** [Crop](#crop) · [The output frame](concepts.md#the-output-frame)

## Crop

**Where to find it.** An expanded video or image row › **Picture ▸** › **Crop**.

**What it does.** Trims a percentage off each edge of the source — chrome strips in a screen recording, headroom in a webcam clip.

**Details.** Four fields, *left*, *right*, *top* and *bottom*, in percent of the source. Only the kept region renders; each axis always keeps at least {{CROP_MIN_KEPT_PERCENT}} % of the source. The crop applies in the source's own space, before orientation, and reshapes the output frame like any source. **Reset** clears it. **Adjust visually…** beside the fields opens the [crop editor](visual-editors.md#what-each-editor-shows).

**Related.** [Orientation](#orientation) · [Background fill](#background-fill) · [Visual editors](visual-editors.md)

## Redact a region

**Where to find it.** An expanded video or image row › **Picture ▸** › **Redact**, on sequence entries and overlays alike.

**What it does.** Hides part of the picture for a stretch of the clip — an address bar, a name in a chat sidebar, a key in a terminal — by blurring it, pixelating it, or covering it with a solid colour.

**Details.** **+ Add region** puts a rectangle in the middle of the frame, showing for the whole of the clip's current trim. Each region has:

- **Area** — *left*, *top*, *width* and *height*, in percent of the **source** frame, before any crop or rotation. A region names the pixels of the recording it hides, so cropping, turning or re-trimming the clip afterwards leaves the mask on the thing it was put over.
- **Shows from … to …** — the window, in seconds into the source, like the In and Out fields. Outside it the picture is untouched.
- **Style** — **Blur** (a *strength*, in source pixels), **Pixelate** (a *block size*, in source pixels, {{DEFAULT_PIXELATE_BLOCK}} to start with) or **Solid** (a colour, black to start with). A new region is a Pixelate.
- **Remove** takes the region away.
- **Adjust visually…** opens the [redaction editor](visual-editors.md#what-each-editor-shows) under the region: drag it into place on a still of the source, with the other regions outlined and a Preview slider across its window.

A clip can hold any number of regions, and they may overlap. Every change is one undo step.

**Which style to use.** Blur can be partly reversed on small text, so it is the one to avoid for anything that matters; Pixelate and Solid cannot be. Blur starts at {{DEFAULT_BLUR_STRENGTH}} source pixels of radius.

The region shows in the preview as you play, and is drawn into the export, a [saved frame](preview-and-playback.md#the-frame-menu) and an [Animated GIF](plugins.md#gif-export) alike — including behind a [blurred background fill](#background-fill), which is a copy of the same picture. There are no soft edges: a mask that faded in would show what it hides while it faded.

**If a blurred region cannot be drawn.** A browser without canvas filters refuses the export and the saved frame outright, naming the redaction, rather than writing out the thing you meant to hide — the same rule [colour adjustments](#colour-adjustments) follow. Switching that region to Pixelate or Solid exports anywhere, since neither needs the filter.

**Related.** [Spotlight a region](#spotlight-a-region) · [Crop](#crop) · [Background fill](#background-fill) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings) · [Visual editors](visual-editors.md)

## Spotlight a region

**Where to find it.** An expanded video or image row › **Picture ▸** › **Spotlight**, on sequence entries and overlays alike.

**What it does.** Points at part of the picture for a stretch of the clip by **dimming everything outside it** — the button you are telling the viewer to click, without taking the rest of the frame away.

**Details.** **+ Add region** puts a rectangle in the middle of the frame, showing for the whole of the clip's current trim. Each region has:

- **Area** — *left*, *top*, *width* and *height*, in percent of the **source** frame, before any crop or rotation, exactly as a [redaction region](#redact-a-region) is placed. Cropping, turning or re-trimming the clip afterwards leaves the spotlight on the thing it was put over.
- **Shows from … to …** — the window, in seconds into the source, like the In and Out fields. Outside it nothing is dimmed.
- **Shape** — **Rectangle**, or **Oval** inscribed in the same box. Switching between them moves and resizes nothing, so an area that is square in the picture draws a circle.
- **dim** — how far the outside drops, in percent: 0 leaves the picture alone, 100 takes everything outside the region to black. A new region starts at {{DEFAULT_SPOTLIGHT_DIM_PERCENT}} %.
- **soften** — how wide the edge is, in percent of the picture's shorter side, up to {{MAX_SPOTLIGHT_SOFTEN_PERCENT}} %. At 0 — where a new region starts — the edge is a hard line. Above it the dim ramps in across a band centred on the region's edge, half of it lighting outside the box and half dimming inside, so a softened region reads as a pool of light rather than a cut-out. The ramp is drawn by the same rule in the preview, the export, a saved frame and a GIF, in proportion to the picture, so it looks the same at every size.
- **Remove** takes the region away.
- **Adjust visually…** opens the [spotlight editor](visual-editors.md#what-each-editor-shows) under the region: drag it into place on a still of the source, drawn in its own shape with the outside dimmed, with the other regions outlined and a Preview slider across its window.

A clip can hold any number of regions, and they may overlap. **Overlapping regions stay bright together** — a second spotlight never dims the first — and where several are showing at once, the outside is dimmed by the strongest of their dims. Every change is one undo step.

The dimming shows in the preview as you play, and is drawn into the export, a [saved frame](preview-and-playback.md#the-frame-menu) and an [Animated GIF](plugins.md#gif-export) alike. It does **not** dim a [blurred or coloured background fill](#background-fill) behind the clip: that backdrop is an enlarged copy of the same picture, and lighting a second hole in it would put a second spotlight on screen.

**Spotlight or zoom?** A [zoom](#zooms) removes the context — the viewer sees the button and nothing else, and loses where on the screen it is. A spotlight keeps the whole frame and points into it, which is usually what a tutorial wants. They combine: a spotlight rides a zoom like any other part of the picture.

**A redaction always wins.** Where a spotlight and a [redaction](#redact-a-region) overlap on the same clip, the redaction is drawn last and stays hiding what it hides, however bright the spotlight around it.

**Related.** [Redact a region](#redact-a-region) · [Zooms](#zooms) · [Crop](#crop) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings) · [Visual editors](visual-editors.md)

## Background fill

**Where to find it.** An expanded sequence entry › **Picture ▸** › **Background**.

**What it does.** Chooses what shows behind a clip that does not fill the output frame — a portrait phone clip in a landscape sequence, a quarter-turned or cropped clip.

**Details.** **None** leaves the frame's black bars; **Blur** fills them with a blurred, cover-fit copy of the clip's own current frame; **Color** fills them with a flat colour you pick. The backdrop renders behind the normally fitted clip, moves and fades with it through zooms and transitions, and never reshapes the output frame. A clip that already fills the frame draws no backdrop.

**Related.** [Crop](#crop) · [The output frame](concepts.md#the-output-frame)

## Shape mask

**Where to find it.** An expanded overlay row › **Picture ▸** › **Shape**.

**What it does.** Clips an overlay's rectangle to a shape — the webcam-bubble look.

**Details.** **Rectangle** is the placed rectangle as it is; **Ellipse** inscribes an ellipse in it, a circle when the rectangle is square; **Rounded** rounds the corners by a *radius* in percent, up to {{MAX_ROUNDED_RADIUS_PERCENT}} %, starting at {{DEFAULT_ROUNDED_RADIUS_PERCENT}} %. The silhouette is cut the same way in the preview and in every export. The overlay's placement editor outlines the silhouette while you place it.

**Related.** [Picture ▸](timeline.md#picture) · [Visual editors](visual-editors.md)

## The slider beside each number

**Where to find it.** Every number field on a timeline row that has a range — trims, volume, fades, the colour dials, effect timings, a corner radius.

**What it does.** Drags the value on the field's own range and step instead of typing it.

**Details.** The number moves as you drag and commits once when you release, so a whole drag is one undo step. The field itself still commits on Enter or when you leave it, and the two always read the same value.

**Related.** [A row](timeline.md#a-row)
