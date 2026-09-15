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
How the images are taken and retaken is #483.

## Before opening a PR

- Every stated fact checked against the code or the running app, not only
  against the README; say so in the PR, and expect the reviewer to
  spot-check.
- `npm test` runs the compile over these files (`tools/guide/guideContent.test.ts`).
- `npm run dev` recompiles on every save; a compile error shows in the
  browser's overlay with the file and the offending text.
