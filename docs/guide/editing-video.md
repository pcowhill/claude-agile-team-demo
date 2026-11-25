# Editing video

What the controls on a timeline row do to the picture and its timing: [trimming](#trimming) and [the Trim window](#the-trim-window), [Cut…](#cut), [Split at playhead](#split-at-playhead) and [Split…](#split), [Cut out marked range](#cut-out-marked-range), [Freeze frame](#freeze-frame), [transitions](#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom), [speed segments and pauses](#speed-segments-and-pauses), [zooms](#zooms), [colour adjustments](#colour-adjustments), [orientation](#orientation), [crop](#crop), [background fill](#background-fill), [shape mask](#shape-mask), [overlay border](#overlay-border), [overlay shadow](#overlay-shadow), [overlay move](#overlay-move), and [the slider beside each number](#the-slider-beside-each-number). Every one of them renders live in the preview, saves with the project, and renders identically in the exported file — the video formats, the GIF and WebP plugin formats and frame snapshots draw through one shared rule. Where a row's controls live is on [Timeline](timeline.md); dragging a value on a picture instead of typing it is on [Visual editors](visual-editors.md).

## Trimming

**Where to find it.** An expanded sequence entry, audio track or video overlay › **In** and **Out**. For a sequence entry, also **Q** and **W** at the playhead.

**What it does.** Sets where the clip starts and stops playing, in seconds into its source file.

**Details.** Type a value and press Enter, or drag the slider beside the field. On a sequence entry, a video overlay or an [audio track](audio.md#audio-tracks), **Trim…** beside the fields sets the same two numbers while you watch or listen to the clip: see [The Trim window](#the-trim-window). To remove a part from the middle of a clip instead of its ends, use [Cut…](#cut). The thumbnail follows the in point, the coverage bar and the **Total** follow the new length, and any transition on the entry's boundaries stays on the boundary. Trimming never touches the library clip. A still or slate has no source to trim; its **Shows for** field is its length.

**At the playhead, without a window:** in the preview, **Q** trims the clip under the playhead so that it starts on the frame showing, and **W** so that it ends there; the clip closes up to its neighbours, and one **Undo** puts it back. After **Q** the playhead moves to the clip's new start, where the frame you pressed it on now plays, so the preview still shows that frame; after **W** it stays where it was, already on the clip's new end. Undo puts the trim back but does not move the playhead.
- The frame is the one the preview shows, through any [speed segment](#speed-segments-and-pauses): inside a pause, it is the held frame.
- They do nothing over a still or slate, on the clip's own first or last frame, inside a [transition](#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom)'s blend, where less than a tenth of a second would be left, and wherever the preview's other keys [pause](preview-and-playback.md#when-the-shortcuts-pause).
- Not **I** and **O**: in the preview those set the [export marks](preview-and-playback.md#export-marks).
- As with any trim, the clip's zooms, speed segments and pauses stay at their seconds into the clip, so Q moves them with its start.

**Related.** [The Trim window](#the-trim-window) · [A row](timeline.md#a-row) · [Time on the timeline](concepts.md#time-on-the-timeline)

**Shortcuts.** Q · W.

## The Trim window

**Where to find it.** An expanded video sequence entry, video overlay, or [audio track](audio.md#audio-tracks) › **Trim…**, beside **In** and **Out**. An image overlay has none: it has no source to trim, and its **Length** is its window.

**What it does.** Opens a window over the editor where you watch the clip and drag its In and Out on a strip of the whole clip, then play just the part you keep, like *Trim Video* in a presentation app. It is a second way to set the entry's **In** and **Out**, or an overlay's or a track's.

**Details.**

- **Opening it pauses the preview.** If the video, or a library clip you are [previewing](media-library.md#preview-a-clip), is playing when you press **Trim…**, it stops, so its sound does not play on under Play trim. Closing the window leaves it paused: press Play to carry on.
- **The picture** is the source clip itself, with none of the entry's effects (colour, crop, zoom), so nothing hides what is at its edges. Under it, the playhead's time and the clip's length.
- **The strip** is the whole clip, left to right: a row of {{TRIM_FRAME_COUNT}} frames along the top, taken at even steps through the clip so you can see where it changes, and its sound's waveform under them. The parts outside the two clamps are darkened. The frames appear a moment after the window opens, and everything works before they do; opening the window again on the same clip shows them at once.
  - **The In clamp** `[` and **the Out clamp** `]` are dragged along the strip; the picture follows the clamp you drag, showing the frame the kept part will start or end on.
  - Each clamp is also a slider: Tab to it, then **←** and **→** move it by the nudge size and **Shift** by the jump size (both in [Settings](settings.md)); **Home** and **End** take it to its limit.
  - The clamps cannot cross: the kept part is never shorter than a tenth of a second.
  - Click or drag on the strip anywhere else to move the playhead and look at that moment, without moving a clamp.
- **What a trim does to the entry's effects** shows on the strip before you apply it:
  - **Marks.** The entry's [zooms](#zooms), [speed segments and pauses](#speed-segments-and-pauses), and its [vignettes and blurs](#vignette-and-blur), sit along the foot of the strip where they will be after Apply. A zoom is a purple bar, a speed segment a green bar, a vignette or blur a blue bar, and a pause an orange tick; point at one to see its name. They are placed in seconds into the kept part, as their fields are, so they move with the In clamp.
  - **The warning line** under the strip names each effect the clamps as they stand would cut into:
    - *shortens Zoom 1*: part of it is left.
    - *removes Speed segment 1*: none of it plays. It is kept at length zero, so trimming back out restores it.
    - *moves Pause 1 to the new end*: the pause still holds, on the new last frame.

    It changes as you drag and goes when the clamps move back.
  - **Transitions.** When the entry has a [transition](#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) at its start or end, the stretch of clip that transition will play over is hatched, at the clamps as they stand. A sped-up span under it covers more of the clip.
- **The buttons:**
  - **▶ Play trim** plays from In and stops at Out. It starts from the playhead instead when the playhead is already inside the kept part, so a pause and a second press carry on. While it plays it reads **⏸ Pause**.
  - **↻ Loop**, while it is on, takes Play trim back to In each time it reaches Out, until you pause.
  - **⏮ In** and **Out ⏭** move the playhead to a clamp. **◀ frame** and **frame ▶** move it one frame (a thirtieth of a second).
  - **Set In here (I)** and **Set Out here (O)** move a clamp to the playhead: play, then press **I** where you want the clip to begin and **O** where you want it to end. Between them, **kept** says how long the kept part is.
  - **In** and **Out** at the bottom show the clamps' times exactly, to type into. A value past the other clamp stops a tenth of a second short of it.
- **Nothing changes until Apply.** **Apply** sets the entry's In and Out together, as one undo step; it is greyed out until a clamp has moved. **Cancel**, **✕** and **Esc** close the window and change nothing. A click outside the window does not close it.
- **On an audio track** the window is the same, without the picture: the strip is the track's waveform alone, **▶ Play trim** plays its sound, and there are no frames, so no frame row and no **◀ frame** / **frame ▶**. A track has no zooms, speed segments or transitions, so nothing is marked on the strip. **Apply** sets the track's In and Out, as one undo step, and leaves where it **Starts at** alone.
- **On a video overlay** the window is the entry's, on the overlay's own clip: the picture, the frames and the waveform are that clip's, and the marks and the warning line are the overlay's own [zooms](#zooms), [speed segments and pauses](#speed-segments-and-pauses). An overlay sits on no boundary between entries, so nothing is hatched. **Apply** sets the overlay's In and Out, as one undo step, and leaves where it **Starts at** and its rectangle alone.
- **Keys while it is open:** **Space** plays and pauses, **I** and **O** set the clamps, and **Esc** closes. They act on the window only: behind it, the editor's own keys do nothing, so I and O never set the [export marks](preview-and-playback.md#export-marks) while the window is open. In a field you are typing into, keys type; on a focused button, Space presses that button.

**Shortcuts.** Space plays or pauses · I sets In · O sets Out · ← → move a focused clamp, Shift for the jump size · Esc closes without applying.

**Related.** [Trimming](#trimming) · [Cut…](#cut) · [Keyboard shortcuts](keyboard-shortcuts.md#every-shortcut)

## Cut…

**Where to find it.** An expanded video sequence entry, video overlay or [audio track](audio.md#audio-tracks) › **Cut…**, between **Trim…** and **Split…**. Stills and slates have none, as they have no Trim…. An image overlay has none either, since it has no clip to cut.

**What it does.** Opens the Cut window on the clip, where you mark a part in the middle of the clip and remove it. What lies either side of the part then plays back to back. It is the reverse of [the Trim window](#the-trim-window), which keeps the part between its clamps.

**Details.**

- **The window.** It is the Trim window's frame: the raw clip at the top, and under it the whole clip as a strip of its frames over its waveform, with the parts outside In and Out darkened. It has two clamps, **Cut from** `]` and **Cut to** `[`, both red. The part **between** them is hatched red: that is what Apply removes. Under the strip, **removes** says how long that part is.
  - On an audio track there is no picture. The strip is the track's waveform alone, ▶ Play cut plays the sound, and there are no frame buttons.
- **Moving the clamps.** They open on the middle third of the clip's trimmed range.
  - Drag a clamp along the strip, and the picture follows it, showing the frame the cut starts or ends on.
  - Each clamp is also a slider: Tab to it, then **←** and **→** move it by the nudge size and **Shift** by the jump size (both in [Settings](settings.md)). **Home** and **End** take it to In and Out.
  - Click or drag on the strip anywhere else to move the playhead and look at that moment. **◀ frame** and **frame ▶** step the playhead, and **Cut from here** and **Cut to here** move a clamp to it.
  - **Cut from** and **Cut to** at the bottom show the clamps' times exactly, to type into, in seconds into the clip. A clamp stays between In and Out.
- **▶ Play cut** (or **Space**) plays the clip as it will be after the cut. It starts {{PLAY_CUT_LEAD}} seconds before *Cut from*, or at In if that is closer. At *Cut from* it goes straight on from *Cut to*, so you hear and see the join before you apply it, and it stops at Out. While it plays it reads **⏸ Pause**.
- **Apply on a sequence entry** is exactly [Cut out marked range](#cut-out-marked-range) over the part of the video the clamps mark, so the same rules hold:
  - the clip becomes two entries meeting at a hard cut, and the video is shorter by the part's length;
  - speed segments, pauses and zooms inside the part go with it, and one across a clamp is cut there;
  - everything placed by its own start time after the part (audio tracks, overlays, text and subtitles, shape groups and chapter markers) moves earlier with the picture.

  When anything besides clips would change, it asks first in one line, for example *"Removes 2 s. 1 subtitle after it moves earlier."* **Cut out** goes ahead, and **Cancel** or Esc leaves everything as it was. The whole cut is one undo step. Unlike Cut out marked range, it leaves the [export marks](preview-and-playback.md#export-marks) where they were.
- **Apply on a video overlay or an audio track** cuts that one element, and **nothing else moves**:
  - it becomes two rows: the earlier part keeps its **Starts at**, and the later part starts where the earlier one now ends, so it plays on without a gap and finishes earlier by the part's length;
  - the video, the other overlays and tracks, text and subtitles, shape groups and chapter markers all stay where they were, because an overlay or a track is placed by its own start time. So it never asks first;
  - both parts keep every setting. The fade-in stays on the earlier part and the fade-out on the later one;
  - an overlay's speed segments, pauses and zooms are cut as on a sequence entry: inside the part they go, and one across a clamp is cut there. Its [Moves](#overlay-move) are cut the same way. The later part starts from where the overlay was at *Cut to*, so it jumps there at the join.

  It is one undo step.
- **Where it cannot cut.** Apply is greyed out, and the line above the buttons says why, in these cases:
  - *Cut from* is on In or *Cut to* is on Out. That removes the start or the end of the clip, which is a trim, so use [Trim…](#the-trim-window) for it.
  - *Cut to* is not after *Cut from*, so there is nothing between them.
  - On a sequence entry, a clamp is inside a [transition](#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) at either end of the clip, where two clips play at once. Cut out marked range refuses that too.

  The hatching turns grey while Apply is greyed out.
- **Nothing changes until Apply.** **Cancel**, **✕** and **Esc** close the window without cutting. A click outside the window does not close it. Opening it pauses the preview, as the Trim window does.
- **The clamps are in the clip's own time**, as In and Out are. With a speed segment on the clip or overlay, the time removed is the part's sped-up or slowed-down length.

**Shortcuts.** Space plays or pauses · ← → move a focused clamp, Shift for the jump size · Home and End take it to In and Out · Esc closes without cutting.

**Related.** [The Trim window](#the-trim-window) · [Cut out marked range](#cut-out-marked-range) · [Split…](#split) · [Trimming](#trimming) · [Audio tracks](audio.md#audio-tracks)

## Split at playhead

**Where to find it.** Preview › **Frame ▾** › **Split at playhead**.

**What it does.** Cuts the sequence entry under the playhead into two entries, each trimmable and removable on its own.

**Details.** An untouched split plays and exports exactly like the original. Effects follow the cut: speed segments and pauses split exactly where the razor falls, and a zoom moves to the half that shows it or splits with it. The item is disabled at entry boundaries and inside a transition's overlap, where there is nothing to split. To pick the moment on one clip instead of moving the playhead to it, use [Split…](#split) on the clip's row.

**Related.** [Split…](#split) · [Trimming](#trimming) · [Cut out marked range](#cut-out-marked-range) · [Freeze frame](#freeze-frame)

## Split…

**Where to find it.** An expanded video sequence entry, video overlay or audio track › **Split…**, after **Trim…** and [Cut…](#cut). Stills and slates have none; split them with [Split at playhead](#split-at-playhead). An image overlay has none either, since it has no clip to cut: it has no Trim… for the same reason.

**What it does.** Opens the Split window on the clip, where you pick a moment on the clip itself and split the entry, overlay or track into two there.

**Details.**

- **The window.** It is the [Trim window](#the-trim-window)'s frame: the raw clip at the top, the whole clip as a strip of its frames over its waveform, and the parts outside In and Out darkened. It has one position on the strip, the **split point**, instead of two clamps. The point is the window's playhead: the picture always shows the frame the cut falls at.
- **Moving the point.** It opens at the middle of the entry's trimmed range. Click or drag on the strip, use **◀ frame** and **frame ▶**, press **←** and **→** (by the nudge size in [Settings](settings.md); with **Shift**, by the jump size), or type the time in **Split at**, in seconds into the clip. The point stays between In and Out.
- **Watching for the moment.** **▶ Play** (or **Space**) plays on from the point, and the point follows the picture; pause where you want the cut. Playing stops at Out.
- **Apply.** It splits the entry at the point, using the same cut as [Split at playhead](#split-at-playhead), so the same rules hold: an untouched split plays and exports exactly as before, and speed segments, pauses and zooms follow the cut. The two entries meet exactly at the point and the video's length does not change. The line above the buttons shows the two parts' lengths. Apply is one undo step and closes the window.
- **Where it cannot split.** Apply is greyed out where Split at playhead is disabled: with the point on In or on Out, and inside a transition at either end of the clip, where two clips play at once — splitting there would shorten the transition and lengthen the video. The line above the buttons says which.
- **Nothing changes until Apply.** **Cancel**, **✕** and **Esc** close the window without splitting. Opening it pauses the preview, as the Trim window does.
- The point is in the clip's own time, as In and Out are, so a speed segment does not change where on the picture the cut falls.
- **On a video overlay or an audio track.** Apply makes two overlays, or two tracks, that play and export exactly as the one did, until you edit either:
  - The first keeps the *Starts at* and In, and ends at the point. The second starts at the point and begins where the first ends in the video. With a speed segment or a pause on the overlay, that is after the first part's sped-up or held time, so the join stays seamless.
  - Both keep every setting: volume, mute and ducking on a track; placement, colour, orientation, crop, shape mask, border, shadow, redactions and spotlights on an overlay.
  - The first keeps the fade-in and the second the fade-out, so the join plays straight through. A fade that runs across the point cannot be divided, so it is shortened to fit its part and ramps faster.
  - An overlay's speed segments, pauses and zooms are cut as an entry's are.
  - An overlay's [Moves](#overlay-move) stay where they were in the video. The second part starts where the overlay was at the point, so a split between Moves changes nothing you can see. A Move gliding across the point is divided there, and each part glides its own share. The overlay passes the point in the same place and ends where it did, though each share eases in and out over its own length.
  - The second is listed right after the first, so an overlay's place in the stacking order does not change.
  - A track's window has no picture, as its [Trim window](#the-trim-window) has none: the strip is its waveform, **▶ Play** plays the sound, and there are no frame buttons.

**Related.** [Split at playhead](#split-at-playhead) · [The Trim window](#the-trim-window) · [Keyboard shortcuts](keyboard-shortcuts.md#every-shortcut)

## Cut out marked range

**Where to find it.** Preview › **Frame ▾** › **Cut out marked range**, or **X**.

**What it does.** Removes the part of the video between the in and out [marks](preview-and-playback.md#export-marks), and the video either side of it then plays back to back.

**Details.** Set the in mark where a fumble starts and the out mark where it ends, then cut: the marked time is gone in one step. To mark the part on one clip's own strip instead, while watching it, use [Cut…](#cut) on the clip's row: it applies this same cut.

- **It works across cuts.** An entry the range starts or ends inside is cut there exactly as [Split at playhead](#split-at-playhead) cuts, and an entry lying wholly inside the range is removed. A mark exactly on a cut needs no split.
- **Effects follow the razor.** Speed segments, pauses and zooms inside the range go with it; one across a mark is cut there, or kept, as Split at playhead would. A mark inside a pause keeps the part of its hold on the kept side, so exactly the marked time is removed.
- **Transitions.** A transition on a cut inside the range goes with it, and the two sides meet at a hard cut. Transitions elsewhere stay.
- **Everything placed by its own start time moves with the picture.** Audio tracks, video and image overlays, text and subtitles, shape groups and chapter markers follow what they were placed against:
  - one that starts at or after the out mark moves earlier by the range's length;
  - one lying wholly inside the range is removed;
  - one that starts before the range and ends inside it loses its tail, and one that starts inside it and ends after it loses its head and then starts at the in mark;
  - one that covers the whole range stays one element, shorter by the range's length. One element cannot skip its middle, so it keeps its beginning and loses the range's length **from its end**.
- **How an element is shortened.** An audio track or a video overlay is trimmed: a lost head moves its In, a lost tail its Out. A video overlay's own speed segments, pauses and zooms are cut at that moment, as the razor cuts an entry's. An overlay's [Moves](#overlay-move) keep their moments in the video: a lost head starts it from where it was at the cut. Text, an image overlay or a shape group gets a shorter duration. Fades and a draw-on shrink to fit.
- **Chapter markers.** A marker inside the range is removed. One exactly on the in mark stays, and one after the range moves earlier. A marker that would land on one that stays is removed instead, since two markers cannot share an instant.
- **It asks first when anything besides clips would change.** The question is one line, for example *"Removes 4.2 s. 3 subtitles and 1 video overlay after it move earlier."* **Cut out** goes ahead; **Cancel** or Esc leaves everything as it was. When only clips are touched it cuts at once.
- **Afterwards** the marks are cleared, since the range they bounded no longer exists, and the playhead stands on the join. The whole cut, with everything it moved, is one undo step.

The item is disabled, and X does nothing, without a marked range; while either mark is inside a transition's blend, where Split at playhead is disabled too; and when the range is the whole video, since removing everything is what each row's ✕ is for. It is also disabled where a kept part would be nothing but a held frame: an in mark inside a pause on an entry's first frame, or an out mark inside a pause on its last frame.

**Related.** [Export marks](preview-and-playback.md#export-marks) · [Cut…](#cut) · [Split at playhead](#split-at-playhead) · [Trimming](#trimming)

**Shortcuts.** X.

## Freeze frame

**Where to find it.** Preview › **Frame ▾** › **Freeze frame — split & hold** or **Freeze frame — append after clip**.

**What it does.** Captures the frame under the playhead as a still and places it on the timeline.

**Details.** The frame is composed exactly as an export of that instant would be — transitions mid-blend, zooms, colour, orientation, overlays, shapes and text included — and saved into the library as an image clip named *Freeze* and the time, so it can be reused. *Split & hold* splits the entry at the playhead and holds the still between the halves; *append after clip* places it after the entry. The still shows for {{FREEZE_STILL_DURATION}} s, adjustable like any still. Both items are disabled where a split would be — at a boundary or inside a transition. The whole freeze is one undo step; the captured clip stays in the library across that undo.

**Related.** [Split at playhead](#split-at-playhead)

## Transitions: crossfade, slides, wipes, pushes, fades, irises and cross-zoom

**Where to find it.** Between two adjacent sequence entries › **+ Transition**, then the type menu and the duration field that appear.

**What it does.** Blends one entry into the next instead of cutting.

**Details.** A new transition is a **Crossfade** of {{DEFAULT_TRANSITION_DURATION}} s. The type menu offers every transition the app has: Crossfade; Slide from above, below, left and right; Wipe from left, right, above and below; Push from left, right, above and below; Fade through black; Fade through white; Iris open; Iris close; Cross-zoom. The [Shaped wipes](plugins.md#shaped-wipes) and [Pattern transitions](plugins.md#pattern-transitions) plugins add their own kinds to the same menu while they are enabled. A transition overlaps the two entries by its duration, so the sequence gets shorter by that much, and it needs room on both sides — the duration is bounded by the shorter neighbour. Remove it with its ✕ to return to a cut. Duplicating an entry never copies a transition, since a transition belongs to a boundary.

**Related.** [Add a transition](quick-start.md#4-add-a-transition) · [Duplicate](timeline.md#duplicate)

## Speed segments and pauses

**Where to find it.** An expanded video entry or video overlay › **+ Effect ▾** › **Speed segment** or **Pause**.

**What it does.** Changes how the source's time maps onto the video's time within one entry or overlay.

**Details.** A **speed segment** plays a range of the entry — *from* and *to*, in seconds into its trimmed range — at a factor: below 1 slows it down and takes longer, above 1 speeds it up. A new one runs {{DEFAULT_SPEED_LENGTH}} s at {{DEFAULT_SPEED_FACTOR}} ×. A **pause** freezes one frame — *at*, in seconds into the trimmed range — for a *hold* in output seconds; a new one holds {{DEFAULT_PAUSE_HOLD}} s. An entry can carry any number of each so long as they do not overlap; the menu greys an item when no room is left. The preview's playback, scrubbing and sequence timing honour them, and the exported file plays the same remapped timing. In Firefox the exported file keeps that timing, but a speed segment's span has no sound: Firefox cannot record a clip's sound at another speed, so the export leaves that span silent rather than letting the sound run ahead of the picture. The rest of the entry keeps its sound, and Chromium exports the span with its sound slowed or sped.

**On an overlay.** A video overlay takes speed segments and pauses with the same fields, defaults and rules, read against the overlay's own trimmed range. They change how long the overlay is on screen: a segment at 2× over 2 s of it shortens its time by 1 s, and a pause lengthens it by its hold. The row's length, its bar on the timeline and its *plays … — … remapped* note show the new length, and *Starts at* still says where it begins. Its sound fades in and out over that new length, and a duplicate starts where the original now ends. Its [zooms](#zooms) stay on the moments of its picture they cover, so a slowed span keeps its zoom for longer. Its sound follows the same rules as an entry's, Firefox's silent span included. An image overlay has no time to remap, so it offers neither item, as a still entry does not.

**Related.** [+ Effect ▾](timeline.md#effect) · [Time on the timeline](concepts.md#time-on-the-timeline)

## Zooms

**Where to find it.** An expanded sequence entry or overlay › **+ Effect ▾** › **Zoom**.

**What it does.** Magnifies part of the frame for a while: ramps in, holds, ramps out.

**Details.** A zoom has a start (*at*, in seconds into the entry), a ramp *in*, a *hold*, a ramp *out*, a magnification (*scale*, in ×) and a *centre*, *x* and *y*, as fractions of the frame's width and height. A new zoom is {{DEFAULT_ZOOM_SCALE}} × on the centre of the frame, with {{DEFAULT_ZOOM_RAMP}} s ramps and a {{DEFAULT_ZOOM_HOLD}} s hold, fitted into the room the entry has. An entry may carry several zooms with windows that do not overlap. The centre is a fraction of the output frame, so it keeps its place when the frame changes; the zoomed region never leaves the frame. Each ramp is a straight push-in: one point of the picture stays where it is on screen while everything else grows away from it, so a zoom into a corner keeps that corner in the corner of the picture throughout, and a zoom on the centre stays centred. **Adjust visually…** beside the fields opens the [zoom editor](visual-editors.md#what-each-editor-shows).

**On an overlay.** A zoom on a video or image overlay magnifies the overlay's own picture inside its rectangle; the zoom does not grow or move the rectangle (a [Move](#overlay-move) does that), and the base and everything else on the frame are untouched. The fields are the same, read against the overlay: *at* is seconds into the overlay's window, and the *centre* is a fraction of the overlay's rectangle rather than of the frame. The zoomed region never leaves the rectangle, its shape mask still cuts it, and its redaction and spotlight regions stay on the parts of the picture they cover. An overlay's zooms are removed with it and copied when it is duplicated. **Adjust visually…** beside an overlay zoom's fields opens the [zoom editor](visual-editors.md#what-each-editor-shows) on the overlay's own picture, its rectangle cut out of the frame, so the region you drag is the part of the overlay the zoom will fill.

**Related.** [+ Effect ▾](timeline.md#effect) · [Visual editors](visual-editors.md)

## Vignette and blur

**Where to find it.** An expanded sequence entry › **+ Effect ▾** › **Vignette** or **Blur**, once the [Visual effects](plugins.md#visual-effects) plugin is enabled.

**What it does.** Darkens the edges of the frame (Vignette) or blurs the whole picture (Blur) for a stretch of the entry.

**Details.** Each effect's row has its stretch, *from* and *to* in seconds into the entry, and one setting: a Vignette's *strength*, 0 to 100 %, and a Blur's *amount*, 0 to 5 % of the frame's width. A new one runs for {{DEFAULT_PICTURE_EFFECT}} s at its default setting, starting where the entry's earlier effects of the same kind leave room, fitted into the room the entry has; the item is greyed once that kind covers the whole entry. A vignette and a blur may overlap, and stack. Each eases in and out at the ends of its stretch, and ✕ removes it. Rows are named by kind and numbered in time order, *Vignette 1*, *Blur 1*. Every entry offers them, a still or a slate as well as a clip. How each effect looks, how it eases and how it rides a zoom or a transition is on [Plugins › Visual effects](plugins.md#visual-effects).

With the plugin disabled, the items leave the menu, and an effect already on an entry stays with its row named *(unavailable)*, *vignette 1 (unavailable)*: its stretch can still be moved and ✕ still removes it, and the picture shows without it until the plugin is enabled again. A [Trim](#the-trim-window) that cuts into an effect says so on its warning line, as it does for a zoom, and a [split](#split-at-playhead) or [cut](#cut-out-marked-range) divides an effect across it as it divides a speed segment.

**Related.** [+ Effect ▾](timeline.md#effect) · [Plugins › Visual effects](plugins.md#visual-effects) · [Zooms](#zooms)

## Colour adjustments

**Where to find it.** An expanded video or image row › **Picture ▸** › **Color**.

**What it does.** Adjusts brightness, contrast and saturation, and applies a one-click look.

**Details.** Three dials, *brightness*, *contrast* and *saturation*, from {{COLOR_ADJUSTMENT_MIN}} to {{COLOR_ADJUSTMENT_MAX}} %, where 100 leaves the picture as it is, and a **Look** of **Grayscale** or **Sepia**, or none. **Reset** clears the group. A browser whose canvas cannot apply filters refuses to export — or to save a frame from — a timeline with colour adjustments, with a message saying so, rather than exporting it unadjusted; the preview still shows the adjustment.

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

The region shows in the preview as you play, and is drawn into the export, a [saved frame](preview-and-playback.md#the-frame-menu), an [Animated GIF](plugins.md#gif-export), an [Animated WebP](plugins.md#more-export-formats) and an [Animated PNG](plugins.md#more-export-formats) alike — including behind a [blurred background fill](#background-fill), which is a copy of the same picture. There are no soft edges: a mask that faded in would show what it hides while it faded.

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

The dimming shows in the preview as you play, and is drawn into the export, a [saved frame](preview-and-playback.md#the-frame-menu), an [Animated GIF](plugins.md#gif-export), an [Animated WebP](plugins.md#more-export-formats) and an [Animated PNG](plugins.md#more-export-formats) alike. It does **not** dim a [blurred or coloured background fill](#background-fill) behind the clip: that backdrop is an enlarged copy of the same picture, and lighting a second hole in it would put a second spotlight on screen.

**Spotlight or zoom?** A [zoom](#zooms) removes the context — the viewer sees the button and nothing else, and loses where on the screen it is. A spotlight keeps the whole frame and points into it, which is usually what a tutorial wants. They combine: a spotlight rides a zoom like any other part of the picture.

**A redaction is dimmed with the rest of the picture.** A [redaction](#redact-a-region) outside every lit region is dimmed by the same amount as the picture around it, and one inside a lit region stays as bright as that region. A redaction across a region's edge is dimmed on the outside and left alone on the inside, following a soft edge's ramp like any other part of the picture. The dim only darkens what is already drawn, so it never brings back what a redaction hides.

**Related.** [Redact a region](#redact-a-region) · [Zooms](#zooms) · [Crop](#crop) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings) · [Visual editors](visual-editors.md)

## Background fill

**Where to find it.** An expanded sequence entry › **Picture ▸** › **Background**.

**What it does.** Chooses what shows behind a clip that does not fill the output frame — a portrait phone clip in a landscape sequence, a quarter-turned or cropped clip.

**Details.** **None** leaves the frame's black bars; **Blur** fills them with a blurred, cover-fit copy of the clip's own current frame; **Color** fills them with a flat colour you pick. The backdrop renders behind the normally fitted clip, moves and fades with it through zooms and transitions, and never reshapes the output frame. A clip that already fills the frame draws no backdrop.

**Related.** [Crop](#crop) · [The output frame](concepts.md#the-output-frame)

## Shape mask

**Where to find it.** An expanded overlay row › **Picture ▸** › **Shape**.

**What it does.** Clips an overlay's picture to a shape — the webcam-bubble look.

**Details.** The shape is cut from the overlay's **picture**: what its [crop](#crop) keeps, fitted inside the placed rectangle. Where the picture fills the rectangle the two are the same; where it is narrower or shorter — a crop that changes its proportions, or a source shaped differently from its rectangle — the shape follows the picture, and the empty sides of the rectangle stay empty. **Rectangle** is the picture as it is; **Ellipse** inscribes an ellipse in it, a circle when the picture is square; **Rounded** rounds its corners by a *radius* in percent of its shorter side, up to {{MAX_ROUNDED_RADIUS_PERCENT}} %, starting at {{DEFAULT_ROUNDED_RADIUS_PERCENT}} %. The silhouette is cut the same way in the preview and in every export. The overlay's placement editor outlines the same silhouette while you place it, on the picture rather than the whole rectangle, and the outline follows the picture as you drag or resize.

**Related.** [Overlay border](#overlay-border) · [Overlay shadow](#overlay-shadow) · [Picture ▸](timeline.md#picture) · [Visual editors](visual-editors.md)

## Overlay border

**Where to find it.** An expanded video or image overlay row › **Picture ▸** › **Border**.

**What it does.** Outlines an overlay in a colour, at a thickness you set — a black or red edge that separates a webcam bubble or a picture-in-picture from a busy picture behind it.

**Details.** **Thickness** is in pixels of the output frame, up to a tenth of its shorter side; 0, the default, is no border. The thickness keeps its proportion when the output frame changes, so a border looks the same at every export size, and the field shows it in pixels at the current frame. **Colour** sets the outline's colour; choosing one before any thickness starts the border at 4 px. The border follows the overlay's [shape mask](#shape-mask) — the rectangle, the ellipse or the rounded rectangle — cut from its picture, so a [cropped](#crop) overlay is outlined where its picture ends, not around its whole rectangle. It is drawn **outside** the shape, so the picture keeps every pixel and the outline hugs it. A part of the border past the frame's edge is cut off, as anything past the frame is. A later overlay covers an earlier one's border, as it covers its picture. The border shows exactly while the overlay does; an overlay's fades are its sound's, so the border does not fade. It is drawn the same way in the preview and in every export, saves with the project, and is copied when the overlay is duplicated. Copy settings does not carry it, as it does not carry the shape mask.

**Related.** [Shape mask](#shape-mask) · [Overlay shadow](#overlay-shadow) · [Picture ▸](timeline.md#picture)

## Overlay shadow

**Where to find it.** An expanded video or image overlay row › **Picture ▸** › **Shadow**.

**What it does.** Casts a soft drop shadow under an overlay, so a webcam bubble or a picture-in-picture looks lifted off the picture behind it.

**Details.** The **Shadow** checkbox turns it on and off; it is off until you turn it on. Turned on, it starts black at {{DEFAULT_OVERLAY_SHADOW_OPACITY_PERCENT}} % opacity, with a {{DEFAULT_OVERLAY_SHADOW_BLUR_PX}} px blur, falling {{DEFAULT_OVERLAY_SHADOW_OFFSET_PX}} px right and {{DEFAULT_OVERLAY_SHADOW_OFFSET_PX}} px down. **Colour** and **opacity** (0 to 100 %) set how it looks. **Blur** softens its edge; at 0 the edge is hard. **x** and **y** move it right and down; a negative value moves it left or up. Blur and each offset are in pixels of the output frame, up to a tenth of its shorter side, and keep their proportion when the output frame changes, as a [border's](#overlay-border) thickness does. The shadow takes the overlay's [shape](#shape-mask) — the rectangle, the ellipse or the rounded rectangle, cut from its picture — grown by its border when it has one. So a [cropped](#crop) picture, or one narrower or shorter than its rectangle, casts from its own edges, and its shadow can fall in the empty sides of the rectangle. It is drawn only **outside** that shape, so a still with transparent parts never shows shadow through itself. It sits under the border and the picture, over everything beneath the overlay; a later overlay covers it, as it covers the earlier one's picture. A part past the frame's edge is cut off. It shows exactly while the overlay does and does not fade, since an overlay's fades are its sound's. It is drawn the same way in the preview and in every export, saves with the project, and is copied when the overlay is duplicated. Copy settings does not carry it, as it does not carry the border.

**Related.** [Overlay border](#overlay-border) · [Shape mask](#shape-mask) · [Picture ▸](timeline.md#picture)

## Overlay move

**Where to find it.** An expanded video or image overlay › **+ Effect ▾** › **Move**.

**What it does.** Makes an overlay glide to a new place and size during the video, and stay there. Use it, for example, to move a webcam bubble out of the way of what the screen recording is showing.

**Details.**

- **The fields.** Each Move has four parts:
  - **at**: when the glide begins, in seconds after the overlay appears;
  - **glide**: how long it takes, in seconds. At 0 the overlay jumps;
  - **left**, **top**, **width** and **height**: where it ends up, in the same units as the row's own **Rect** fields.
- **What you see.** Before its first Move, the overlay sits at its own **Rect**. During a glide it moves and resizes smoothly from where it was to the Move's place. It starts slowly, is quickest halfway, and settles gently, so halfway through the glide it is exactly halfway there. After the glide it stays at the Move's place until the next Move.
- **Adding one.** A new Move starts where the last one ends, or when the overlay appears if it has none. It glides for 1 s, or for what is left of the overlay's time. Its place is where the overlay already is at that moment, so adding it changes nothing until you edit it. The item is greyed when there is no time left.
- **Several Moves.** An overlay can carry several Moves, one after another. They are kept in time order and never overlap: a Move set to start during another's glide starts when that glide ends. Every glide stays within the time the overlay is on screen, so shortening the overlay shortens a glide that ran past its new end. A place that would leave the frame is pulled back onto it, as the **Rect** fields are.
- **Time is the video's, not the clip's.** **at** counts from when the overlay appears. A [speed segment or pause](#speed-segments-and-pauses) on the overlay changes which frame of its clip is showing, not when it moves. Its [zooms](#zooms) stay on its picture's own time, since they magnify the picture.
- **Everything moves with it.** The overlay's [shape mask](#shape-mask), [border](#overlay-border) and [shadow](#overlay-shadow) are drawn on its picture wherever it is, and its zoom magnifies inside the moving rectangle. The preview and every export place it identically.
- **Editing elsewhere.** [Split…](#split), [Cut…](#cut) and [Cut out marked range](#cut-out-marked-range) keep each Move at its moment in the video. A part that starts in the middle of the overlay's time starts from where the overlay was then.
- **Duplicating and removing.** [Duplicate](timeline.md#duplicate) copies the Moves with the overlay, and removing the overlay removes them. Copy settings does not carry them, as it does not carry zooms. Adding, editing and removing a Move is one undo step each, and Moves save with the project.
- **Dragging a Move's place.** **Adjust visually…** beside the **Rect** fields opens the [overlay editor](visual-editors.md#what-each-editor-shows) with a Preview slider. It edits the place that holds where the slider is: the overlay's own before its first Move, and a Move's destination from that Move's start on. A line beside the slider says which, for example *Editing: after Move 1*.

**Related.** [+ Effect ▾](timeline.md#effect) · [Placement rectangle](glossary.md#placement-rectangle) · [Zooms](#zooms)

## The slider beside each number

**Where to find it.** Every number field on a timeline row that has a range — trims, volume, fades, the colour dials, effect timings, a corner radius.

**What it does.** Drags the value on the field's own range and step instead of typing it.

**Details.** The number moves as you drag and commits once when you release, so a whole drag is one undo step. The field itself still commits on Enter or when you leave it, and the two always read the same value. In Firefox a click on the field's own arrows commits at once, because Firefox steps the number without putting the cursor in the field. The Volume slider runs from 0 to {{MAX_VOLUME}} and carries a small mark at 1, the source as recorded.

**Related.** [A row](timeline.md#a-row)
