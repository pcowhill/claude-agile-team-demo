import { useEffect, useRef, useState } from 'react'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import type { TimelineState } from '../lib/timeline'
import { serializeProject } from '../lib/projectFile'
import { DEFAULT_PROJECT_FILE_NAME, createSavePort } from '../lib/saveProject'
import type { SaveDestination, SavePort } from '../lib/saveProject'
import './ProjectControls.css'

interface ProjectControlsProps {
  library: MediaLibraryState
  timeline: TimelineState
  /** Whether there are changes since the last save (or since startup). */
  dirty: boolean
  /** Called with exactly the state that was written, so App can clear dirty. */
  onSaved: (saved: { clips: MediaLibraryState['clips']; timeline: TimelineState }) => void
  /** Injectable for tests (the real pickers cannot be driven by automation). */
  port?: SavePort
}

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; name: string }
  | { kind: 'error'; message: string }

/**
 * Save and Save As… for the current project (#76): Save As… always asks
 * where the file goes; Save re-uses the established destination, or behaves
 * as Save As… when there is none yet. Ctrl+S / Cmd+S triggers Save. The Save
 * button carries an unsaved-changes indicator while `dirty`.
 */
export function ProjectControls({ library, timeline, dirty, onSaved, port }: ProjectControlsProps) {
  // The port touches window at creation, so default lazily, once.
  const portRef = useRef<SavePort | null>(port ?? null)
  portRef.current ??= createSavePort()
  const [destination, setDestination] = useState<SaveDestination | null>(null)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  const save = async (alwaysPick: boolean) => {
    if (status.kind === 'saving') return
    // Serialize exactly what is committed now; edits made while the picker
    // or the write is pending stay unsaved (and keep the dirty flag).
    const snapshot = { clips: library.clips, timeline }
    setStatus({ kind: 'saving' })
    try {
      let target = destination
      if (alwaysPick || target === null) {
        const picked = await portRef.current!.pickDestination(
          destination?.name ?? DEFAULT_PROJECT_FILE_NAME,
        )
        if (picked.kind === 'canceled') {
          setStatus({ kind: 'idle' })
          return
        }
        target = picked.destination
        setDestination(target)
      }
      await target.write(await serializeProject(library, timeline))
      onSaved(snapshot)
      setStatus({ kind: 'saved', name: target.name })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Saving failed unexpectedly.',
      })
    }
  }

  // Keep the handler's view of state fresh without re-subscribing per render.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        // Always claim the shortcut, or the browser's own save dialog opens.
        // Saving mid-edit is harmless: only committed state is serialized.
        event.preventDefault()
        if (!event.repeat) void saveRef.current(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const saving = status.kind === 'saving'

  return (
    <div className="project-controls">
      <button
        type="button"
        disabled={saving}
        // The dot alone would be color-only; the label carries its meaning.
        aria-label={dirty ? 'Save (unsaved changes)' : undefined}
        onClick={() => void save(false)}
      >
        Save
        {dirty && (
          <span className="project-dirty" title="Unsaved changes" aria-hidden="true">
            ●
          </span>
        )}
      </button>
      <button type="button" disabled={saving} onClick={() => void save(true)}>
        Save As…
      </button>
      <span className="project-save-status" role="status">
        {status.kind === 'saved' && `Saved as ${status.name}`}
        {saving && 'Saving…'}
      </span>
      {status.kind === 'error' && (
        <span className="project-save-error" role="alert">
          Could not save: {status.message}
        </span>
      )}
    </div>
  )
}
