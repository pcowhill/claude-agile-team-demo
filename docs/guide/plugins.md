# Plugins

**There is no importing of plugins.** Plugins here are optional features built into the editor, shipped with it and switched on from **File ▾** › **Plugins…** — nothing is downloaded from a third party, and no file is imported. Enabling one downloads that feature's own code, which the editor otherwise never loads. This page covers [what a plugin is here](#what-a-plugin-is-here) and why, [the plugin manager](#the-plugin-manager), the eight plugins — [GIF export](#gif-export), [Shaped wipes](#shaped-wipes), [Pattern transitions](#pattern-transitions), [Visual effects](#visual-effects), [More export formats](#more-export-formats), [Title templates](#title-templates), [Sound library](#sound-library) and [Font pack](#font-pack) — [how enabled plugins are remembered](#enabled-plugins-and-this-browser), and [what a project records](#projects-that-need-a-plugin) about the plugins it uses.

## What a plugin is here

**Where to find it.** Nothing to operate; the design.

**What it does.** Keeps the default editor lightweight by holding some features back until they are wanted.

**Details.** Each plugin is a module in the editor's own build, split off so the browser downloads it only when the plugin is first enabled. The customer's rule for what belongs behind a plugin rather than in the core is one of two conditions: the feature loads a significant amount of data, or it adds far more options than most projects need. Everything else is core. Third-party plugins — code fetched from a URL at runtime — were considered and declined by design: running fetched code inside the editor, with access to your media, is a security and integrity risk that a static site cannot police, and every plugin so far is the team's own. The seams a later remote model would build on are kept, but the door is closed until the customer opens it.

**Related.** [The plugin manager](#the-plugin-manager)

## The plugin manager

**Where to find it.** **File ▾** › **Plugins…**.

**What it does.** Lists every plugin this build ships and switches each on or off.

**Details.** Like every dialog, it never grows past the window: once the list is taller, the list scrolls inside the dialog, and the heading and **Close** stay in view. The dialog says what it holds — *Optional features, loaded only when enabled. Your choices are remembered in this browser* — and lists each plugin's name, version and what it adds, with an **Enable** or **Disable** button. Enabling downloads the plugin's code and activates it; the button reads *Enabling…* meanwhile, and a download or activation that fails is reported on the row as *Could not enable: …*, leaving the plugin off. Disabling takes effect at once — the plugin's contributions leave the menus they were in — but never tears down work in flight: an export that started under the plugin's encoder runs to completion. If the open project uses the plugin, **Disable** asks first. A confirmation, *Disable Visual effects?* for example, says how many times the project uses it and what those uses are: *This project uses Visual effects 2 times: 2 picture effects*. It also says that disabling removes nothing, and how the uses show while the plugin is off. **Disable** then disables the plugin, and **Cancel**, **Esc** or a click outside the confirmation leaves it on. Either way you are back in the Plugins dialog. A use is a transition for [Shaped wipes](#shaped-wipes) and [Pattern transitions](#pattern-transitions), and a picture effect for [Visual effects](#visual-effects). For [Font pack](#font-pack), a use is a text overlay in a pack font, plus the Subtitle style if it uses one. A plugin the project does not use, and a plugin no project can depend on, such as GIF export, disables without asking. The list is short by design; a build with no plugins would say so.

**Related.** [GIF export](#gif-export) · [Shaped wipes](#shaped-wipes) · [Pattern transitions](#pattern-transitions) · [More export formats](#more-export-formats)

## GIF export

**Where to find it.** **File ▾** › **Plugins…** › *GIF export*; once enabled, **Animated GIF** in the export dialog's Format group.

**What it does.** Adds an *Animated GIF* export format: the composed timeline — transitions, zooms, overlays, shapes, text and all — as a soundless GIF.

**Details.** The GIF samples at {{GIF_FPS}} fps and is scaled down so its longer side is at most {{GIF_MAX_PX}} px, with a fresh 256-colour palette per frame; the format's note in the export dialog states the limits. The encoder lives inside the plugin, so the editor never carries it until the plugin is enabled. No project depends on this plugin — a GIF is an output, not part of the arrangement — so a project file never asks for it.

**Related.** [Animated GIF (plugin)](export.md#animated-gif-plugin)

## Shaped wipes

**Where to find it.** **File ▾** › **Plugins…** › *Shaped wipes*; once enabled, seven more kinds in a transition's type menu.

**What it does.** Adds transitions whose reveal has a richer shape than the core wipes' single moving edge.

**Details.** The seven are **Box open**, **Barn doors open**, **Letterbox open**, and **Wipe from top left**, **top right**, **bottom left** and **bottom right**. They join the type menu beside the core kinds and render identically in the preview and every export, through the same rule. Because a transition is part of the arrangement, a project that uses one *depends on the plugin*: the file records it, and opening the file asks to enable the plugin (below). Disabling the plugin never removes your edits — a shaped wipe already on the timeline stays there, plays as a crossfade while the plugin is off, and its type menu shows it as *unavailable* until the plugin is enabled again.

**Related.** [Transitions](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) · [Projects that need a plugin](#projects-that-need-a-plugin)

## Pattern transitions

**Where to find it.** **File ▾** › **Plugins…** › *Pattern transitions*; once enabled, nine more kinds in a transition's type menu.

**What it does.** Adds transitions whose reveal is a pattern: slats, a grid of cells, a shape, or a sweep around the centre.

**Details.** The nine are:

- **Blinds (horizontal)**: {{PATTERN_BLIND_SLATS}} horizontal slats, each opening downward from its own top edge, all at the same time.
- **Blinds (vertical)**: the same with {{PATTERN_BLIND_SLATS}} vertical slats, each opening to the right.
- **Checkerboard**: a grid of {{PATTERN_CHECKER_COLUMNS}} × {{PATTERN_CHECKER_ROWS}} cells. Alternate cells fill over the first half of the transition, so the picture is a checkerboard of the two clips at the midpoint, and the remaining cells fill over the second half. Each cell fills from its left edge.
- **Diamond iris**: a diamond grows from the centre.
- **Star iris**: a five-pointed star, one point up, grows from the centre.
- **Clock wipe**: a hand sweeps clockwise from 12 o'clock, like a clock's, at a steady speed, and reveals the new clip behind it. It points at 3 o'clock a quarter of the way through, at 6 half-way, and at 9 three-quarters of the way.
- **Radial wipe**: two hands start together at 12 o'clock and sweep apart, one each way, until they meet at 6.
- **Spiral**: the frame, divided into {{PATTERN_SPIRAL_COLUMNS}} × {{PATTERN_SPIRAL_ROWS}} cells, is revealed one cell after another, clockwise from the top-left corner along the edges and then inward to the middle. Each cell fills from the side the path enters it.
- **Heart iris**: a heart, point down, grows from the centre.

The three irises and the hands of the two sweeps keep their shape on any frame, whether landscape, portrait or square: 3 o'clock is straight to the right. Each iris finishes covering the frame exactly at the end of the transition. The slats and cells divide the frame itself, so they stretch with it. Like Shaped wipes, these render identically in the preview and every export, through the same rule. A project that uses one *depends on the plugin*: the file records it, and opening the file asks to enable the plugin. A pattern transition already on the timeline when the plugin is disabled stays there. It plays as a crossfade, and its type menu shows it as *unavailable*.

**Related.** [Transitions](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) · [Projects that need a plugin](#projects-that-need-a-plugin)

## Visual effects

**Where to find it.** **File ▾** › **Plugins…** › *Visual effects*; once enabled, **Vignette**, **Blur**, **Film grain**, **Old film**, **VHS**, **Chromatic aberration** and **Glitch** in an expanded sequence entry's **+ Effect ▾**.

**What it does.** Draws picture effects on a stretch of a clip: a **Vignette** that darkens the edges of the frame, a **Blur** over the whole picture, **Film grain**, moving noise over it, **Old film**, a sepia tone with a flicker, grain, scratches and dust, **VHS**, a soft picture with colour fringes at its edges, thin dark lines across it and, now and then, a band of noise rolling down it, **Chromatic aberration**, the picture's red and blue split apart into fringes at every edge, and **Glitch**, bands of the picture tearing sideways and the same split jumping in and out in short bursts.

**Details.** Each effect covers part of a clip, from a start to an end time on that clip, and the clip can carry several, which stack. Each one fades in and out over {{PICTURE_EFFECT_EASE}} s at the ends of its stretch, so it never appears or disappears all at once. An effect that starts at the clip's first frame, or ends at its last, is at full strength there instead, because the picture changes at the cut anyway.
- **Vignette** has a **Strength**, from 0 to 100 %, which is how dark the frame's corners get: at 100 % they are black. The darkening starts a little under half-way out from the centre and deepens towards the edges.
- **Blur** has an **Amount**, from 0 to 5 %, the blur's radius as a share of the frame's width. 1 % is about 19 pixels in a 1080p export, so a blur looks the same in the preview as in the file.
- **Film grain** has an **Amount**, from 0 to 100 %, how far the strongest grains lighten or darken the picture, and a **Size**, from 2 to 10, a grain's width in pixels of a 1080p frame. The grain is black and white, lightening about as much of the picture as it darkens. Its pattern changes 24 times a second of the clip, and is fixed for each moment rather than random: the preview and the export show the same grain at the same instant. On a clip with a pause or a speed segment the grain follows the clip's own time, so it holds still through a pause, as the picture does.
- **Old film** has an **Amount**, from 0 to 100 %, which sets five things together: a sepia tone, a flicker of the picture's brightness, up to 8 % either way at 100 %, a fine grain like Film grain's at size 3, the occasional thin light scratch down the picture, and a few dust specks. The flicker, scratches and dust change 24 times a second of the clip and, like the grain, are fixed for each moment, so the preview and the export show the same ones.
- **VHS** has an **Amount**, from 0 to 100 %, which sets four things together: a soft blur, about 3 pixels of a 1080p frame at 100 %, a colour offset that moves the picture's red left and its blue right by about 4 pixels of a 1080p frame at 100 %, thin dark scanlines across the picture, one every 4 pixels of a 1080p frame, and a light, noisy tracking band about 48 pixels of a 1080p frame tall. Each line's darkness shimmers 24 times a second of the clip. The band shows in about 4 of every 10 half-seconds of the clip and rolls down the picture through each one. Both are fixed for each moment, so the preview and the export show the same lines and the same band.
- **Chromatic aberration** has an **Amount**, from 0 to 100 %, how far the picture's red moves left and its blue right: about 19 pixels of a 1080p frame each at 100 %, and 6 at the default 30 %. The green stays, so the fringes show only at edges, and the split is the same across the whole frame.
- **Glitch** has an **Intensity**, from 0 to 100 %, how far the picture tears and the red and blue jump apart, about 96 and 38 pixels of a 1080p frame for the largest jumps at 100 %, and a **Frequency**, from 0 to 100 %, the chance that each eighth of a second of the clip glitches. Each glitch has its own size, up to the Intensity. Which moments glitch is fixed for each moment rather than random, so the preview and the export glitch at the same instants.

Effects belong to the clip's picture as you frame it: a zoom moves inside the vignette, which stays on the frame's edges, and a transition carries the effect with the clip. A blur softens the clip's own picture, not its redactions or spotlights, and, like any blur, it also softens the picture's outer edge into the frame's black. The preview and every export draw an effect through the same rule.

Each effect is added from **+ Effect ▾** and set on its own row, its stretch and its settings: [Vignette and blur](editing-video.md#vignette-and-blur), [Film grain](editing-video.md#film-grain), [Old film](editing-video.md#old-film), [VHS](editing-video.md#vhs), [Chromatic aberration](editing-video.md#chromatic-aberration) and [Glitch](editing-video.md#glitch) have the fields. Because an effect is part of the arrangement, a project that uses one *depends on the plugin*: the file records it, and opening the file asks to enable the plugin (below). Disabling the plugin never removes an effect: it stays in the project, its row is named *(unavailable)*, and the picture shows without it until the plugin is enabled again.

**Related.** [Vignette and blur](editing-video.md#vignette-and-blur) · [Film grain](editing-video.md#film-grain) · [Old film](editing-video.md#old-film) · [VHS](editing-video.md#vhs) · [Chromatic aberration](editing-video.md#chromatic-aberration) · [Glitch](editing-video.md#glitch) · [Projects that need a plugin](#projects-that-need-a-plugin)

## More export formats

**Where to find it.** **File ▾** › **Plugins…** › *More export formats*; once enabled, **Animated WebP**, **Animated PNG (APNG)**, **PNG image sequence (ZIP)** and **WAV audio (uncompressed)** in the export dialog's Format group.

**What it does.** Adds export formats beyond the editor's own. Today those are *Animated WebP* and *Animated PNG (APNG)*, the composed timeline as a soundless, looping animation in full colour, the *PNG image sequence (ZIP)*, one lossless PNG per frame for another tool, and *WAV audio (uncompressed)*, the soundtrack as lossless 16-bit stereo.

**Details.** The WebP samples at {{WEBP_FPS}} fps and is scaled down so its longer side is at most {{WEBP_MAX_PX}} px, the same limits as the GIF, but without the GIF's 256-colour palette; the format's note in the export dialog states the limits. Each frame is encoded by the browser's own WebP encoder, so the plugin carries no encoder of its own, and the format is offered only where the browser can encode WebP. The APNG samples at {{APNG_FPS}} fps and at most {{APNG_MAX_PX}} px too, and is lossless: every frame keeps the composed pixels exactly, at several times the GIF's size. Its frames are encoded by the browser's own PNG encoder. The PNG image sequence uses the same encoder, at the export's own Frame rate and Frame size, and packs the frames into a ZIP the plugin writes itself. The WAV takes the same mix the MP3 export does, at the browser's audio rate, and the plugin writes the file itself. No project depends on this plugin, because an export format is an output, not part of the arrangement.

**Related.** [Animated WebP (plugin)](export.md#animated-webp-plugin) · [Animated PNG (plugin)](export.md#animated-png-plugin) · [PNG image sequence (plugin)](export.md#png-image-sequence-plugin) · [WAV audio (plugin)](export.md#wav-audio-plugin) · [GIF export](#gif-export)

## Title templates

**Where to find it.** **File ▾** › **Plugins…** › *Title templates*; once enabled, timeline header › **Add ▾** › **Title template…**.

**What it does.** Places a ready-made title at the playhead, built from ordinary text overlays and a shape group. There are sixteen: four lower thirds, four chapter cards, three end cards, three **before / after** labels, a **Call-out** and a **Step badge**.

**Details.** **Title template…** opens a gallery. Each template is drawn small at the project's own shape, with its example words. The gallery scrolls inside the dialog, so the words and **Place** stay in view below it. Choose a template, type its words, and **Place** it.

The lower thirds take a *Name* and an optional *Role*, left-aligned at the lower left, and show for 5 s. Each bar grows with the longer line.
- **Lower third**: a dark bar with an amber strip down its edge.
- **Minimal lower third**: no bar; a thin amber rule between the two lines, as long as the longer one.
- **Bold lower third**: a solid red bar.
- **Outlined lower third**: a white outline round a lightly darkened bar.

The chapter cards take a large centred *Title* and an optional *Subtitle*, and show for 3 s.
- **Chapter card**: over the picture, dimmed by a translucent black layer.
- **Minimal chapter card**: over the picture as it is, with a short amber rule under the title.
- **Bold chapter card**: on a solid violet background that hides the picture.
- **Outlined chapter card**: in a white outline, over the dimmed picture.

The end cards take a *Closing line* and an optional *Second line*, centred on a solid background that hides the picture, and show for 5 s.
- **End card**: white and amber words on near-black.
- **Bold end card**: dark words on amber.
- **Outlined end card**: white and amber words on near-black, inside an amber frame at the margins.

The before / after templates label a comparison the picture shows side by side: a *Left label*, *Before* to begin with, on the left half of the frame, and a *Right label*, *After*, on the right half. Both are required, and any pair of words works, such as *Old* and *New*. Each label stays in its own half, clear of the middle: a long one is made smaller rather than crossing it, and the other label is set at the same size, so the two read as a pair. They show for 5 s.
- **Before / after**: each label in a dark rounded box, at the upper left and the upper right.
- **Before / after split**: a thin white line down the middle of the frame, and each label in bold, centred in its half on a dark band along the bottom.
- **Bold before / after**: each label in bold on a solid bar across the top of its half, grey on the left and green on the right.

The last two point at things in a screen recording, and show for 4 s:
- **Call-out**: a short *Label* in a yellow box, with a yellow arrow pointing down and to the right from under the box. It is placed above the middle of the frame. Move the text and the shapes onto what it points at, in the [visual editors](visual-editors.md#what-each-editor-shows).
- **Step badge**: a red numbered circle near the upper left, the same [numbered badge](shapes-and-annotations.md#numbered-badges) a shape group can hold, with an optional *Caption* on a dark strip to its right. Its *Number* starts at **one more than the highest badge already on the timeline**, in any shape group, or 1 when there is none, so placing step after step counts up by itself. Change it to any whole number from 0 to 999. Nothing is renumbered when a badge is deleted: with badges 1, 2 and 3, deleting 3 offers 3 again, and deleting 2 still offers 4.

Every template fades in and out over half a second. Its words are sized from the frame's shorter side, so a portrait title is not set at a landscape title's height. A line that would run wider than the frame, less its margins, is made smaller until it fits, because text overlays never wrap. Leaving an optional field empty places no text for it; **Place** stays unavailable while a required one is empty. Placing a template is **one undo step**: one **Undo** takes away all of its text overlays and its shape group.

What is placed is ordinary: the text overlays appear in the Text section and the shape group, named for the template (a step badge's group is named for its step, *Step 3*), in the Shapes section. Edit them, retime them, fade them, move them in the visual editors, and export them like any other. They do not need the plugin. Disabling it removes **Title template…** from Add ▾ and leaves everything it placed on the timeline, and no project depends on it.

The gallery works from the keyboard: the arrow keys move between templates, **Tab** moves on to the words, **Enter** places, and **Esc** closes it without placing anything.

**Related.** [Adding a text overlay](text-and-subtitles.md#adding-a-text-overlay) · [Adding a shape group](shapes-and-annotations.md#adding-a-shape-group) · [Fade-in and fade-out](text-and-subtitles.md#fade-in-and-fade-out)

## Sound library

**Where to find it.** **File ▾** › **Plugins…** › *Sound library*; once enabled, the media library header › **Sound library…**, beside **Import clips**.

**What it does.** Lists short sound effects, such as a whoosh, a click or a ding, and background music tracks, and adds the one you choose to the media library as an ordinary audio clip.

**Details.** **Sound library…** opens a list of 13 effects in four groups, each with its length:
- **Transitions:** Whoosh, Swoosh out, Riser.
- **Clicks and keys:** Click, Double click, Pop, Typing, Camera shutter.
- **Alerts:** Ding, Notification, Success, Error.
- **Impacts:** Thump.

None is longer than about 2 seconds.

Below them, a **Music** group lists six background music tracks, each with its mood and its length in minutes and seconds:
- **Still water** (*Calm*, 1:29): warm, slow chords and a soft electric-piano arpeggio, with no drums.
- **Bright side** (*Upbeat*, 1:21): a plucked guitar pattern over bass, kick, clap and hats.
- **Late night notes** (*Lo-fi*, 1:18): mellow electric-piano chords on a lazy, swung beat, with a quiet vinyl crackle.
- **Horizon** (*Cinematic*, 1:17): low strings that swell and build, with deep drum hits.
- **Bounce** (*Playful*, 1:17): a marimba tune over a bouncing bass and finger snaps.
- **Circuit** (*Tech*, 1:16): a fast synth arpeggio over a steady four-on-the-floor kick.

Each is a bed to play under a voice: it keeps one tempo and one key, has no singing or leading tune, starts gently and ends on a fade. All six are mastered to about the same loudness, so changing one for another does not change the level. They are made to play once, not to loop. On the timeline a track is trimmed and faded like any audio, and turning on [Duck others](audio.md#duck-others) on a voice-over lowers the music under it.

**▶** plays a sound so you can hear it first, and reads **■** while it plays. Pressing it again, or playing another sound, stops it, and so does closing the list. **Add** puts the sound in the library under its name, for example *Whoosh.webm*. From there it previews, goes on the timeline as an audio track, and is trimmed, faded and mixed like any audio file you import. The list stays open, so you can add several in a row. A line under the list says when a sound has been added, or why it could not be downloaded.

**You may use these sounds and tracks anywhere, with no credit.** The team made them itself, synthesising them from tones and noise without recordings or anyone else's files, and composing the music in code that is kept with the editor. All of them are released under **CC0**, the public-domain dedication. Put them in your videos, publish those videos commercially or not, and change them, without naming anyone.

Enabling the plugin downloads only the list. Each sound or track is a file of its own, downloaded only when you play or add it: an effect is at most a few tens of kilobytes, and a music track under 1 MB. An added sound is an ordinary clip: it is saved with your project like any import. It does not need the plugin, and it stays in the library when the plugin is disabled, so no project depends on it.

The list works from the keyboard. Opening it puts the focus on the first **▶**. **Tab** moves through each row's **▶** and **Add**, **Enter** or **Space** presses one, and **Esc** closes the list.

**Related.** [Importing clips](media-library.md#importing-clips) · [Audio tracks](audio.md#audio-tracks)

## Font pack

**Where to find it.** **File ▾** › **Plugins…** › *Font pack*; once enabled, ten more faces in every **Font** menu: a text row's, and the Subtitle style's.

**What it does.** Adds ten typefaces to the four core fonts, for the styles the core fonts cannot give a title.

**Details.** The faces, after *Display* in the menu:
- **Nunito**, a rounded sans-serif, for friendly titles and captions.
- **Montserrat**, a geometric sans-serif, for clean modern headings.
- **Oswald**, a condensed sans-serif, for long lines and lower thirds that must stay narrow.
- **Bebas Neue**, a tall display face in capitals only, for thumbnails and title cards.
- **Zilla Slab**, a slab serif, for sturdy, readable headings.
- **Cormorant Garamond**, an elegant serif, for formal and cinematic titles.
- **Courier Prime**, a typewriter face, for code, notes and terminal-style text.
- **Caveat**, a handwritten script, for personal notes and annotations.
- **Comic Neue**, a comic-book face, for playful call-outs.
- **Silkscreen**, a pixel face, for retro and game-style text.

Nunito, Montserrat, Zilla Slab, Cormorant Garamond, Courier Prime and Comic Neue have a real bold and italic. Oswald, Caveat and Silkscreen have a bold but no italic, and Bebas Neue has neither: for those, **Bold** and **Italic** make the browser thicken or slant the face, in the preview and the export alike.

**The fonts are served by this site, and each downloads only when it is used.** Enabling the plugin downloads the list, not the fonts. A face downloads the first time text in it is drawn: when it shows in the preview or goes into an export or a saved frame, and when you open a **Font** menu, which draws each name in its own font, so the first opening downloads the regular style of all ten faces, about 206 kB together. Each style of a face is 8 to 51 kB, and all ten faces in every style are about 656 kB. An export waits for the fonts its text uses before it draws its first frame, so the file shows a stand-in face only when a download fails. While a face downloads, the preview draws that text blank at first, then in a similar stand-in font if the download takes longer (after about a second in Chromium); from this site a face usually arrives within a few tens of milliseconds. If a face cannot be downloaded, for example while the connection is down, the text is drawn in its stand-in font, and the export still finishes; the next export or saved frame downloads the face again.

**You may use these fonts in your videos, with no credit.** Every face is published under the **SIL Open Font License 1.1**, which lets anyone use the fonts, and embed them in a video or any other work, commercially or not. The licence of each face, with its authors, ships with the editor's source. The fonts were taken from the Fontsource project's copies of them, in their Latin character set: letters with accents used in Western European languages are included, Greek, Cyrillic and Vietnamese are not.

A text overlay in a pack font, or a Subtitle style that uses one, makes the project *depend on the plugin*: the file records it, and opening the file asks to enable the plugin (below). Disabling the plugin never changes your text: it keeps its font, which its Font menu names *(unavailable)*, and it draws in the core sans-serif until the plugin is enabled again.

**Related.** [Text overlays › The properties](text-and-subtitles.md#the-properties) · [The default subtitle style](text-and-subtitles.md#the-default-subtitle-style) · [Projects that need a plugin](#projects-that-need-a-plugin)

## Enabled plugins and this browser

**Where to find it.** Nothing to operate.

**What it does.** Remembers which plugins are on, per browser.

**Details.** The set of enabled plugins is stored in this browser and re-activated on the next visit. It is a preference of this browser, not of any project: a project file never contains which plugins are enabled, and another computer starts with none. Where the browser has no storage, plugins can still be enabled for the session and are forgotten on reload.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [Settings](settings.md#where-settings-live)

## Projects that need a plugin

**Where to find it.** A dialog while opening a project.

**What it does.** Records in the project file which plugins its features come from, and offers to enable them when the file is opened.

**Details.** Saving a project that uses a plugin's feature — a shaped wipe or a pattern transition on the timeline, a visual effect on a clip, or a Font pack font on text — records the plugin's name in the file. Opening that file while the plugin is disabled asks *Enable plugins to open?*, naming the file and the plugins; **Enable and open** turns them on and continues, and **Cancel** leaves the file unopened rather than dropping its features. A plugin that fails to load is reported the same way. The full account is on [A file that needs plugins](projects.md#a-file-that-needs-plugins).

**Related.** [A file that needs plugins](projects.md#a-file-that-needs-plugins) · [Shaped wipes](#shaped-wipes) · [Pattern transitions](#pattern-transitions) · [Visual effects](#visual-effects) · [Font pack](#font-pack)
