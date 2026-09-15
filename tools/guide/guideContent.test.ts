import { describe, expect, it } from 'vitest'
import { GUIDE_CONSTANT_NAMES } from '../../src/lib/guide/constantNames.ts'
import { DEFAULT_GUIDE_LOCATION } from '../../src/lib/guide/location.ts'
import type { GuideBlock, GuideDocument } from '../../src/lib/guide/document.ts'
import { GuideCompileError, compileGuide } from './compileGuide.ts'
import { readGuideSources } from './sources.ts'

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

  it('gives every section at least one heading to link to', () => {
    for (const section of compileRealGuide().sections) {
      expect(section.headings.length, `${section.id}.md has no headings`).toBeGreaterThan(0)
    }
  })
})
