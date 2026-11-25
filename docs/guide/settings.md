# Settings

Preferences for the way you work, kept on this device: [opening Settings](#opening-settings), the [step sizes](#step-sizes-playhead-nudge-and-jump) for the arrow keys, [how long a new still shows](#new-still-or-slate-duration), [how time fields show a time](#time-fields), [what happens when a previous session is found](#when-a-previous-session-is-found), the [Visual editors](#visual-editors) switch, the [countdown before recording](#countdown-before-recording), the [screen recording quality](#screen-recording-quality), the [Match levels target](#match-levels-target), the [default export format](#default-export-format), and [where settings live](#where-settings-live). None of them is part of a project; the dividing line is in [What is saved where](concepts.md#what-is-saved-where).

## Opening Settings

**Where to find it.** **File ▾** › **Settings…**.

**What it does.** Opens the *Settings* dialog; every change applies at once, with no reload and no Save.

**Details.** Like every dialog, it never grows past the window: once the settings are taller, they scroll inside the dialog, and the heading and **Close** stay in view. The dialog says what it holds — *Preferences for this browser, remembered on this device. They are not part of a project, so they never travel with a saved file.* Each setting is a drop-down of known-good choices rather than a free field, so there is never an invalid value to correct. **Close** dismisses the dialog; nothing needs confirming.

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

## Time fields

**Where to find it.** Settings › **Time fields**: **Seconds (83.5 s)** or **Minutes and seconds (1:23.500)**.

**What it does.** Decides how every box where you type a time shows it: plain seconds, or minutes, seconds and milliseconds.

**Details.** **Seconds** is the default, and the boxes read as they always have — `83.5`, with **s** inside the box. **Minutes and seconds** shows the same value as `1:23.500`: always three decimals, and hours in front from an hour on (`1:02:05.250`). The **s** is not drawn then, since the colon says what the number is. It covers every time box on the timeline — start, duration, In and Out, fades, transition lengths, zooms, speed segments and pauses, Moves, redaction and spotlight windows, shape timings — and the time box of the [Trim](editing-video.md#the-trim-window), [Cut](editing-video.md#cut) and [Split](editing-video.md#split) windows, and the preview-time readout of each [visual editor](visual-editors.md). It covers the note beside a row's In and Out too, so `plays 6.01s of 6.01s — 8.01s remapped` reads `plays 0:06.010 of 0:06.010 — 0:08.010 remapped`, and an image overlay's `shows 5s` reads `shows 0:05.000`. Readouts that already show minutes, such as the preview's `0:12 / 1:05` and the Trim window's `0:12.50`, stay as they are.

In minutes mode a box takes `1:23.5`, `1:23.500`, `1:23` or `1:02:05.25`, and plain seconds too: `83.5` is read as 1:23.500. A seconds or minutes part after a colon of 60 or more, such as `1:75`, is not a time; the box goes back to the value it held. Enter or leaving the box commits, as in seconds mode, and **↑** / **↓** step the value by the box's step, as the number box's arrows do. Leaving a box as it shows, or typing the same time again, changes nothing — not even a value stored more finely than the millisecond the box shows.

The times themselves are the same in both modes, so a project reads alike either way; like every setting, this one is a preference for this browser and never part of a project.

**Related.** [A row](timeline.md#a-row) · [The Trim window](editing-video.md#the-trim-window)

## When a previous session is found

**Where to find it.** Settings › **When a previous session is found**.

**What it does.** Decides whether the *Restore last session?* offer appears when the page opens with an autosaved session waiting.

**Details.** **Ask each time** (the default) shows the offer with Restore and Discard; **Always restore** restores without asking; **Never restore** shows nothing and lets the autosave take over the old snapshot. As the hint says, autosave keeps recording either way — this is only about the offer.

**Related.** [Autosave and Restore last session](projects.md#autosave-and-restore-last-session)

## Visual editors

**Where to find it.** Settings › **Visual editors**, **On** or **Off**.

**What it does.** Shows or hides every *Adjust visually…* button on the timeline, and a shape group's *Draw shapes…*.

**Details.** On by default. The hint says what the switch gates: *Adjust visually… buttons sit beside the fields they stand in for, and open a still of the frame to drag the value into place instead of typing it. Off hides them all and never renders that frame.* The number fields keep working either way; Off is for a machine where rendering the still costs more than it is worth.

**Related.** [Turning the editors on and off](visual-editors.md#turning-the-editors-on-and-off)

## Countdown before recording

**Where to find it.** Settings › **Countdown before recording**, **{{RECORDING_COUNTDOWN_SECONDS}} s** or **Off**.

**What it does.** Decides whether the recording dialog counts 3 · 2 · 1 before the recorder starts.

**Details.** On by default, at {{RECORDING_COUNTDOWN_SECONDS}} s. The hint says what it is for: *Record ▾ counts 3 · 2 · 1 after the sources are granted, so a take never begins with your hand still on the mouse. Start now skips it; Off starts recording at once.* Off is for people who never want the pause; anyone else can skip a single countdown with **Start now** in the dialog. Like every setting, it is a preference for this browser and never part of a project.

**Related.** [The countdown](recording.md#the-countdown) · [The recording dialog](recording.md#the-recording-dialog)

## Screen recording quality

**Where to find it.** Settings › **Screen recording quality**: **Standard (smaller files)** or **High (sharper text)**.

**What it does.** Decides how much detail a [screen recording](recording.md#screen) keeps, and so how large its file is.

**Details.** **High** is the default. It asks the browser's recorder for a rate worked out from what is being captured: a quarter of a bit for each pixel of each frame, which is about 15.6 Mbit/s for a 1920 × 1080 screen at 30 frames a second, capped at 40 Mbit/s for very large or very fast captures. Small text then stays sharp when the clip is zoomed or cropped. **Standard** asks for no rate, so the browser picks its own, as the editor always did before this setting. That rate is lower, so the files are smaller, but text shows compression blur once it is magnified.

The hint sums it up: *For Screen and Screen + camera. High keeps small text sharp when the clip is zoomed or cropped, in larger files; Standard leaves it to the browser.* In a test on a full-HD screen of small text, High made a file about a third larger than Standard while the text stood still, and over four-fifths larger while it scrolled. A long recording at High takes correspondingly more room in the autosave and in a project file that keeps its media.

The setting covers **Screen** and the screen half of **Screen + camera**. The webcam and the microphone record as they always have, and so does **System audio**, which keeps only the sound of what it shares. It applies to the next recording; clips already in the library keep the quality they were recorded at. Like every setting, it is a preference for this browser and never part of a project.

**Related.** [Screen](recording.md#screen) · [Screen + camera](recording.md#screen-camera)

## Match levels target

**Where to find it.** Settings › **Match levels target**: {{MATCH_TARGET_CHOICES}}.

**What it does.** Sets the level [Match levels](audio.md#match-levels) brings every element with sound to.

**Details.** {{MATCH_TARGET_DEFAULT}} by default — the level a clear voice recording usually sits near, leaving room above it for the peaks of speech. The level is the average level of the sound, ignoring silences, in dB below full scale; a higher number (nearer 0) is louder. A louder element is turned down to the target and a quieter one raised to it, by up to Volume {{MAX_VOLUME}}, unless its peaks would clip first; one still below the target at {{MAX_VOLUME}} is reported as below it. A higher target raises more of your recordings, and so brings more of them up against that clipping limit; a lower one turns more of them down. Changing the target changes nothing until you press Match levels again. Like every setting, it is a preference for this browser; the Volumes it produces are part of the project.

**Related.** [Match levels](audio.md#match-levels) · [Volume and mute](audio.md#volume-and-mute)

## Default export format

**Where to find it.** Settings › **Default export format**.

**What it does.** Chooses which format the export dialog opens on; every export can still be changed there.

**Details.** The list holds the formats this browser offers, plugin formats included while their plugin is enabled — {{DEFAULT_EXPORT_FORMAT}} unless changed. A remembered choice this browser cannot offer right now — a plugin format while the plugin is off, an MP4 preference on a browser without MP4 — stays in the list marked *not available in this browser*, and the export dialog opens on WebM instead until it is available again. **File ▾** › **Export ▸** › a format opens the dialog on that format regardless.

**Related.** [Opening the export dialog](export.md#opening-the-export-dialog) · [Formats and what decides them](export.md#formats-and-what-decides-them)

## Where settings live

**Where to find it.** Nothing to operate.

**What it does.** Says what settings are, and are not.

**Details.** Settings describe how you like to work — the arrow steps, a new still's length, how time fields show a time, the restore offer, the export format, the visual editors, the recording countdown, the screen recording quality, the Match levels target — and are stored in this browser, per device. Anything that describes the edit itself — a track's volume, a duck level, the project's subtitle style, the choices made for one export — is project state and travels with the project file instead. So settings are never in a project file or the autosave snapshot; another computer, or a browser with nothing stored, uses the defaults and behaves exactly as the editor did before there were settings — except that screen recordings default to the [High quality](#screen-recording-quality) the browser alone did not give them. A stored value this version does not recognise falls back to the default for that one setting, leaving the others as you set them. Changing a setting is not an edit: Undo never touches it.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [What is never in a project file](projects.md#what-is-never-in-a-project-file)
