# Export

Turning the arrangement into a file: [opening the export dialog](#opening-the-export-dialog), the [formats](#formats-and-what-decides-them) and what decides which are offered, the [output settings](#output-settings) and their presets, the [Size limit](#the-size-limit), [the Range line](#the-range-line), the two [Audio only](#audio-only-webm-opus-and-mp3) formats, [Animated GIF](#animated-gif-plugin), [Animated WebP](#animated-webp-plugin), [Animated PNG](#animated-png-plugin), the [PNG image sequence](#png-image-sequence-plugin) and [WAV audio](#wav-audio-plugin) through their plugins, and [what can stop an export](#what-can-stop-an-export). The exported file carries the preview's mix, and draws every frame through the same rule the preview uses — see [The output frame](concepts.md#the-output-frame). A single frame is saved from the preview's **Frame ▾** › **Save frame as PNG…** instead.

## Opening the export dialog

**Where to find it.** The header's **Export Project…** button, or **File ▾** › **Export ▸** › a format.

**What it does.** Opens the *Export project* dialog — on the format Settings chose, or on the one picked from the submenu — and runs the export from there.

**Details.** Both are disabled while the timeline is empty; the button says so on hover (*Add clips to the timeline to export your edit*). The dialog opens on the format from **Settings** › *Default export format* ({{DEFAULT_EXPORT_FORMAT}} unless changed), falling back to a format this browser offers when that one is not available; the **Export ▸** submenu lists every offered format and opens the dialog on the one you pick. **Export** starts it; **Cancel** closes the dialog or stops a running export. An export runs in real time — the dialog says so: a 30-second sequence takes about 30 seconds — with a progress bar and percentage, and the file downloads as *sequence-export* with the format's extension when it finishes. Recording begins once the browser's sound is actually playing, which is normally at once; a sound output that is slow to start holds the bar at 0% until it plays, so the file's sound still lines up with its picture. If the browser's sound cannot start, as on a machine with no sound device or with its sound service stopped, the bar holds at 0% for up to {{AUDIO_START_TIMEOUT_SECONDS}} seconds while the editor waits for it. A video export then runs without sound, and an audio-only one refuses (below). The editor's keys are inert while the dialog is open.

**Related.** [Export](quick-start.md#7-export) · [Default export format](settings.md#default-export-format)

## Formats and what decides them

**Where to find it.** The dialog's **Format** group.

**What it does.** Lists the formats this browser can produce, and shows the selected format's note beneath them.

**Details.** The list is decided by the browser, not the app. **WebM** and **MP4** record through the browser's own recorder, so each appears only where the browser can encode it — Firefox offers WebM alone, and MP4 needs a recent Chromium or Safari. **Audio only (WebM/Opus)** records the same way; **Audio only (MP3)** encodes in the page and needs only the browser's audio engine, so it is offered wherever sound plays at all. **Animated GIF** appears while the GIF export plugin is enabled, and **Animated WebP**, **Animated PNG (APNG)**, **PNG image sequence (ZIP)** and **WAV audio (uncompressed)** while the More export formats plugin is. WebM is listed first and is the fallback when a preferred format is missing. A format with a stated limit — an animation's frame rate and size, an audio-only format's *no video track* — shows it right under the group.

**Related.** [Audio only](#audio-only-webm-opus-and-mp3) · [Animated GIF](#animated-gif-plugin) · [Animated WebP](#animated-webp-plugin) · [Animated PNG](#animated-png-plugin) · [PNG image sequence](#png-image-sequence-plugin) · [WAV audio](#wav-audio-plugin) · [Plugins](plugins.md) · [Browser support](troubleshooting.md#browser-support-and-feature-detection)

## Output settings

**Where to find it.** The dialog's **Output** group: a size drop-down, **Width**, **Height** and **Frame rate**, and below them the [Size limit](#the-size-limit).

**What it does.** Sets the exported picture's size and frame rate for this one export.

**Details.** The drop-down opens on **Auto (match sources)** — the frame follows the sources composed with the canvas preset, exactly as the preview shows, and the fields display the size that yields. The presets — {{EXPORT_SIZE_PRESETS}} — fill the fields with a common output size, and **Custom** is what typing into a field switches to. Each field shows its unit inside the box, after the number: **px** for width and height, **fps** for the frame rate. Width and height are whole pixels from {{MIN_EXPORT_DIMENSION}} to {{MAX_EXPORT_DIMENSION}}; the frame rate is {{EXPORT_FRAME_RATE}} fps unless you set another, up to {{MAX_EXPORT_FRAME_RATE}}. A value outside those bounds shows a message and disables Export until it is fixed. Whatever you choose here applies to this export only — the next time the dialog opens it is back on Auto — and an audio-only format hides the size and frame-rate fields, since it records no picture. The picture is composed at the requested size, not scaled after the fact, so overlays, shapes, text and zooms keep their proportions.

**Related.** [The output frame](concepts.md#the-output-frame) · [Canvas](timeline.md#the-header) · [The Size limit](#the-size-limit)

## The Size limit

**Where to find it.** The dialog's **Output** group › **Size limit**: **No limit**, **10 MB**, **25 MB**, **100 MB** or **Custom…**, which takes a number of MB.

**What it does.** Aims the exported file under a size you choose — e-mail, chat and course platforms cap uploads, often at about 25 MB — by telling the browser's recorder how many bits a second to spend.

**Details.** The rate is the limit, less a {{SIZE_LIMIT_MARGIN_PERCENT}} % safety margin, spread over the length of what you export: the whole project, or the range you chose, with speed segments, pauses and transitions counted as they play. When the export carries sound, {{RESERVED_AUDIO_KBPS}} kbit/s of it is kept for the sound and the picture gets the rest. **No limit** is where the dialog opens, and it leaves the rate to the browser, as before the limit existed; like the output settings, the limit applies to this export only.

- **The estimate.** As soon as a limit is chosen, a line under it says the rate it implies and what that means at the output size — *Aims at about 1.7 Mbit/s: fine for screen text at 1280×720*. Below about {{BLUR_BITS_PER_PIXEL}} bits per pixel per frame it warns instead — *text will be blurry at 1280×720; consider a larger limit or a smaller output size*. The dialog never changes the output size itself: a smaller frame, or a lower frame rate, is your call.
- **Aimed at, not guaranteed.** A browser's recorder treats the rate as a target and varies it as the picture changes, so a file can come out a little over. After a limited export the dialog stays open and states the file's actual size beside the limit, *Saved sequence-export.webm: 23.1 MB (limit 25 MB)*, or says plainly that it is over, giving both figures to as many decimals as it takes to tell them apart: *Saved sequence-export.webm: 0.78 MB — over the 0.76 MB limit*. With **No limit** the dialog closes on the download, as it always has.
- **Export again smaller.** When a file comes out over its limit, **Export again smaller** appears under its size, with the rate it will ask for. It runs the same export again — the same format, range, output settings and limit, even if you have changed the dialog's fields since — at a lower rate, worked out from how far over the file came: the rate is scaled by the limit divided by the actual size, and by the {{SIZE_LIMIT_MARGIN_PERCENT}} % margin again, so a file barely over is trimmed a little and one twice over is cut to under half. For a video export it is the picture's rate that drops; the sound keeps its {{RESERVED_AUDIO_KBPS}} kbit/s. The first file stays downloaded, and the second is a new download. If that one is still over, it is offered again. When the rate cannot go any lower, the dialog says so instead.
- **WebM picks the codec that holds the rate.** With a limit set, a WebM export records with VP8 rather than VP9: in Chromium, VP9's recorder came out at nearly twice a tight limit, where VP8 stayed under it. Without a limit WebM records as before, with VP9 where the browser has it, which makes the smaller file for the same picture.
- **Too small to export.** A limit that leaves the picture nothing once the sound has its share, or one too small for sound alone, says so and disables **Export**.
- **Each chapter.** With [Each chapter](#exporting-each-chapter-as-its-own-file), the limit applies to **every chapter file** on its own, sized by that chapter's length, because an upload cap is per file. The estimate reads the longest chapter, the one the limit squeezes hardest, and the finished list gives each file's size and says which are over; **Export again smaller** is offered for a single-file export only, so a chapter file that came out over is re-exported as a Custom range.
- **Which formats.** WebM, MP4 and **Audio only (WebM/Opus)** offer the limit; for the audio-only format the whole budget goes to the sound. **MP3** has its own fixed rate, **Animated GIF**, **Animated WebP** and **Animated PNG (APNG)** their own limits, and **PNG image sequence (ZIP)** and **WAV audio (uncompressed)** are lossless with no bitrate to aim at, so none of them shows the control.

**Related.** [Output settings](#output-settings) · [The Range line](#the-range-line) · [Audio only: WebM/Opus and MP3](#audio-only-webm-opus-and-mp3)

## The Range line

**Where to find it.** The dialog's **Range** group.

**What it does.** Exports the whole project, the span between the preview's marks, or a span typed here.

**Details.** **Whole project** is every export's starting point. **Marked range** appears only while the preview's in and out marks form a range, and names it — *Marked range (0:04 – 0:12)*. **Custom range** takes a start and an end typed as `m:ss` or plain seconds — `1:30`, `90`, `0:08.5` and `h:mm:ss` are all read — and typing into either field selects it; the fields start out filled with the marks, or with the whole sequence. The end must lie within the sequence and the start before the end, or the dialog says what is wrong and disables Export. The range narrows every format alike, GIF and the audio-only ones included, and a boundary inside a transition or an effect exports exactly what the preview shows at that instant — mid-blend if that is where it falls, with no snapping.

**Related.** [Time on the timeline](concepts.md#time-on-the-timeline) · [Exporting each chapter as its own file](#exporting-each-chapter-as-its-own-file)

## Exporting each chapter as its own file

**Where to find it.** The dialog's **Range** group: **Each chapter**, which appears once the project has at least one [chapter marker](preview-and-playback.md#chapter-markers) and says how many files it would write — *Each chapter (4 files)*.

**What it does.** Runs the export once per chapter and saves each one as its own file, so a long sectioned recording becomes a series of videos in a single pass instead of one custom range typed and named by hand per chapter.

**Details.** The chapters are the same ones [Copy chapter list](#copying-a-chapter-list) writes: each one runs from its marker up to the next, the last reaches the end of the project, and when no marker sits at the very start a leading **Intro** chapter covers the span before the first one. Each file is named `NN Name` — the chapter's number, zero-padded so a folder sorts in order, then the marker's name with any character a filesystem would reject replaced by a space. A chapter whose name survives none of that keeps the number alone. Every file uses the format and output settings chosen in the dialog, exactly as a single export would; a [Size limit](#the-size-limit) applies to each file on its own.

**Each chapter always covers the whole project**, so it cannot be combined with a marked or typed range — the Range options are a choice of one. While the run is going the dialog says which chapter is recording and how many there are, *Chapter 3 of 7: Installing the CLI*, and the progress bar shows that one file.

**Your browser may ask to allow several downloads.** That is worth knowing before you start: a browser that asks and is refused can quietly drop every file after the first. When the run finishes the dialog stays open and lists what it wrote — each chapter's number, name, filename and length — so you can check the list against your downloads folder rather than discovering a missing chapter later. **Cancel** stops the run; files already saved stay saved.

**If a run stops early** — you pressed **Cancel**, or a chapter failed to export — the dialog stays open and says which chapter it stopped at and why, *Stopped at chapter 3 of 7: Installing the CLI — cancelled*, above the list of files it did write. **Resume from chapter N** carries on from that chapter with the format and output settings the run started with, whatever the dialog's controls have been set to since, and writes only the chapters still missing: files already saved are not written again, and the list grows to cover the whole set. Cancel during a resumed run stops it the same way, and you can resume again. The offer lasts as long as the dialog stays open; if the project changes underneath it — an undo, say — the dialog says so and withdraws it, and **Export** starts a fresh run from the project as it is now.

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

**Details.** Selecting either hides the Output group's size and frame-rate fields; the Range line still applies, and **WebM/Opus** keeps the [Size limit](#the-size-limit). The mix is the one the preview plays — every volume, mute, fade and duck — so the file sounds like the preview did (in Firefox, except a [Volume above 1](audio.md#volume-and-mute), which the export raises and the preview does not). **WebM/Opus** is recorded by the browser's own recorder, like the video formats. **MP3** is encoded in the page at {{MP3_KBPS}} kbps by an encoder the app downloads the first time an MP3 export runs, so it costs nothing until then and works wherever the browser's audio engine does — including browsers whose recorder cannot produce MP3, which is all of them. The MP3 holds exactly what you export, from its first instant to its last, so it lines up when laid back under the video in another editor. Like any MP3, it opens with the encoder's own delay of about 25 ms, which players and editors generally keep, and its last frame is padded out with silence. An audio-only export needs the browser's audio engine; where it is unavailable the export refuses rather than producing a silent file.

**Related.** [Formats and what decides them](#formats-and-what-decides-them) · [WAV audio](#wav-audio-plugin)

## Animated GIF (plugin)

**Where to find it.** **Format** › **Animated GIF**, once **File ▾** › **Plugins…** › *GIF export* is enabled.

**What it does.** Encodes the composed timeline — transitions, zooms, overlays, shapes and text included — as a soundless animated GIF.

**Details.** The GIF samples at {{GIF_FPS}} fps and is scaled down so its longer side is at most {{GIF_MAX_PX}} px, whatever size the Output group asks for — the composition is drawn at the requested size and then shrunk, so nothing is misplaced — and each frame gets its own 256-colour palette. The note under the Format group states these limits. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [GIF export](plugins.md#gif-export) · [Animated WebP](#animated-webp-plugin) · [Plugins](plugins.md)

## Animated WebP (plugin)

**Where to find it.** **Format** › **Animated WebP**, once **File ▾** › **Plugins…** › *More export formats* is enabled.

**What it does.** Encodes the composed timeline — transitions, zooms, overlays, shapes and text included — as a soundless, looping animated WebP in full colour.

**Details.** Like the GIF, the WebP samples at {{WEBP_FPS}} fps and is scaled down so its longer side is at most {{WEBP_MAX_PX}} px, whatever size the Output group asks for. Unlike the GIF, it keeps every colour, so gradients do not band and text in a screen recording stays clean, and it usually comes out smaller: about a quarter to two fifths smaller than the GIF of the same timeline, in the two clips measured when it was added. The note under the Format group states the limits. Every current browser plays an animated WebP. The format is offered only where the browser can encode WebP pictures, which current Chromium and Firefox can. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [More export formats](plugins.md#more-export-formats) · [Animated GIF](#animated-gif-plugin) · [Animated PNG](#animated-png-plugin) · [Plugins](plugins.md)

## Animated PNG (plugin)

**Where to find it.** **Format** › **Animated PNG (APNG)**, once **File ▾** › **Plugins…** › *More export formats* is enabled.

**What it does.** Encodes the composed timeline — transitions, zooms, overlays, shapes and text included — as a soundless, looping animated PNG, losslessly: every frame keeps exactly the pixels the preview composes.

**Details.** Like the GIF and the WebP, the APNG samples at {{APNG_FPS}} fps and is scaled down so its longer side is at most {{APNG_MAX_PX}} px, whatever size the Output group asks for, so switching between the three keeps the same animation. Being lossless, it is the largest of the three: about four times the GIF of the same timeline for moving video, and about three times for a still screenshot, in the two 5 s clips measured when it was added. Choose it where exact colours matter more than size, such as a short interface demonstration for documentation. The file is saved as `.png`: a viewer that shows PNG but not APNG still opens it, on its first frame. Current browsers play it. The note under the Format group states the limits. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [More export formats](plugins.md#more-export-formats) · [Animated WebP](#animated-webp-plugin) · [Animated GIF](#animated-gif-plugin) · [PNG image sequence](#png-image-sequence-plugin) · [Plugins](plugins.md)

## PNG image sequence (plugin)

**Where to find it.** **Format** › **PNG image sequence (ZIP)**, once **File ▾** › **Plugins…** › *More export formats* is enabled.

**What it does.** Saves the composed timeline — transitions, zooms, overlays, shapes and text included — as one lossless PNG per frame, named in order from `frame-00001.png`, inside a single `.zip`. It is for handing frames to another tool, such as a compositor or an image-sequence importer.

**Details.** Unlike the animations, it has no rate or size of its own: it takes the Output group's **Frame rate** and **Frame size** as they are, so a 2 s range at 24 fps is 48 PNGs at the size shown. The export runs in real time. Where the editor could not compose a frame in time for one of the frame rate's ticks, that file repeats the frame before it, so the archive always holds one file per tick. It has no sound. The ZIP stores the PNGs without compressing them again, because a PNG is already compressed, and any unzip tool opens it. It is large: a 30 s export at 1920×1080 and 30 fps came to about 260 MB for a still screenshot and about 540 MB for fast-moving video, when the format was added. The browser holds the frames in memory until the file is saved; the moving one used about 2 GB more while it ran. A ZIP of this kind holds at most 65,535 files and 4 GB, and an export past either is refused with a message rather than saved broken. [The Range line](#the-range-line) narrows it like any format, which keeps a long timeline's sequence small. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [More export formats](plugins.md#more-export-formats) · [Animated PNG](#animated-png-plugin) · [Output settings](#output-settings) · [Plugins](plugins.md)

## WAV audio (plugin)

**Where to find it.** **Format** › **WAV audio (uncompressed)**, once **File ▾** › **Plugins…** › *More export formats* is enabled.

**What it does.** Saves just the project's mixed soundtrack as an uncompressed WAV file, 16-bit stereo, with no video track. It is for a podcast tool or an audio editor that wants lossless input.

**Details.** It takes its sound from the same place as [Audio only (MP3)](#audio-only-webm-opus-and-mp3), so the two files hold the same mix: every volume, mute, fade and duck, from the export's first instant to its last. A WAV has no encoder delay and no padding, so its length is the export's exactly. The sample rate is the mix's own, which is the browser's audio rate, usually 44.1 or 48 kHz; that makes about 10–11.5 MB per minute, as the note under the Format group says. Selecting it hides the Output group's size and frame-rate fields, as the other audio-only formats do. The Range line still applies, and there is no Size limit, because uncompressed audio has no bitrate to aim at. A WAV file holds at most 4 GB, which is about 6 h 12 min at 48 kHz, and a longer export is refused with a message before it starts. Like the other audio-only formats, it needs the browser's audio engine. The plugin's code downloads when the plugin is first enabled, not with the editor. Disabling the plugin removes the format from the list; an export already running finishes.

**Related.** [More export formats](plugins.md#more-export-formats) · [Audio only: WebM/Opus and MP3](#audio-only-webm-opus-and-mp3) · [Plugins](plugins.md)

## What can stop an export

**Where to find it.** The disabled Export button and its reason, or a message in the dialog after Export is pressed.

**What it does.** Says why an export did not start, or why the browser could not finish it.

**Details.** Before an export starts, **Export** is disabled while the timeline is empty, while a typed width, height or frame rate is out of bounds — *Width and height must be whole numbers between {{MIN_EXPORT_DIMENSION}} and {{MAX_EXPORT_DIMENSION}}…* — or while a custom range does not parse. Once it runs, the browser can refuse, and the dialog shows the reason:

- *This browser does not support recording video (MediaRecorder)* or *This browser cannot encode … video* — the format is not one this browser can record; pick another.
- *This browser cannot render color adjustments when exporting (canvas filters are unsupported)* — the timeline carries a colour adjustment and this browser's canvas cannot apply it; the export refuses rather than silently exporting the picture unadjusted. Reset the colour adjustments or export from another browser. Saving a frame refuses in the same case.
- *This browser cannot capture audio for an audio-only export* — the browser's audio engine is unavailable, or its sound output did not start within {{AUDIO_START_TIMEOUT_SECONDS}} seconds, so there is no mix to record.
- *This browser cannot draw canvas graphics* or *cannot capture canvas video* — the browser lacks the canvas features every video export composes through.

A project file that names a plugin this browser has disabled is refused at *open* time instead, with an offer to enable the plugin; see [A file that needs plugins](projects.md#a-file-that-needs-plugins).

**Related.** [Troubleshooting](troubleshooting.md#an-export-is-refused) · [Colour adjustments](editing-video.md#colour-adjustments)
