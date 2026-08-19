import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { emptyLibrary } from '../lib/mediaLibrary'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import { restoreProject } from '../lib/openProject'
import type { RestoredProject } from '../lib/openProject'
import { probeVideoFile } from '../lib/probeVideo'
import { deserializeProject } from '../lib/projectFile'
import type { Project } from '../lib/projectFile'
import { serializeProject } from '../lib/projectFile'
import { emptyTimeline } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { DEFAULT_PROJECT_FILE_NAME, PROJECT_FILE_EXTENSION, createSavePort } from '../lib/saveProject'
import type { SaveDestination, SavePort } from '../lib/saveProject'
import { ConfirmDialog } from './ConfirmDialog'
import { OpenProjectDialog } from './OpenProjectDialog'
import './ProjectControls.css'

interface ProjectControlsProps {
  library: MediaLibraryState
  timeline: TimelineState
  /** Whether there are changes since the last save (or since startup). */
  dirty: boolean
  /** Called with exactly the state that was written, so App can clear dirty. */
  onSaved: (saved: { clips: MediaLibraryState['clips']; timeline: TimelineState }) => void
  /**
   * Replaces the whole editing state: an opened project, or the empty one
   * for New Project. The receiver owns revoking the *previous* state's
   * object URLs and resetting the dirty baseline to the given references.
   * Optional only so save-focused tests that predate #77 keep compiling
   * unchanged — the app always supplies it.
   */
  onProjectReplaced?: (project: RestoredProject) => void
  /** Injectable for tests (the real pickers cannot be driven by automation). */
  port?: SavePort
  /** Injectable for tests (jsdom cannot probe real video). */
  probeVideo?: typeof probeVideoFile
}

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; name: string }
  | { kind: 'error'; message: string }

/**
 * Project lifecycle controls. Save and Save As… (#76): Save As… always asks
 * where the file goes; Save re-uses the established destination, or behaves
 * as Save As… when there is none yet. Ctrl+S / Cmd+S triggers Save. The Save
 * button carries an unsaved-changes indicator while `dirty`. Open Project…
 * and New Project (#77) replace the whole editing state, guarded by an
 * "are you sure?" dialog while there are unsaved changes; opening runs
 * through the media re-link dialog (see `OpenProjectDialog`).
 */
export function ProjectControls({
  library,
  timeline,
  dirty,
  onSaved,
  onProjectReplaced,
  port,
  probeVideo,
}: ProjectControlsProps) {
  // The port touches window at creation, so default lazily, once.
  const portRef = useRef<SavePort | null>(port ?? null)
  portRef.current ??= createSavePort()
  const [destination, setDestination] = useState<SaveDestination | null>(null)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  // Open/New flow (#77): the pending unsaved-changes guard, the picked
  // project awaiting media re-linking, and the last failed open's reason.
  const [pendingDiscard, setPendingDiscard] = useState<'open' | 'new' | null>(null)
  const [pendingOpen, setPendingOpen] = useState<{ fileName: string; project: Project } | null>(
    null,
  )
  const [openError, setOpenError] = useState<string | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)

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

  // Replacing the project invalidates everything session-scoped here: the
  // save destination belongs to the previous project, as does status text.
  const replaceProject = (restored: RestoredProject) => {
    onProjectReplaced?.(restored)
    setDestination(null)
    setStatus({ kind: 'idle' })
    setOpenError(null)
  }

  const startNewProject = () => {
    replaceProject({ clips: emptyLibrary.clips, timeline: emptyTimeline })
  }

  const requestNewProject = () => {
    if (dirty) setPendingDiscard('new')
    else startNewProject()
  }

  const requestOpenProject = () => {
    if (dirty) setPendingDiscard('open')
    else openInputRef.current?.click()
  }

  const confirmDiscard = () => {
    const action = pendingDiscard
    setPendingDiscard(null)
    if (action === 'new') startNewProject()
    // The click on the confirm button is the user activation the file
    // picker needs, so opening can chain directly.
    else if (action === 'open') openInputRef.current?.click()
  }

  const handleProjectFile = async (file: File) => {
    const result = await deserializeProject(new Uint8Array(await file.arrayBuffer()))
    if (!result.ok) {
      // A failed open leaves the current project untouched — only report.
      setOpenError(result.error)
      return
    }
    setOpenError(null)
    if (result.project.clips.length === 0) {
      // Nothing to re-link; the (empty-library) project opens immediately.
      replaceProject(restoreProject(result.project, new Map()))
      return
    }
    setPendingOpen({ fileName: file.name, project: result.project })
  }

  const handleOpenInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void handleProjectFile(file)
    // Allow re-picking the same file (e.g. after fixing it externally).
    event.target.value = ''
  }

  const saving = status.kind === 'saving'

  return (
    <div className="project-controls">
      <button type="button" disabled={saving} onClick={requestNewProject}>
        New Project
      </button>
      <button type="button" disabled={saving} onClick={requestOpenProject}>
        Open Project…
      </button>
      <input
        ref={openInputRef}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},application/gzip`}
        hidden
        data-testid="project-file-input"
        onChange={handleOpenInputChange}
      />
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
      {openError !== null && (
        <span className="project-open-error" role="alert">
          Could not open: {openError}
        </span>
      )}
      {pendingDiscard !== null && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body={
            pendingDiscard === 'new'
              ? 'Starting a new project will discard your unsaved changes.'
              : 'Opening a project will discard your unsaved changes.'
          }
          confirmLabel={pendingDiscard === 'new' ? 'Discard and start new' : 'Discard and open'}
          onCancel={() => setPendingDiscard(null)}
          onConfirm={confirmDiscard}
        />
      )}
      {pendingOpen !== null && (
        <OpenProjectDialog
          fileName={pendingOpen.fileName}
          project={pendingOpen.project}
          probeVideo={probeVideo}
          onCancel={() => setPendingOpen(null)}
          onOpen={(restored) => {
            setPendingOpen(null)
            replaceProject(restored)
          }}
        />
      )}
    </div>
  )
}
