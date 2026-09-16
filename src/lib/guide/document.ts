/**
 * The compiled user guide (#478, from the approved design #477): what the
 * build turns `docs/guide/*.md` into, and what the in-app panel renders.
 *
 * A structure rather than HTML on purpose. Rendering from a structure is
 * what lets a link inside the guide navigate the panel instead of the page,
 * lets a `{{PLACEHOLDER}}` be filled from the running app's constants, and
 * keeps the Markdown parser out of the browser: the app never injects
 * markup it did not build itself.
 *
 * This module is types only and imports nothing, so both the compiler under
 * `tools/guide/` (type-checked against Node's lib) and the app (checked
 * against the DOM's) can share it.
 */

/** Where an internal link goes: a section, and optionally a heading in it. */
export interface GuideLinkTarget {
  section: string
  anchor: string | null
}

export type GuideInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; inlines: GuideInline[] }
  | { kind: 'em'; inlines: GuideInline[] }
  | { kind: 'code'; text: string }
  /** `target` is null for an external (https) link. */
  | { kind: 'link'; href: string; inlines: GuideInline[]; target: GuideLinkTarget | null }
  | { kind: 'image'; src: string; alt: string }
  /** `{{NAME}}` in the source: filled at render time from the app's constants. */
  | { kind: 'placeholder'; name: string }
  | { kind: 'break' }

export type GuideCellAlign = 'left' | 'center' | 'right' | null

export interface GuideTableCell {
  inlines: GuideInline[]
  align: GuideCellAlign
}

export interface GuideListItem {
  blocks: GuideBlock[]
}

export type GuideBlock =
  | { kind: 'heading'; level: 2 | 3 | 4; anchor: string; inlines: GuideInline[]; text: string }
  | { kind: 'paragraph'; inlines: GuideInline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: GuideListItem[] }
  | { kind: 'table'; header: GuideTableCell[]; rows: GuideTableCell[][] }
  | { kind: 'blockquote'; blocks: GuideBlock[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  /**
   * The keyboard-shortcut table, generated at render time from the same
   * `shortcutsFor` the cheat sheet uses (#482, design #477 §6), so the two
   * cannot disagree. Written in the source as an empty fenced block with the
   * info string `shortcuts`.
   */
  | { kind: 'shortcuts' }

/** A heading's entry in the section's table of contents and link targets. */
export interface GuideHeading {
  level: 2 | 3 | 4
  anchor: string
  text: string
}

export interface GuideSection {
  /** The source file's name without `.md` — what links and URLs use. */
  id: string
  /** The file's single `#` heading. */
  title: string
  headings: GuideHeading[]
  blocks: GuideBlock[]
}

export interface GuideDocument {
  /** In table-of-contents order (`docs/guide/contents.json`). */
  sections: GuideSection[]
}
