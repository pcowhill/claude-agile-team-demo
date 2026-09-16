import type { Plugin } from 'vite'
import type { GuideBlock, GuideDocument, GuideInline } from '../../src/lib/guide/document.ts'
import { GUIDE_CONSTANT_NAMES } from '../../src/lib/guide/constantNames.ts'
import { resolve } from 'node:path'
import { GuideCompileError, compileGuide } from './compileGuide.ts'
import { imagePathsOf, imageProblem } from './images.ts'
import { GUIDE_DIR, readGuideSources } from './sources.ts'

/**
 * Compiles `docs/guide/` into the app at build time (#478, design #477 §2).
 *
 * The app imports `virtual:user-guide` — from inside the lazily loaded
 * guide chunk only, never from the entry (checked by `npm run check:bundle`)
 * — and receives the compiled `GuideDocument` as JSON. The Markdown parser
 * runs here, in the build, and never reaches the browser (ADR 0005).
 *
 * Images (#483) ship with the guide, not the entry bundle: every
 * `![alt](images/x.png)` becomes a `?url` asset import in the generated
 * module — Vite serves the file in dev and emits a hashed asset in the
 * build — and the compiled document's `src` is replaced by that URL. A
 * picture the Markdown names but the directory lacks fails the build, like
 * a broken link.
 *
 * A compile problem is reported through `this.error`, so `npm run build`
 * fails naming the file and the offending text, and the dev server shows
 * the same message in its overlay. Every guide file is a watch file, so an
 * edit while `npm run dev` runs recompiles the guide.
 */
export const GUIDE_MODULE_ID = 'virtual:user-guide'
const RESOLVED_ID = `\0${GUIDE_MODULE_ID}`

export function userGuidePlugin(dir: string = GUIDE_DIR): Plugin {
  return {
    name: 'user-guide',
    resolveId(id) {
      return id === GUIDE_MODULE_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      const { sources, order, files } = readGuideSources(dir)
      for (const file of files) this.addWatchFile(file)
      try {
        const document = compileGuide(sources, { order, constantNames: GUIDE_CONSTANT_NAMES })
        const images = imagePathsOf(document)
        const problems = images.map((src) => imageProblem(src, dir)).filter((problem): problem is string => problem !== null)
        if (problems.length > 0) throw new GuideCompileError(problems)
        for (const src of images) this.addWatchFile(resolve(dir, src))
        return guideModule(document, images, dir)
      } catch (error) {
        if (error instanceof GuideCompileError) this.error(error.message)
        throw error
      }
    },
  }
}

/** A marker no guide text contains, replaced by the asset import's identifier. */
const imageMarker = (index: number) => `__GUIDE_IMAGE_${index}__`

/**
 * The virtual module's code: one `?url` import per image, and the document
 * with each image's `src` pointing at the imported URL. The import paths are
 * root-relative (`/docs/guide/images/x.png`), which Vite resolves against the
 * project root in dev and build alike.
 */
export function guideModule(document: GuideDocument, images: readonly string[], dir: string): string {
  const marked = JSON.parse(JSON.stringify(document)) as GuideDocument
  const replaceSrc = (inlines: GuideInline[]) => {
    for (const inline of inlines) {
      if (inline.kind === 'image') inline.src = imageMarker(images.indexOf(inline.src))
      else if (inline.kind === 'strong' || inline.kind === 'em' || inline.kind === 'link') replaceSrc(inline.inlines)
    }
  }
  const replaceBlocks = (blocks: GuideBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'heading' || block.kind === 'paragraph') replaceSrc(block.inlines)
      else if (block.kind === 'list') for (const item of block.items) replaceBlocks(item.blocks)
      else if (block.kind === 'table') for (const row of [block.header, ...block.rows]) for (const cell of row) replaceSrc(cell.inlines)
      else if (block.kind === 'blockquote') replaceBlocks(block.blocks)
    }
  }
  for (const section of marked.sections) replaceBlocks(section.blocks)
  let json = JSON.stringify(marked)
  const imports = images.map((src, index) => {
    json = json.replace(`"${imageMarker(index)}"`, `image${index}`)
    return `import image${index} from ${JSON.stringify(`/${dir}/${src}?url`)}\n`
  })
  return `${imports.join('')}export default ${json}\n`
}
