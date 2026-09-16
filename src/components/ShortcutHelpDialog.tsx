import { useEffect, useId, useRef } from 'react'
import { shortcutsFor } from '../lib/shortcuts'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from '../lib/transport'
import './dialog.css'
import './ShortcutHelpDialog.css'

interface ShortcutHelpDialogProps {
  onClose: () => void
  /** The configured arrow steps (#286), so the sheet describes the keys as
   * they actually behave rather than as they were once hardcoded. */
  stepSeconds?: number
  largeStepSeconds?: number
}

/**
 * The keyboard-shortcut cheat sheet (#203), opened with `?`. Same
 * hand-rolled modal idiom as ConfirmDialog (jsdom does not run <dialog>'s
 * focus/cancel machinery): Escape and a click outside both dismiss it, and
 * while it is open the transport keys are inert like under any other modal
 * (see modalDialogOpen in lib/transport.ts).
 */
export function ShortcutHelpDialog({
  onClose,
  stepSeconds = STEP_SECONDS,
  largeStepSeconds = LARGE_STEP_SECONDS,
}: ShortcutHelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const shortcuts = shortcutsFor(stepSeconds, largeStepSeconds)

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
          {shortcuts.map(({ keys, does }) => (
            <div className="shortcut-row" key={keys.join('|')}>
              <dt>
                {keys.map((combo) => (
                  <kbd key={combo}>{combo}</kbd>
                ))}
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
