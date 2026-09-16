import { describe, expect, it } from 'vitest'
import { GUIDE_CONSTANT_NAMES } from '../../src/lib/guide/constantNames.ts'
import { DEFAULT_GUIDE_LOCATION } from '../../src/lib/guide/location.ts'
import type { GuideBlock, GuideDocument } from '../../src/lib/guide/document.ts'
import { GuideCompileError, compileGuide } from './compileGuide.ts'
import { imagePathsOf, imageProblem } from './images.ts'
import { GUIDE_DIR, readGuideSources } from './sources.ts'

/**
 * The real guide compiles (#478 §4, §6.2): every internal link resolves,
 * no anchor is duplicated, every placeholder is known, no raw HTML. The
 * build runs the same compile, so this is the same check earlier — under
 * `npm test`, with the problems listed in the failure.
 */
function compileRealGuide(): GuideDocument {
  const { sources, order } = readGuideSources()
  try {
    return compileGuide(sources, { order, constantNames: GUIDE_CONSTANT_NAMES })
  } catch (error) {
    if (error instanceof GuideCompileError) throw new Error(error.message)
    throw error
  }
}

/** Every block in a section, nested ones included. */
function* walk(blocks: readonly GuideBlock[]): Generator<GuideBlock> {
  for (const block of blocks) {
    yield block
    if (block.kind === 'list') for (const item of block.items) yield* walk(item.blocks)
    if (block.kind === 'blockquote') yield* walk(block.blocks)
  }
}

describe('docs/guide (#478)', () => {
  it('compiles: every link resolves, anchors are unique, placeholders are known, no raw HTML', () => {
    const document = compileRealGuide()
    expect(document.sections.length).toBeGreaterThan(0)
  })

  it('opens on a section that exists, and lists every section in contents.json order', () => {
    const document = compileRealGuide()
    const { order } = readGuideSources()
    expect(document.sections.map((section) => section.id)).toEqual(order)
    expect(order).toContain(DEFAULT_GUIDE_LOCATION.section)
  })

  it('keeps images to Quick Start only (the customer’s decision on #477)', () => {
    const document = compileRealGuide()
    for (const section of document.sections) {
      if (section.id === 'quick-start') continue
      for (const block of walk(section.blocks)) {
        if (block.kind !== 'paragraph' && block.kind !== 'heading') continue
        const images = block.inlines.filter((inline) => inline.kind === 'image')
        expect(images, `${section.id}.md has an image; only quick-start.md may`).toEqual([])
      }
    }
  })

  it('shows three to five screenshots in Quick Start, each a file under docs/guide/ (#483)', () => {
    const document = compileRealGuide()
    const quickStart = document.sections.find((section) => section.id === 'quick-start')!
    const images = imagePathsOf({ sections: [quickStart] })
    expect(images.length).toBeGreaterThanOrEqual(3)
    expect(images.length).toBeLessThanOrEqual(5)
    for (const src of imagePathsOf(document)) {
      expect(imageProblem(src, GUIDE_DIR), src).toBeNull()
    }
    expect(imageProblem('images/not-there.png', GUIDE_DIR)).toContain('not found')
    expect(imageProblem('../secrets.png', GUIDE_DIR)).toContain('must be a file under')
  })

  it('keeps the Feature Index last, alphabetical, and linked throughout (#485)', () => {
    const document = compileRealGuide()
    const last = document.sections[document.sections.length - 1]
    expect(last.id, 'the Feature Index is the last section (#477 §3, section 19)').toBe(
      'feature-index',
    )

    // An entry is a list item opening with its bolded name; the letter it
    // sits under is the heading above it.
    const groups: { heading: string; entries: string[] }[] = []
    for (const block of last.blocks) {
      if (block.kind === 'heading') groups.push({ heading: block.text, entries: [] })
      if (block.kind !== 'list' || groups.length === 0) continue
      for (const item of block.items) {
        const [first] = item.blocks
        expect(first?.kind, 'an index entry is a paragraph').toBe('paragraph')
        if (first?.kind !== 'paragraph') continue
        const [name] = first.inlines
        expect(name?.kind, 'an index entry opens with its bolded name').toBe('strong')
        if (name?.kind !== 'strong') continue
        const text = name.inlines.map((inline) => (inline.kind === 'text' ? inline.text : '')).join('')
        expect(
          first.inlines.some((inline) => inline.kind === 'link'),
          `the entry "${text}" links to the page that explains it`,
        ).toBe(true)
        groups[groups.length - 1].entries.push(text)
      }
    }

    // Symbols first, then A–Z: a control drawn as a glyph has no letter to
    // sit under, so it cannot be alphabetised among the words.
    expect(groups[0].heading).toBe('Symbols and keys')
    const letters = groups.slice(1).map((group) => group.heading)
    expect(letters, 'the letter groups are in order').toEqual([...letters].sort())
    expect(letters.every((letter) => /^[A-Z]$/.test(letter))).toBe(true)

    const total = groups.reduce((count, group) => count + group.entries.length, 0)
    expect(total, 'the index covers the app').toBeGreaterThan(150)
    for (const { heading, entries } of groups) {
      // Case-insensitive by code unit, which is the order the page is
      // written in: "Ctrl+S" before "Ctrl/Cmd + Z" because "+" precedes "/".
      const sorted = [...entries].sort((a, b) => {
        const [x, y] = [a.toLowerCase(), b.toLowerCase()]
        return x < y ? -1 : x > y ? 1 : 0
      })
      expect(entries, `the entries under "${heading}" are alphabetical`).toEqual(sorted)
      if (/^[A-Z]$/.test(heading)) {
        for (const entry of entries) {
          expect(entry[0].toUpperCase(), `"${entry}" sits under "${heading}"`).toBe(heading)
        }
      }
    }
  })

  it('gives every section at least one heading to link to', () => {
    for (const section of compileRealGuide().sections) {
      expect(section.headings.length, `${section.id}.md has no headings`).toBeGreaterThan(0)
    }
  })
})
