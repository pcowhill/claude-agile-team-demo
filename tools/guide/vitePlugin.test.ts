import { describe, expect, it } from 'vitest'
import type { GuideDocument } from '../../src/lib/guide/document.ts'
import { guideModule } from './vitePlugin.ts'

/**
 * The virtual module's image wiring (#483): every `![alt](images/x.png)`
 * becomes one `?url` import, and every `src` that named that picture points
 * at the imported identifier — including the second one, since
 * `imagePathsOf` lists a picture once however often the guide shows it. A
 * marker left as text would reach the panel as a broken `<img>`, which no
 * type or link check can see.
 */
const picture = (src: string) => ({
  kind: 'paragraph' as const,
  inlines: [{ kind: 'image' as const, src, alt: 'what the reader should see' }],
})

const documentWith = (...sources: string[]): GuideDocument =>
  ({
    sections: [
      {
        id: 'quick-start',
        title: 'Quick Start',
        headings: [],
        blocks: sources.map(picture),
      },
    ],
  }) as GuideDocument

describe('guideModule images (#483)', () => {
  it('imports each picture once and points its src at the import', () => {
    const code = guideModule(documentWith('images/a.png', 'images/b.png'), ['images/a.png', 'images/b.png'], 'docs/guide')
    expect(code).toContain('import image0 from "/docs/guide/images/a.png?url"')
    expect(code).toContain('import image1 from "/docs/guide/images/b.png?url"')
    expect(code).toContain('"src":image0')
    expect(code).toContain('"src":image1')
    expect(code).not.toContain('__GUIDE_IMAGE_')
  })

  it('replaces every marker when one picture is shown twice', () => {
    const code = guideModule(documentWith('images/a.png', 'images/a.png'), ['images/a.png'], 'docs/guide')
    // One import, two srcs, no marker left as text.
    expect(code.match(/^import /gm)).toHaveLength(1)
    expect(code.match(/"src":image0/g)).toHaveLength(2)
    expect(code).not.toContain('__GUIDE_IMAGE_')
  })
})
