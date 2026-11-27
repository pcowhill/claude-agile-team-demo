# Audio

Everything the video sounds like: the sequence's own sound, [audio tracks](#audio-tracks) placed beside it, a track that runs past the video trimmed to [end with it](#end-with-video), each source's [volume and mute](#volume-and-mute) and [fades](#fade-in-and-fade-out), [matching every source's level](#match-levels) in one step, one track [ducking the rest](#duck-others) to [its duck level](#the-duck-level), a [volume change](#volume-change) turning a track, or a video's own sound, down or up for a stretch, [extracting a video's sound](#extract-audio) into a clip of its own, and the [one mix](#one-mix-for-preview-and-export) the preview plays and the export records. The [waveforms](#waveforms) on the timeline's bars show where the sound is. Recording a voice-over is on [Recording](recording.md#microphone); the export's two audio-only formats are on the [Export page](export.md#audio-only-webm-opus-and-mp3).

## Audio tracks

**Where to find it.** The **Audio** section of the timeline. A track is made by adding an audio clip from the library — its **Add** button, or the selection bar's *Add to timeline*.

**What it does.** Plays a sound clip at a start time of your choosing, mixed with the sequence's own sound.

**Details.** A track's row has **Starts at** — the second of the video it begins — and **In** and **Out**, its trim in seconds into the clip — **Trim…** beside them sets the two while you listen, in [the Trim window](editing-video.md#the-trim-window) with the track's waveform as its strip; **Cut…** after it removes a part from the middle of the track, marked on that waveform, and the later part closes up behind the earlier while everything else stays put ([Cut…](editing-video.md#cut)); and **Split…** splits the track into two that play on as one, at a moment picked on that waveform ([Split…](editing-video.md#split)) — then its [audio fields](#volume-and-mute). Tracks overlap freely and are independent of the sequence's cuts: moving an entry never moves a track. [Cut out marked range](editing-video.md#cut-out-marked-range) is the exception: it moves a track after the range earlier with the picture, and trims or removes one the range overlaps. Anything past the end of the sequence is cut off there, like every element. A track's ⋯ menu offers [End with video](#end-with-video), [Duplicate](timeline.md#duplicate) (the copy starts where the original ends), [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings) (the *Audio* group), [Rename…](timeline.md#rename), and **Remove**, as the row's ✕ does.

**Related.** [The five sections](timeline.md#the-five-sections) · [Trimming](editing-video.md#trimming) · [Time on the timeline](concepts.md#time-on-the-timeline) · [End with video](#end-with-video)

## End with video

**Where to find it.** An audio track's **⋯** menu › **End with video**, first in the menu.

**What it does.** Trims a song that runs past the end of the video so that it ends where the video ends, and fades it out, instead of being cut off at full volume on the last frame.

**Details.**

- **What it sets.** **Out** becomes the moment of the clip that plays as the video ends, so **Starts at** plus the trimmed length is the video's length. **Fade out** becomes {{END_WITH_VIDEO_FADE_OUT}} s, or stays as it is if it was already longer. **Fade in** and **Starts at** are left alone, and so is **In**.
- **The video's length** is what the preview and the export stop at: [transitions](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) overlap and shorten it, and [speed segments](editing-video.md#speed-segments-and-pauses) lengthen or shorten it.
- **A short track.** When **Fade in** and {{END_WITH_VIDEO_FADE_OUT}} s together are longer than what is left, **Fade in** keeps its value and **Fade out** takes the rest, as when you type the two yourself.
- **It acts once.** The track is not pinned to the end of the video. If the video gets longer or shorter afterwards, choose **End with video** again.
- **Greyed** when there is nothing to trim: the track already ends at or before the end of the video (an empty sequence included), or it starts at or after that end. A song shorter than the video is left as it is; nothing loops.
- **Other settings follow the trim.** It is a trim, so the track's [volume changes](#volume-change) are fitted to the new length as [Trimming](editing-video.md#trimming) fits them: one past the new end shrinks to nothing, without being removed. [Duck others](#duck-others) stays as it was and ducks for the track's new, shorter time.
- **Undo.** One undo step restores both the old **Out** and the old **Fade out**.

**Related.** [Audio tracks](#audio-tracks) · [Fade-in and fade-out](#fade-in-and-fade-out) · [Trimming](editing-video.md#trimming) · [The ⋯ menu](timeline.md#the-menu)

## Volume and mute

**Where to find it.** The expanded row › **Volume**, and **Mute** beside it on video entries and video overlays.

**What it does.** Sets how loud each sound source plays, from silent, through the source as recorded, to {{MAX_VOLUME}} times as loud.

**Details.** **Volume** is a number from 0 to {{MAX_VOLUME}} on audio tracks, video entries and video overlays: 0 is silent, **1 is the source as recorded**, 0.5 is half as loud and 2 twice as loud, up to {{MAX_VOLUME}} (+{{MAX_VOLUME_DB}} dB) for a recording made too quietly. The slider beside the field has a small mark at 1. Raising a source raises its hiss and room tone with it, and a Volume above 1 can push loud moments past full scale, where they clip — [Match levels](#match-levels) never does that. Above 1, the preview plays the sound through the browser's audio engine; in **Firefox** the preview plays a Volume above 1 at 1 (the export is still raised), because Firefox's audio engine cannot follow the preview's playback speed. Video entries and video overlays also have **Mute**, which silences them whatever the volume says — mute wins over everything. An audio track has no Mute; set its volume to 0 or take it off the timeline. A still image, a slate and an image overlay have no sound and no audio fields. Each commit is one undo step, and the slider beside the field commits once on release. [Match levels](#match-levels) sets every Volume at once, as one undo step for all of them. Through a transition, the outgoing entry's sound fades out as the incoming entry's fades in, whatever the transition's picture does.

**Related.** [The slider beside each number](editing-video.md#the-slider-beside-each-number) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings) · [Match levels](#match-levels)

## Match levels

**Where to find it.** **Match levels** in the [timeline's header](timeline.md#the-header); the level it aims for is Settings › [**Match levels target**](settings.md#match-levels-target).

**What it does.** Measures how loud every sound source on the timeline is, and sets each one's **Volume** so they all play at about the same level — for recordings made on different days, at different distances from the microphone.

**Details.**

- **What it covers.** Every video entry, video overlay and audio track, in every section, whether or not the Audio section is showing. A muted entry or overlay is left alone: you silenced it on purpose. A still image, a slate and an image overlay have no sound and are skipped.
- **What it measures** is the average level of the sound, **ignoring silences**: the pauses between sentences do not count as the speaker being quiet. Precisely, it is a level in dB of the sound's average power, taken in tenth-of-a-second blocks; blocks of near-silence are left out, and so are blocks more than {{MATCH_RELATIVE_GATE_DB}} dB below the rest, which is where room tone between sentences sits. Each element is measured on its **trim** — the part that plays — not on the whole clip, so a take trimmed to its quiet half is measured on that half.
- **What it sets.** Each element's Volume becomes the one that brings it to the target, worked out from the source itself, so what its Volume was before makes no difference. The new values are ordinary Volume fields: you can see them, change them, and **one Undo** puts every one of them back.
- **Down and up.** A louder element is turned down to the target; a quieter one is raised to it, by up to Volume {{MAX_VOLUME}} (+{{MAX_VOLUME_DB}} dB). One that would need more than that is set to {{MAX_VOLUME}} and named in the report as *below the target even at Volume {{MAX_VOLUME}}*.
- **Never into clipping.** An element is never set to a Volume at which its loudest moment would pass full scale, which matters most when raising; one that would is stopped short and named as *stopped short so its peaks do not clip*.
- **The report** appears under the timeline's header: how many elements were set to the target, and each one held back, by name, with the reason. An element whose sound could not be read — a video recorded with no sound, or a file this browser cannot decode — is named and left as it was, never guessed at. **✕** dismisses the report; the next Match levels replaces it.
- **Decoded once.** Each clip is read once, together with its [waveform](#waveforms); pressing Match levels again, after a trim or a change of target, measures from what was already read.

**Related.** [Volume and mute](#volume-and-mute) · [Settings › Match levels target](settings.md#match-levels-target) · [The header](timeline.md#the-header)

## Fade-in and fade-out

**Where to find it.** The expanded row › **Fade in** and **out**, on audio tracks, video entries and video overlays.

**What it does.** Ramps the source's sound from silence up to its volume over the first seconds it plays, and back down over the last.

**Details.** Both are in seconds, both start at zero, and the ramps are linear. They are measured in the video's own time within the element's window — the seconds you hear — so a speed segment never stretches or squeezes an audible ramp. Together they never exceed the window: the two ramps meet at full volume but never overlap. A fade that falls inside a transition rides the transition's own crossfade — the two multiply, so a fade-out over a crossfade ends earlier and softer, never later or louder. Preview and export draw the identical envelope.

**Related.** [Volume and mute](#volume-and-mute) · [Text: fade-in and fade-out](text-and-subtitles.md#fade-in-and-fade-out)

## Duck others

**Where to find it.** An expanded audio track's row › **Duck others**.

**What it does.** Lowers every other sound while this track plays — a voice-over over music, without riding the music's volume by hand.

**Details.** While a duck-enabled track audibly plays, every other sound source — the other audio tracks, the video entries' own sound, the overlays' sound — drops to the track's [duck level](#the-duck-level). The drop ramps down over {{DUCK_RAMP_SECONDS}} s just *before* the track's window and back up over the same time just *after* it, so the track's first audible instant is already clear of the others and the return is smooth. Brief gaps in the track — a pause in a voice-over shorter than the ramp — are merged, so the music does not pump back up between sentences. The ducking track is never itself ducked, and neither is any other duck-enabled track: two voices can duck the music without ducking each other. Where two ducking windows overlap and disagree, the deeper duck wins. A duck-enabled track that is silent — volume 0 — ducks nothing. The setting saves with the project, and the preview and the export apply the identical rule.

**Related.** [The duck level](#the-duck-level) · [Recording: Microphone](recording.md#microphone)

## The duck level

**Where to find it.** The field marked **to**, shown beside Duck others while it is on.

**What it does.** Sets how far the other sound drops while this track plays.

**Details.** A fraction of the others' own volume, from 0 (silence) to 1 (no drop); a new track ducks to {{DEFAULT_DUCK_LEVEL_PERCENT}} %. The level is per track — a narrator and a sound effect can each duck by a different amount — and each commit is one undo step. Turning Duck others off keeps the level for when it is turned on again.

**Related.** [Duck others](#duck-others)

## Volume change

**Where to find it.** An expanded audio track's row, an expanded video entry's in the sequence, or an expanded video overlay's › **+ Effect ▾** › **Volume change**. Each change then has a row of its own: on a track under its audio fields, on a video entry after its zoom, speed and picture-effect rows, and on a video overlay last, after its zoom, Move, speed and picture-effect rows. A still, a slate or an image overlay has no sound, so its menu does not offer it.

**What it does.** Turns a track, or a video's or a video overlay's own sound, down or up for a stretch of its time, with a smooth ramp either side. For example, background music drops while you talk over it and comes back afterwards, a mumbled line in a recording is lifted, or a loud notification chime is pulled down for a second, without splitting anything into pieces whose volumes jump.

**Details.**

- **The fields.** A change's row reads **Volume change 1 at**, **length** and **level**, then **✕**, which removes it.
  - **at** is when the change begins, in seconds into the track, the video entry or the video overlay. 0 is the first moment it plays, its **In**.
  - **length** is how long it lasts, in seconds.
  - **level** is the volume for that stretch, as a multiple of the track's, entry's or overlay's own [Volume](#volume-and-mute), in the same units. 0 is silent, 1 is unchanged, 0.2 is a fifth as loud, and the most is {{MAX_VOLUME}}. The slider beside it is the Volume field's, with its mark at 1.
- **The ramps.** The level holds from **at** to **at** + **length**. The sound slides to it over {{VOLUME_CHANGE_RAMP_SECONDS}} s just *before* the change and back over {{VOLUME_CHANGE_RAMP_SECONDS}} s just *after* it, as [Duck others](#duck-others) does. A change starting at 0 is at its level from the first moment, and one reaching the end stays there to the end. Two changes closer together than two ramps slide straight from one level to the next.
- **Adding one.** **Volume change** adds a {{DEFAULT_VOLUME_CHANGE_LENGTH}} s change at level {{DEFAULT_VOLUME_CHANGE_LEVEL}}, starting where the last change ends. It is greyed once there is no time left after the last change.
- **Several on one track, entry or overlay.** Changes are numbered in time order and never overlap. A change set to start inside an earlier one starts where that one ends. Lengthening a change into the next one pushes that one, and any after it, later instead, and a change pushed past the end shrinks to nothing without being removed. Undo brings it back. A start or a length past the end is pulled back to it, and the fields show where each change landed.
- **With the other settings.** The level multiplies with the Volume, the [fades](#fade-in-and-fade-out) and any [ducking](#duck-others), and on a video entry with a [transition](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom)'s sound crossfade. Level 0.5 under a duck to 0.3 plays at 0.15. A stretch is never louder than Volume {{MAX_VOLUME}} could make it, and a muted track, entry or overlay stays silent inside a change.
- **On a video entry or a video overlay, the time is the clip's own.** A change's seconds count the clip's sound from the entry's or overlay's **In**, as its zooms do. On an overlay this differs from its [Moves](editing-video.md#overlay-move) and [visual effects](editing-video.md#visual-effects-on-an-overlay), which count from when the overlay appears. A [speed segment](editing-video.md#speed-segments-and-pauses) before a change leaves it on the same sound, so it plays later or sooner in the video along with that sound. A speed segment over a change plays the change, ramps included, at that speed, as it plays the sound.
- **Undo.** Adding, editing a field and removing are one undo step each.
- **When the track, entry or overlay is edited.**
  - A change's time counts from the **In**. Moving a track or an overlay with **Starts at**, or an entry along the sequence, moves its changes with it. Changing **In** keeps each change the same time after the new In, as a zoom on a sequence entry does, so it lands on a different moment of the sound.
  - [Trimming](editing-video.md#trimming) shorter shrinks a change that no longer fits to nothing, without removing it. Undo brings it back. The [Trim window](editing-video.md#the-trim-window), on a track, a video entry or a video overlay, marks each change on its strip and says before you apply which ones the trim would shorten or remove.
  - [Split…](editing-video.md#split), and on a video entry [Split at playhead](editing-video.md#split-at-playhead), divide the changes between the two parts, and a change across the split point becomes one in each at the same level. A split less than {{VOLUME_CHANGE_RAMP_SECONDS}} s from a change's start or end cuts that change's ramp. The part on that side of the split plays at full volume up to the split point, rather than partway down the ramp.
  - [Cut…](editing-video.md#cut) and [Cut out marked range](editing-video.md#cut-out-marked-range) take a change, or the part of one, out with the sound they remove.
  - [Duplicate](timeline.md#duplicate) copies the changes.
  - [Copy settings](timeline.md#copy-settings-and-paste-settings) leaves them out, because they belong to that track's, entry's or overlay's timing.
- **Saving.** Volume changes save with the project. A project holding one opens only in a version of the editor that has them.

**Related.** [Volume and mute](#volume-and-mute) · [Duck others](#duck-others) · [Fade-in and fade-out](#fade-in-and-fade-out) · [+ Effect ▾](timeline.md#effect)

## Extract audio

**Where to find it.** Media library › a video clip's **⋯** › **Extract audio**.

**What it does.** Makes a new audio clip from the video's sound, so the sound can be placed as an audio track on its own — trimmed, faded and ducked independently of the picture.

**Details.** The new clip is named after the video with *(audio)* appended, and it is the same imported bytes played as sound — no re-encoding, no loss, and no wait. Its lifetime is its own: removing the video from the library leaves the extracted clip working. In a project saved with references only, the extracted clip re-links from the original video file, since it has no file of its own on disk. A failure is reported in the library's failure list. [Download](media-library.md#downloading-a-clip) saves the extracted clip as a WAV of its sound.

**Related.** [The ⋯ menu](media-library.md#the-menu) · [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media)

## One mix for preview and export

**Where to find it.** Nothing to operate; a property of every export.

**What it does.** Guarantees that what the preview plays is what the exported file contains.

**Details.** One rule composes every source's volume, mute, fades, transition crossfade and ducking, and a track's, video entry's or video overlay's [volume changes](#volume-change), into the gain it plays at, and both the preview and the export read that rule — so the two cannot drift. Every export carries the mix: the video formats record it with the picture, and the two [*Audio only* formats](export.md#audio-only-webm-opus-and-mp3) — WebM/Opus and MP3 — record the mix alone. A soundless element — a still, a slate, an image overlay, or a clip whose sound the browser cannot decode — adds nothing to the mix. One exception, in Firefox only: the preview plays a [Volume above 1](#volume-and-mute) at 1, while the export raises it as asked.

**Related.** [Volume and mute](#volume-and-mute) · [The output frame](concepts.md#the-output-frame)

## Waveforms

**Where to find it.** The coverage bar under each sound-bearing row.

**What it does.** Draws the clip's loudness along the bar, so a beat, a pause or a sentence can be found by eye.

**Details.** Audio tracks, video entries and video overlays draw their clip's amplitude across the bar's span; a still, a slate, an image overlay and a clip whose sound cannot be decoded keep the plain bar. The waveform follows the trim, is drawn from the media in this session, and is never stored in a project file.

**Related.** [A row](timeline.md#a-row) · [Extract audio](#extract-audio)
