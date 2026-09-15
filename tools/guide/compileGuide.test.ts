import { describe, expect, it } from 'vitest'
import { GuideCompileError, anchorFor, compileGuide, plainTextOf } from './compileGuide.ts'
import type { GuideSource } from './compileGuide.ts'
import type { GuideBlock, GuideInline } from '../../src/lib/guide/document.ts'

const NAMES = ['HISTORY_LIMIT', 'STEP_SECONDS']

const source = (id: string, text: string): GuideSource => ({ id, fileName: `docs/guide/${id}.md`, text })

/** Compiles one file listed alone. */
const one = (text: string, id = 'alpha') =>
  compileGuide([source(id, text)], { order: [id], constantNames: NAMES }).sections[0]

/** The problems a compile reports, or fails the test if it compiled. */
function problemsOf(sources: GuideSource[], order = sources.map((s) => s.id)): readonly string[] {
  try {
    compileGuide(sources, { order, constantNames: NAMES })
  } catch (error) {
    expect(error).toBeInstanceOf(GuideCompileError)
    return (error as GuideCompileError).problems
  }
  throw new Error('expected the compile to fail')
}

describe('anchorFor (#478)', () => {
  it('lowercases, collapses punctuation runs to one hyphen, and trims the ends', () => {
    expect(anchorFor('Duck others')).toBe('duck-others')
    expect(anchorFor('  Save / Save As…  ')).toBe('save-save-as')
    expect(anchorFor('Frame ▾ → Save frame as PNG…')).toBe('frame-save-frame-as-png')
    expect(anchorFor('I / O')).toBe('i-o')
    expect(anchorFor('…')).toBe('')
  })
})

describe('compileGuide: structure (#478)', () => {
  it('takes the title from the # heading and the id from the file', () => {
    const section = one('# Quick Start\n\nHello.\n', 'quick-start')
    expect(section.id).toBe('quick-start')
    expect(section.title).toBe('Quick Start')
    expect(section.blocks).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'Hello.' }] }])
  })

  it('gives every heading an anchor and lists it for the table of contents', () => {
    const section = one('# T\n\n## Duck others\n\n### The duck level\n\n#### Deep\n')
    expect(section.headings).toEqual([
      { level: 2, anchor: 'duck-others', text: 'Duck others' },
      { level: 3, anchor: 'the-duck-level', text: 'The duck level' },
      { level: 4, anchor: 'deep', text: 'Deep' },
    ])
    expect(section.blocks[0]).toMatchObject({ kind: 'heading', level: 2, anchor: 'duck-others' })
  })

  it('compiles emphasis, inline code, breaks and escapes into inlines', () => {
    const section = one('# T\n\nUse **bold** and *em* with `code`, a \\* star  \nnext line.\n')
    const [block] = section.blocks
    expect(block.kind).toBe('paragraph')
    const inlines = (block as Extract<GuideBlock, { kind: 'paragraph' }>).inlines
    expect(inlines).toEqual<GuideInline[]>([
      { kind: 'text', text: 'Use ' },
      { kind: 'strong', inlines: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', inlines: [{ kind: 'text', text: 'em' }] },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ', a ' },
      { kind: 'text', text: '*' },
      { kind: 'text', text: ' star' },
      { kind: 'break' },
      { kind: 'text', text: 'next line.' },
    ])
  })

  it('compiles ordered and unordered lists, nested, keeping the start number', () => {
    const section = one('# T\n\n3. three\n4. four\n   - nested **x**\n\n- a\n- b\n')
    expect(section.blocks).toHaveLength(2)
    const [ordered, bullets] = section.blocks as Extract<GuideBlock, { kind: 'list' }>[]
    expect(ordered).toMatchObject({ kind: 'list', ordered: true, start: 3 })
    expect(ordered.items).toHaveLength(2)
    expect(ordered.items[1].blocks[0]).toEqual({
      kind: 'paragraph',
      inlines: [{ kind: 'text', text: 'four' }],
    })
    expect(ordered.items[1].blocks[1]).toMatchObject({ kind: 'list', ordered: false })
    expect(bullets).toMatchObject({ kind: 'list', ordered: false, start: 1 })
    expect(bullets.items.map((item) => plainTextOf((item.blocks[0] as { inlines: GuideInline[] }).inlines))).toEqual([
      'a',
      'b',
    ])
  })

  it('compiles tables with their alignment', () => {
    const section = one('# T\n\n| Key | Does |\n|:--|:-:|\n| `Space` | Play |\n')
    const table = section.blocks[0] as Extract<GuideBlock, { kind: 'table' }>
    expect(table.kind).toBe('table')
    expect(table.header.map((cell) => plainTextOf(cell.inlines))).toEqual(['Key', 'Does'])
    expect(table.header.map((cell) => cell.align)).toEqual(['left', 'center'])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0][0].inlines).toEqual([{ kind: 'code', text: 'Space' }])
  })

  it('compiles blockquotes, fenced code and rules', () => {
    const section = one('# T\n\n> quoted\n\n```\nlet x = 1\n```\n\n---\n')
    expect(section.blocks.map((block) => block.kind)).toEqual(['blockquote', 'code', 'rule'])
    expect(section.blocks[1]).toEqual({ kind: 'code', text: 'let x = 1' })
  })

  it('compiles images with their alt text', () => {
    const section = one('# T\n\n![The empty editor](images/empty.png)\n')
    expect((section.blocks[0] as { inlines: GuideInline[] }).inlines).toEqual([
      { kind: 'image', src: 'images/empty.png', alt: 'The empty editor' },
    ])
  })

  it('orders sections as contents.json says, not as the files sort', () => {
    const document = compileGuide([source('alpha', '# A\n'), source('zulu', '# Z\n')], {
      order: ['zulu', 'alpha'],
      constantNames: NAMES,
    })
    expect(document.sections.map((section) => section.id)).toEqual(['zulu', 'alpha'])
  })
})

describe('compileGuide: links (#478 §4)', () => {
  it('resolves links to other sections, to headings in them, and within the section', () => {
    const document = compileGuide(
      [
        source('alpha', '# A\n\n## Here\n\nSee [B](beta.md), [B heading](beta.md#duck-others) and [here](#here).\n'),
        source('beta', '# B\n\n## Duck others\n\nBack to [A](alpha.md).\n'),
      ],
      { order: ['alpha', 'beta'], constantNames: NAMES },
    )
    const paragraph = document.sections[0].blocks[1] as Extract<GuideBlock, { kind: 'paragraph' }>
    const links = paragraph.inlines.filter((inline) => inline.kind === 'link')
    expect(links.map((link) => (link as { target: unknown }).target)).toEqual([
      { section: 'beta', anchor: null },
      { section: 'beta', anchor: 'duck-others' },
      { section: 'alpha', anchor: 'here' },
    ])
  })

  it('keeps https links external', () => {
    const section = one('# T\n\n[Site](https://example.com/x)\n')
    expect((section.blocks[0] as { inlines: GuideInline[] }).inlines[0]).toEqual({
      kind: 'link',
      href: 'https://example.com/x',
      inlines: [{ kind: 'text', text: 'Site' }],
      target: null,
    })
  })

  it('fails on a link to a missing section, a missing heading, or an unknown form', () => {
    const problems = problemsOf([
      source(
        'alpha',
        '# A\n\n## Real\n\n[gone](gamma.md) [no heading](alpha.md#nope) [odd](../README.md) [same](#missing)\n',
      ),
    ])
    expect(problems).toHaveLength(4)
    expect(problems[0]).toContain('docs/guide/alpha.md')
    expect(problems.join('\n')).toMatch(/section that does not exist.*gamma\.md/)
    expect(problems.join('\n')).toMatch(/heading that does not exist in alpha\.md.*#nope/)
    expect(problems.join('\n')).toMatch(/another guide file.*\.\.\/README\.md/)
    expect(problems.join('\n')).toMatch(/heading that does not exist.*#missing/)
  })

  it('fails on duplicate anchors and on a heading with nothing to anchor', () => {
    const problems = problemsOf([source('alpha', '# A\n\n## Save\n\n## Save\n\n## …\n')])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/duplicate heading anchor "#save"/)
    expect(problems[1]).toMatch(/no letters or digits/)
  })
})

describe('compileGuide: placeholders (#478 §6.2)', () => {
  it('splits known placeholders out of the text', () => {
    const section = one('# T\n\nKeeps {{HISTORY_LIMIT}} steps; arrows move {{STEP_SECONDS}} s.\n')
    expect((section.blocks[0] as { inlines: GuideInline[] }).inlines).toEqual([
      { kind: 'text', text: 'Keeps ' },
      { kind: 'placeholder', name: 'HISTORY_LIMIT' },
      { kind: 'text', text: ' steps; arrows move ' },
      { kind: 'placeholder', name: 'STEP_SECONDS' },
      { kind: 'text', text: ' s.' },
    ])
  })

  it('fails on an unknown or malformed placeholder, naming it', () => {
    const problems = problemsOf([source('alpha', '# A\n\n{{NOPE}} and {{lower}}\n')])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/unknown placeholder \{\{NOPE\}\}/)
    expect(problems[1]).toMatch(/malformed placeholder/)
  })
})

describe('compileGuide: rejections (#478 §2)', () => {
  it('fails on raw HTML, block or inline, quoting it', () => {
    const problems = problemsOf([source('alpha', '# A\n\nA <b>bold</b> word.\n\n<div>block</div>\n')])
    expect(problems).toHaveLength(3)
    for (const problem of problems) expect(problem).toMatch(/raw HTML is not allowed/)
    expect(problems[0]).toContain('"<b>"')
    expect(problems[2]).toContain('"<div>block</div>"')
  })

  it('fails on a file without a title, a second title, or a heading too deep', () => {
    expect(problemsOf([source('alpha', 'No title here.\n')])[0]).toMatch(/must begin with a single `#` title/)
    const problems = problemsOf([source('alpha', '# A\n\n# Again\n\n##### Five\n')])
    expect(problems[0]).toMatch(/only the first heading may be a `#` title/)
    expect(problems[1]).toMatch(/no deeper than `####`/)
  })

  it('fails on an image with a URL or without alt text', () => {
    const problems = problemsOf([source('alpha', '# A\n\n![x](https://e.com/a.png) ![](images/a.png)\n')])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/not a URL/)
    expect(problems[1]).toMatch(/needs alt text/)
  })

  it('fails when contents.json and the files disagree', () => {
    const problems = problemsOf([source('alpha', '# A\n'), source('beta', '# B\n')], ['alpha', 'gamma'])
    expect(problems).toEqual([
      'contents.json lists "gamma" but there is no docs/guide/gamma.md',
      'docs/guide/beta.md: not listed in docs/guide/contents.json (every section must be)',
    ])
  })

  it('reports every problem across every file in one error', () => {
    const problems = problemsOf([
      source('alpha', '# A\n\n<i>x</i>\n'),
      source('beta', '# B\n\n{{NOPE}}\n'),
    ])
    expect(problems).toHaveLength(3)
    expect(problems.filter((p) => p.startsWith('docs/guide/alpha.md'))).toHaveLength(2)
    expect(problems.filter((p) => p.startsWith('docs/guide/beta.md'))).toHaveLength(1)
  })
})
