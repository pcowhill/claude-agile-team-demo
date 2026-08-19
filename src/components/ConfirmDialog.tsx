import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import './dialog.css'

interface ConfirmDialogProps {
  title: string
  /** Rendered inside the dialog's paragraph. */
  body: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Modal confirmation for a destructive action: removing a clip, or
 * discarding unsaved changes for Open/New Project (#77). Hand-rolled rather
 * than <dialog>.showModal() so focus and Escape behave identically under
 * jsdom, which does not run the native dialog's focus/cancel machinery.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
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
        <h3 id={headingId}>{title}</h3>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
