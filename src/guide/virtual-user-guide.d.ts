/**
 * The compiled guide the build provides (#478): `tools/guide/vitePlugin.ts`
 * compiles `docs/guide/*.md` and serves the result under this id. Imported
 * only from the lazily loaded guide chunk, never from the entry bundle —
 * `npm run check:bundle` enforces it.
 */
declare module 'virtual:user-guide' {
  const document: import('../lib/guide/document.ts').GuideDocument
  export default document
}
