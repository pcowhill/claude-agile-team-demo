# Shapes and annotations

Rectangles and ellipses drawn on the picture: a red circle with a clear centre around the button you are talking about, a box around a setting, a highlight over a line of text. Shapes come in **shape groups**. A group's shapes appear and disappear together, so three circles meant for the same moment are one row, not three. This page covers [adding a shape group](#adding-a-shape-group), [a group's timing and fades](#a-group-s-timing-and-fades), [the shapes in a group](#the-shapes-in-a-group), [a shape's style](#a-shape-s-style) and [how shapes render](#how-shapes-render). Where the Shapes section sits on the timeline is on [Timeline](timeline.md#the-five-sections).

## Adding a shape group

**Where to find it.** Timeline header › **Add ▾** › **Shape group**.

**What it does.** Adds a group to the Shapes section, starting at the playhead, with one red ellipse with a clear centre in the middle of the frame.

**Details.** The group shows for {{DEFAULT_SHAPE_GROUP_DURATION}} s from where the playhead stands, or from the end of the video if the playhead is past it. The ellipse has a red border at full opacity, about 6 px thick in a 1080p frame, and no fill. Adding the group is one undo step. Its row is named for what it holds — *Ellipse*, *Ellipse + Rectangle*, *3 ellipses* — and the name follows its shapes as you add and remove them. Take the group off the timeline with the row's **✕**, or **Remove** in its **⋯** menu; both ask first.

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

- **+ Add shape ▾** offers **Rectangle** and **Ellipse**. The new shape appears in the middle of the frame and takes the style of the group's last shape, so after setting one shape to yellow, the next one you add is yellow too.
- **Box** is four fractions of the frame: **x** and **y**, the left and top edges, and **w** and **h**, the width and height, each 0 to 1. An ellipse fills its box, so a box that is square in pixels gives a circle. Because they are fractions, shapes keep their places when the output frame changes.
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

**Related.** [The shapes in a group](#the-shapes-in-a-group) · [How shapes render](#how-shapes-render)

## How shapes render

**Where to find it.** Nothing to operate; how the preview and the export draw a group.

**What it does.** Draws each group's shapes on the picture for its window, in the preview and identically in the exported file.

**Details.** Shapes are drawn above the picture — the sequence with its transitions, zooms, spotlights and redactions, and the overlay layers — and **below text**, so a caption placed on a box stays readable. They are placed on the output frame, like text: a shape stays where you put it on the screen and does not move with a zoom or a slide. Where two groups overlap, the one that starts later is drawn on top; groups that start together keep their order in the Shapes section. The same drawing is used by the preview, every export format, [Save frame as PNG…](preview-and-playback.md#the-frame-menu) and the [Animated GIF](export.md#animated-gif-plugin) plugin. Shape groups are saved with the project and the autosave.

**Related.** [How text renders](text-and-subtitles.md#how-text-renders) · [The output frame](concepts.md#the-output-frame)
