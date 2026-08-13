import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { LibraryClip, MediaLibraryState } from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import './MediaLibrary.css'

interface MediaLibraryProps {
  library: MediaLibraryState
  onImportFiles: (files: File[]) => void
  onDismissFailures: () => void
  onAddToTimeline: (clip: LibraryClip) => void
  onRemoveClip: (clip: LibraryClip) => void
  /** How many timeline entries were created from the given library clip. */
  timelineUseCount: (clipId: string) => number
}

interface ConfirmRemovalDialogProps {
  clip: LibraryClip
  timelineEntryCount: number
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Modal confirmation for removing a library clip. Hand-rolled rather than
 * <dialog>.showModal() so focus and Escape behave identically under jsdom,
 * which does not run the native dialog's focus/cancel machinery.
 */
function ConfirmRemovalDialog({
  clip,
  timelineEntryCount,
  onCancel,
  onConfirm,
}: ConfirmRemovalDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    // Focus starts on the safe action; Escape cancels from anywhere.
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Remove {clip.name}?</h3>
        <p>
          {timelineEntryCount > 0
            ? `This also removes ${
                timelineEntryCount === 1
                  ? 'the 1 timeline entry'
                  : `all ${timelineEntryCount} timeline entries`
              } created from this clip.`
            : 'The clip will be removed from the media library.'}
        </p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog-danger" onClick={onConfirm}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

export function MediaLibrary({
  library,
  onImportFiles,
  onDismissFailures,
  onAddToTimeline,
  onRemoveClip,
  timelineUseCount,
}: MediaLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<LibraryClip | null>(null)

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onImportFiles(files)
    // Allow re-importing the same file (e.g. after a failure).
    event.target.value = ''
  }

  const cancelRemoval = useCallback(() => setPendingRemoval(null), [])

  const confirmRemoval = () => {
    if (pendingRemoval) onRemoveClip(pendingRemoval)
    setPendingRemoval(null)
  }

  return (
    <section className="panel" aria-label="Media library">
      <div className="library-header">
        <h2>Media Library</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import clips
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          data-testid="clip-file-input"
          onChange={handleInputChange}
        />
      </div>

      {library.failures.length > 0 && (
        <div className="import-errors" role="alert">
          <ul>
            {library.failures.map((failure) => (
              <li key={failure.id}>{failure.reason}</li>
            ))}
          </ul>
          <button type="button" onClick={onDismissFailures}>
            Dismiss
          </button>
        </div>
      )}

      {library.clips.length === 0 ? (
        <p className="placeholder">
          No clips yet. Import video files, or drag and drop them anywhere in the app.
        </p>
      ) : (
        <ul className="clip-list" aria-label="Imported clips">
          {library.clips.map((clip) => (
            <li key={clip.id} className="clip-item">
              <span className="clip-name" title={clip.name}>
                {clip.name}
              </span>
              <span className="clip-duration">{formatDuration(clip.duration)}</span>
              <button
                type="button"
                aria-label={`Add ${clip.name} to timeline`}
                onClick={() => onAddToTimeline(clip)}
              >
                Add
              </button>
              <button
                type="button"
                aria-label={`Remove ${clip.name} from library`}
                onClick={() => setPendingRemoval(clip)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingRemoval && (
        <ConfirmRemovalDialog
          clip={pendingRemoval}
          timelineEntryCount={timelineUseCount(pendingRemoval.id)}
          onCancel={cancelRemoval}
          onConfirm={confirmRemoval}
        />
      )}
    </section>
  )
}
