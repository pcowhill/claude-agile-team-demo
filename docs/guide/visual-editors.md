# Visual editors

Six places on the timeline where a value can be dragged into place on a picture instead of typed: a zoom's region, an overlay's rectangle, a crop's kept region, a text block, a redaction region and a spotlight region. Each opens from an **Adjust visually…** button beside the fields it stands in for, draws under the row it edits, and commits through the same fields, so the two never disagree. This page covers [turning them on and off](#turning-the-editors-on-and-off), [what each editor shows](#what-each-editor-shows), [dragging](#dragging), [snapping and guides](#snapping-and-guides), [keyboard nudges](#keyboard-nudges), the zoom, redaction and spotlight editors' [Preview slider](#the-preview-slider), [Loop](#loop) and [Show result](#show-result), the crop editor's [Reset](#reset), [when an editor cannot load](#when-an-editor-cannot-load), and [what commits as an edit](#what-commits-as-an-edit). The values themselves are explained on [Editing video](editing-video.md).

## Turning the editors on and off

**Where to find it.** **File ▾** › **Settings…** › **Visual editors**.

**What it does.** Shows or hides every *Adjust visually…* button.

**Details.** On by default. The setting's own words: *Adjust visually… buttons sit beside the fields they stand in for, and open a still of the frame to drag the value into place instead of typing it. Off hides them all and never renders that frame.* The fields keep working either way; the switch is a per-device preference, never part of a project.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [What is never in a project file](projects.md#what-is-never-in-a-project-file)

## What each editor shows

**Where to find it.** The **Adjust visually…** button beside a zoom's fields, an overlay's **Rect** fields, the **Crop** fields in a Picture ▸ group, a text overlay's **Centre** fields, a redaction region's fields in Picture ▸ › Redact, or a spotlight region's fields in Picture ▸ › Spotlight.

**What it does.** Opens a still under the row with the thing being placed drawn on it.

**Details.** The still is rendered by the export's own composer, so what you drag against is what the viewer will see:

- **Zoom** — the composed frame at the middle of the zoom's hold, with this zoom left out, and the region the zoom will fill drawn on it. The region keeps the frame's aspect and never leaves it.
- **Overlay** — the frame at the middle of the overlay's own window, with this overlay left out, so the rectangle marks where it will go rather than covering the picture it is placed against. An overlay with a shape mask shows the silhouette it will be painted in inside the rectangle, so a bubble is placed as a bubble.
- **Crop** — the element's **own source**, alone, uncropped and filling the frame, with the kept region drawn and the trimmed margins dimmed. A crop is a fraction of the source, not of the composed frame, so this picture makes a crop percentage a fraction of what you see; it is also what lets an overlay be cropped on its whole picture rather than inside the small rectangle it sits in.
- **Text** — the frame at the middle of the overlay's window with the text **drawn**, since the text is what is being placed; a committed drag re-renders the still with the block in its new place. The block's box is measured from the text under its font, not stored, so the handle sits on the text you see.
- **Redaction** — the element's **own source**, alone, uncropped and filling the frame — the crop editor's picture, for the same reason: a region names a fraction of the source, before any crop or rotation. The region is drawn as a rectangle with corners and edges, and nothing around it is dimmed, since a redaction hides the *inside* and a dimmed outside would read as a crop. The element's other regions show as thin dashed outlines that cannot be dragged, so you see what is already covered; each region has its own **Adjust visually…**, and opening one closes another. On a rotated or flipped clip the picture is shown turned and the region is stored before that, so the edge you drag may move a different stored value; the readout under the still names the stored one.
- **Spotlight** — the same picture as the redaction editor's, for the same reason, and the same handles on the region's box. What differs is what the effect does: the outside of the region **is** dimmed here, because that is the effect, and the dimmed area is cut to the region's own shape — an oval region shows the ellipse inscribed in its box with the box's corners dark, exactly as the frame will have them, and a square box shows a circle. The handles stay on the box, since that is what the fields store. The element's other spotlights show as dashed outlines of their boxes; the shape, dim and soften stay in the fields.

Close, Escape, or the row's button again dismisses the editor.

**Related.** [Zooms](editing-video.md#zooms) · [Crop](editing-video.md#crop) · [Shape mask](editing-video.md#shape-mask) · [Redact a region](editing-video.md#redact-a-region) · [Spotlight a region](editing-video.md#spotlight-a-region)

## Dragging

**Where to find it.** The rectangle drawn on the still.

**What it does.** Moves or resizes the value with the pointer; the fields beneath follow live.

**Details.** Drag inside the rectangle to move it. Resizing differs by what is being placed:

- a **zoom's** region has corners only: a corner changes the magnification about the centre — between {{EDITOR_ZOOM_MIN_SCALE}} × and {{EDITOR_ZOOM_MAX_SCALE}} × — and the region keeps the frame's aspect;
- an **overlay's** rectangle has corners and edges: a corner resizes both dimensions and an edge one, each holding the opposite side fixed. Hold **Shift** on a corner to keep the rectangle's proportions;
- a **crop's** region has edges: drag one to trim it, with the trimmed margin dimmed; hold **Shift** to trim the opposite edge as far; drag inside to pan the kept region without resizing. Drags land on whole percents; hold **Alt** for finer values — every digit the fields can show;
- a **text** block has one corner, which scales the block about its centre — both dimensions follow one size — and it never grows off the frame;
- a **redaction region** has corners and edges like an overlay's rectangle, and the same Shift on a corner to keep its proportions; it never leaves the source frame and never shrinks below {{REDACTION_MIN_REGION_PERCENT}} % of either side. The region's window and style stay in the fields — the drag changes only its area;
- a **spotlight region** is dragged and sized exactly as a redaction region is, by its box — an oval's handles sit on the box it fills, so dragging a corner reshapes the oval with it. Its window, shape, dim and soften stay in the fields.

A zoom's region takes drags only across its hold, where it is the zoom's own region; part-way through a ramp it is drawn dashed and read-only, because a drag there has no single stored zoom it could mean.

**Related.** [Snapping and guides](#snapping-and-guides) · [What commits as an edit](#what-commits-as-an-edit)

## Snapping and guides

**Where to find it.** While dragging, in every editor.

**What it does.** Pulls the rectangle onto the frame's centre, thirds and edges, and shows a guide line for the alignment being held.

**Details.** A zoom's centre snaps onto the frame centre and the thirds. An overlay's, text block's, redaction region's or spotlight region's rectangle also snaps flush to the frame's own borders, since an overlay is more often parked in a corner than placed in the middle. The guide line shows which alignment is held. Hold **Alt** while dragging to ignore the guides — the same bypass the playhead's own snapping uses. In the crop editor Alt means fine values instead, and the crop's snapping is to whole percents.

**Related.** [Dragging](#dragging)

## Keyboard nudges

**Where to find it.** With the rectangle focused, in every editor.

**What it does.** Moves and resizes the value by fixed steps, each press its own undo step.

**Details.** The arrow keys nudge the rectangle by {{EDITOR_NUDGE_PERCENT}} % of the frame, or {{EDITOR_NUDGE_LARGE_PERCENT}} % with Shift; a nudge never snaps, since it is already a deliberate amount. **+** and **−** change what the editor sizes: a zoom's magnification by {{ZOOM_SCALE_STEP}}, an overlay's, a crop's, a redaction region's or a spotlight region's rectangle by {{RECT_SIZE_STEP_PERCENT}} % of the frame, a text block's size by {{TEXT_SIZE_STEP}} — the text size field's own step.

**Related.** [Dragging](#dragging)

**Shortcuts.** ← ↑ → ↓ nudge; Shift for the larger step; + and − resize.

## The Preview slider

**Where to find it.** Under the zoom editor's still, and under the redaction and spotlight editors'.

**What it does.** Scrubs the zoom's whole envelope — from where it begins to where it has finished ramping out — so the motion is visible without playing anything. In the redaction and spotlight editors it scrubs the region's own **window**, in seconds into the source, so you see the picture on the frames the region covers.

**Details.** The still is re-rendered at the instant you stop on, and the region is drawn at the size the zoom actually has there: the whole frame at either end, part-way through a ramp, the full region across the hold. Each instant is rendered once and kept while the editor is open; the previous still stays on screen while the next one draws; and a quick drag across the slider renders where it stops, not every stop it passed. The clip stays loaded for as long as the editor is open, so a new instant is a seek rather than a reload. The redaction and spotlight editors open in the middle of the window; changing the window in the fields moves the slider's ends and keeps your place inside them.

**Related.** [Loop](#loop) · [Show result](#show-result)

## Loop

**Where to find it.** The **↻ Loop** toggle in the zoom editor's scrub row, and in the redaction and spotlight editors'.

**What it does.** Plays the zoom's hold — or a redaction or spotlight region's window — on repeat inside the editor, in real time.

**Details.** The loop rests {{LOOP_REST_SECONDS}} s on the span's first and last frame so the ends are easy to see, then goes round again. The Preview slider follows and cannot be dragged while the loop drives it; the region stays draggable over the moving picture, since the loop never leaves the span. Pause it to scrub by hand again — the slider stays where the loop stopped, showing that instant. With Show result on, it is the finished frame that loops. Closing the editor stops the clock.

**Related.** [The Preview slider](#the-preview-slider)

## Show result

**Where to find it.** The **Show result** toggle in the zoom editor, and in the redaction and spotlight editors.

**What it does.** Swaps the picture for the frame the viewer gets at that instant — the zoom applied rather than bypassed, with no region drawn over it. In the redaction editor it draws every region on the element in its own style — blurred, pixelated or filled — through the same rule the preview and the export use, so what you see masked is what ships. In the spotlight editor it lights every region on the element at its dim, in its shape and with its soft edge, through the same rule again.

**Details.** Turn it off to adjust the region again. The values it draws from are the committed ones.

**Related.** [The Preview slider](#the-preview-slider)

## Reset

**Where to find it.** The **Reset** button in the crop editor.

**What it does.** Clears the crop, exactly as the row's own Reset does.

**Related.** [Crop](editing-video.md#crop)

## When an editor cannot load

**Where to find it.** In place of the editor, after pressing *Adjust visually…*.

**What it does.** Says that the editor could not load, and offers **Reload the page**.

**Details.** Each editor is fetched the first time you open it, rather than with the rest of the app, so the app starts faster. That fetch can fail — a connection that dropped, or a new version of the app published while this tab stayed open. When it does, a short panel appears where the editor would have been, saying so in place of showing nothing. **Reload the page** is the remedy, and it is the one that works: a browser remembers that a piece of code failed to arrive and will not ask for it again on its own, so pressing *Adjust visually…* a second time shows the same panel. Reloading starts the page afresh and fetches the editor again. **✕** dismisses the panel and leaves the row as it was. The fields the editor stands in for keep working throughout — nothing about the clip or the project is affected, and an editor that has already opened once this session is unaffected.

**Related.** [Turning the editors on and off](#turning-the-editors-on-and-off) · [Autosave and Restore last session](projects.md#autosave-and-restore-last-session)

## What commits as an edit

**Where to find it.** Every editor.

**What it does.** Makes each gesture one undo step through the row's own fields.

**Details.** A drag commits once, on release, whatever it passed through — one edit, one undo step; the fields mirror the drag live and settle on the committed value. Each key press is its own edit. A release without movement changes nothing and records no step. On a rotated or flipped clip the crop, redaction and spotlight editors name the stored edge the displayed one corresponds to, since all three apply before orientation, rather than quietly renaming it. A redaction or spotlight region's drag commits the element's whole list of regions as one edit, exactly as its fields do. Nothing is committed by scrubbing, looping or toggling Show result.

**Related.** [Edits and everything else](concepts.md#edits-and-everything-else)
