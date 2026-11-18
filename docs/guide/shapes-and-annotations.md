# Shapes and annotations

Rectangles, ellipses and arrows drawn on the picture: a red circle with a clear centre around the button you are talking about, a box around a setting, a highlight over a line of text, an arrow pointing at the thing to click. Shapes come in **shape groups**. A group's shapes appear and disappear together, so three circles meant for the same moment are one row, not three. This page covers [adding a shape group](#adding-a-shape-group), [a group's timing and fades](#a-group-s-timing-and-fades), [the shapes in a group](#the-shapes-in-a-group), [a shape's style](#a-shape-s-style), [arrows and lines](#arrows-and-lines), [drawing shapes on the picture](#drawing-shapes-on-the-picture) and [how shapes render](#how-shapes-render). Where the Shapes section sits on the timeline is on [Timeline](timeline.md#the-five-sections).

## Adding a shape group

**Where to find it.** Timeline header › **Add ▾** › **Shape group**.

**What it does.** Adds a group to the Shapes section, starting at the playhead, with one red ellipse with a clear centre in the middle of the frame.

**Details.** The group shows for {{DEFAULT_SHAPE_GROUP_DURATION}} s from where the playhead stands, or from the end of the video if the playhead is past it. The ellipse has a red border at full opacity, about 6 px thick in a 1080p frame, and no fill. Adding the group is one undo step. Its row is named for what it holds — *Ellipse*, *Ellipse + Rectangle*, *3 ellipses* — and the name follows its shapes as you add and remove them, until you give the group a name of its own with **Rename…** (emptying the name goes back to this one). Take the group off the timeline with the row's **✕**, or **Remove** in its **⋯** menu; both ask first. The same menu holds **Duplicate**, which adds a copy starting where the group ends, and **Copy settings** / **Paste settings**, which carry a group's timing and fades onto another group without touching its shapes. See [The ⋯ menu](timeline.md#the-menu).

**Related.** [A group's timing and fades](#a-group-s-timing-and-fades) · [The header](timeline.md#the-header)

## A group's timing and fades

**Where to find it.** The expanded shape group row › **Shows at**, **for**, **Fade in** and **out**.

**What it does.** Sets when the group's shapes appear, how long they stay, and how they fade in and out, all together.

**Details.** **Shows at** is the second of the video the group appears, and **for** how many seconds it stays. Both are in the video's own time, not any clip's, so a group stays where you put it when you trim or reorder clips. Anything past the end of the video is cut off there. **Fade in** and **out** are in seconds and ramp the whole group's opacity linearly, exactly as a [text overlay's fades](text-and-subtitles.md#fade-in-and-fade-out) do: both start at zero, and together they never exceed the group's duration. Each committed change is one undo step.

**Related.** [Text: fade-in and fade-out](text-and-subtitles.md#fade-in-and-fade-out) · [Time on the timeline](concepts.md#time-on-the-timeline)

## The shapes in a group

**Where to find it.** The expanded shape group row, one block of fields per shape; **+ Add shape ▾** under them.

**What it does.** Lists every shape in the group with its kind, its box and its style, and adds or removes shapes.

**Details.**

- **+ Add shape ▾** offers **Rectangle**, **Ellipse** and **Arrow**. The new shape appears in the middle of the frame and takes the style of the group's last shape, so after setting one shape to yellow, the next one you add is yellow too. An arrow is placed by its two ends rather than a box; see [Arrows and lines](#arrows-and-lines).
- **Box**, on a rectangle or an ellipse, is four fractions of the frame: **x** and **y**, the left and top edges, and **w** and **h**, the width and height, each 0 to 1. An ellipse fills its box, so a box that is square in pixels gives a circle. Because they are fractions, shapes keep their places when the output frame changes.
- **✕** beside a shape removes it. A group always holds at least one shape, so its only shape has no ✕; remove the group instead.
- Shapes draw in list order: a later shape in the list covers an earlier one where they overlap.

**Related.** [A shape's style](#a-shape-s-style) · [The output frame](concepts.md#the-output-frame)

## A shape's style

**Where to find it.** A shape's block in the expanded group row › **Border**, **Thickness**, **Fill** and, on a rectangle, **Corners**.

**What it does.** Sets the border and fill colours, how opaque each is, how thick the border is, and how rounded a rectangle's corners are.

**Details.**

- **Border** is a colour and an opacity from 0 to 100 %. **Thickness** is in pixels of the current output frame; 0 means no border. The border is centred on the shape's outline.
- **Fill** is a colour and an opacity from 0 to 100 %. 0 % is a clear centre, which is where every new shape starts.
- **Corners** is a rectangle's corner radius in pixels; 0 is a sharp corner. It is capped at half the rectangle's shorter side.
- Thickness and corner radius are stored as a share of the frame's shorter side, so a shape looks the same at every output size. The pixels the field shows are worked out for the frame the preview is showing, so changing the [canvas preset](timeline.md#the-header) changes the number shown but not the shape's look.
- A shape with no visible border and no visible fill draws nothing, and its block says *This shape is invisible*, so an empty-looking group is explained.

**Related.** [The shapes in a group](#the-shapes-in-a-group) · [Arrows and lines](#arrows-and-lines) · [How shapes render](#how-shapes-render)

## Arrows and lines

**Where to find it.** **+ Add shape ▾** › **Arrow** on an expanded shape group row; the arrow's block of fields in that row.

**What it does.** Draws a straight arrow from a tail to a tip, with a head at the tip, a head at both ends, or no head at all, which makes it a plain line.

**Details.**

- A new arrow runs across the middle of the frame, pointing right, with a head at the tip.
- **Tail** and **Tip** are each two fractions of the frame, **x** across and **y** down, from 0 to 1. The arrow is drawn from the tail to the tip and ends exactly at the tip.
- **Heads** is **At the tip**, **Both ends** or **None (a line)**.
- **Head size** is **Small**, **Medium** or **Large**. A head is 3, 4.5 or 6 times the border's thickness long, and as wide across its base as it is long, so a thicker arrow has a bigger head. However thin the arrow, a head is never shorter than 2 % of the frame's shorter side, about 22 px in a 1080p frame, so a 1 px line still ends in a head you can see. On a short arrow the heads shrink to fit. A line has no head, so the field is hidden while Heads is None.
- An arrow is drawn entirely in its **Border** colour, opacity and **Thickness**, head included. It has no fill, so its block has no Fill field. With thickness 0 or opacity 0 % it draws nothing, and its block says *This arrow is invisible*.

**Related.** [A shape's style](#a-shape-s-style) · [The shapes in a group](#the-shapes-in-a-group)

## Drawing shapes on the picture

**Where to find it.** **Draw shapes…** under the shapes of an expanded shape group row, beside **+ Add shape ▾**.

**What it does.** Opens the shape editor under the row: a still of the frame the group shows over, where you draw rectangles, ellipses and arrows by dragging, and select, move and resize them, instead of typing their fields.

**Details.**

- **The picture** is the frame at the middle of the group's window, rendered by the export's own drawing. The group's own shapes are drawn on it live, so a shape you drag looks as it will render. Other shape groups showing at that moment are in the picture too, and outlined faint and dashed; they cannot be selected here. In the editor this group is drawn over any text, though in the video it sits [below text](#how-shapes-render).
- **The tools** are **Select**, **Rectangle**, **Ellipse** and **Arrow**, in a strip above the picture.
  - With **Rectangle** or **Ellipse**, drag from one corner of the shape to the opposite one. With **Arrow**, drag from the tail to the tip.
  - Hold **Shift** while drawing for a square, a circle, or an arrow at a multiple of 15°. Squares, circles and angles are measured in the output frame's pixels, so a circle on a 16:9 frame is round.
  - The new shape is added to the end of the group, takes the style of the last shape you drew or edited in the editor (the group's last shape until then), and is selected. The tool goes back to **Select**; **double-click** a tool to keep it for several shapes.
  - A press that barely moves draws nothing.
- **Select** picks a shape with a click. A selected rectangle or ellipse has handles on its corners and edges: a corner moves its two edges, an edge only its own, and **Shift** on a corner keeps the shape's proportions. A selected arrow has a ring at each end; dragging a ring moves only that end, and **Shift** keeps the arrow at 15° steps. Drag a shape itself to move it. A click on bare picture selects nothing.
- **Snapping.** A moved shape, a drawn corner and a dragged arrow end are pulled onto the frame's edges, its thirds and its centre, with a guide line while you drag; hold **Alt** to place it freely. See [Snapping and guides](visual-editors.md#snapping-and-guides).
- **Keys.** Clicking the picture gives it the keyboard. The arrow keys then nudge the selected shape, Shift for the larger step, and **+** and **−** resize it: a rectangle or ellipse about its centre, an arrow along its own line.
- **Edits.** Each drag is one undo step, committed when you let go; each key press is one more. The fields above show the same values, to a hundredth of the frame, and typing in them moves the shape in the editor. So Shift's squares and angles are exact to that hundredth: a square's sides can differ by up to half a hundredth of the frame's width, and an arrow a tenth of the frame long or longer is within a degree of its 15° step.
- Close, Escape, or **Draw shapes…** again closes the editor. The button is hidden while Settings › [Visual editors](visual-editors.md#turning-the-editors-on-and-off) is Off.

**Related.** [The shapes in a group](#the-shapes-in-a-group) · [Arrows and lines](#arrows-and-lines) · [Visual editors](visual-editors.md)

**Shortcuts.** Shift while drawing or resizing · Alt while dragging · ← ↑ → ↓ nudge, Shift for the larger step · + and − resize · Esc closes.

## How shapes render

**Where to find it.** Nothing to operate; how the preview and the export draw a group.

**What it does.** Draws each group's shapes on the picture for its window, in the preview and identically in the exported file.

**Details.** Shapes are drawn above the picture — the sequence with its transitions, zooms, spotlights and redactions, and the overlay layers — and **below text**, so a caption placed on a box stays readable. They are placed on the output frame, like text: a shape stays where you put it on the screen and does not move with a zoom or a slide. Where two groups overlap, the one that starts later is drawn on top; groups that start together keep their order in the Shapes section. The same drawing is used by the preview, every export format, [Save frame as PNG…](preview-and-playback.md#the-frame-menu) and the [Animated GIF](export.md#animated-gif-plugin) plugin. Shape groups are saved with the project and the autosave.

**Related.** [How text renders](text-and-subtitles.md#how-text-renders) · [The output frame](concepts.md#the-output-frame)
