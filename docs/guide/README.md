# Writing the user guide

This directory is the user guide's source (#478, from the approved design
#477 and the customer's request #476). One Markdown file per section;
`contents.json` lists the sections in reading order. The build compiles the
files into the app's Help ▾ → User guide… panel (`tools/guide/`), and the
same compile runs as a unit test, so a broken link or a stray tag fails
`npm test` and `npm run build` with the file and the offending text.

This file is the authoring guide and is not itself a section.

## A section

- The file name is the section's id — `undo-redo.md` is reached as
  `#guide/undo-redo` and linked as `undo-redo.md`. Lower-case words and
  hyphens only.
- The file begins with exactly one `# Title`. Everything below it uses
  `##`, `###` and `####`; nothing deeper.
- Every heading gets an anchor from its text: lower-cased, runs of anything
  but letters and digits collapsed to one hyphen, ends trimmed. *Duck
  others* → `#duck-others`; *Save / Save As…* → `#save-save-as`. Two
  headings in one section may not share an anchor.
- Add the id to `contents.json` where the section belongs. A file that is
  not listed, or a listing without a file, fails the build.

## A feature page

Every feature gets the same shape, so nothing is left out and a reader
knows where to look:

```markdown
## Duck others

**Where to find it.** Timeline › an audio track's row › Audio group › *Duck others*.

**What it does.** …one or two sentences…

**Details.** Defaults, limits, what it does *not* do, edge cases, how it
interacts with preview and export, whether it saves with the project.

**Related.** [Volume](#volume) · [Audio tracks](timeline.md#audio-tracks)

**Shortcuts.** None. (Omit the line when there are none.)
```

An overview at the top of a section — *Timeline*, *Export* — exists to be a
map: **the first time it mentions a feature by name, that name is a link
to the feature's page.**

## Links

- To another section: `[Undo](undo-redo.md)`.
- To a heading in another section: `[Undo](undo-redo.md#undo)`.
- To a heading in this section: `[the duck level](#the-duck-level)`.
- To the web: `[MDN](https://developer.mozilla.org/)`. Opens in a new tab.

A link to a section or heading that does not exist fails the build. Nothing
else — a relative path, a `javascript:` URL — is accepted.

## Numbers the code owns

Where the guide states a value the code decides — how many undo steps are
kept, how long a still shows, the default duck level — write a placeholder
instead of the number:

```markdown
The history keeps the last {{HISTORY_LIMIT}} edits.
```

The panel fills it from the constant when it renders, so the guide cannot
say "100" after the code says 200. The names live in
`src/lib/guide/constantNames.ts` with their values in
`src/lib/guide/constants.ts`; add a pair there to use a new one. An
unknown placeholder fails the build. Some values are live settings — the
arrow-key step sizes — and read the value in force.

## The generated shortcut table

The Keyboard shortcuts section is not written by hand. Its table comes from
`src/lib/shortcuts.ts` — the same table the `?` cheat sheet renders — so
the two can never disagree, and it shows the arrow-key step sizes in force.
The page writes an empty fenced block whose info string is `shortcuts`:

    ```shortcuts
    ```

The build turns it into the table; a `shortcuts` block with content in it
fails the build. Adding or changing a shortcut means editing
`src/lib/shortcuts.ts`, which updates both.

## What Markdown is allowed

Headings, paragraphs, `**bold**`, `*emphasis*`, `` `inline code` `` for
control names and keys, bullet and numbered lists (nested is fine),
tables, blockquotes, fenced code blocks, horizontal rules, links and
images.

**Raw HTML is rejected.** Write `` `<video>` `` in backticks when you mean
the tag. Task-list checkboxes and strikethrough are not supported.

## Images

Screenshots belong in **Quick Start only** — the customer's decision on
#477 (question 2). Every other section is text; it says exactly where a
control is instead. An image needs alt text that says what the reader
should see: `![The empty editor with the library on the left](images/empty.png)`.
The files live in `docs/guide/images/`; a picture the Markdown names but
the directory lacks fails the build, like a broken link, and the images
ship with the guide's lazy chunk, never in the entry bundle.

**Screenshots are taken by a script, never by hand** (#483), so a UI change
is followed by one command rather than a session with a cropping tool:

```sh
npm run guide:screenshots
```

It drives the app through Quick Start's steps in Chromium on the two
fixture clips in `e2e/guide-fixtures/` and rewrites every image. The
clips are committed so a retake changes only what the UI changed;
`npm run guide:fixtures` re-records them, which is needed only to change
the clips themselves. A frame is captured only once two consecutive
captures agree, and an existing image is kept when the new capture
differs from it by rasterizer noise alone — Chromium draws a rounded
corner's anti-aliased pixels one shade apart between otherwise identical
runs — so a retake rewrites a file only when the UI changed; the run
prints *unchanged*, *kept* or *rewritten* for each image. A retake on
another machine differs in the text's pixels (its fonts), which is a
retake, not a defect. Keep the set small — the current budget is stated
in the PR that last retook it — and the pictures in Quick Start only;
`tools/guide/guideContent.test.ts` counts them.

## Before opening a PR

- Every stated fact checked against the code or the running app, not only
  against the README; say so in the PR, and expect the reviewer to
  spot-check.
- `npm test` runs the compile over these files (`tools/guide/guideContent.test.ts`).
- `npm run dev` recompiles on every save; a compile error shows in the
  browser's overlay with the file and the offending text.
