import { fontRegistry } from '../../lib/textOverlay'
import type { FontRegistry, TextFontDefinition } from '../../lib/textOverlay'
import type { FontPackId } from '../fontPackIds'
import { FONT_PACK_IDS } from '../fontPackIds'

/**
 * The Font pack plugin (#867): ten open-licence typefaces in every Font
 * menu, through the font registry #859 built for it.
 *
 * **The files.** Each face is a set of `woff2` files under `./fonts/`,
 * copied from the `@fontsource/*` 5.3.0 packages (Latin subset), each
 * family's SIL Open Font License beside them. No package is a dependency
 * and nothing is fetched from a third-party server: Vite emits every file
 * as its own static asset of this site (`?url&no-inline`), and this chunk
 * holds only their URLs.
 *
 * **When a file downloads.** Activating registers each file as a
 * `FontFace` in `document.fonts` **without loading it**. A face in that
 * state downloads the first time something renders with its family: the
 * preview's text, which is DOM (`PreviewPlayer`), triggers it by itself.
 * The canvas does too, but draws the fallback face until the file arrives,
 * so the export awaits the font's `load` before its first frame
 * (`loadTextFonts`, #859), as does Save frame (`frameSnapshot.ts`).
 *
 * **A failed download** resolves the loader rather than rejecting it: the
 * export then draws the stack's fallback, which is what the preview shows
 * for a face that failed to load, instead of refusing to export at all.
 * A `FontFace` that failed stays failed: under the CSS Font Loading spec,
 * `load()` on a face in `error` returns its settled promise and downloads
 * nothing (#928 measured one request for two loads in Chromium). So the
 * loader swaps each failed face for a fresh, unloaded one for the same
 * file. The next export's load, or the preview's text, downloads it again.
 */

/** The weights and styles a family ships, as file-name parts: `400-normal`, `700-italic`. */
type Variant = '400-normal' | '400-italic' | '700-normal' | '700-italic'

interface PackFace {
  /** What the Font menus list. */
  label: string
  /** The file-name stem, as `@fontsource` names it: `zilla-slab`. */
  file: string
  /** The CSS stack after the pack's own family, for the moment before it loads. */
  fallback: string
  variants: readonly Variant[]
}

const ALL: readonly Variant[] = ['400-normal', '400-italic', '700-normal', '700-italic']
const UPRIGHT: readonly Variant[] = ['400-normal', '700-normal']

/**
 * The faces, by id, each picked for a use the four core stacks do not
 * cover (#867). A family without a bold or an italic leaves that toggle to
 * the browser's synthesis, in the preview and the canvas alike.
 */
const FACES: Record<FontPackId, PackFace> = {
  // A rounded sans: friendly titles and captions.
  'pack-nunito': { label: 'Nunito', file: 'nunito', fallback: 'Arial, Helvetica, sans-serif', variants: ALL },
  // A geometric sans: clean modern headings.
  'pack-montserrat': {
    label: 'Montserrat',
    file: 'montserrat',
    fallback: 'Arial, Helvetica, sans-serif',
    variants: ALL,
  },
  // A condensed sans: long lines and lower thirds that must stay narrow.
  'pack-oswald': {
    label: 'Oswald',
    file: 'oswald',
    fallback: '"Arial Narrow", Arial, sans-serif',
    variants: UPRIGHT,
  },
  // A bold display face, capitals only: thumbnails and title cards.
  'pack-bebas-neue': {
    label: 'Bebas Neue',
    file: 'bebas-neue',
    fallback: 'Impact, "Arial Black", sans-serif',
    variants: ['400-normal'],
  },
  // A slab serif: sturdy, readable headings.
  'pack-zilla-slab': {
    label: 'Zilla Slab',
    file: 'zilla-slab',
    fallback: 'Georgia, "Times New Roman", serif',
    variants: ALL,
  },
  // An elegant serif: formal and cinematic titles.
  'pack-cormorant-garamond': {
    label: 'Cormorant Garamond',
    file: 'cormorant-garamond',
    fallback: 'Georgia, "Times New Roman", serif',
    variants: ALL,
  },
  // A typewriter monospace: code, notes and terminal-style text.
  'pack-courier-prime': {
    label: 'Courier Prime',
    file: 'courier-prime',
    fallback: '"Courier New", Courier, monospace',
    variants: ALL,
  },
  // A handwritten script: personal notes and annotations.
  'pack-caveat': { label: 'Caveat', file: 'caveat', fallback: 'cursive', variants: UPRIGHT },
  // A comic / marker face: playful, informal call-outs.
  'pack-comic-neue': {
    label: 'Comic Neue',
    file: 'comic-neue',
    fallback: '"Comic Sans MS", cursive',
    variants: ALL,
  },
  // A pixel face: retro and game-style text.
  'pack-silkscreen': {
    label: 'Silkscreen',
    file: 'silkscreen',
    fallback: '"Courier New", monospace',
    variants: UPRIGHT,
  },
}

/** Every font file's URL, by its path under this module. */
const URLS = import.meta.glob<string>('./fonts/*.woff2', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
})

/** One font file of a face: its URL and the descriptors it is registered under. */
export interface PackFontFile {
  url: string
  weight: '400' | '700'
  style: 'normal' | 'italic'
}

/** A pack font as the plugin registers it: the registry's fields plus its CSS family and files. */
export interface PackFont {
  id: FontPackId
  label: string
  /** The CSS family name the files are registered under, distinct from any installed font. */
  family: string
  stack: string
  files: readonly PackFontFile[]
}

/** The pack, in the ids module's order (= Font-menu order, after the core four). */
export const packFonts: readonly PackFont[] = FONT_PACK_IDS.map((id) => {
  const face = FACES[id]
  const family = `Font Pack ${face.label}`
  return {
    id,
    label: face.label,
    family,
    stack: `"${family}", ${face.fallback}`,
    files: face.variants.map((variant) => {
      const [weight, style] = variant.split('-') as ['400' | '700', 'normal' | 'italic']
      const url = URLS[`./fonts/${face.file}-latin-${variant}.woff2`]
      if (url === undefined) throw new Error(`Font pack: no file for ${face.file} ${variant}`)
      return { url, weight, style }
    }),
  }
})

/** The slice of `FontFace` the plugin uses. */
export interface PackFontFace {
  load: () => Promise<unknown>
  readonly status: FontFaceLoadStatus
}

/** The slice of `document.fonts` the plugin uses. */
export interface PackFontSet<Face extends PackFontFace> {
  add: (face: Face) => unknown
  delete: (face: Face) => unknown
}

/** What `activateFontPack` registers into; the app's defaults are `activate`'s. */
export interface FontPackEnvironment<Face extends PackFontFace> {
  registry: FontRegistry
  fonts: PackFontSet<Face> | null
  createFace: ((family: string, url: string, descriptors: FontFaceDescriptors) => Face) | null
}

/**
 * Registers the pack's fonts, and each file as an unloaded face, and
 * returns the undo (#197's contract). Without the Font Loading API there
 * are no faces: the fonts are listed, and draw in their fallback stacks.
 */
export function activateFontPack<Face extends PackFontFace>({
  registry,
  fonts,
  createFace,
}: FontPackEnvironment<Face>): () => void {
  // Every face currently in `fonts`, so deactivating removes exactly those,
  // replacements included.
  const added = new Set<Face>()
  for (const font of packFonts) {
    const register = (file: PackFontFile): Face | null => {
      if (fonts === null || createFace === null) return null
      const face = createFace(font.family, `url("${file.url}") format("woff2")`, {
        weight: file.weight,
        style: file.style,
      })
      fonts.add(face)
      added.add(face)
      return face
    }
    const faces = font.files.map(register).filter((face): face is Face => face !== null)
    /** Swaps the face at `index`, which failed, for a fresh unloaded one (#928). */
    const replace = (index: number) => {
      const failed = faces[index]
      fonts?.delete(failed)
      added.delete(failed)
      const fresh = register(font.files[index])
      if (fresh !== null) faces[index] = fresh
    }
    let loading: Promise<void> | null = null
    const definition: TextFontDefinition = {
      id: font.id,
      label: font.label,
      stack: font.stack,
      // Every variant, since `loadTextFonts` knows ids, not weights; a
      // family is 8 to 100 kB in all. A face already loaded resolves at once.
      load: () => {
        loading ??= loadAll()
        return loading
      },
    }
    /**
     * Loads every face of the font. A face already in `error`, which the
     * preview's or the canvas's own attempt can leave behind, is swapped
     * first, so this load downloads it again rather than settling at once.
     */
    const loadAll = (): Promise<void> => {
      faces.forEach((face, index) => {
        if (face.status === 'error') replace(index)
      })
      return Promise.all(
        faces.map((face, index) =>
          face.load().then(
            () => true,
            () => {
              // A failed face never loads again, so a fresh one takes its
              // place for the next attempt (#928).
              if (faces[index] === face) replace(index)
              return false
            },
          ),
        ),
      ).then((loaded) => {
        // Any failure: this export draws the fallback, and the next load
        // asks again, downloading only the replaced faces.
        if (!loaded.every(Boolean)) loading = null
      })
    }
    registry.register(definition)
  }
  return () => {
    for (const font of packFonts) registry.unregister(font.id)
    for (const face of added) fonts?.delete(face)
    added.clear()
  }
}

/** Registers the pack into the app's font registry and `document.fonts`. */
export function activate(): () => void {
  const supported = typeof FontFace === 'function' && typeof document !== 'undefined' && 'fonts' in document
  return activateFontPack<FontFace>({
    registry: fontRegistry,
    fonts: supported ? document.fonts : null,
    createFace: supported ? (family, source, descriptors) => new FontFace(family, source, descriptors) : null,
  })
}
