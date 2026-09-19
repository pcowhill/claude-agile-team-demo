import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import './visualEditors.css'

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
 * — and renders nothing while a load is in flight: the editor was not on
 * screen a moment before, and the chunk is a few kB, so a placeholder would
 * flash rather than inform. Both paths are the same component afterwards.
 *
 * A load that *fails* is the one case worth showing (#568). The first draft
 * cached the load promise with `??=`, which cached a rejection exactly as
 * readily as a success: a chunk lost to a dropped connection, or 404'd
 * because a deploy replaced the content-hashed files under an open tab,
 * left the button pressed, the dialog absent, every later press reusing the
 * same rejected promise, and an unhandled rejection the only trace. So a
 * rejection clears the slot rather than being cached, the rejection is
 * handled, and the failure renders as a dialog of its own.
 * `props.onClose` is why the generic asks for it: without a way out, a
 * failure dialog is a worse dead end than the blank it replaces.
 *
 * **It borrows no class from the editors**, for the reason `visualEditors.css`
 * gives at length: their stylesheet ships inside the very chunk that failed
 * to arrive, so a dialog reusing `.effect-editor` renders with no border, no
 * padding and no width bound — which is what the first draft did, plausibly
 * enough that the screenshot did not give it away.
 *
 * **The remedy offered is a reload, not a retry, and that is not a
 * preference.** A browser's module map caches a module whose fetch failed,
 * so a second `import()` of the same specifier re-rejects *without issuing
 * a request*. Measured, because the obvious design was a Retry button:
 * `e2e/visual-editor-load-failure.spec.ts` counts the requests its route
 * sees, and with the block lifted before a second attempt the counter read
 * `aborted=1, continued=0` — the retry never reached the network, and the
 * failure dialog simply came back. Clearing `loading` above is still what
 * makes each attempt honest rather than silent; it just cannot defeat the
 * module map. A reload builds a new one, and for the stale-deploy case it
 * also fetches an `index.html` naming chunks that exist. Busting the cache
 * with a query instead would mean a runtime-built specifier, which is
 * exactly the static edge #537 removed.
 */
// eslint-disable-next-line react/only-export-components -- the factory that builds the six components below; exported so visualEditors.test.tsx can drive it with a loader that fails, which no real chunk does in jsdom
export function lazyEditor<P extends { onClose: () => void }>(
  /** Names the editor in the failure dialog: "the crop editor could not load". */
  name: string,
  load: () => Promise<ComponentType<P>>,
): {
  Editor: ComponentType<P>
  preload: () => Promise<void>
} {
  let Loaded: ComponentType<P> | null = null
  let loading: Promise<void> | null = null
  const preload = (): Promise<void> =>
    (loading ??= load().then(
      (component) => {
        Loaded = component
      },
      (error: unknown) => {
        // Never cache a rejection (#568): a cached one makes every later
        // open re-await the same failure, which is how this rendered a
        // permanent blank. Clearing the slot means each open is a fresh
        // attempt that can report for itself — the module map decides
        // whether it reaches the network (see the note above), but the
        // dialog appears either way. Rethrown so the caller still sees it.
        loading = null
        throw error
      },
    ))
  function LazyEditor(props: P) {
    const [ready, setReady] = useState(Loaded !== null)
    const [failed, setFailed] = useState(false)
    useEffect(() => {
      if (Loaded !== null) {
        setReady(true)
        return undefined
      }
      let cancelled = false
      setFailed(false)
      preload().then(
        () => {
          if (!cancelled) setReady(true)
        },
        () => {
          // Handled here rather than left to `void`, so a failed chunk is a
          // dialog and not an unhandled rejection in the console (#568).
          if (!cancelled) setFailed(true)
        },
      )
      return () => {
        cancelled = true
      }
    }, [])
    if (ready && Loaded !== null) return <Loaded {...props} />
    if (!failed) return null
    return (
      <div
        role="dialog"
        aria-label={`The ${name} editor could not load`}
        className="visual-editor-failed"
        data-testid="visual-editor-failed"
      >
        <div className="visual-editor-failed-body">
          <span role="alert" className="visual-editor-failed-message">
            The {name} editor could not load. Reloading the page fetches it again.
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <button
            type="button"
            aria-label={`Close the ${name} editor`}
            title="Close (Esc)"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
      </div>
    )
  }
  return { Editor: LazyEditor, preload }
}
const cropEditor = lazyEditor('crop', () => import('./CropEditor').then((m) => m.CropEditor))
const overlayEditor = lazyEditor('overlay placement', () =>
  import('./OverlayEditor').then((m) => m.OverlayEditor),
)
const redactionEditor = lazyEditor('redaction', () =>
  import('./RedactionEditor').then((m) => m.RedactionEditor),
)
const spotlightEditor = lazyEditor('spotlight', () =>
  import('./SpotlightEditor').then((m) => m.SpotlightEditor),
)
const textEditor = lazyEditor('text', () => import('./TextEditor').then((m) => m.TextEditor))
const zoomEditor = lazyEditor('zoom', () => import('./ZoomEditor').then((m) => m.ZoomEditor))
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
