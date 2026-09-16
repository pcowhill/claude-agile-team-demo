import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type { GuideBlock, GuideDocument, GuideInline } from '../../src/lib/guide/document.ts'

/**
 * The images a compiled guide refers to (#483): every `![alt](images/x.png)`
 * across every section, as the relative paths the Markdown wrote, once each
 * in document order. Shared by the Vite plugin, which turns each into an
 * asset import so the picture ships with the guide's lazy chunk, and by the
 * unit test that checks every referenced file exists under `docs/guide/`.
 */
function* inlinesOf(blocks: readonly GuideBlock[]): Generator<GuideInline> {
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        yield* block.inlines
        break
      case 'list':
        for (const item of block.items) yield* inlinesOf(item.blocks)
        break
      case 'table':
        for (const row of [block.header, ...block.rows]) for (const cell of row) yield* cell.inlines
        break
      case 'blockquote':
        yield* inlinesOf(block.blocks)
        break
      default:
        break
    }
  }
}

function* deepInlines(inlines: Iterable<GuideInline>): Generator<GuideInline> {
  for (const inline of inlines) {
    yield inline
    if (inline.kind === 'strong' || inline.kind === 'em' || inline.kind === 'link') yield* deepInlines(inline.inlines)
  }
}

export function imagePathsOf(document: GuideDocument): string[] {
  const paths: string[] = []
  for (const section of document.sections) {
    for (const inline of deepInlines(inlinesOf(section.blocks))) {
      if (inline.kind === 'image' && !paths.includes(inline.src)) paths.push(inline.src)
    }
  }
  return paths
}

/**
 * Why an image path cannot be used, or null when it can: it must stay inside
 * the guide's directory (no absolute path, no `..`) and name a file that
 * exists there — a missing picture fails the build like a missing link.
 */
export function imageProblem(src: string, dir: string): string | null {
  const normalized = normalize(src)
  if (isAbsolute(src) || normalized.startsWith('..')) return `an image must be a file under ${dir}/ — "${src}"`
  if (!existsSync(join(dir, normalized))) return `image file not found: ${join(dir, normalized)} — "${src}"`
  return null
}
