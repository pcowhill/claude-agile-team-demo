# Plugins

**There is no importing of plugins.** Plugins here are optional features built into the editor, shipped with it and switched on from **File ▾** › **Plugins…** — nothing is downloaded from a third party, and no file is imported. Enabling one downloads that feature's own code, which the editor otherwise never loads. This page covers [what a plugin is here](#what-a-plugin-is-here) and why, [the plugin manager](#the-plugin-manager), the two plugins — [GIF export](#gif-export) and [Shaped wipes](#shaped-wipes) — [how enabled plugins are remembered](#enabled-plugins-and-this-browser), and [what a project records](#projects-that-need-a-plugin) about the plugins it uses.

## What a plugin is here

**Where to find it.** Nothing to operate; the design.

**What it does.** Keeps the default editor lightweight by holding some features back until they are wanted.

**Details.** Each plugin is a module in the editor's own build, split off so the browser downloads it only when the plugin is first enabled. The customer's rule for what belongs behind a plugin rather than in the core is one of two conditions: the feature loads a significant amount of data, or it adds far more options than most projects need. Everything else is core. Third-party plugins — code fetched from a URL at runtime — were considered and declined by design: running fetched code inside the editor, with access to your media, is a security and integrity risk that a static site cannot police, and every plugin so far is the team's own. The seams a later remote model would build on are kept, but the door is closed until the customer opens it.

**Related.** [The plugin manager](#the-plugin-manager)

## The plugin manager

**Where to find it.** **File ▾** › **Plugins…**.

**What it does.** Lists every plugin this build ships and switches each on or off.

**Details.** The dialog says what it holds — *Optional features, loaded only when enabled. Your choices are remembered in this browser* — and lists each plugin's name, version and what it adds, with an **Enable** or **Disable** button. Enabling downloads the plugin's code and activates it; the button reads *Enabling…* meanwhile, and a download or activation that fails is reported on the row as *Could not enable: …*, leaving the plugin off. Disabling takes effect at once — the plugin's contributions leave the menus they were in — but never tears down work in flight: an export that started under the plugin's encoder runs to completion. The list is short by design; a build with no plugins would say so.

**Related.** [GIF export](#gif-export) · [Shaped wipes](#shaped-wipes)

## GIF export

**Where to find it.** **File ▾** › **Plugins…** › *GIF export*; once enabled, **Animated GIF** in the export dialog's Format group.

**What it does.** Adds an *Animated GIF* export format: the composed timeline — transitions, zooms, overlays, text and all — as a soundless GIF.

**Details.** The GIF samples at {{GIF_FPS}} fps and is scaled down so its longer side is at most {{GIF_MAX_PX}} px, with a fresh 256-colour palette per frame; the format's note in the export dialog states the limits. The encoder lives inside the plugin, so the editor never carries it until the plugin is enabled. No project depends on this plugin — a GIF is an output, not part of the arrangement — so a project file never asks for it.

**Related.** [Animated GIF (plugin)](export.md#animated-gif-plugin)

## Shaped wipes

**Where to find it.** **File ▾** › **Plugins…** › *Shaped wipes*; once enabled, seven more kinds in a transition's type menu.

**What it does.** Adds transitions whose reveal has a richer shape than the core wipes' single moving edge.

**Details.** The seven are **Box open**, **Barn doors open**, **Letterbox open**, and **Wipe from top left**, **top right**, **bottom left** and **bottom right**. They join the type menu beside the core kinds and render identically in the preview and every export, through the same rule. Because a transition is part of the arrangement, a project that uses one *depends on the plugin*: the file records it, and opening the file asks to enable the plugin (below). Disabling the plugin never removes your edits — a shaped wipe already on the timeline stays there, plays as a crossfade while the plugin is off, and its type menu shows it as *unavailable* until the plugin is enabled again.

**Related.** [Transitions](editing-video.md#transitions-crossfade-slides-wipes-pushes-fades-irises-and-cross-zoom) · [Projects that need a plugin](#projects-that-need-a-plugin)

## Enabled plugins and this browser

**Where to find it.** Nothing to operate.

**What it does.** Remembers which plugins are on, per browser.

**Details.** The set of enabled plugins is stored in this browser and re-activated on the next visit. It is a preference of this browser, not of any project: a project file never contains which plugins are enabled, and another computer starts with none. Where the browser has no storage, plugins can still be enabled for the session and are forgotten on reload.

**Related.** [What is saved where](concepts.md#what-is-saved-where) · [Settings](settings.md#where-settings-live)

## Projects that need a plugin

**Where to find it.** A dialog while opening a project.

**What it does.** Records in the project file which plugins its features come from, and offers to enable them when the file is opened.

**Details.** Saving a project that uses a plugin's feature — a shaped wipe on the timeline — records the plugin's name in the file. Opening that file while the plugin is disabled asks *Enable plugins to open?*, naming the file and the plugins; **Enable and open** turns them on and continues, and **Cancel** leaves the file unopened rather than dropping its features. A plugin that fails to load is reported the same way. The full account is on [A file that needs plugins](projects.md#a-file-that-needs-plugins).

**Related.** [A file that needs plugins](projects.md#a-file-that-needs-plugins) · [Shaped wipes](#shaped-wipes)
