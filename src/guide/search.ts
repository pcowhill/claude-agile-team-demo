import type { GuideBlock, GuideDocument, GuideInline } from '../lib/guide/document'
import type { GuideConstants } from '../lib/guide/constantNames'

/**
 * The guide's search (#478, design #477 §5): an index of passages built in
 * the browser from the compiled guide the first time the panel opens, and
 * a prefix-matching query over it. No library: the corpus is a few hundred
 * kilobytes at most, and prefix matching over it is predictable — `duck`
 * finds *Duck others* and *ducking*, and a query the customer expects to
 * work but that does not is a content bug (add the word), not a ranking
 * mystery.
 *
 * Passages are what a hit points at: a section title, a heading, or one
 * body block (paragraph, list, table…) under its nearest heading. Several
 * words in a query must all match the same passage. Ranking is by kind —
 * title over heading over body — then by document order, so the answer to
 * "duck others" is the heading named that, not the paragraph that mentions
 * it in passing.
 */

export type PassageKind = 'title' | 'heading' | 'body'

export interface Passage {
  section: string
  sectionTitle: string
  /** The nearest heading above the passage (the heading itself for a heading). */
  anchor: string | null
  heading: string | null
  kind: PassageKind
  text: string
}

export interface SearchHit {
  passage: Passage
  /** A window of the passage around the first match, with ellipses. */
  snippet: string
  /** Character ranges within `snippet` to highlight, in order, non-overlapping. */
  ranges: [number, number][]
}

const WORD = /[\p{L}\p{N}]+/gu

/** The plain text of inlines, with placeholders filled — what a reader sees. */
export function renderedText(inlines: readonly GuideInline[], constants: GuideConstants): string {
  return inlines
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
        case 'code':
          return inline.text
        case 'strong':
        case 'em':
        case 'link':
          return renderedText(inline.inlines, constants)
        case 'image':
          return inline.alt
        case 'placeholder':
          return constants[inline.name as keyof GuideConstants] ?? inline.name
        case 'break':
          return ' '
      }
    })
    .join('')
}

function blockText(block: GuideBlock, constants: GuideConstants): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return renderedText(block.inlines, constants)
    case 'list':
      return block.items
        .map((item) => item.blocks.map((child) => blockText(child, constants)).join(' '))
        .join(' · ')
    case 'table':
      return [block.header, ...block.rows]
        .map((row) => row.map((cell) => renderedText(cell.inlines, constants)).join(' · '))
        .join(' · ')
    case 'blockquote':
      return block.blocks.map((child) => blockText(child, constants)).join(' ')
    case 'code':
      return block.text
    case 'rule':
      return ''
  }
}

export function buildIndex(document: GuideDocument, constants: GuideConstants): Passage[] {
  const passages: Passage[] = []
  for (const section of document.sections) {
    passages.push({
      section: section.id,
      sectionTitle: section.title,
      anchor: null,
      heading: null,
      kind: 'title',
      text: section.title,
    })
    let anchor: string | null = null
    let heading: string | null = null
    for (const block of section.blocks) {
      if (block.kind === 'heading') {
        anchor = block.anchor
        heading = renderedText(block.inlines, constants)
        passages.push({ section: section.id, sectionTitle: section.title, anchor, heading, kind: 'heading', text: heading })
        continue
      }
      const text = blockText(block, constants).replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      passages.push({ section: section.id, sectionTitle: section.title, anchor, heading, kind: 'body', text })
    }
  }
  return passages
}

/** The query's words, lowercased; punctuation and spacing are not searched. */
export function queryTerms(query: string): string[] {
  return Array.from(query.toLowerCase().matchAll(WORD), (match) => match[0])
}

/** Every word in `text` a term is a prefix of, as [start, end) ranges. */
function matchRanges(text: string, terms: readonly string[]): [number, number][] {
  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const match of lower.matchAll(WORD)) {
    const word = match[0]
    const term = terms.find((candidate) => word.startsWith(candidate))
    if (term !== undefined) ranges.push([match.index, match.index + term.length])
  }
  return ranges
}

const RANK: Record<PassageKind, number> = { title: 0, heading: 1, body: 2 }
const SNIPPET_BEFORE = 40
const SNIPPET_LENGTH = 140

/**
 * The passages every term matches, best first: by kind, then in document
 * order. Each hit carries a snippet around its first match and the ranges
 * to highlight within it. An empty query matches nothing.
 */
export function searchGuide(passages: readonly Passage[], query: string, limit = 20): SearchHit[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const hits: { rank: number; order: number; hit: SearchHit }[] = []
  passages.forEach((passage, order) => {
    const lower = passage.text.toLowerCase()
    const words = Array.from(lower.matchAll(WORD), (match) => match[0])
    if (!terms.every((term) => words.some((word) => word.startsWith(term)))) return
    const ranges = matchRanges(passage.text, terms)
    const first = ranges[0]?.[0] ?? 0
    const start = passage.text.length <= SNIPPET_LENGTH ? 0 : Math.max(0, first - SNIPPET_BEFORE)
    const end = Math.min(passage.text.length, start + SNIPPET_LENGTH)
    const leading = start > 0 ? '…' : ''
    const trailing = end < passage.text.length ? '…' : ''
    const snippet = leading + passage.text.slice(start, end) + trailing
    const shifted = ranges
      .filter(([from, to]) => from >= start && to <= end)
      .map(([from, to]): [number, number] => [from - start + leading.length, to - start + leading.length])
    hits.push({ rank: RANK[passage.kind], order, hit: { passage, snippet, ranges: shifted } })
  })
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order)
  return hits.slice(0, limit).map((entry) => entry.hit)
}
