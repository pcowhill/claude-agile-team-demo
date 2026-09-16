# Audio

Everything the video sounds like: the sequence's own sound, [audio tracks](#audio-tracks) placed beside it, each source's [volume and mute](#volume-and-mute) and [fades](#fade-in-and-fade-out), one track [ducking the rest](#duck-others) to [its duck level](#the-duck-level), [extracting a video's sound](#extract-audio) into a clip of its own, and the [one mix](#one-mix-for-preview-and-export) the preview plays and the export records. The [waveforms](#waveforms) on the timeline's bars show where the sound is. Recording a voice-over is on [Recording](recording.md#microphone); the export's two audio-only formats are on the Export page.

## Audio tracks

**Where to find it.** The **Audio** section of the timeline. A track is made by adding an audio clip from the library — its **Add** button, or the selection bar's *Add to timeline*.

**What it does.** Plays a sound clip at a start time of your choosing, mixed with the sequence's own sound.

**Details.** A track's row has **Starts at** — the second of the video it begins — and **In** and **Out**, its trim in seconds into the clip, then its [audio fields](#volume-and-mute). Tracks overlap freely and are independent of the sequence's cuts: moving an entry never moves a track. Anything past the end of the sequence is cut off there, like every element. A track's ⋯ menu offers Duplicate (the copy starts where the original ends), Copy settings and Paste settings (the *Audio* group), and Rename….

**Related.** [The four sections](timeline.md#the-four-sections) · [Trimming](editing-video.md#trimming) · [Time on the timeline](concepts.md#time-on-the-timeline)

## Volume and mute

**Where to find it.** The expanded row › **Volume**, and **Mute** beside it on video entries and video overlays.

**What it does.** Sets how loud each sound source plays, from silent to full.

**Details.** **Volume** is a fraction from 0 to 1 on audio tracks, video entries and video overlays. Video entries and video overlays also have **Mute**, which silences them whatever the volume says — mute wins over everything. An audio track has no Mute; set its volume to 0 or take it off the timeline. A still image, a slate and an image overlay have no sound and no audio fields. Each commit is one undo step, and the slider beside the field commits once on release. Through a transition, the outgoing entry's sound fades out as the incoming entry's fades in, whatever the transition's picture does.

**Related.** [The slider beside each number](editing-video.md#the-slider-beside-each-number) · [Copy settings and Paste settings](timeline.md#copy-settings-and-paste-settings)

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

## Extract audio

**Where to find it.** Media library › a video clip's **⋯** › **Extract audio**.

**What it does.** Makes a new audio clip from the video's sound, so the sound can be placed as an audio track on its own — trimmed, faded and ducked independently of the picture.

**Details.** The new clip is named after the video with *(audio)* appended, and it is the same imported bytes played as sound — no re-encoding, no loss, and no wait. Its lifetime is its own: removing the video from the library leaves the extracted clip working. In a project saved with references only, the extracted clip re-links from the original video file, since it has no file of its own on disk. A failure is reported in the library's failure list.

**Related.** [The ⋯ menu](media-library.md#the-menu) · [Open Project… and re-linking media](projects.md#open-project-and-re-linking-media)

## One mix for preview and export

**Where to find it.** Nothing to operate; a property of every export.

**What it does.** Guarantees that what the preview plays is what the exported file contains.

**Details.** One rule composes every source's volume, mute, fades, transition crossfade and ducking into the gain it plays at, and both the preview and the export read that rule — so the two cannot drift. Every export carries the mix: the video formats record it with the picture, and the two *Audio only* formats — WebM/Opus and MP3 — record the mix alone. A soundless element — a still, a slate, an image overlay, or a clip whose sound the browser cannot decode — adds nothing to the mix.

**Related.** [Volume and mute](#volume-and-mute) · [The output frame](concepts.md#the-output-frame)

## Waveforms

**Where to find it.** The coverage bar under each sound-bearing row.

**What it does.** Draws the clip's loudness along the bar, so a beat, a pause or a sentence can be found by eye.

**Details.** Audio tracks, video entries and video overlays draw their clip's amplitude across the bar's span; a still, a slate, an image overlay and a clip whose sound cannot be decoded keep the plain bar. The waveform follows the trim, is drawn from the media in this session, and is never stored in a project file.

**Related.** [A row](timeline.md#a-row) · [Extract audio](#extract-audio)
