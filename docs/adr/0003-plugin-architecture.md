# 0003. Plugin architecture: built-in optional modules behind registries

- Status: accepted
- Date: 2026-08-31
- Links: #175 (customer feedback requesting plugins), #183 (plan approved by
  the customer), #196 (phase 1: this ADR + export-format registry),
  #197 (phase 2: plugin manager), #198 (phase 3: GIF export plugin),
  #199 (phase 4: transitions pack plugin)

## Context

The customer asked for a plugin/extension system starting with a few
officially supported plugins (#175). The app is a fully static site on
GitHub Pages — no backend, no store, no accounts — so a "plugin" here is a
bundle of optional capability the app loads only when enabled: new export
formats, transition packs, and similar. A full plan with options and
recommendations was put to the customer in #183 and approved verbatim
("go with the recommendations",
[#183 comment](https://github.com/pcowhill/claude-agile-team-demo/issues/183#issuecomment-5479503756)).

Three distribution models were considered:

- **Option A — built-in optional modules.** Plugins live in this repository,
  are code-split into lazy-loaded chunks, and ship with the site. A plugin
  manager UI lists them; enabling one downloads and activates its chunk; the
  enabled set persists in browser storage.
- **Option B — remotely loaded bundles**, fetched by URL at runtime. True
  third-party extensibility, but running fetched code is a real security and
  integrity concern (a compromised or stale URL runs code in the editor with
  access to the user's media), and it demands a frozen plugin API contract,
  CSP/hosting/caching decisions, and a harder test story — overkill while
  all plugins are ours.
- **Option C — sandboxed plugins** (iframe/worker + message protocol).
  Strongest isolation, but every capability needs a protocol, and it is too
  heavy for features like transitions that render every frame.

## Decision

**Option A: plugins are built-in optional modules.** No remote code. The
design keeps the seams (registries, manifest-style plugin descriptions) that
a later upgrade to remote bundles — probably a manifest allowlist plus
integrity hashes — would build on, so that upgrade is an extension, not a
rewrite. The customer noted they will most likely never take the third-party
step but want the door kept open.

### What belongs behind a plugin (customer's criteria)

The customer defined the core-vs-plugin split in the approving comment on
#183; recorded verbatim so future sessions apply the same test:

> There is this interesting split between what should be core to the app and
> what should be behind a plugin. It seems to me that one of two conditions
> should be true (there may be more, but these are the two that I have
> identified so far): 1. the plugin loads a significant amount of data (so
> it is hidden behind a plugin to keep the video editor lightweight by
> default), and 2. the plugin loads far more options for the user (so
> instead of cluttering their space, they can enable it instead).

Everything else belongs in core.

### Extension points are registries, built on demand

The lasting mechanism is **registries the core consults instead of
hard-coded lists**, so a plugin can contribute a capability without core
edits. Each extension point is a contract future plugins depend on
(#183's API-stability concern): they stay **few and small**, each is
documented where it lives, and — the approved scope-creep guard — **no
extension point is built until a concrete plugin needs it**.

- **Export-format registry** (`src/lib/exportFormats.ts`, built in phase 1
  #196 because the GIF plugin needs it): a format spec carries an id, label,
  filename extension, recorder MIME candidates (video-only and with-audio),
  and an `encode` entry point. Core WebM/MP4 register at startup and encode
  through the shared MediaRecorder pipeline; a plugin format may bring its
  own encoder. The export UI offers exactly what the registry holds and
  feature detection supports. Phase 2 (#197) grew the contract deliberately,
  because the plugin manager concretely needed both: `unregister(id)` (a
  disabled plugin's format leaves the picker; unregistering an absent id is
  a no-op so teardown order stays safe) and `subscribe`/`version` (the
  picker re-reads the registry when plugins change it at runtime). Phase 3
  (#198, the GIF plugin) grew it again, each addition for a concrete need:
  `isSupported?` (a support probe replacing the MIME-candidates rule — the
  growth the contract's own doc anticipated — because a pure-JS encoder's
  availability is not a recordable MIME type) and `note?` (one line the
  export modal shows for the selected format, where a format states its
  limits in the UI). Phase 3 also gave the shared pipeline an
  `ExportFrameSink` seam (`ExportOptions.sink`, exportVideo.ts): a format
  that does not encode through MediaRecorder receives every frame the
  pipeline composes — the same `drawFrame` composition the WebM recording
  captures, so preview/export parity extends to plugin formats — and
  produces the Blob itself. Sink-driven exports are soundless by definition
  (no sink-based format with sound exists; sound support here waits for a
  concrete format, per the scope-creep guard). The audio-only export (#245)
  grew the spec once more, again for a concrete need: `audioOnly?` marks a
  format that records no video track, so the export modal hides the
  video-only output settings (frame size, frame rate) while it is selected
  and passes no frame overrides to `encode`. The pipeline half is
  `ExportOptions.audioOnly` (exportVideo.ts): the recorder receives the
  mixed audio-capture track alone — the same replay/gain loop drives the
  mix, so audio parity with video exports is inherited — and an audio-only
  export refuses where Web Audio is unavailable instead of falling back to
  video-only. The Size limit (#726) grew it again: `sizeLimit?` marks a
  format whose encoder takes a target bitrate, which today means one that
  records through the shared `MediaRecorder` pipeline (WebM, MP4, audio
  WebM). The export modal offers the limit only for such a format and then
  passes `ExportOptions.sizeLimitBytes` to `encode`. The pipeline turns
  that into `videoBitsPerSecond` / `audioBitsPerSecond` from the exported
  window's duration. The flag is opt-in, so a format with its own encoder
  (MP3, and the GIF plugin) has the limit hidden rather than faked, and a
  future plugin format gets it only by declaring an encoder that honours
  it.
- **Plugin runtime** (`src/lib/plugins.ts`, phase 2 #197): the catalog entry
  contract — id, name, description, version, a `load()` that must be a
  dynamic `import()` of a module under `src/plugins/` (so the code ships as
  a lazy chunk, enforced in CI), and an optional `projectUses` behind
  project-dependency recording. `projectUses` was a boolean
  `usedByProject` predicate until #953 made it a count: how many times the
  project uses the plugin, what those uses are, and how they show while the
  plugin is off. A count above zero is the dependency the project file
  records, and the count is what the manager's confirmation states before
  disabling a plugin in use. One source serves both, so they cannot
  disagree. A plugin module exports
  `activate(): () => void`: make the registrations, return the function
  that undoes them. Disable semantics: disabling deactivates immediately
  (contributions unregister and leave the UI); work already in flight — a
  running export — completes, because the encoder captured what it needs
  when it started.
- **GIF export plugin** (`src/plugins/gif/`, phase 3 #198): the first real
  plugin, replacing phase 2's sample plugin. Encodes with `gifenc` (small,
  dependency-free, MIT), which lives only in the plugin's lazy chunk — the
  CI bundle-discipline check proves the dependency never reaches the entry
  bundle. Fixed 10 fps sampling (exactly 10 cs per frame — GIF stores
  delays in centiseconds), a 480 px dimension cap (the sink downscales the
  composed frame; composition coordinates stay at the requested
  resolution), and a per-frame 256-color palette; the numbers and the why
  live in `gifSink.ts`, and the format's `note` states them in the UI.
- **More export formats plugin** (`src/plugins/moreFormats/`, #858, from
  the customer's pick of idea 12 on #856): export formats beyond the core
  set, one per issue, Animated WebP first. No new extension point and no
  new dependency. The format is a frame sink on the shared pipeline, as
  GIF is. Browsers have no animated-WebP encoder, so the sink encodes
  each kept frame with `canvas.toBlob(…, 'image/webp')` and a small
  hand-written muxer (`webpMux.ts`) wraps those stills' bitstream chunks
  in `ANMF` frames. Support is probed with `toDataURL('image/webp')`,
  because a browser that cannot encode WebP silently returns PNG. The
  WebP keeps the GIF's 10 fps and 480 px: standalone still frames cost
  about a key frame each, and measured on #858 a faster rate or a larger
  frame made the WebP larger than the GIF it improves on. The table and
  the reasoning live in `moreFormatsLimits.ts`, which the guide reads.
- **Transition registry** (`src/lib/transitionRender.ts`, built in phase 4
  #199 because the Shaped wipes pack needs it — the deferral this list
  recorded): a definition carries an id (what timeline state and project
  files record), a picker name, and the pure `layerSpec(progress)` rule both
  renderers already consumed — so preview/export parity is inherited, not
  re-proven per plugin. Core transitions (#42, #181) register at startup in
  their established order; `unregister`/`subscribe`/`version` mirror the
  export-format registry for the same phase-2 reasons. Two consequences of
  transitions being *project state* (unlike export formats): an unregistered
  type renders as a crossfade fallback instead of throwing — disabling a
  plugin tears down contributions, never user edits, so a pack transition
  can outlive its plugin on the timeline (the picker shows it as
  "(unavailable)") — and `PluginRuntime.projectPlugins` now asks every
  catalog plugin, enabled or not, so a save after a disable still records
  the dependency (the pack's id list lives in top-level catalog wiring,
  `src/plugins/shapedWipesIds.ts`, so the predicate loads no chunk).
  Parse-time transition-type validation (#75) moved with it: `projectFile`
  checks structure only, and the open flow enforces known-types after the
  plugin gate, when plugin types are knowable.
- **Shaped wipes plugin** (`src/plugins/shapedWipes/`, phase 4 #199): the
  transitions pack — box open, barn doors, letterbox, four corner wipes —
  every definition the base spec plus a single reveal rectangle, the same
  vocabulary the core wipes use, so the pack ships zero rendering code and
  no dependencies.
- **Transition registry, widened for patterns** (#857, the Pattern
  transitions plugin the customer picked on #856). Two contract changes,
  both for that concrete need. **(1)** `TransitionLayerSpec` gains
  `incomingPolygons`: a list of polygons in frame fractions, and the
  incoming card paints inside their union. One vocabulary covers every
  patterned reveal: the separate pieces of blinds and a checkerboard, the
  pointed outlines of a diamond or a star, and, sampled finely, the clock
  sweep and heart that part 2 (#863) needs. Both renderers resolve it
  through `windRevealPolygons`, which winds every polygon the same way, so
  the non-zero fill each renderer uses means "union" whatever order a
  definition lists its vertices in. The export fills one canvas path and
  clips to it. The preview draws the same path into an SVG used as the
  incoming element's `mask-image`. `clip-path: polygon()` takes only one
  polygon, and `clip-path: path()` takes pixel coordinates the style does
  not know, while an SVG with a unit `viewBox` stretched over the element
  (`preserveAspectRatio="none"`) takes the frame fractions as they are.
  **(2)** `layerSpec(progress, aspect)` now receives the frame's width ÷
  height, and `transitionLayerSpec` passes it on. Both renderers pass the
  frame they draw, and callers with no frame get `DEFAULT_TRANSITION_ASPECT`
  (16:9). Frame fractions stretch with the frame. A star drawn in them
  would be 1.78× too wide on 16:9, and a shape defined in a fixed square
  covers a 16:9 frame at about 78% of the transition and then sits still.
  Only a rule that knows the aspect can keep a shape's proportions *and*
  reach exact cover at progress 1. Core and Shaped-wipes rules ignore the
  argument and are unchanged, so their tests pass with only the shared
  fixture gaining the new field's `null`.
- **Pattern transitions plugin** (`src/plugins/patternTransitions/`,
  #857): horizontal and vertical blinds, a checkerboard, and diamond and
  star irises. Each is the base spec plus one polygon reveal, with no
  dependencies. Its ids and pattern sizes are top-level wiring
  (`src/plugins/patternTransitionsIds.ts`), as with Shaped wipes, so
  dependency recording and the guide read them without loading the chunk.
- **Font registry** (`fontRegistry` in `src/lib/textOverlay.ts`, built in
  #859 because the Font pack plugin the customer picked on #856 needs it).
  It follows the transition registry: `register`/`unregister`/`has`/
  `find`/`list`/`subscribe`/`version`, and registration order is
  Font-menu order. The four core fonts (`CORE_TEXT_FONTS`, #139) register
  at startup in their established order. A definition carries an id (what
  timeline state and project files record), a menu label, a CSS stack,
  and an optional `load(): Promise<void>`. The core fonts are system
  stacks and need nothing loaded. A pack's webfont does: a canvas
  `fillText` with a face that has not loaded silently draws the fallback.
  So `exportTimeline` awaits the loaders of the fonts the timeline's text
  uses (`loadTextFonts`) before it creates or draws anything. An
  audio-only export skips this, since it draws no text. Fonts are project
  state, as transitions are, so the same three consequences follow:
  - An unregistered id renders in the core sans-serif
    (`FALLBACK_TEXT_FONT_STACK`) rather than throwing, and the Font menus
    show it as "(unavailable)".
  - The reducer accepts any non-empty id, so text whose font outlived its
    plugin stays editable.
  - `projectFile` checks only that `font` is a string. The open flow
    refuses an unknown font by name after the plugin gate
    (`unregisteredTextFonts`), as #199 moved transition types.

  Each Font menu subscribes on the component that owns the `<select>`,
  not on its options. React re-applies a controlled select's value only
  when the select itself re-renders.
- **Add ▾ contributions** (`addMenuContributions` in `src/lib/addMenu.ts`,
  built in #860 because the Title templates plugin the customer picked on
  #856 needs it). A contribution is `{ id, label, Dialog }`: a menu item,
  listed after the core four in registration order, and the React
  component it opens. The dialog receives the output frame and returns
  `PlacedElements`, which are text overlay and shape group *specs* timed
  from 0. Core places them: `placeElementsAt` moves them to the Preview
  time and mints every id, shape ids included, and the reducer's
  `elements-placed` action adds them as **one edit**, all-or-nothing, through
  the same checks `texts-added` and `shape-group-added` apply.
  This is the smallest seam the plugin needs, and it was chosen over two
  others:
  - **Letting the plugin dispatch.** That would hand plugin code the
    timeline reducer, which every other extension point keeps away from
    plugins.
  - **A data-only template registry, with the gallery in core.** That puts
    a plugin's UI in the entry bundle.

  What a contribution places is ordinary project state, owned by no
  plugin, so a contribution-only plugin has no `projectUses`. The registry
  follows the others (`register`/`unregister`/`find`/`list`/`subscribe`/
  `version`). Timeline holds the open dialog by id, so a plugin disabled
  while its dialog is open closes it.

  Since #868 the dialog also receives the timeline's shape groups,
  read-only, so the step badge template can offer the next number. It is
  a read, not a write: the dialog still never dispatches, and core still
  mints every id. A narrower prop carrying only the next badge number was
  the alternative, but it would have put one template's rule into core's
  seam.
- **Title templates plugin** (`src/plugins/titleTemplates/`, #860): a
  gallery of a lower third, a chapter card and an end card, grown in #868
  to thirteen: those three kinds in more styles, a call-out (a box and an
  arrow shape) and a step badge (#689's badge shape, numbered one above
  the timeline's highest badge). Each template
  builds its elements for the project's frame. It measures every line with
  the export's own font string (`textCanvasFont`) under the app's canvas
  measurer, and shrinks a line that would run past the margins. Text
  overlays never wrap. Motion is fades only, because Moves (#834) do not
  apply to text or shapes. No dependencies.
- **Media Library header contributions** (`libraryHeaderContributions` in
  `src/lib/libraryHeader.ts`, built in #861 because the Sound library
  plugin the customer picked on #856 needs it). A contribution is
  `{ id, label, Dialog }`: a button after **Import clips**, in registration
  order, and the dialog it opens. The dialog receives `onImportFiles`, the
  same function Import clips and voice-over recording use, and hands it
  `File`s. So a plugin's media arrives as ordinary library clips: probed,
  named, saved and reopened like any import. The registry follows the
  others (`register`/`unregister`/`find`/`list`/`subscribe`/`version`), and
  the header holds the open dialog by id, so disabling the plugin closes it.
  #856 called this a *media-source registry* that stickers (idea 11) could
  share, but idea 11 was not approved, so it carries only what one source
  needs. A sticker source would fit it unchanged, because it also hands back
  files. Rejected alternative: a data-only sound registry with the dialog in
  core, which would put a plugin's UI in the entry bundle, as with Add ▾.
- **Sound library plugin** (`src/plugins/soundLibrary/`, #861): 13 short
  effects, synthesised by a committed script (`tools/sounds/`), released as
  CC0, and recorded per file in `sounds/manifest.json` and
  `sounds/LICENSES.md`.
  - **Static assets, not code.** The chunk carries the manifest and each
    file's URL, imported as `?url&no-inline`. Without `no-inline`, Vite
    would inline a file under 4 kB, as Click is, into the chunk as a data
    URL. The sounds download only on ▶ or Add.
  - **The bundle check** (`tools/checkPluginChunks.ts`) counts only
    JavaScript chunks. Vite lists these assets in the build manifest under
    `src/plugins/`, but a file is not code that a static import could merge
    into the entry.
  - **No `projectUses`.** An added sound is an ordinary clip.
  - **No runtime dependency.** Generating needs FFmpeg with libopus, but
    the encoded files are committed, so building and running never do.
- **Picture-effect registry** (`src/lib/pictureEffect.ts`, #862, from
  idea 8 the customer approved on #856): a stylised change to a sequence
  entry's picture over a window of its time, kept in the timeline as
  `pictureEffects` keyed to the entry. Built because a vignette and a blur
  for three seconds are a kind of edit nothing else in the model could
  hold: colour adjustments cover a whole entry, and zooms move the frame
  rather than change the picture.
  - **The contract.** A definition carries an id (what timeline state and
    project files record), a menu name, its parameters (key, label, range,
    default, unit), and one pure rule, `look(params, weight, time)`. The rule
    returns a `PictureLook`: filter functions for the picture's source
    pixels, and layers drawn over the frame-shaped card, every size a
    fraction of the frame. The registry mirrors the transition registry's
    `register`/`unregister`/`has`/`subscribe`/`version` for the same
    reasons.
  - **One resolver, two renderers (#66).** `pictureLookAt` in
    `src/lib/pictureLook.ts` picks the effects whose windows hold an
    instant, eases each, and calls the rules. The preview maps the look to
    CSS (`filter` on the media element, a radial-gradient element in the
    card) and the export to the canvas (`filter` around the source draw, a
    radial gradient over the card), so a plugin writes no rendering code,
    as transition packs write none.
  - **Where an effect applies:** to the picture as framed, after the
    entry's zoom and before its transition. A vignette stays on the
    frame's edges while a zoom moves inside it, and travels with the card
    through a push. A blur's radius is a fraction of the frame width, so a
    preview frame and a 1080p export blur alike.
  - **The ease** is the core's, not the rule's: the rule receives a
    weight in [0, 1] and must change nothing at 0. An edge lying on its
    entry's own bounds does not ease, so a split's halves (#919) render as
    the one effect did.
  - **Unregistered types** stay in the project and render as nothing, as a
    disabled plugin's transition stays on the timeline. Project files
    check structure only, and the open flow checks known types after the
    plugin gate (#199's order).
  - **Generated textures (#870).** The rule's third argument, `time`, is
    seconds on the entry's source clock, the clock its window is measured
    on, which `pictureLookAt` passes. A texture is a `PictureLayer` kind
    whose pattern is a pure function of its inputs: Film grain's `grain`
    layer carries a `seed` that the rule sets from `textureStep(time)`,
    24 steps a second (`PICTURE_TEXTURE_RATE`), and `grainTile` turns the
    layer into a tile of pixels through an integer hash, never
    `Math.random()`. Both renderers stretch that one tile over the card
    with smoothing: the preview as a canvas element in the layer box, the
    export with `drawImage`. So the same instant draws the same grain in
    the preview, a saved frame and every export, whatever their frame
    rates. The texture follows the source clock, so it holds through a
    pause as the picture does. `time` is optional in the type, so a
    timeless effect's rule and its tests are unchanged; a caller that
    omits it means 0.
    - **Rejected for textures:** a per-render random pattern, which cannot
      match between renderers (#66); the sequence clock, which an entry's
      effect window does not use; and a canvas-wide noise layer drawn
      after composition, which would not travel with the card through a
      transition or sit inside a zoom's frame as a vignette does.
    - **Filter kinds that vary over time (#870, step 2a).** Old film adds
      two `PictureFilter` kinds, `sepia` and `brightness`, CSS's own
      functions, which the canvas `filter` defines identically. Its
      flicker is a `brightness` whose amount the rule takes from
      `textureHash(textureStep(time), …)`, so a filter that changes per
      frame follows the same pure-function rule as a texture layer, with
      no new mechanism. Sepia and brightness have no size, so unlike a
      blur they ignore the frame width and the zoom's scale.
    - **Sparse texture kinds (#870, step 2a(ii)).** Old film's
      `scratches` and `dust` are layer kinds of the same shape as `grain`:
      a tile that is a pure function of the step's seed, which both
      renderers stretch over the card with smoothing. They differ only in
      being mostly transparent. A scratch is one column of a short tile
      (960 × 27), so it runs the frame's height at 2 px of a 1080p frame,
      and a speck is one cell of a 480-wide tile. Both renderers now draw
      every texture kind through one path, `textureTile` and
      `textureTileKey`, rather than a branch per kind, so a further kind is
      a tile function and a `switch` case. The export keeps one cached
      tile per kind, since Old film draws three a frame. Each kind hashes
      the seed at cells no other kind reaches (negative x), so the
      patterns are independent of one another at the same step.
    - **Scanlines (#870, step 2b(i)).** VHS's `scanlines` is one more
      texture kind: a tile function and a `textureTile` case, as the
      sparse kinds predicted, with no change to either renderer. Its tile
      is one column of 540 rows, alternately clear and black, so the lines
      keep a 4 px period of a 1080p frame at any size, and each line's
      alpha wavers with a hash of the step and the row. VHS's soft blur is
      the existing `blur` filter at a small radius.
    - **Tracking band (#870, step 2b(i)b).** VHS's `tracking` is one
      more texture kind, again with no change to either renderer. Its
      tile is 480 × 270 at any aspect, clear but for a 12-row band of
      white noise. The band is the first texture whose pattern spans
      several steps: whether it shows, and where it starts, are hashed
      from the step's *burst* (12 steps, half a second) rather than the
      step, and it rolls 2 rows a step within the burst, so it reads as
      a tape mistracking for a moment rather than a flash 24 times a
      second. That needs no new input: the burst is a pure function of
      the step the look already passes as `seed`. It lightens, so it
      takes `drawPictureLayers`' dimmed path on a crossfade's outgoing
      card, as the scratches do.
    - **Still to come (#870, then #871).** A per-channel offset (VHS's
      colour bleed and #871's chromatic aberration) would be a new
      `PictureFilter` kind the same way. The contract grows by kinds, not
      by mechanisms.
  - **Rejected:** a rule returning a CSS string, which the canvas could
    take for a blur but not for a vignette or grain, and drawing with
    per-plugin code in each renderer, which is what the shared rule
    exists to prevent.
- **Visual effects plugin** (`src/plugins/visualEffects/`, #862): Vignette
  (Strength, the corner's darkening in percent), Blur (Amount, the
  radius in percent of the frame width) and Film grain (#870: Amount, the
  strongest grain's alpha in percent, and Size, a grain's width in pixels
  of a 1080p frame) and Old film (#870: Amount, scaling its sepia, its
  flicker, a fixed-size grain, its scratches and its dust together) and
  VHS (#870: Amount, scaling its soft blur, its scanlines and its tracking band together). Each is parameters plus a `look`
  rule, with no rendering code and no dependencies. Its ids are top-level
  wiring (`src/plugins/visualEffectsIds.ts`), as with the transition
  packs, so `projectUses` loads no chunk.
- **Font pack plugin** (`src/plugins/fontPack/`, #867): ten SIL OFL 1.1
  faces registered into the font registry (#859), their `woff2` files
  copied from `@fontsource/*` 5.3.0 (Latin subset) with each family's
  licence beside them. No package is a dependency.
  - **Static assets, loaded on use.** As with the Sound library, the chunk
    holds only URLs (`?url&no-inline`). Activating adds each file to
    `document.fonts` as an unloaded `FontFace`, so the browser downloads a
    face the first time something renders with its family. Each family's
    CSS name is `Font Pack <name>`, so an installed copy of the font is
    never used instead.
  - **The export and Save frame await `load`.** A canvas draws the
    fallback face while a font is still downloading, so each font's `load`
    resolves once its faces have. A failed download resolves too, and the
    export then draws the fallback, as the preview does.
  - **`projectUses`** reads text fonts and the subtitle style's font
    against the top-level `src/plugins/fontPackIds.ts`.

### Projects that use plugin features: prompt-and-enable

A project saved using plugin features records its plugin dependencies in the
saved file. Opening it where a needed plugin is disabled prompts the user
and enables the plugin on confirm (phase 2 #197 implements this). Chosen
over silently dropping the feature (quiet data loss) and refusing to open
(worse); with Option A the code is always available, so enabling is safe.

### Phasing

1. This ADR + the export-format registry — pure refactor, no visible change
   (#196).
2. Plugin manager: enable/disable UI, persistence, lazy chunk loading,
   prompt-and-enable (#197).
3. GIF export plugin end to end — proves the whole chain (#198).
4. Transitions pack plugin, after #181 (#199).
5. Only if the customer ever wants third-party plugins: revisit Option B.

## Consequences

- Easier: adding an official plugin is adding a lazily loaded module that
  registers its contributions; core code paths consult registries and need
  no edits. All plugins are tested in the same CI as core.
- Constrained: registry interfaces are contracts — changes must update all
  registered specs and this ADR deliberately, in one PR. Plugin code must
  stay out of the default bundle (lazy chunks; phase 2 adds the mechanism,
  and bundle discipline should be checked in CI once chunks exist).
- Test matrix grows with plugins: plugin features are tested enabled and
  disabled (plugin e2e specs run with the plugin enabled, core specs with
  defaults).
- Harder: users cannot add third-party plugins; a new plugin requires a site
  deploy (automatic here anyway). Accepted explicitly by the customer.
