import { Marked } from 'marked'
import type { Token, Tokens } from 'marked'
import type {
  GuideBlock,
  GuideDocument,
  GuideHeading,
  GuideInline,
  GuideLinkTarget,
  GuideListItem,
  GuideSection,
  GuideTableCell,
} from '../../src/lib/guide/document.ts'

/**
 * The user guide's compiler (#478, from the approved design #477 §2): the
 * Markdown under `docs/guide/` in, a `GuideDocument` out — or a
 * `GuideCompileError` naming every problem, so a PR that adds a bad link
 * or a stray `<div>` fails the build with the file and the offending text
 * rather than shipping a guide that renders wrong.
 *
 * Pure: strings in, structure out. `marked` lexes; nothing here renders.
 * The Vite plugin (`vitePlugin.ts`) feeds it the real files and turns the
 * result into a virtual module the app imports lazily; the unit tests feed
 * it fixtures. The parser is a development-time dependency only (ADR 0005).
 *
 * What is allowed — headings 2–4 under one `#` title, paragraphs, lists,
 * tables, emphasis, inline code, fenced code, blockquotes, rules, links,
 * images, `{{PLACEHOLDER}}`s and the ```shortcuts directive (#482) — and what is rejected (raw HTML, unknown
 * placeholders, links that go nowhere) is written down for authors in
 * `docs/guide/README.md`; keep the two in step.
 */

export interface GuideSource {
  /** The section id links and URLs use: the file's name without `.md`. */
  id: string
  /** For messages: the path a reader can open. */
  fileName: string
  text: string
}

export interface CompileOptions {
  /** Section ids in table-of-contents order; every source must be listed. */
  order: readonly string[]
  /** The `{{NAMES}}` the source may use (`src/lib/guide/constantNames.ts`). */
  constantNames: readonly string[]
}

export class GuideCompileError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(
      `The user guide did not compile (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    )
    this.name = 'GuideCompileError'
    this.problems = problems
  }
}

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g
const EXTERNAL_LINK = /^(https?:)?\/\//
const SECTION_LINK = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md(?:#(.*))?$/

/**
 * A heading's anchor: its plain text lowercased, runs of anything but
 * letters and digits collapsed to one hyphen, ends trimmed. Stable across
 * rewordings that keep the words, and what a hand-written link can predict.
 */
export function anchorFor(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The plain text of inlines, for anchors and table-of-contents entries. */
export function plainTextOf(inlines: readonly GuideInline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
        case 'code':
          return inline.text
        case 'strong':
        case 'em':
        case 'link':
          return plainTextOf(inline.inlines)
        case 'image':
          return inline.alt
        case 'placeholder':
          return inline.name
        case 'break':
          return ' '
      }
    })
    .join('')
}

/** A link's parsed destination; `kind: 'invalid'` carries the reason. */
type LinkDestination =
  | { kind: 'external' }
  | { kind: 'internal'; section: string | null; anchor: string | null }
  | { kind: 'invalid'; reason: string }

function parseLinkHref(href: string): LinkDestination {
  if (EXTERNAL_LINK.test(href)) return { kind: 'external' }
  if (href.startsWith('#')) {
    const anchor = href.slice(1)
    return anchor.length === 0
      ? { kind: 'invalid', reason: 'an empty anchor' }
      : { kind: 'internal', section: null, anchor }
  }
  const match = SECTION_LINK.exec(href)
  if (match === null) {
    return {
      kind: 'invalid',
      reason: 'a link must be another guide file (`name.md`, `name.md#heading`), `#heading`, or an https URL',
    }
  }
  const [, section, anchor] = match
  if (anchor === '') return { kind: 'invalid', reason: 'an empty anchor' }
  return { kind: 'internal', section, anchor: anchor ?? null }
}

/** One unresolved internal link, checked once every section's anchors are known. */
interface PendingLink {
  fileName: string
  href: string
  target: GuideLinkTarget
  /** Filled in by the resolution pass, so the block tree is built once. */
  node: Extract<GuideInline, { kind: 'link' }>
}

/**
 * Compiles one file's tokens into a section, collecting the problems and
 * the links to resolve later. A class rather than closures so the per-file
 * state (anchors seen, the section id) is one object.
 */
class SectionCompiler {
  readonly problems: string[] = []
  readonly pendingLinks: PendingLink[] = []
  readonly headings: GuideHeading[] = []
  private readonly anchors = new Set<string>()
  private readonly source: GuideSource
  private readonly constantNames: ReadonlySet<string>

  constructor(source: GuideSource, constantNames: ReadonlySet<string>) {
    this.source = source
    this.constantNames = constantNames
  }

  private problem(message: string, offending?: string): void {
    const where = `${this.source.fileName}: ${message}`
    this.problems.push(offending === undefined ? where : `${where} — "${offending.trim()}"`)
  }

  compile(tokens: readonly Token[]): GuideSection | null {
    const [first, ...rest] = tokens.filter((token) => token.type !== 'space')
    if (first === undefined || first.type !== 'heading' || (first as Tokens.Heading).depth !== 1) {
      this.problem('the file must begin with a single `#` title heading')
      return null
    }
    const title = plainTextOf(this.inlines((first as Tokens.Heading).tokens))
    if (title.length === 0) this.problem('the title heading is empty')
    const blocks = this.blocks(rest)
    return { id: this.source.id, title, headings: this.headings, blocks }
  }

  private blocks(tokens: readonly Token[]): GuideBlock[] {
    const blocks: GuideBlock[] = []
    for (const token of tokens) {
      const block = this.block(token)
      if (block !== null) blocks.push(block)
    }
    return blocks
  }

  private block(token: Token): GuideBlock | null {
    switch (token.type) {
      case 'space':
      case 'def':
        return null
      case 'heading':
        return this.heading(token as Tokens.Heading)
      case 'paragraph':
        return { kind: 'paragraph', inlines: this.inlines((token as Tokens.Paragraph).tokens) }
      // A list item's text is a block-level `text` token carrying inlines.
      case 'text':
        return { kind: 'paragraph', inlines: this.inlines((token as Tokens.Text).tokens ?? []) }
      case 'list':
        return this.list(token as Tokens.List)
      case 'table':
        return this.table(token as Tokens.Table)
      case 'blockquote':
        return { kind: 'blockquote', blocks: this.blocks((token as Tokens.Blockquote).tokens) }
      case 'code':
        return this.code(token as Tokens.Code)
      case 'hr':
        return { kind: 'rule' }
      case 'html':
        this.problem('raw HTML is not allowed; write control names and tags in backticks', token.raw)
        return null
      default:
        this.problem(`unsupported Markdown (${token.type})`, token.raw)
        return null
    }
  }

  /**
   * A fenced block is code — except the `shortcuts` directive (#482): an
   * empty fence whose info string is `shortcuts` becomes the generated
   * keyboard-shortcut table, so the page is never authored by hand.
   */
  private code(token: Tokens.Code): GuideBlock | null {
    if (token.lang?.trim() === 'shortcuts') {
      if (token.text.trim().length > 0) {
        this.problem('the `shortcuts` block takes no content; the table is generated from src/lib/shortcuts.ts', token.raw)
        return null
      }
      return { kind: 'shortcuts' }
    }
    return { kind: 'code', text: token.text }
  }

  private heading(token: Tokens.Heading): GuideBlock | null {
    if (token.depth === 1) {
      this.problem('only the first heading may be a `#` title; use `##` to `####` below it', token.raw)
      return null
    }
    if (token.depth > 4) {
      this.problem('headings go no deeper than `####`', token.raw)
      return null
    }
    const level = token.depth as 2 | 3 | 4
    const inlines = this.inlines(token.tokens)
    const text = plainTextOf(inlines)
    const anchor = anchorFor(text)
    if (anchor.length === 0) {
      this.problem('the heading has no letters or digits to make an anchor from', token.raw)
      return null
    }
    if (this.anchors.has(anchor)) {
      this.problem(`duplicate heading anchor "#${anchor}"; reword one of the two headings`, token.raw)
      return null
    }
    this.anchors.add(anchor)
    this.headings.push({ level, anchor, text })
    return { kind: 'heading', level, anchor, inlines, text }
  }

  private list(token: Tokens.List): GuideBlock {
    const items: GuideListItem[] = token.items.map((item) => {
      if (item.task) this.problem('task-list checkboxes are not supported', item.raw)
      return { blocks: this.blocks(item.tokens) }
    })
    const start = token.ordered && typeof token.start === 'number' ? token.start : 1
    return { kind: 'list', ordered: token.ordered, start, items }
  }

  private table(token: Tokens.Table): GuideBlock {
    const cell = (source: Tokens.TableCell, index: number): GuideTableCell => ({
      inlines: this.inlines(source.tokens),
      align: token.align[index] ?? null,
    })
    return {
      kind: 'table',
      header: token.header.map(cell),
      rows: token.rows.map((row) => row.map(cell)),
    }
  }

  private inlines(tokens: readonly Token[]): GuideInline[] {
    const inlines: GuideInline[] = []
    for (const token of tokens) inlines.push(...this.inline(token))
    return inlines
  }

  private inline(token: Token): GuideInline[] {
    switch (token.type) {
      case 'text':
        return this.text((token as Tokens.Text).text)
      case 'escape':
        return [{ kind: 'text', text: (token as Tokens.Escape).text }]
      case 'strong':
        return [{ kind: 'strong', inlines: this.inlines((token as Tokens.Strong).tokens) }]
      case 'em':
        return [{ kind: 'em', inlines: this.inlines((token as Tokens.Em).tokens) }]
      case 'codespan':
        return [{ kind: 'code', text: (token as Tokens.Codespan).text }]
      case 'br':
        return [{ kind: 'break' }]
      case 'link':
        return this.link(token as Tokens.Link)
      case 'image':
        return this.image(token as Tokens.Image)
      case 'html':
        this.problem('raw HTML is not allowed; write control names and tags in backticks', token.raw)
        return []
      default:
        this.problem(`unsupported Markdown (${token.type})`, token.raw)
        return []
    }
  }

  /** Text with its `{{PLACEHOLDER}}`s split out; a `{{` that is not one is a problem. */
  private text(text: string): GuideInline[] {
    const inlines: GuideInline[] = []
    let last = 0
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1]
      if (match.index > last) inlines.push({ kind: 'text', text: text.slice(last, match.index) })
      if (this.constantNames.has(name)) inlines.push({ kind: 'placeholder', name })
      else this.problem(`unknown placeholder {{${name}}}; add it to src/lib/guide/constantNames.ts`, text)
      last = match.index + match[0].length
    }
    const tail = text.slice(last)
    if (tail.includes('{{')) this.problem('malformed placeholder; the form is {{UPPER_CASE_NAME}}', text)
    if (tail.length > 0) inlines.push({ kind: 'text', text: tail })
    return inlines
  }

  private link(token: Tokens.Link): GuideInline[] {
    const inlines = this.inlines(token.tokens)
    const destination = parseLinkHref(token.href)
    switch (destination.kind) {
      case 'external':
        return [{ kind: 'link', href: token.href, inlines, target: null }]
      case 'invalid':
        this.problem(destination.reason, token.raw)
        return inlines
      case 'internal': {
        const target: GuideLinkTarget = {
          section: destination.section ?? this.source.id,
          anchor: destination.anchor,
        }
        const node: Extract<GuideInline, { kind: 'link' }> = {
          kind: 'link',
          href: token.href,
          inlines,
          target,
        }
        this.pendingLinks.push({ fileName: this.source.fileName, href: token.href, target, node })
        return [node]
      }
    }
  }

  private image(token: Tokens.Image): GuideInline[] {
    if (EXTERNAL_LINK.test(token.href) || token.href.includes(':')) {
      this.problem('an image must be a file under docs/guide/, not a URL', token.raw)
      return []
    }
    if (token.text.trim().length === 0) {
      this.problem('an image needs alt text saying what the reader should see', token.raw)
      return []
    }
    return [{ kind: 'image', src: token.href, alt: token.text }]
  }
}

/**
 * Compiles the guide, or throws `GuideCompileError` listing every problem
 * found across every file — all of them, so one build failure names them
 * all rather than one per run.
 */
export function compileGuide(sources: readonly GuideSource[], options: CompileOptions): GuideDocument {
  const problems: string[] = []
  const constantNames = new Set(options.constantNames)
  const byId = new Map<string, GuideSource>()
  for (const source of sources) {
    if (byId.has(source.id)) problems.push(`${source.fileName}: duplicate section id "${source.id}"`)
    byId.set(source.id, source)
  }
  for (const id of options.order) {
    if (!byId.has(id)) problems.push(`contents.json lists "${id}" but there is no docs/guide/${id}.md`)
  }
  const listed = new Set(options.order)
  for (const source of sources) {
    if (!listed.has(source.id)) {
      problems.push(`${source.fileName}: not listed in docs/guide/contents.json (every section must be)`)
    }
  }

  const marked = new Marked({ gfm: true })
  const compiled = new Map<string, { section: GuideSection; compiler: SectionCompiler }>()
  for (const source of sources) {
    const compiler = new SectionCompiler(source, constantNames)
    const section = compiler.compile(marked.lexer(source.text))
    problems.push(...compiler.problems)
    if (section !== null) compiled.set(source.id, { section, compiler })
  }

  // Links resolve once every section's headings are known.
  for (const { compiler } of compiled.values()) {
    for (const link of compiler.pendingLinks) {
      const target = compiled.get(link.target.section)
      if (target === undefined) {
        problems.push(`${link.fileName}: link to a section that does not exist — "${link.href}"`)
        continue
      }
      if (
        link.target.anchor !== null &&
        !target.section.headings.some((heading) => heading.anchor === link.target.anchor)
      ) {
        problems.push(
          `${link.fileName}: link to a heading that does not exist in ${link.target.section}.md — "${link.href}"`,
        )
      }
    }
  }

  if (problems.length > 0) throw new GuideCompileError(problems)
  return {
    sections: options.order.map((id) => compiled.get(id)!.section),
  }
}
