# 0005. The user guide: Markdown compiled at build time, rendered as structure

- Status: accepted
- Date: 2026-09-15
- Links: #476 (customer feedback: *Make a User Guide for the Application*),
  #477 (the design, approved by the customer with one change), #478 (this
  ADR's PR: the infrastructure), #479–#486 (content, index, process rule,
  screenshots, README hand-over)

## Context

The customer asked for an in-app, searchable, cross-linked guide that
explains every feature, and approved a design (#477) that puts it in a
panel docked beside the editor, written as Markdown in the repository so
it is reviewable in pull requests like code. Three things about *how* the
Markdown reaches the browser needed deciding, each expensive to reverse
once content PRs are written against it:

1. **Where the Markdown is parsed.** In the browser at runtime (ship a
   parser), or at build time (ship a structure).
2. **What the app renders.** HTML produced by the parser, or a structure
   of the app's own that React components render.
3. **How code-owned numbers reach the prose** — the undo history's limit,
   a still's default duration — without being retyped.

## Decision

**Parse at build time with `marked`, a development dependency; ship a
structured document; render it with React; fill placeholders at render
time.**

- `tools/guide/compileGuide.ts` walks `marked`'s lexer tokens into a
  `GuideDocument` (`src/lib/guide/document.ts`): sections → headings with
  stable anchors → blocks (paragraph, list, table, blockquote, code, rule)
  → inlines (text, emphasis, code, link, image, placeholder). It rejects
  raw HTML, unknown placeholders, links to sections or headings that do
  not exist, duplicate anchors, and headings with nothing to anchor —
  every problem in one message naming the file and the offending text.
- A Vite plugin (`tools/guide/vitePlugin.ts`) runs the compiler over
  `docs/guide/*.md` in the order `contents.json` gives and exposes the
  result as the virtual module `virtual:user-guide`. The same compile runs
  in `npm test` over the real files (`tools/guide/guideContent.test.ts`).
- The panel (`src/guide/UserGuide.tsx`) imports that module and is itself
  a `React.lazy` chunk, so the compiled guide, its search index and its
  renderer download the first time the guide opens; the entry bundle does
  not grow, and `npm run check:bundle` fails if it does (the plugins'
  rule, ADR 0003, extended to the guide).
- `{{NAME}}` in the prose becomes a placeholder node, validated at compile
  time against the names in `src/lib/guide/constantNames.ts` and filled
  when rendered from `src/lib/guide/constants.ts`, whose entries read the
  constants the code owns. The panel's search indexes the filled text.
- The panel's place is the URL hash, `#guide/<section>/<anchor>`
  (`src/lib/guide/location.ts`), so sections are bookmarkable and Back
  walks the panel's history.

### Why `marked`, and why only at build time

`marked` is small, has a lexer that yields a plain token tree without
rendering anything, and is used here only for that lexer. It never reaches
the browser: the app has no Markdown parser and no HTML injection. That is
the property the design asked for — "the app renders the structure with
its own React components; no HTML injection" — and it is what makes an
internal link navigate the panel rather than the page (the renderer sees a
`link` node with a resolved target, not an `<a href>`), and what lets the
build, not the reader, discover a broken link.

### Why placeholders are filled at render time, not compile time

The compiler runs in the build against Node's type library and must not
import app modules that type against the DOM; the constants live in such
modules (`history.ts`, `timeline.ts`). Splitting *names* (a leaf module the
compiler validates against) from *values* (an app module the panel reads)
keeps the compiler pure and the build's type-check honest. It also gives
the guide live values for free: the arrow-key step sizes are settings, and
the same table fills them from the settings in force, exactly as the
cheat sheet does (#286). A name added without a value is a type error.

## Alternatives considered

- **Parse in the browser with `react-markdown` or `marked` at runtime.**
  Simplest to build, but ships a parser and an HTML sanitiser to every
  visitor, renders HTML the app did not author, and cannot fail the build
  on a broken link — the reader would find it. Rejected for the properties
  above.
- **Hand-written parser for the allowed subset.** No dependency and total
  control, but a second Markdown implementation to maintain and the
  usual edge cases (nested lists, table cells with inline code) to get
  wrong; `marked`'s lexer costs nothing at runtime, so the saving is nil.
- **A separate documentation site** (MkDocs, Docusaurus) under `/guide/`.
  Weighed in #477 §8 and not chosen by the customer: a second toolchain
  and deploy, no live values, no future contextual help from controls.
- **Compile-time substitution of constants** by adding `DOM` to the tools'
  type library so the plugin could import app modules. Works, but widens
  the tools' type environment for one import and gives up live values.

## Consequences

- Authors write ordinary Markdown under the rules in `docs/guide/README.md`;
  a mistake fails `npm test` and `npm run build` with the file and text.
- Adding a code-owned number to the prose means adding a name and a value
  (`constantNames.ts`, `constants.ts`) — a small tax that is the point.
- Images are accepted by the compiler (`![alt](images/x.png)`) but their
  asset pipeline is #483's; the customer wants a few in Quick Start only.
- Nothing about the panel's rendering depends on the parser's output
  shape beyond the compiler, so swapping `marked` for another lexer later
  touches one file and its tests.
