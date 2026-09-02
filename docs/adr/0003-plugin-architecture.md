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
  video-only.
- **Plugin runtime** (`src/lib/plugins.ts`, phase 2 #197): the catalog entry
  contract — id, name, description, version, a `load()` that must be a
  dynamic `import()` of a module under `src/plugins/` (so the code ships as
  a lazy chunk, enforced in CI), and an optional `usedByProject` predicate
  behind project-dependency recording. A plugin module exports
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
- **Transitions registry**: deliberately *not* built yet; it comes with the
  transitions pack plugin (phase 4 #199), after the core transitions (#181)
  landed in core (they were an unconditional customer ask).

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
