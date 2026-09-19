import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'

/**
 * The six visual editors are lazy chunks (#537): each opens behind an
 * *Adjust visually…* button and none is on the first-paint path, yet
 * statically imported into `Timeline.tsx` they and `FrameEditor` put some
 * 25 kB into the entry bundle — the bytes that carried it past Vite's 500 kB
 * warning when #529 landed. The shape is the guide's (`App.tsx`, ADR 0003):
 * `import()` is the only edge to these modules, so a static import added
 * back anywhere in the entry graph would pull them in again silently, which
 * is what `npm run build`'s warning is now the guard against.
 * (`lib/frameEditor` itself stays in the entry: the guide's constants read
 * its limits.)
 *
 * Not `React.lazy`, for one reason: `lazy` suspends on a component's first
 * render even when its module is already in hand, and the editors' own
 * suites open them from the timeline and read the dialog on the next line,
 * 54 times over. This loader renders the editor synchronously once its
 * module is cached — `preloadVisualEditors` below is how a test gets there
 * — and renders nothing until then: the editor was not on screen a moment
 * before, and the chunk is a few kB, so a placeholder would flash rather
 * than inform. Both paths are the same component afterwards.
 */
function lazyEditor<P extends object>(load: () => Promise<ComponentType<P>>): {
  Editor: ComponentType<P>
  preload: () => Promise<void>
} {
  let Loaded: ComponentType<P> | null = null
  let loading: Promise<void> | null = null
  const preload = (): Promise<void> =>
    (loading ??= load().then((component) => {
      Loaded = component
    }))
  function LazyEditor(props: P) {
    const [ready, setReady] = useState(Loaded !== null)
    useEffect(() => {
      if (Loaded !== null) return undefined
      let cancelled = false
      void preload().then(() => {
        if (!cancelled) setReady(true)
      })
      return () => {
        cancelled = true
      }
    }, [])
    return ready && Loaded !== null ? <Loaded {...props} /> : null
  }
  return { Editor: LazyEditor, preload }
}
const cropEditor = lazyEditor(() => import('./CropEditor').then((m) => m.CropEditor))
const overlayEditor = lazyEditor(() => import('./OverlayEditor').then((m) => m.OverlayEditor))
const redactionEditor = lazyEditor(() => import('./RedactionEditor').then((m) => m.RedactionEditor))
const spotlightEditor = lazyEditor(() => import('./SpotlightEditor').then((m) => m.SpotlightEditor))
const textEditor = lazyEditor(() => import('./TextEditor').then((m) => m.TextEditor))
const zoomEditor = lazyEditor(() => import('./ZoomEditor').then((m) => m.ZoomEditor))
export const CropEditor = cropEditor.Editor
export const OverlayEditor = overlayEditor.Editor
export const RedactionEditor = redactionEditor.Editor
export const SpotlightEditor = spotlightEditor.Editor
export const TextEditor = textEditor.Editor
export const ZoomEditor = zoomEditor.Editor

/**
 * Loads every visual editor's chunk, so the next render of any of them is
 * synchronous. For tests that open an editor and read it on the next line
 * (`beforeAll(preloadVisualEditors)` in the editors' suites, #537); the app
 * itself loads each on first open.
 */
// eslint-disable-next-line react/only-export-components -- a loader beside the components it loads; Fast Refresh of this module is not something a lazy edge needs
export function preloadVisualEditors(): Promise<void> {
  return Promise.all(
    [cropEditor, overlayEditor, redactionEditor, spotlightEditor, textEditor, zoomEditor].map(
      (editor) => editor.preload(),
    ),
  ).then(() => undefined)
}
