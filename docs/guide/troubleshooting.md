# Troubleshooting

When something is not where the guide says, or the browser will not do what you asked: [browser support and feature detection](#browser-support-and-feature-detection), [permission prompts](#permission-prompts), [large media and browser storage](#large-media-and-browser-storage), [an export that is refused](#an-export-is-refused), [a recording that will not re-link](#a-recording-will-not-re-link), and [a control that is missing](#a-control-is-missing). The editor runs entirely in the browser — nothing is uploaded, and nothing happens on a server — so what the browser can do is what the editor can do.

## Browser support and feature detection

**Where to find it.** Nothing to operate; why a control may be absent in one browser and present in another.

**What it does.** Offers only what the running browser can do, and hides the rest rather than showing a control that would fail.

**Details.** A recent Chromium browser, Firefox or Safari runs the editor. What differs between them is detected, not assumed:

- **Recording** needs the browser's media capture and recorder. Where either is missing — and on a page not served securely, where browsers hide media capture altogether — the **Record ▾** menu is absent. The **Screen** and **Screen + camera** sources need screen capture as well, which most mobile browsers lack; they are left out of the menu while Microphone and Webcam stay.
- **Export formats** are whatever the browser's recorder can encode: Firefox offers WebM alone, and MP4 needs a recent Chromium or Safari. **Audio only (MP3)** is encoded in the page and needs only the browser's audio engine. **Animated GIF** needs its plugin enabled.
- **Colour adjustments** render live in every browser's preview, but exporting or saving a frame from an adjusted timeline needs the browser's canvas to apply filters; a browser without them refuses that export rather than producing an unadjusted file (below).
- **Sound in exports, and the waveforms**, need the browser's audio engine. Without it, video exports run without sound, audio-only exports refuse, and the coverage bars stay plain; the preview still plays.
- **Browser storage** holds Settings, the enabled plugins, the library's view, the preview's size and the autosave. A browser that blocks it — a private window, a strict setting — uses the defaults and keeps no autosave, and says so under the header when it matters.

**Related.** [Record ▾](recording.md#record) · [Formats and what decides them](export.md#formats-and-what-decides-them)

## Permission prompts

**Where to find it.** The browser's own prompts, and the library's failure list.

**What it does.** Explains what the editor asks the browser for, and what a refusal does.

**Details.** The **microphone** and the **camera** each need your permission the first time a recording source uses them; the browser remembers the answer per site. The **screen** needs the browser's picker every time, and there is no remembered permission — you choose what to share. A refusal, a dismissed picker or a missing device never breaks anything: the recording does not begin, and a line naming the source — *Microphone recording failed: …*, *Screen recording failed: …* — joins the library's failure list with the browser's reason, exactly like a file that could not be imported. **Screen + camera** cancels the whole start if either the picker or the camera is refused, so a half-take is never recorded. A permission once denied is re-allowed in the browser's own site settings, not in the editor.

**Related.** [Permissions and failures](recording.md#permissions-and-failures) · [The failure list](media-library.md#the-failure-list)

## Large media and browser storage

**Where to find it.** The two autosave notes under the header, and the size of a project file.

**What it does.** Says what happens when the media outgrows what the browser will hold.

**Details.** The autosave keeps each clip's media in the browser's storage once, so a session with a lot of footage can outgrow the browser's quota. When it does, the note *Autosave: the media no longer fits in browser storage, so only the project structure is being kept* appears; the arrangement is still protected, and restoring it asks for the media files again through the re-link dialog. *Autosave is currently unavailable* means the browser would not store even the structure — save your project to a file to keep it safe. A project file with **embedded media** is about the size of the media plus a little; where that is too large to pass around, **references only** writes a small file and re-links the originals on open — except recordings, which exist only in the browser (below). Nothing is uploaded anywhere: the only limits are this browser's and this disk's.

**Related.** [Autosave and Restore last session](projects.md#autosave-and-restore-last-session) · [Embedded media or references only](projects.md#embedded-media-or-references-only)

## An export is refused

**Where to find it.** The message in the export dialog, or under the preview after *Save frame as PNG…*.

**What it does.** Names what the browser could not do, so the fix is clear.

**Details.**

- *This browser does not support recording video (MediaRecorder)* or *This browser cannot encode … video* — pick a format the Format group offers in this browser, or export from another browser.
- *This browser cannot render color adjustments when exporting (canvas filters are unsupported)* — this browser's canvas cannot apply the colour adjustments the timeline carries, and the editor will not export the picture unadjusted. Reset the colour adjustments (each row's Picture ▸ › Color › Reset), or export from a browser whose canvas can. Saving a frame refuses with the matching message.
- *An audio-only export requires captured audio* — the browser's audio engine is unavailable, so there is no mix to record; a video format still exports, silent.
- *This browser cannot draw canvas graphics* or *cannot capture canvas video* — the browser lacks the features every video export composes through.
- The **Export** button is disabled — the timeline is empty, a typed size or frame rate is out of bounds, or a custom range does not parse; the dialog says which.

**Related.** [What can stop an export](export.md#what-can-stop-an-export) · [Colour adjustments](editing-video.md#colour-adjustments)

## A recording will not re-link

**Where to find it.** The re-link dialog when a references-only project is opened.

**What it does.** Explains why a recording shows as *Missing* with no file to choose.

**Details.** A recording exists only in the browser — it was never a file on disk — so a project saved with **references only** has nothing to re-link it from. Save with **embedded media** to carry recordings across machines and sessions; the autosave keeps them within this browser either way, until the media outgrows browser storage.

**Related.** [Recordings and project files](recording.md#recordings-and-project-files) · [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media)

## A control is missing

**Where to find it.** Wherever the guide says a control is and you do not see it.

**What it does.** Lists the controls that appear only under a condition, and the condition.

**Details.**

- **Adjust visually…** buttons — hidden when Settings › *Visual editors* is Off.
- **Animated GIF** in the export dialog, and the seven **shaped wipe** transitions — their plugin is disabled; enable it in File ▾ › Plugins…. A shaped wipe already on the timeline shows as *unavailable* in the type menu meanwhile.
- **Record ▾**, or its **Screen** sources — the browser cannot capture; see above.
- **Marked range** in the export dialog — the preview's in and out marks do not form a range; set both, in before out.
- **Sort by** in the library's View ▾ — it appears only with more than one clip.
- The **Subtitle style** disclosure — it appears once the timeline holds any text overlay.
- **Paste settings** in a row's ⋯ menu — nothing has been copied yet; **Rename…** — text overlays are named by their content and have none.
- **Export Project…** and File ▾ › Export ▸ — disabled while the timeline is empty.
- The **Restore last session?** bar — no snapshot was found, or Settings › *When a previous session is found* is not *Ask each time*.

**Related.** [Settings](settings.md) · [The plugin manager](plugins.md#the-plugin-manager)
