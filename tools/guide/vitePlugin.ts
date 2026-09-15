import type { Plugin } from 'vite'
import { GUIDE_CONSTANT_NAMES } from '../../src/lib/guide/constantNames.ts'
import { GuideCompileError, compileGuide } from './compileGuide.ts'
import { GUIDE_DIR, readGuideSources } from './sources.ts'

/**
 * Compiles `docs/guide/` into the app at build time (#478, design #477 §2).
 *
 * The app imports `virtual:user-guide` — from inside the lazily loaded
 * guide chunk only, never from the entry (checked by `npm run check:bundle`)
 * — and receives the compiled `GuideDocument` as JSON. The Markdown parser
 * runs here, in the build, and never reaches the browser (ADR 0005).
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
        return `export default ${JSON.stringify(document)}\n`
      } catch (error) {
        if (error instanceof GuideCompileError) this.error(error.message)
        throw error
      }
    },
  }
}
