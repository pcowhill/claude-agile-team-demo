# Plugins

**There is no importing of plugins.** Plugins here are optional features built into the editor, shipped with it and switched on from **File ▾** › **Plugins…** — nothing is downloaded from a third party, and no file is imported. Enabling one downloads that feature's own code, which the editor otherwise never loads. This page covers [what a plugin is here](#what-a-plugin-is-here) and why, [the plugin manager](#the-plugin-manager), the seven plugins — [GIF export](#gif-export), [Shaped wipes](#shaped-wipes), [Pattern transitions](#pattern-transitions), [Visual effects](#visual-effects), [More export formats](#more-export-formats), [Title templates](#title-templates) and [Sound library](#sound-library) — [how enabled plugins are remembered](#enabled-plugins-and-this-browser), and [what a project records](#projects-that-need-a-plugin) about the plugins it uses.

## What a plugin is here

**Where to find it.** Nothing to operate; the design.

**What it does.** Keeps the default editor lightweight by holding some features back until they are wanted.

**Details.** Each plugin is a module in the editor's own build, split off so the browser downloads it only when the plugin is first enabled. The customer's rule for what belongs behind a plugin rather than in the core is one of two conditions: the feature loads a significant amount of data, or it adds far more options than most projects need. Everything else is core. Third-party plugins — code fetched from a URL at runtime — were considered and declined by design: running fetched code inside the editor, with access to your media, is a security and integrity risk that a static site cannot police, and every plugin so far is the team's own. The seams a later remote model would build on are kept, but the door is closed until the customer opens it.

**Related.** [The plugin manager](#the-plugin-manager)

## The plugin manager

**Where to find it.** **File ▾** › **Plugins…**.

**What it does.** Lists every plugin this build ships and switches each on or off.

**Details.** The dialog says what it holds — *Optional features, loaded only when enabled. Your choices are remembered in this browser* — and lists each plugin's name, version and what it adds, with an **Enable** or **Disable** button. Enabling downloads the plugin's code and activates it; the button reads *Enabling…* meanwhile, and a download or activation that fails is reported on the row as *Could not enable: …*, leaving the plugin off. Disabling takes effect at once — the plugin's contributions leave the menus they were in — but never tears down work in flight: an export that started under the plugin's encoder runs to completion. The list is short by design; a build with no plugins would say so.

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

**Where to find it.** **File ▾** › **Plugins…** › *Visual effects*.

**What it does.** Draws picture effects on a stretch of a clip: a **Vignette** that darkens the edges of the frame, and a **Blur** over the whole picture.

**Details.** Each effect covers part of a clip, from a start to an end time on that clip, and the clip can carry several, which stack. Each one fades in and out over {{PICTURE_EFFECT_EASE}} s at the ends of its stretch, so it never appears or disappears all at once. An effect that starts at the clip's first frame, or ends at its last, is at full strength there instead, because the picture changes at the cut anyway.
- **Vignette** has a **Strength**, from 0 to 100 %, which is how dark the frame's corners get: at 100 % they are black. The darkening starts a little under half-way out from the centre and deepens towards the edges.
- **Blur** has an **Amount**, from 0 to 5 %, the blur's radius as a share of the frame's width. 1 % is about 19 pixels in a 1080p export, so a blur looks the same in the preview as in the file.

Effects belong to the clip's picture as you frame it: a zoom moves inside the vignette, which stays on the frame's edges, and a transition carries the effect with the clip. A blur softens the clip's own picture, not its redactions or spotlights, and, like any blur, it also softens the picture's outer edge into the frame's black. The preview and every export draw an effect through the same rule.

**Adding an effect is not in the editor yet.** This version of the plugin draws the effects a project file already holds; the menu items that add and edit them will follow. Because an effect is part of the arrangement, a project that uses one *depends on the plugin*: the file records it, and opening the file asks to enable the plugin (below). Disabling the plugin never removes an effect: it stays in the project, and the picture shows without it until the plugin is enabled again.

**Related.** [Projects that need a plugin](#projects-that-need-a-plugin)

## More export formats

**Where to find it.** **File ▾** › **Plugins…** › *More export formats*; once enabled, **Animated WebP**, **Animated PNG (APNG)**, **PNG image sequence (ZIP)** and **WAV audio (uncompressed)** in the export dialog's Format group.

**What it does.** Adds export formats beyond the editor's own. Today those are *Animated WebP* and *Animated PNG (APNG)*, the composed timeline as a soundless, looping animation in full colour, the *PNG image sequence (ZIP)*, one lossless PNG per frame for another tool, and *WAV audio (uncompressed)*, the soundtrack as lossless 16-bit stereo.

**Details.** The WebP samples at {{WEBP_FPS}} fps and is scaled down so its longer side is at most {{WEBP_MAX_PX}} px, the same limits as the GIF, but without the GIF's 256-colour palette; the format's note in the export dialog states the limits. Each frame is encoded by the browser's own WebP encoder, so the plugin carries no encoder of its own, and the format is offered only where the browser can encode WebP. The APNG samples at {{APNG_FPS}} fps and at most {{APNG_MAX_PX}} px too, and is lossless: every frame keeps the composed pixels exactly, at several times the GIF's size. Its frames are encoded by the browser's own PNG encoder. The PNG image sequence uses the same encoder, at the export's own Frame rate and Frame size, and packs the frames into a ZIP the plugin writes itself. The WAV takes the same mix the MP3 export does, at the browser's audio rate, and the plugin writes the file itself. No project depends on this plugin, because an export format is an output, not part of the arrangement.

**Related.** [Animated WebP (plugin)](export.md#animated-webp-plugin) · [Animated PNG (plugin)](export.md#animated-png-plugin) · [PNG image sequence (plugin)](export.md#png-image-sequence-plugin) · [WAV audio (plugin)](export.md#wav-audio-plugin) · [GIF export](#gif-export)

## Title templates

**Where to find it.** **File ▾** › **Plugins…** › *Title templates*; once enabled, timeline header › **Add ▾** › **Title template…**.

**What it does.** Places a ready-made title — a **Lower third**, a **Chapter card** or an **End card** — at the playhead, built from ordinary text overlays and a shape group.

**Details.** **Title template…** opens a gallery. Each template is drawn small at the project's own shape, with its example words. Choose one, type its words, and **Place** it:

- **Lower third** — a *Name* and an optional *Role*, left-aligned on a dark bar at the lower left, with an amber strip down the bar's edge. The bar grows with the longer line. It shows for 5 s.
- **Chapter card** — a large centred *Title* and an optional *Subtitle*, over the picture dimmed by a translucent black layer. It shows for 3 s.
- **End card** — a *Closing line* and an optional *Second line*, centred on a solid dark background that hides the picture. It shows for 5 s.

Every template fades in and out over half a second. Its words are sized from the frame's shorter side, so a portrait title is not set at a landscape title's height. A line that would run wider than the frame, less its margins, is made smaller until it fits, because text overlays never wrap. Leaving an optional field empty places no text for it; **Place** stays unavailable while a required one is empty. Placing a template is **one undo step**: one **Undo** takes away all of its text overlays and its shape group.

What is placed is ordinary: the text overlays appear in the Text section and the shape group, named for the template, in the Shapes section. Edit them, retime them, fade them, move them in the visual editors, and export them like any other. They do not need the plugin. Disabling it removes **Title template…** from Add ▾ and leaves everything it placed on the timeline, and no project depends on it.

The gallery works from the keyboard: the arrow keys move between templates, **Tab** moves on to the words, **Enter** places, and **Esc** closes it without placing anything.

**Related.** [Adding a text overlay](text-and-subtitles.md#adding-a-text-overlay) · [Adding a shape group](shapes-and-annotations.md#adding-a-shape-group) · [Fade-in and fade-out](text-and-subtitles.md#fade-in-and-fade-out)

## Sound library

**Where to find it.** **File ▾** › **Plugins…** › *Sound library*; once enabled, the media library header › **Sound library…**, beside **Import clips**.

**What it does.** Lists short sound effects, such as a whoosh, a click or a ding, and adds the one you choose to the media library as an ordinary audio clip.

**Details.** **Sound library…** opens a list of 13 effects in four groups, each with its length:
- **Transitions:** Whoosh, Swoosh out, Riser.
- **Clicks and keys:** Click, Double click, Pop, Typing, Camera shutter.
- **Alerts:** Ding, Notification, Success, Error.
- **Impacts:** Thump.

None is longer than about 2 seconds.

**▶** plays a sound so you can hear it first, and reads **■** while it plays. Pressing it again, or playing another sound, stops it, and so does closing the list. **Add** puts the sound in the library under its name, for example *Whoosh.webm*. From there it previews, goes on the timeline as an audio track, and is trimmed, faded and mixed like any audio file you import. The list stays open, so you can add several in a row. A line under the list says when a sound has been added, or why it could not be downloaded.

**You may use these sounds anywhere, with no credit.** The team made them itself, synthesising them from tones and noise without recordings or anyone else's files, and released them under **CC0**, the public-domain dedication. Put them in your videos, publish those videos commercially or not, and change the sounds, without naming anyone.

Enabling the plugin downloads only the list. Each sound is a small file, downloaded only when you play or add it. An added sound is an ordinary clip: it is saved with your project like any import. It does not need the plugin, and it stays in the library when the plugin is disabled, so no project depends on it.

The list works from the keyboard. Opening it puts the focus on the first **▶**. **Tab** moves through each row's **▶** and **Add**, **Enter** or **Space** presses one, and **Esc** closes the list.

**Related.** [Importing clips](media-library.md#importing-clips) · [Audio tracks](audio.md#audio-tracks)

## Enabled plugins and this browser

**Where to find it.** Nothing to operate.

**What it does.** Remembers which plugins are on, per browser.

**Details.** The set of enabled plugins is stored in this browser and re-activated on the next visit. It is a preference of this browser, not of any project: a project file never contains which plugins are enabled, and another computer starts with none. Where the browser has no storage, plugins can still be enabled for the session and are forgotten on reload.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [Settings](settings.md#where-settings-live)

## Projects that need a plugin

**Where to find it.** A dialog while opening a project.

**What it does.** Records in the project file which plugins its features come from, and offers to enable them when the file is opened.

**Details.** Saving a project that uses a plugin's feature — a shaped wipe or a pattern transition on the timeline, or a visual effect on a clip — records the plugin's name in the file. Opening that file while the plugin is disabled asks *Enable plugins to open?*, naming the file and the plugins; **Enable and open** turns them on and continues, and **Cancel** leaves the file unopened rather than dropping its features. A plugin that fails to load is reported the same way. The full account is on [A file that needs plugins](projects.md#a-file-that-needs-plugins).

**Related.** [A file that needs plugins](projects.md#a-file-that-needs-plugins) · [Shaped wipes](#shaped-wipes) · [Pattern transitions](#pattern-transitions) · [Visual effects](#visual-effects)
