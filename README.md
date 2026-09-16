# claude-agile-team-demo

An experiment in **repository-driven autonomous software development**.

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

## The product: Browser Video Editor

A video editor that runs entirely in the browser (#3). Import video, image
and audio clips — or record from a microphone, the screen, a webcam, or the
screen and camera at once — arrange and trim them on a timeline, layer
overlays and text over the sequence, preview the result, and export a video
or audio file. Everything happens on the machine it runs on: no upload, no
account, no server. Projects save to a `.bvep` file and reopen later, and
the session is autosaved continuously so a crash or a refresh loses nothing.

**Try it: https://pcowhill.github.io/claude-agile-team-demo/**

## What the editor does: the user guide

**The user guide is the product's documentation.**
[Open it in the app](https://pcowhill.github.io/claude-agile-team-demo/#guide/quick-start),
or press **F1** — or **Help ▾ → User guide…** — anywhere in the editor. It
opens as a panel docked beside the editor — over it on a narrow screen — so
a control can be read about while being looked at, and it has a search field
and a table of contents.

Every control, menu item, setting, dialog and keyboard shortcut is explained
there, and its
[Feature Index](https://pcowhill.github.io/claude-agile-team-demo/#guide/feature-index)
lists them all alphabetically, each linking to the page that explains it.

That index is not a promise but a check (#485): `e2e/feature-index.spec.ts`
walks the running editor in CI and fails the build naming any control the
guide does not list. A feature cannot quietly outrun its documentation.

**This README deliberately no longer describes the features** (#486). Two
descriptions of one editor drift apart, and only one of them is tested
against the app. The guide's source is Markdown under
[`docs/guide/`](docs/guide/README.md), compiled into the app at build time
and loaded lazily — see
[ADR 0005](docs/adr/0005-user-guide-markdown-compiler.md).

## Stack and architecture

Vite + TypeScript + React; unit-tested with Vitest and React Testing
Library, browser-tested with Playwright, linted with oxlint. Deployed
automatically from `main` to GitHub Pages.

Decisions whose reasoning outlives their commit are recorded in
[`docs/adr/`](docs/adr/):

| ADR | Decision |
| --- | --- |
| [0001](docs/adr/0001-frontend-stack-and-deployment.md) | Frontend stack, testing tooling, and deployment approach |
| [0002](docs/adr/0002-overlay-video-layers.md) | Overlay video layers over a single base sequence |
| [0003](docs/adr/0003-plugin-architecture.md) | Plugin architecture: built-in optional modules behind registries |
| [0004](docs/adr/0004-mp3-encoder-dependency.md) | MP3 export encodes with a pure-JS LAME port |
| [0005](docs/adr/0005-user-guide-markdown-compiler.md) | The user guide: Markdown compiled at build time |

### Development

```bash
npm ci             # install dependencies (Node 22)
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright — see "Browser tests" below)
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # production build to dist/
npm run check:bundle  # after build: plugin and user-guide chunks stay out of the entry bundle (#197, #478)
```

The user guide's text lives in `docs/guide/` — see
[`docs/guide/README.md`](docs/guide/README.md) for how to write a section
and what the build checks.

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
- Every user-facing change updates `docs/guide/` in the same PR, and CI
  fails when a control in the app has no Feature Index entry.
