import { useEffect, useId, useRef } from 'react'
import './dialog.css'
import './ShortcutHelpDialog.css'

interface ShortcutHelpDialogProps {
  onClose: () => void
}

/** Every shortcut the app answers to, in one place (#203): the transport
 * keys this dialog is opened by, and the #189 undo/redo chords the App-level
 * handler owns. Update this table when a shortcut is added or changed. */
const SHORTCUTS: readonly { keys: string; does: string }[] = [
  { keys: 'Space', does: 'Play / pause the preview' },
  { keys: '← / →', does: 'Step the playhead 0.1 s back / forward' },
  { keys: 'Shift + ← / →', does: 'Step the playhead 1 s back / forward' },
  { keys: 'Home / End', does: 'Jump to the sequence start / end' },
  { keys: 'Ctrl/Cmd + Z', does: 'Undo the last timeline edit' },
  { keys: 'Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y', does: 'Redo' },
  { keys: '?', does: 'Show this cheat sheet' },
]

/**
 * The keyboard-shortcut cheat sheet (#203), opened with `?`. Same
 * hand-rolled modal idiom as ConfirmDialog (jsdom does not run <dialog>'s
 * focus/cancel machinery): Escape and a click outside both dismiss it, and
 * while it is open the transport keys are inert like under any other modal
 * (see modalDialogOpen in lib/transport.ts).
 */
export function ShortcutHelpDialog({ onClose }: ShortcutHelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    // Focus starts on the only action; Escape closes from anywhere.
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Keyboard shortcuts</h3>
        <dl className="shortcut-list">
          {SHORTCUTS.map(({ keys, does }) => (
            <div className="shortcut-row" key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{does}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcut-note">
          Shortcuts pause while you are typing in a field or a dialog is open.
        </p>
        <div className="dialog-actions">
          <button type="button" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
