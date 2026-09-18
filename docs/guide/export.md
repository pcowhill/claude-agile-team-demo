# Export

Turning the arrangement into a file: [opening the export dialog](#opening-the-export-dialog), the [formats](#formats-and-what-decides-them) and what decides which are offered, the [output settings](#output-settings) and their presets, [the Range line](#the-range-line), the two [Audio only](#audio-only-webm-opus-and-mp3) formats, [Animated GIF](#animated-gif-plugin) through its plugin, and [what can stop an export](#what-can-stop-an-export). The exported file carries the preview's mix, and draws every frame through the same rule the preview uses — see [The output frame](concepts.md#the-output-frame). A single frame is saved from the preview's **Frame ▾** › **Save frame as PNG…** instead.

## Opening the export dialog

**Where to find it.** The header's **Export Project…** button, or **File ▾** › **Export ▸** › a format.

**What it does.** Opens the *Export project* dialog — on the format Settings chose, or on the one picked from the submenu — and runs the export from there.

**Details.** Both are disabled while the timeline is empty; the button says so on hover (*Add clips to the timeline to export your edit*). The dialog opens on the format from **Settings** › *Default export format* ({{DEFAULT_EXPORT_FORMAT}} unless changed), falling back to a format this browser offers when that one is not available; the **Export ▸** submenu lists every offered format and opens the dialog on the one you pick. **Export** starts it; **Cancel** closes the dialog or stops a running export. An export runs in real time — the dialog says so: a 30-second sequence takes about 30 seconds — with a progress bar and percentage, and the file downloads as *sequence-export* with the format's extension when it finishes. The editor's keys are inert while the dialog is open.

**Related.** [Export](quick-start.md#7-export) · [Default export format](settings.md#default-export-format)

## Formats and what decides them

**Where to find it.** The dialog's **Format** group.

**What it does.** Lists the formats this browser can produce, and shows the selected format's note beneath them.

**Details.** The list is decided by the browser, not the app. **WebM** and **MP4** record through the browser's own recorder, so each appears only where the browser can encode it — Firefox offers WebM alone, and MP4 needs a recent Chromium or Safari. **Audio only (WebM/Opus)** records the same way; **Audio only (MP3)** encodes in the page and needs only the browser's audio engine, so it is offered wherever sound plays at all. **Animated GIF** appears while the GIF export plugin is enabled. WebM is listed first and is the fallback when a preferred format is missing. A format with a stated limit — the GIF's frame rate and size, an audio-only format's *no video track* — shows it right under the group.

**Related.** [Audio only](#audio-only-webm-opus-and-mp3) · [Animated GIF](#animated-gif-plugin) · [Plugins](plugins.md) · [Browser support](troubleshooting.md#browser-support-and-feature-detection)

## Output settings

**Where to find it.** The dialog's **Output** group: a size drop-down, **Width**, **Height** and **Frame rate**.

**What it does.** Sets the exported picture's size and frame rate for this one export.

**Details.** The drop-down opens on **Auto (match sources)** — the frame follows the sources composed with the canvas preset, exactly as the preview shows, and the fields display the size that yields. The presets — {{EXPORT_SIZE_PRESETS}} — fill the fields with a common output size, and **Custom** is what typing into a field switches to. Width and height are whole pixels from {{MIN_EXPORT_DIMENSION}} to {{MAX_EXPORT_DIMENSION}}; the frame rate is {{EXPORT_FRAME_RATE}} fps unless you set another, up to {{MAX_EXPORT_FRAME_RATE}}. A value outside those bounds shows a message and disables Export until it is fixed. Whatever you choose here applies to this export only — the next time the dialog opens it is back on Auto — and an audio-only format hides the whole group, since it records no picture. The picture is composed at the requested size, not scaled after the fact, so overlays, text and zooms keep their proportions.

**Related.** [The output frame](concepts.md#the-output-frame) · [Canvas](timeline.md#the-header)

## The Range line

**Where to find it.** The dialog's **Range** group.

**What it does.** Exports the whole project, the span between the preview's marks, or a span typed here.

**Details.** **Whole project** is every export's starting point. **Marked range** appears only while the preview's in and out marks form a range, and names it — *Marked range (0:04 – 0:12)*. **Custom range** takes a start and an end typed as `m:ss` or plain seconds — `1:30`, `90`, `0:08.5` and `h:mm:ss` are all read — and typing into either field selects it; the fields start out filled with the marks, or with the whole sequence. The end must lie within the sequence and the start before the end, or the dialog says what is wrong and disables Export. The range narrows every format alike, GIF and the audio-only ones included, and a boundary inside a transition or an effect exports exactly what the preview shows at that instant — mid-blend if that is where it falls, with no snapping.

**Related.** [Time on the timeline](concepts.md#time-on-the-timeline) · [Exporting each chapter as its own file](#exporting-each-chapter-as-its-own-file)

## Exporting each chapter as its own file

**Where to find it.** The dialog's **Range** group: **Each chapter**, which appears once the project has at least one [chapter marker](preview-and-playback.md#chapter-markers) and says how many files it would write — *Each chapter (4 files)*.

**What it does.** Runs the export once per chapter and saves each one as its own file, so a long sectioned recording becomes a series of videos in a single pass instead of one custom range typed and named by hand per chapter.

**Details.** The chapters are the same ones [Copy chapter list](#copying-a-chapter-list) writes: each one runs from its marker up to the next, the last reaches the end of the project, and when no marker sits at the very start a leading **Intro** chapter covers the span before the first one. Each file is named `NN Name` — the chapter's number, zero-padded so a folder sorts in order, then the marker's name with any character a filesystem would reject replaced by a space. A chapter whose name survives none of that keeps the number alone. Every file uses the format and output settings chosen in the dialog, exactly as a single export would.

**Each chapter always covers the whole project**, so it cannot be combined with a marked or typed range — the Range options are a choice of one. While the run is going the dialog says which chapter is recording and how many there are, *Chapter 3 of 7: Installing the CLI*, and the progress bar shows that one file.

**Your browser may ask to allow several downloads.** That is worth knowing before you start: a browser that asks and is refused can quietly drop every file after the first. When the run finishes the dialog stays open and lists what it wrote — each chapter's number, name, filename and length — so you can check the list against your downloads folder rather than discovering a missing chapter later. **Cancel** stops the run; files already saved stay saved.

**Related.** [The Range line](#the-range-line) · [Copying a chapter list](#copying-a-chapter-list) · [Chapter markers](preview-and-playback.md#chapter-markers)

## Copying a chapter list

**Where to find it.** The dialog's **Range** group, below the range options: **Copy chapter list**.

**What it does.** Puts the [chapter markers](preview-and-playback.md#chapter-markers) inside the exported span on the clipboard, as the plain-text `mm:ss Name` list YouTube and most players read — ready to paste into a video's description.

**Details.** The times are **offset to the span's start**, so a partial export gets a correct list: with the range set to 1:00–1:45, a marker at 1:30 is written `00:30`. Markers outside the span are left out, including any sitting past the end of the sequence. Players only recognise a list that begins at the very start, so when no marker sits there a first line **00:00 Intro** is added for you; the note beside the button says so. Once any line reaches an hour every line grows an hours field (`h:mm:ss`), so the times stay a column. Two markers in the same second get a line each, in their timeline order.

The times are rounded **down**, so a chapter never starts after the moment you marked — which is why a marker the timeline labels *0:03* can appear as `00:02`. The button is disabled, and says why, while the exported span holds no markers. If the browser refuses the clipboard, the list appears in a read-only field below the button instead of the copy failing silently.

**Related.** [The Range line](#the-range-line) · [Exporting each chapter as its own file](#exporting-each-chapter-as-its-own-file) · [Chapter markers](preview-and-playback.md#chapter-markers)

## Audio only: WebM/Opus and MP3

**Where to find it.** **Format** › **Audio only (WebM/Opus)** or **Audio only (MP3)**.

**What it does.** Saves just the project's mixed soundtrack — the same mix a video export records, with no video track.

**Details.** Selecting either hides the Output group; the Range line still applies. The mix is the one the preview plays — every volume, mute, fade and duck — so the file sounds like the preview did. **WebM/Opus** is recorded by the browser's own recorder, like the video formats. **MP3** is encoded in the page at {{MP3_KBPS}} kbps by an encoder the app downloads the first time an MP3 export runs, so it costs nothing until then and works wherever the browser's audio engine does — including browsers whose recorder cannot produce MP3, which is all of them. An audio-only export needs the browser's audio engine; where it is unavailable the export refuses rather than producing a silent file.

**Related.** [Formats and what decides them](#formats-and-what-decides-them)

## Animated GIF (plugin)

**Where to find it.** **Format** › **Animated GIF**, once **File ▾** › **Plugins…** › *GIF export* is enabled.

**What it does.** Encodes the composed timeline — transitions, zooms, overlays and text included — as a soundless animated GIF.

**Details.** The GIF samples at {{GIF_FPS}} fps and is scaled down so its longer side is at most {{GIF_MAX_PX}} px, whatever size the Output group asks for — the composition is drawn at the requested size and then shrunk, so nothing is misplaced — and each frame gets its own 256-colour palette. The note under the Format group states these limits. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [GIF export](plugins.md#gif-export) · [Plugins](plugins.md)

## What can stop an export

**Where to find it.** The disabled Export button and its reason, or a message in the dialog after Export is pressed.

**What it does.** Says why an export did not start, or why the browser could not finish it.

**Details.** Before an export starts, **Export** is disabled while the timeline is empty, while a typed width, height or frame rate is out of bounds — *Width and height must be whole numbers between {{MIN_EXPORT_DIMENSION}} and {{MAX_EXPORT_DIMENSION}}…* — or while a custom range does not parse. Once it runs, the browser can refuse, and the dialog shows the reason:

- *This browser does not support recording video (MediaRecorder)* or *This browser cannot encode … video* — the format is not one this browser can record; pick another.
- *This browser cannot render color adjustments when exporting (canvas filters are unsupported)* — the timeline carries a colour adjustment and this browser's canvas cannot apply it; the export refuses rather than silently exporting the picture unadjusted. Reset the colour adjustments or export from another browser. Saving a frame refuses in the same case.
- *An audio-only export requires captured audio* — the browser's audio engine is unavailable, so there is no mix to record.
- *This browser cannot draw canvas graphics* or *cannot capture canvas video* — the browser lacks the canvas features every video export composes through.

A project file that names a plugin this browser has disabled is refused at *open* time instead, with an offer to enable the plugin; see [A file that needs plugins](projects.md#a-file-that-needs-plugins).

**Related.** [Troubleshooting](troubleshooting.md#an-export-is-refused) · [Colour adjustments](editing-video.md#colour-adjustments)
