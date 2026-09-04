import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { exportFormats, mediaRecorderSupports, supportedExportFormats } from '../lib/exportFormats'
import {
  LARGE_STEP_CHOICES,
  SESSION_RESTORE_CHOICES,
  STEP_CHOICES,
  STILL_DURATION_CHOICES,
  formatSeconds,
  sessionRestoreLabel,
} from '../lib/settings'
import type { AppSettings, SessionRestoreMode } from '../lib/settings'
import './dialog.css'
import './SettingsControl.css'

interface SettingsControlProps {
  settings: AppSettings
  /** Every change is applied immediately — there is no OK to press (#286). */
  onChange: (settings: AppSettings) => void
  /** Injectable for tests (jsdom has no MediaRecorder). */
  isTypeSupported?: (type: string) => boolean
}

interface SettingRowProps {
  label: string
  /** Shown under the control and wired up with `aria-describedby`, so it
   * explains the setting without becoming part of the control's name. */
  hint?: string
  children: (describedBy: string | undefined) => ReactNode
}

function SettingRow({ label, hint, children }: SettingRowProps) {
  const hintId = useId()
  return (
    <div className="settings-row">
      <label className="settings-field">
        <span className="settings-label">{label}</span>
        {children(hint === undefined ? undefined : hintId)}
      </label>
      {hint !== undefined && (
        <p className="settings-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * The ⚙ Settings button and its modal (#286, from customer feedback #281):
 * the per-device preferences that used to be hardcoded. Every control writes
 * through on change — no Apply, no Cancel — because each one is a single
 * value whose effect is immediately visible, and a settings dialog that
 * needs confirming is a settings dialog people leave without saving.
 *
 * Same hand-rolled modal idiom as PluginManager and ConfirmDialog (jsdom
 * does not run `<dialog>`'s focus/cancel machinery): Escape and a click
 * outside dismiss it, and while it is open the transport keys are inert like
 * under any other modal (see `modalDialogOpen` in lib/transport.ts).
 *
 * Focus lands on Close rather than on the first control deliberately: these
 * are all `<select>`s, and an arrow key on a focused one silently changes a
 * preference before the user has read the dialog.
 */
export function SettingsControl({
  settings,
  onChange,
  isTypeSupported = mediaRecorderSupports,
}: SettingsControlProps) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  // Which formats exist is a runtime property of the browser (#114) and of
  // which plugins are enabled (#197), so subscribe like the export picker
  // does rather than reading the registry once.
  useSyncExternalStore(exportFormats.subscribe, () => exportFormats.version)
  const formats = supportedExportFormats(isTypeSupported)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  /**
   * The format choices, always including the stored one. A preference for a
   * format this browser cannot record, or whose plugin is off, would
   * otherwise show as some *other* format's row being selected — the dialog
   * would misreport the setting it exists to display.
   */
  const formatOptions: { id: string; label: string }[] = [
    ...formats.map((spec) => ({ id: spec.id, label: spec.label })),
    ...(formats.some((spec) => spec.id === settings.exportFormat)
      ? []
      : [
          {
            id: settings.exportFormat,
            label: `${settings.exportFormat} (not available in this browser)`,
          },
        ]),
  ]

  const secondsRow = (
    label: string,
    hint: string | undefined,
    choices: readonly number[],
    key: 'stepSeconds' | 'largeStepSeconds' | 'stillDurationSeconds',
  ) => (
    <SettingRow label={label} {...(hint === undefined ? {} : { hint })}>
      {(describedBy) => (
        <select
          value={String(settings[key])}
          aria-describedby={describedBy}
          onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })}
        >
          {choices.map((choice) => (
            <option key={choice} value={String(choice)}>
              {formatSeconds(choice)}
            </option>
          ))}
        </select>
      )}
    </SettingRow>
  )

  return (
    <>
      <button
        type="button"
        className="settings-button"
        // A glyph alone has no accessible name, and the tooltip serves the
        // sighted mouse user the same text.
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && (
        <div className="dialog-overlay" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="dialog settings-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={headingId}>Settings</h3>
            <p>
              Preferences for this browser, remembered on this device. They are not part of a
              project, so they never travel with a saved file.
            </p>
            <div className="settings-list">
              {secondsRow(
                'Playhead nudge (← / →)',
                undefined,
                STEP_CHOICES,
                'stepSeconds',
              )}
              {secondsRow(
                'Playhead jump (Shift + ← / →)',
                undefined,
                LARGE_STEP_CHOICES,
                'largeStepSeconds',
              )}
              {secondsRow(
                'New still or slate duration',
                'Applies to new stills, color slates and image overlay layers; anything already on the timeline keeps its own duration.',
                STILL_DURATION_CHOICES,
                'stillDurationSeconds',
              )}
              <SettingRow
                label="When a previous session is found"
                hint="Autosave keeps recording either way — this is only about the offer to restore."
              >
                {(describedBy) => (
                  <select
                    value={settings.sessionRestore}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      onChange({
                        ...settings,
                        sessionRestore: event.target.value as SessionRestoreMode,
                      })
                    }
                  >
                    {SESSION_RESTORE_CHOICES.map((mode) => (
                      <option key={mode} value={mode}>
                        {sessionRestoreLabel(mode)}
                      </option>
                    ))}
                  </select>
                )}
              </SettingRow>
              <SettingRow
                label="Default export format"
                hint="Which format the export dialog opens on; every export can still be changed there."
              >
                {(describedBy) => (
                  <select
                    value={settings.exportFormat}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      onChange({ ...settings, exportFormat: event.target.value })
                    }
                  >
                    {formatOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </SettingRow>
            </div>
            <div className="dialog-actions">
              <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
