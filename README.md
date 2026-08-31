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
filename and duration. Audio files (music, voice-overs, sound effects) can
be imported into the media library alongside videos (#100) and placed on the
timeline as audio tracks — each with a start time and trim, overlapping
freely (#102). A video clip's audio can also be extracted into a standalone
audio clip in the library (#154), which keeps working even after the video
itself is removed. The preview plays them mixed with the videos' own audio
(#103), honoring each track's volume and optional fade-in/fade-out and each
video entry's volume and mute (#104), and the exported file carries that
same mix (#105). Still images import into the media library too (#137),
with their pixel dimensions probed and shown with an Image badge, and can
be placed on the timeline as stills with an adjustable duration (5 s by
default, #140) — participating in transitions, zooms, preview, export, and
project files like any clip. Solid-color slates (#143) can be added to the
timeline directly — no import, any 24-bit color, same adjustable duration —
so a video can e.g. open on a red screen that crossfades into a clip.
Transitions between adjacent entries offer a crossfade, four slide
directions, four wipes, and four pushes (#181), rendered identically by the
preview and the exported file from one shared rule. Video
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
the same relative size, position, and fade envelope (#142). Video clips can
also be layered above the sequence as overlays (#145) — picture-in-picture —
each with its own start time, trim, fractional placement rectangle, and
volume/mute, shown in the preview above the base video — and composited the
same way into the exported file, overlay audio in the mix (#146).
Every timeline edit is undoable (#189): Undo/Redo buttons on the timeline
and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) walk a bounded history of
edits back and forward — except while typing in a text field, where the
shortcut stays the browser's own text undo.
The export modal shows the output settings it will use — width, height, and
frame rate, pre-filled with the automatic source-derived values — and lets
them be kept, switched to a named preset (Web 854×480 up to 4K UHD), or
edited freely for that one export (#179).
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
