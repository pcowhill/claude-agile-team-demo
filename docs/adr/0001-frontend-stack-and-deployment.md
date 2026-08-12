# 0001. Frontend stack, testing tooling, and deployment approach

- Status: accepted
- Date: 2026-08-12
- Links: #3 (customer feedback), #4 (foundation issue)

## Context

The customer asked for a video editing application that runs entirely in the
browser and is served from GitHub Pages (#3), explicitly leaving interface
and technical choices to the team. The product therefore must be a purely
client-side web application — no backend is possible on Pages. The stack must
support automated testing and CI (`.claude/rules/quality-and-ci.md`), and the
editor will need non-trivial interactive state (media library, timeline,
trims, playback position) plus access to browser media APIs (`<video>`,
canvas, MediaRecorder, WebCodecs).

## Decision

- **Language:** TypeScript (strict mode). Media-handling code has enough
  invariants (durations, trim ranges, sequence offsets) that static typing
  pays for itself immediately.
- **Framework:** React 19 with function components. The editor UI is
  state-heavy and benefits from declarative rendering; React is also the
  ecosystem where future sessions will find the most prior art and library
  support.
- **Build tool:** Vite. Fast dev server, first-class TypeScript/React
  support, static output that maps directly onto GitHub Pages
  (`base: '/claude-agile-team-demo/'`).
- **Unit tests:** Vitest + React Testing Library (jsdom). Vitest shares
  Vite's config and transform pipeline.
- **Lint:** oxlint (the linter the current Vite React template ships with) —
  zero-config, very fast, covers correctness rules including rules-of-hooks.
  If deeper custom rules are ever needed, swapping to ESLint is cheap.
- **Type gate:** `tsc -b` runs as its own CI step.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`): install → lint →
  typecheck → test → build on PRs to `main` and pushes to `main`.
- **Deployment:** GitHub Actions Pages workflow
  (`.github/workflows/deploy.yml`) builds `main` and deploys `dist/` via
  `actions/deploy-pages`, targeting
  https://pcowhill.github.io/claude-agile-team-demo/.

## Consequences

- All video processing must happen client-side; export (#9) will rely on
  browser APIs such as MediaRecorder or WebCodecs — capability varies by
  browser and should be feature-detected.
- Browser/end-to-end tests (expected from #5 onward) are not yet configured;
  Playwright is the natural fit with this stack and should be added when the
  first real UI flow needs it.
- The Vite `base` path couples the build to this repository's name; renaming
  the repo or moving to a custom domain requires updating `vite.config.ts`.
- React and Vite are mainstream and easily staffed by future sessions;
  alternatives considered — vanilla TS (rejected: state complexity will grow
  quickly), Svelte/Vue (rejected: no customer preference, React maximizes
  familiarity), a framework-level editor library (rejected: MVP first,
  dependencies can come later if needed).
