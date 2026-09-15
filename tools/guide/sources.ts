import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { GuideSource } from './compileGuide.ts'

/**
 * The guide's files on disk (#478): every `docs/guide/*.md` except the
 * authoring guide (`README.md`), plus the table-of-contents order in
 * `contents.json`. Shared by the Vite plugin, which compiles them into the
 * app, and the unit test that compiles the real files so a broken link
 * fails `npm test` as well as `npm run build`.
 */
export const GUIDE_DIR = 'docs/guide'
export const CONTENTS_FILE = 'contents.json'
/** The authoring guide, read by people rather than by the compiler. */
const AUTHORING_GUIDE = 'README.md'

export interface GuideSources {
  sources: GuideSource[]
  order: string[]
  /**
   * Every file read, as absolute paths, for the build to watch. Absolute
   * because Vite's dev server reads a relative watch path on a virtual
   * module as an import to resolve, and fails the module on it.
   */
  files: string[]
}

export function readGuideSources(dir: string = GUIDE_DIR): GuideSources {
  const contentsPath = join(dir, CONTENTS_FILE)
  const order: unknown = JSON.parse(readFileSync(contentsPath, 'utf8'))
  if (!Array.isArray(order) || !order.every((entry) => typeof entry === 'string')) {
    throw new Error(`${contentsPath} must be a JSON array of section ids`)
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== AUTHORING_GUIDE)
    .sort()
    .map((name) => join(dir, name))
  const sources = files.map((path) => ({
    id: basename(path, '.md'),
    fileName: path,
    text: readFileSync(path, 'utf8'),
  }))
  return { sources, order, files: [contentsPath, ...files].map((path) => resolve(path)) }
}
