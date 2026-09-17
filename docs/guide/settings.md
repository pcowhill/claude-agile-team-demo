# Settings

Preferences for the way you work, kept on this device: [opening Settings](#opening-settings), the [step sizes](#step-sizes-playhead-nudge-and-jump) for the arrow keys, [how long a new still shows](#new-still-or-slate-duration), [what happens when a previous session is found](#when-a-previous-session-is-found), the [Visual editors](#visual-editors) switch, the [countdown before recording](#countdown-before-recording), the [default export format](#default-export-format), and [where settings live](#where-settings-live). None of them is part of a project; the dividing line is in [What is saved where](concepts.md#what-is-saved-where).

## Opening Settings

**Where to find it.** **File ▾** › **Settings…**.

**What it does.** Opens the *Settings* dialog; every change applies at once, with no reload and no Save.

**Details.** The dialog says what it holds — *Preferences for this browser, remembered on this device. They are not part of a project, so they never travel with a saved file.* Each setting is a drop-down of known-good choices rather than a free field, so there is never an invalid value to correct. **Close** dismisses the dialog; nothing needs confirming.

**Related.** [Where settings live](#where-settings-live)

## Step sizes: playhead nudge and jump

**Where to find it.** Settings › **Playhead nudge (← / →)** and **Playhead jump (Shift + ← / →)**.

**What it does.** Sets how far the arrow keys move the playhead in the preview.

**Details.** The nudge is one of {{STEP_CHOICES}} — {{DEFAULT_STEP_SECONDS}} s unless you change it — and the jump one of {{LARGE_STEP_CHOICES}}, {{DEFAULT_LARGE_STEP_SECONDS}} s by default. The values in force are {{STEP_SECONDS}} s and {{LARGE_STEP_SECONDS}} s right now: the cheat sheet, the [Keyboard shortcuts](keyboard-shortcuts.md) page and this sentence all read the setting, so none of them can describe keys that no longer behave that way. The seek bar's own arrow keys, with the slider focused, keep their own step regardless.

**Related.** [Keyboard shortcuts](keyboard-shortcuts.md)

## New still or slate duration

**Where to find it.** Settings › **New still or slate duration**.

**What it does.** Sets how long a newly added still image, colour slate or image overlay shows.

**Details.** One of {{STILL_DURATION_CHOICES}}; {{DEFAULT_STILL_DURATION}} s unless changed. As the hint says, it applies to new stills, colour slates and image overlay layers — anything already on the timeline keeps its own duration, which is stored on the element and saved with the project. The setting is a starting point, never saved state.

**Related.** [Add](media-library.md#add) · [The header](timeline.md#the-header)

## When a previous session is found

**Where to find it.** Settings › **When a previous session is found**.

**What it does.** Decides whether the *Restore last session?* offer appears when the page opens with an autosaved session waiting.

**Details.** **Ask each time** (the default) shows the offer with Restore and Discard; **Always restore** restores without asking; **Never restore** shows nothing and lets the autosave take over the old snapshot. As the hint says, autosave keeps recording either way — this is only about the offer.

**Related.** [Autosave and Restore last session](projects.md#autosave-and-restore-last-session)

## Visual editors

**Where to find it.** Settings › **Visual editors**, **On** or **Off**.

**What it does.** Shows or hides every *Adjust visually…* button on the timeline.

**Details.** On by default. The hint says what the switch gates: *Adjust visually… buttons sit beside the fields they stand in for, and open a still of the frame to drag the value into place instead of typing it. Off hides them all and never renders that frame.* The number fields keep working either way; Off is for a machine where rendering the still costs more than it is worth.

**Related.** [Turning the editors on and off](visual-editors.md#turning-the-editors-on-and-off)

## Countdown before recording

**Where to find it.** Settings › **Countdown before recording**, **{{RECORDING_COUNTDOWN_SECONDS}} s** or **Off**.

**What it does.** Decides whether the recording dialog counts 3 · 2 · 1 before the recorder starts.

**Details.** On by default, at {{RECORDING_COUNTDOWN_SECONDS}} s. The hint says what it is for: *Record ▾ counts 3 · 2 · 1 after the sources are granted, so a take never begins with your hand still on the mouse. Start now skips it; Off starts recording at once.* Off is for people who never want the pause; anyone else can skip a single countdown with **Start now** in the dialog. Like every setting, it is a preference for this browser and never part of a project.

**Related.** [The countdown](recording.md#the-countdown) · [The recording dialog](recording.md#the-recording-dialog)

## Default export format

**Where to find it.** Settings › **Default export format**.

**What it does.** Chooses which format the export dialog opens on; every export can still be changed there.

**Details.** The list holds the formats this browser offers, plugin formats included while their plugin is enabled — {{DEFAULT_EXPORT_FORMAT}} unless changed. A remembered choice this browser cannot offer right now — a plugin format while the plugin is off, an MP4 preference on a browser without MP4 — stays in the list marked *not available in this browser*, and the export dialog opens on WebM instead until it is available again. **File ▾** › **Export ▸** › a format opens the dialog on that format regardless.

**Related.** [Opening the export dialog](export.md#opening-the-export-dialog) · [Formats and what decides them](export.md#formats-and-what-decides-them)

## Where settings live

**Where to find it.** Nothing to operate.

**What it does.** Says what settings are, and are not.

**Details.** Settings describe how you like to work — the arrow steps, a new still's length, the restore offer, the export format, the visual editors, the recording countdown — and are stored in this browser, per device. Anything that describes the edit itself — a track's volume, a duck level, the project's subtitle style, the choices made for one export — is project state and travels with the project file instead. So settings are never in a project file or the autosave snapshot; another computer, or a browser with nothing stored, uses the defaults and behaves exactly as the editor did before there were settings. A stored value this version does not recognise falls back to the default for that one setting, leaving the others as you set them. Changing a setting is not an edit: Undo never touches it.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [What is never in a project file](projects.md#what-is-never-in-a-project-file)
