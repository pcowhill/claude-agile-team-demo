# Recording

Record straight into the media library — a voice-over from the [microphone](#microphone), the [screen](#screen), the [webcam](#webcam), or [screen and camera together](#screen-camera) — and the result is an ordinary clip: placeable, trimmable, mixable and exportable like any imported file, and kept by the autosave. Everything starts from the [Record ▾](#record) menu, runs in the [recording dialog](#the-recording-dialog) after a short [countdown](#the-countdown), can be [paused and resumed](#pause-and-resume) into one clip, and [lands in the library](#where-recordings-land) under a numbered name. Read [Permissions and failures](#permissions-and-failures) if a source is missing or a recording did not start, and [Recordings and project files](#recordings-and-project-files) before saving a project with references only.

## Record ▾

**Where to find it.** Media library › **Record ▾**, beside Import clips.

**What it does.** Lists the sources this browser can record — **Microphone**, **Screen**, **Webcam** and **Screen + camera** — and starts a capture when one is chosen.

**Details.** Each source appears only where the browser can provide it. Microphone and Webcam need the browser's media-capture and recording support; Screen needs screen capture as well, which most mobile browsers and any page not served securely lack; Screen + camera needs both. Where neither the microphone nor the screen can be captured the whole menu is hidden rather than shown disabled. The menu is a normal menu-button: it opens on click or ArrowDown, the arrows move, Enter chooses and Escape closes.

**Related.** [The recording dialog](#the-recording-dialog) · [Permissions and failures](#permissions-and-failures)

## Microphone

**Where to find it.** Record ▾ › **Microphone**.

**What it does.** Records a voice-over from the microphone into an audio clip.

**Details.** The browser asks for permission to use the microphone the first time. The dialog shows the elapsed time and no live view, since there is nothing to see. Stopping adds the clip as *Voice-over 1*, *Voice-over 2*, … — an audio clip like an imported one, so it can be placed as an audio track, trimmed, faded and made to duck the rest of the mix.

**Related.** [Where recordings land](#where-recordings-land)

## Screen

**Where to find it.** Record ▾ › **Screen**.

**What it does.** Records a tab, a window or the whole display into a video clip.

**Details.** The browser shows its own picker for what to share. Audio is requested along with the picture: when the browser grants tab or system audio it records with the video, and when it grants none the clip is video-only. The dialog shows what is being captured, muted, so the captured sound never feeds back. The browser's own *stop sharing* control ends the recording exactly as the dialog's Stop button does. The clip lands as *Screen recording 1*, *Screen recording 2*, …, ready to [trim](editing-video.md#trimming), overlay, [transition](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) and [export](export.md).

**Related.** [Screen + camera](#screen-camera) · [Keyframes every second](#keyframes-every-second)

## Webcam

**Where to find it.** Record ▾ › **Webcam**.

**What it does.** Records the camera with the microphone into a video clip — the material for a picture-in-picture commentary bubble.

**Details.** The browser asks for the camera and microphone together. A camera without a microphone still records, video-only: the missing device costs the sound, never the recording. A refused camera fails the recording, and the reason is listed under the library. The dialog shows a live self-view, muted. The clip lands as *Webcam recording 1*, *Webcam recording 2*, ….

**Related.** [Screen + camera](#screen-camera)

## Screen + camera

**Where to find it.** Record ▾ › **Screen + camera**.

**What it does.** Records the screen and the camera at once, from one gesture, and places the take on the timeline: the screen clip in the sequence with the camera clip as a corner overlay.

**Details.** The screen picker comes first, then the camera. If either is refused — the picker dismissed, the camera denied — the whole start is cancelled and nothing is recorded, so there is never a half-take or a live capture nobody sees. Both captures start back to back from that one gesture, which keeps them aligned. The audio routing is fixed: the microphone records with the camera clip, and whatever tab or system audio the browser grants stays with the screen clip, so two microphones are never captured. The dialog shows both live views and says as much.

Stopping — the Stop button or the browser's *stop sharing* — delivers two clips to the library, *Screen recording N* and *Webcam recording N*, and places them as one step: the screen clip appended to the sequence, the camera clip as an overlay layer in the bottom-right corner ({{DEFAULT_OVERLAY_SIZE_PERCENT}} % of the frame) starting alongside it. Both are ordinary elements — reposition, resize, mask or mute the bubble, trim either — never a baked composite, and one Undo takes both placements off the timeline while both clips stay in the library.

**Related.** [Screen](#screen) · [Webcam](#webcam) · [Add as overlay](media-library.md#the-menu)

## The recording dialog

**Where to find it.** Opens the moment a capture starts; it is a modal, so the editor waits until you stop or cancel.

**What it does.** Shows the capture while it runs and offers the two ways to end it.

**Details.** The heading names what is recording — *Recording voice-over*, *Recording screen*, *Recording webcam*, *Recording screen + camera*. A video source shows a live, muted view of the capture; the paired take shows the screen and the camera self-view. Beneath, the dialog first [counts down](#the-countdown), then a recording indicator and the **recorded time** count up — the time that will be in the clip, so a [pause](#pause-and-resume) does not add to it. **Pause recording** and **Resume recording** sit beside **Stop recording**, which ends the capture and hands the clip to the library through the same path an imported file takes. **Cancel** discards the capture entirely — nothing reaches the library and the microphone, camera or shared surface is released. Closing the page mid-recording discards it too.

**Related.** [Record ▾](#record) · [The countdown](#the-countdown) · [Pause and resume](#pause-and-resume) · [Where recordings land](#where-recordings-land)

## The countdown

**Where to find it.** The recording dialog, the moment the sources are granted.

**What it does.** Counts **3 · 2 · 1** before the recorder starts, so a take never begins with your hand still on the mouse or the permission prompt still on screen.

**Details.** The countdown lasts {{RECORDING_COUNTDOWN_SECONDS}} s and each number is announced for screen readers. The live view is already showing, but nothing is recorded until it reaches zero — the clip starts clean. **Start now** skips the rest of the count and begins at once; **Cancel** during the count releases the microphone, camera or shared surface and records nothing, with no entry in the failure list. For a screen or screen + camera take, the browser's own *stop sharing* during the count cancels the same way. Turn the countdown off for good in [Settings › Countdown before recording](settings.md#countdown-before-recording); the dialog then starts recording the moment the sources are granted, as it did before there was a countdown.

**Related.** [The recording dialog](#the-recording-dialog) · [Countdown before recording](settings.md#countdown-before-recording)

## Pause and resume

**Where to find it.** The recording dialog: **Pause recording**, which becomes **Resume recording** while paused. **Space** does the same while the dialog is open.

**What it does.** Pauses the capture and carries on later **into the same clip**: the paused stretch is simply absent from the recording, so a thought, a notification or a look-up never has to be cut out afterwards.

**Details.** While paused the indicator stops pulsing, the status reads *Paused*, the live view stays and the recorded time stands still; on Resume it counts on from where it stopped. The clip that lands is one continuous file whose length is the recorded time, not the time the dialog was open. **Stop recording** works while paused too. A screen + camera take pauses and resumes both recorders together on the one button, so the two clips stay aligned. Space is the dialog's own shortcut, not the transport's: it toggles Pause / Resume wherever the focus is inside the dialog — even on Stop or Cancel, which Space never activates there; Enter does — and it does nothing during the countdown. The button appears only where the browser's recorder can pause, which every browser that can record does.

**Related.** [The recording dialog](#the-recording-dialog) · [Split at playhead](editing-video.md#split-at-playhead)

**Shortcuts.** Space, while the recording dialog is open.

## Permissions and failures

**Where to find it.** The browser's own permission prompts, and the library's failure list.

**What it does.** Explains what is asked for, and where a recording that did not start is reported.

**Details.** The microphone and the camera each need permission the first time; the screen needs the picker's choice every time. A refusal, a missing device, a dismissed picker or a recorder the browser could not start does not crash anything: the recording does not begin, and a line naming the source — *Microphone recording failed: …*, *Screen recording failed: …*, *Webcam recording failed: …*, *Screen + camera recording failed: …* — with the browser's reason joins the library's failure list, exactly like a file that could not be imported. **Dismiss** clears it. A source the browser cannot provide at all is simply not offered in the menu.

**Related.** [The failure list](media-library.md#the-failure-list) · [Record ▾](#record)

## Where recordings land

**Where to find it.** The media library, at the end of the list.

**What it does.** Names each recording by its kind and a number, and imports it like a picked file.

**Details.** The names are *Voice-over N*, *Screen recording N* and *Webcam recording N*, where N is one more than the highest number already used under that name in the library — so removing an old recording never reissues its name to a new one. The file extension follows the container the browser recorded to (`webm` where the browser prefers it; `m4a` or `ogg` for audio and `mp4` for video where it does not). A recording is probed for its duration like any import, so a recording the browser cannot read back is reported in the failure list rather than added.

**Related.** [Importing clips](media-library.md#importing-clips)

## Keyframes every second

**Where to find it.** Nothing to operate; a property of every video recording.

**What it does.** Keeps seeking inside a recording quick.

**Details.** Video recordings ask the browser to place a keyframe every {{RECORDING_KEYFRAME_INTERVAL_SECONDS}} s. Seeking to any instant in a recording — the preview, the visual editors' scrub and loop, Save frame — then decodes at most a second of footage instead of everything since the recording began, which is what made long recordings slow to scrub. The file grows by the extra keyframes; browsers that do not offer the option record as they did before. Audio-only captures have no keyframes and are unaffected.

**Related.** [Screen](#screen) · [Webcam](#webcam)

## Recordings and project files

**Where to find it.** The *Save project* dialog's choice between embedding media and storing references.

**What it does.** Says which kind of project file can bring a recording back.

**Details.** A recording exists only in the browser: there is no file on disk to re-select. A project saved with **references only** therefore cannot re-link a recording when it is reopened. Save with **embedded media** to carry recordings across machines and sessions; the autosave keeps them within this browser either way, until the media outgrows browser storage.

**Related.** [Embedded media or references only](projects.md#embedded-media-or-references-only) · [Autosave and Restore last session](projects.md#autosave-and-restore-last-session)
