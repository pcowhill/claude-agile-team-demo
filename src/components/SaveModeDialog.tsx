import { useEffect, useId, useRef, useState } from 'react'
import type { SaveMode } from '../lib/saveProject'
import './dialog.css'
import './SaveModeDialog.css'

interface SaveModeDialogProps {
  /** The mode preselected when the dialog opens: the project's remembered
   * mode, or 'embed' (the customer's default, #92) when none exists yet. */
  initialMode: SaveMode
  onCancel: () => void
  onConfirm: (mode: SaveMode) => void
}

/**
 * The save-mode choice (#98): surfaced on the first save of a project and
 * revisitable via Save As… — never on plain Save, which reuses the project's
 * remembered mode silently. Same hand-rolled modal idiom as ConfirmDialog
 * (jsdom does not run <dialog>'s focus/cancel machinery).
 */
export function SaveModeDialog({ initialMode, onCancel, onConfirm }: SaveModeDialogProps) {
  const [mode, setMode] = useState<SaveMode>(initialMode)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const embedDescriptionId = useId()
  const referencesDescriptionId = useId()

  useEffect(() => {
    // Focus starts on the confirm action — saving with the preselected mode
    // is the common path; Escape cancels from anywhere.
    confirmRef.current?.focus()
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
        <h3 id={headingId}>Save project</h3>
        <fieldset className="save-mode-options">
          <legend>What the file carries</legend>
          <label className="save-mode-option">
            <input
              type="radio"
              name="save-mode"
              checked={mode === 'embed'}
              onChange={() => setMode('embed')}
              aria-describedby={embedDescriptionId}
            />
            Embed media in the project file
          </label>
          <p id={embedDescriptionId} className="save-mode-description">
            One self-contained file that opens on any computer with no re-linking. Includes your
            video data, so the file is larger.
          </p>
          <label className="save-mode-option">
            <input
              type="radio"
              name="save-mode"
              checked={mode === 'references'}
              onChange={() => setMode('references')}
              aria-describedby={referencesDescriptionId}
            />
            Store references only
          </label>
          <p id={referencesDescriptionId} className="save-mode-description">
            A small file with your edits and clip names. Opening it asks you to re-select the
            original video files.
          </p>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" ref={confirmRef} onClick={() => onConfirm(mode)}>
            Save…
          </button>
        </div>
      </div>
    </div>
  )
}
