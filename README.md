# claude-agile-team-demo

An experiment in **repository-driven autonomous software development**.

## The product: Browser Video Editor

The customer asked for a simple video editor that runs entirely in the
browser (#3): import clips, arrange and trim them on a timeline, preview the
result, and export a video file. Projects can be saved to a `.bvep` file and
reopened later (#71, #92): by default the file embeds your media, so that
single file moves to another computer and opens ready to edit with no
re-linking. Choosing "references only" at first save (revisitable via Save
As…) writes a small file with edits and clip metadata instead; opening one
asks you to re-select the original media files and matches them back up by
filename and duration.
The session is also autosaved continuously (#194): the project structure and
the imported media are snapshotted into the browser's own storage shortly
after every edit, and reopening the page after a crash or refresh offers
"Restore last session?" — restoring brings back the timeline and the media
with no file re-picking. If the media outgrows browser storage, autosave
unobtrusively degrades to keeping the structure only, and restore then asks
for the media files again via the usual re-link dialog. Audio files (music, voice-overs, sound effects) can
be imported into the media library alongside videos (#100) and placed on the
timeline as audio tracks — each with a start time and trim, overlapping
freely (#102). A video clip's audio can also be extracted into a standalone
audio clip in the library (#154), which keeps working even after the video
itself is removed. Voice-overs can be recorded directly into the library
(#224): a Record button beside Import offers a Microphone source (browsers
ask for permission; the control hides entirely where recording is
unsupported), and stopping the capture adds it as an ordinary audio clip —
`Voice-over 1` — placeable, trimmable, mixable, and exportable like any
imported audio file, autosave included. The same menu offers a Screen
source (#225): the browser's own tab/window/display picker starts a capture
— with tab/system audio kept when the browser grants it — shown live in
the recording dialog, and stopping (our Stop button or the browser's own
"stop sharing") adds it as an ordinary video clip, `Screen recording 1`,
ready to trim, overlay, transition, and export; the source hides where
`getDisplayMedia` is unavailable. A Webcam source (#226) records camera
video plus microphone audio the same way — a live self-view in the dialog,
the clip landing as `Webcam recording 1`, ready to layer as a
picture-in-picture commentary bubble; a camera without a microphone still
records, video-only. A references-only project file
cannot re-link a recording (it never existed on disk); save with embedded
media to carry recordings across machines. The preview plays them mixed with the videos' own audio
(#103), honoring each track's volume and optional fade-in/fade-out and each
video entry's volume and mute (#104), and the exported file carries that
same mix (#105). Video entries and video overlays take the same optional
audio fade-in/fade-out (#220): their sound ramps from silence to the item's
volume and back, identically in the preview and the exported mix, and a
fade on a transition boundary rides the crossfade.
An audio track can duck the rest of the mix (#241): with "Duck others" on,
every other sound source — other tracks, video entries' audio, overlay-video
audio — drops to the track's duck level (25% by default, adjustable) while
it audibly plays, ramping smoothly down just before its window and back up
after, with brief gaps merged so a voice-over's pauses don't pump the music.
The ducking track itself is never ducked, preview and export apply the
identical rule, and the setting persists with the project. Still images import into the media library too (#137),
with their pixel dimensions probed and shown with an Image badge, and can
be placed on the timeline as stills with an adjustable duration (5 s by
default, #140) — participating in transitions, zooms, preview, export, and
project files like any clip. Solid-color slates (#143) can be added to the
timeline directly — no import, any 24-bit color, same adjustable duration —
so a video can e.g. open on a red screen that crossfades into a clip.
Transitions between adjacent entries offer a crossfade, four slide
directions, four wipes, four pushes, fades through black and white, an
opening and a closing iris, and a cross-zoom (#181), rendered identically by
the preview and the exported file from one shared rule. Video
entries can be time-remapped (#138, #141, #144): any number of speed segments
(e.g. 0.5× slow motion or 1.5× speed-up over part of a clip) and pauses
(freeze one frame for a chosen time), edited on the timeline and honored by
the preview's playback, scrubbing, and sequence timing — and by the exported
file, which plays the same remapped timing. Text overlays (#139) — titles,
subtitles, labels — can be added to the timeline with editable content
(multi-line), timing, position, font (curated system stacks), size relative
to the frame, any color, bold/italic, and per-overlay fade-in/fade-out
durations (#177), rendering in the preview above the composed frame for
their window — and in the exported file, which draws the same overlays with
the same relative size, position, and fade envelope (#142). Subtitles can be
imported from a standard .srt file (#249): every cue lands as an ordinary
text overlay timed to the cue, bottom-center at a readable caption default,
individually editable like any other, with skipped/malformed cue blocks
reported in the library's failure list. A per-project default subtitle
style (#250) — font, size, color, bold/italic, position, edited beside the
import control — restyles every imported subtitle at once, at import time
or any time after; a property edited on an individual cue is pinned and
keeps its value through later default changes, while the cue's other
properties keep following. Video clips can
also be layered above the sequence as overlays (#145) — picture-in-picture —
each with its own start time, trim, fractional placement rectangle, and
volume/mute, shown in the preview above the base video — and composited the
same way into the exported file, overlay audio in the mix (#146).
Every timeline row shows a coverage bar for where the item plays in the
composed timeline (#180) — per-section colors (green video, amber image,
the slate's own color, blue audio, purple overlays, magenta text), all
scaled to the video sequence's duration, with anything past the video's
end clamped (it never plays). Every sound-bearing bar draws its clip's
audio amplitude as a waveform (#191, #230): audio tracks, video entries,
and video overlays alike — soundless items (stills, slates, clips whose
audio cannot be decoded) keep the plain bar.
Video entries and overlay rows also carry a small thumbnail (#193) — the
first frame of the trimmed range, re-captured when the in-point changes;
image entries show the image itself and slates a color swatch. Thumbnails
are session state, recomputed from the media — never stored in project
files.
Video and image entries (and video overlays) take per-clip color
adjustments (#192): brightness, contrast, and saturation dials (0–200%)
plus one-click grayscale and sepia looks, edited on the timeline row,
rendered live in the preview, saved with the project, and rendered
identically in exports (#195) — GIFs included, through the shared frame
pipeline. A browser whose canvas cannot apply filters refuses to export an
adjusted timeline rather than silently exporting it unadjusted.
They also take an orientation (#232): rotate 90°/180°/270° and flip
horizontal/vertical on the timeline row — the fix for sideways phone
footage and mirrored webcam clips — rendered live in the preview, saved
with the project, and composing with zooms, transitions, and color
adjustments; a quarter-turned clip letterboxes into the frame like any
portrait source, and reshapes the output frame the same way. Exports
render orientation through the same shared rule (#233) — GIFs included,
through the shared frame pipeline.
They also take a crop (#255): trim a percentage off each edge on the
timeline row — chrome strips in screen recordings, headroom in webcam
clips — and only the kept region renders in the preview, applied before
orientation, reshaping the output frame like any source and saved with the
project (each axis always keeps at least a tenth). Exports render crop
through the same shared rule (#256).
They also take a background fill (#259): what shows behind a clip that
doesn't fill the output frame — a portrait phone clip in a landscape
sequence, a quarter-turned or cropped clip — chosen on the timeline row:
none (the default black bars), a blurred cover-fit copy of the clip's own
current frame (the familiar social-video blur-fill), or a flat color. The
backdrop renders live in the preview behind the normally fitted clip,
never reshapes the output frame, and saves with the project. Exports —
the video formats, the GIF plugin, and frame snapshots alike — render
the fill through the same shared rule (#260).
Every timeline edit is undoable (#189): Undo/Redo buttons on the timeline
and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) walk a bounded history of
edits back and forward — except while typing in a text field, where the
shortcut stays the browser's own text undo.
The preview answers transport keys (#203): Space plays/pauses, ← / → step
the playhead 0.1 s (1 s with Shift), Home/End jump to the sequence bounds,
and ? opens a cheat sheet of every shortcut — all inert while typing in a
field or while a dialog is open, so no control loses its own keys.
A ✂ Split button beside the preview's transport cuts the entry under the
playhead into two independently trimmable, removable halves (#190) — the
razor. An untouched split plays back and exports exactly like the original;
per-entry effects follow the cut (speed segments and pauses split exactly,
zooms move to or split with the half that shows them), and the button
disables where there is nothing to split — entry boundaries and transition
overlaps.
A 📷 Save frame button on the same transport downloads the exact frame under
the playhead as a PNG at the output resolution (#237) — composed through the
export's own draw path, so transitions mid-overlap, zooms, color
adjustments, orientation, video overlays, and text render exactly as an
export of that moment would.
The export modal shows the output settings it will use — width, height, and
frame rate, pre-filled with the automatic source-derived values — and lets
them be kept, switched to a named preset (Web 854×480 up to 4K UHD), or
edited freely for that one export (#179). An "Audio only (WebM/Opus)"
format (#245) saves just the project's mixed soundtrack — the same mix a
video export records, with no video track — hiding the video-only output
settings while it is selected.
A Plugins… button opens the plugin manager (#197): optional built-in
features ship as lazy-loaded modules that download only when enabled, keeping
the default editor lightweight (see
[`docs/adr/0003-plugin-architecture.md`](docs/adr/0003-plugin-architecture.md)).
Enabled plugins are remembered per browser and re-activate on the next
visit; a project saved using plugin features records that dependency, and
opening it prompts to enable what it needs. The first official plugin is
GIF export (#198): enabling it adds an "Animated GIF" format to the export
dialog — the full composed timeline, encoded soundless at 10 fps and
downscaled to at most 480 px (the limits are stated beside the format) so
files stay manageable.
Side-by-side layouts compose from the same pieces: use a color
slate as the base entry and place two or more overlays in halves or
quadrants. It is
deployed
automatically from `main` to GitHub Pages:
**https://pcowhill.github.io/claude-agile-team-demo/**

Stack: Vite + TypeScript + React, tested with Vitest and React Testing
Library, linted with oxlint — see
[`docs/adr/0001-frontend-stack-and-deployment.md`](docs/adr/0001-frontend-stack-and-deployment.md).

### Development

```bash
npm ci             # install dependencies (Node 22)
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright — see "Browser tests" below)
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # production build to dist/
npm run check:bundle  # after build: plugin chunks stay out of the entry bundle (#197)
```

#### Browser tests

`npm run test:e2e` finds a Chromium by itself and needs no environment
variable. It prefers the revision Playwright pins, and falls back to any
other Chromium already installed in the browsers directory — which is what
sandboxed agent containers ship, at a revision that rarely matches the pinned
one. When nothing usable exists it says so, and names both remedies:

```bash
npx playwright install chromium               # ordinary machines
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm run test:e2e   # pre-installed browser
```

The override wins over both, and must point at the browser binary rather
than the directory holding it. See [`tools/chromiumExecutable.ts`](tools/chromiumExecutable.ts)
for the resolution order and issue #24 for the failure it replaces.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and build on
every PR and push to `main`; merged changes deploy to GitHub Pages via
`.github/workflows/deploy.yml`. CI installs the pinned revision, so it takes
the first branch above and is unaffected by the fallback.

This repository is built and maintained by a succession of independent
Claude Code sessions acting as an agile software team — product manager,
developer, reviewer, QA engineer, release engineer, maintainer. Each session
is started with essentially one instruction (`Go`) and orients itself
entirely from the persistent state in this repository and its GitHub Issues,
Pull Requests, comments, and CI results. The full operating model lives in
[`CLAUDE.md`](CLAUDE.md) and [`docs/rules/`](docs/rules/).

There is no predetermined product. What gets built is decided by the human
**customer** through GitHub. The repository's history — issues, PRs, reviews,
decisions — is itself an artifact of the experiment.

## How to interact with the team (for the customer)

- **Ask for anything / give feedback:** open an issue using the *Customer
  feedback* template. Write informally — no user stories, acceptance
  criteria, or technical detail required. The team translates it into
  actionable work.
- **Answer questions:** the team asks for your judgment via issues labeled
  `customer-question`, assigned to you. Reply with a normal comment.
- **Approve AI ideas:** the team may propose product ideas (labeled `idea` +
  `ai-generated`). They are built only if you add the `customer-approved`
  label. Closing an unapproved idea rejects it.
- **Set priorities:** say so in issues, or use the linked GitHub Project's
  Priority field (P0–P3).

Everything else — triage, implementation, review, merging, releasing — is
handled by the AI team through ordinary GitHub workflow.

## Key guarantees the team operates under

- GitHub Issues and PRs are the single source of truth for work.
- The session that authors a PR never reviews or merges it; an independent
  session does.
- AI-proposed product ideas never become scope without explicit customer
  approval.
- Test results are only ever claimed from real execution or CI evidence.
