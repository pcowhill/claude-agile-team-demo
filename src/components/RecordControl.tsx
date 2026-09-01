import { useEffect, useId, useRef, useState } from 'react'
import {
  isRecordingSupported,
  recordingFileExtension,
  startMicrophoneRecording,
  voiceOverName,
} from '../lib/recording'
import type { RecordingSession } from '../lib/recording'
import { formatDuration } from '../lib/mediaLibrary'
import './dialog.css'
import './RecordControl.css'

interface RecordControlProps {
  /** The current library clip names — numbers the next `Voice-over N`. */
  existingNames: readonly string[]
  /** Receives the finished capture as an ordinary file for the import path. */
  onRecorded: (file: File) => void
  /** Receives a recording failure for the library's failure list (#224). */
  onFailed: (reason: string) => void
  /** Injectable for tests: jsdom has no getUserMedia or MediaRecorder. */
  startRecording?: typeof startMicrophoneRecording
  supported?: boolean
}

/**
 * The Record control in the media library header (#224): a source menu
 * (Microphone today; screen #225 and webcam #226 extend it) and, while
 * capturing, a small modal dialog with the elapsed time, a recording
 * indicator, and Stop / Cancel. Stop hands the capture to the ordinary
 * import path as `Voice-over N`; Cancel discards it. Hidden entirely where
 * the platform cannot record (feature detection, never a crash); a
 * microphone failure (permission denied, no device) lands in the library's
 * dismissible failure list exactly like a failed import.
 */
export function RecordControl({
  existingNames,
  onRecorded,
  onFailed,
  startRecording = startMicrophoneRecording,
  supported = isRecordingSupported(),
}: RecordControlProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)
  const sessionRef = useRef<RecordingSession | null>(null)
  const headingId = useId()

  // A capture never outlives the control: unmounting cancels it so the
  // microphone is always released.
  useEffect(
    () => () => {
      sessionRef.current?.cancel()
    },
    [],
  )

  // The dialog's elapsed readout, ticking only while recording.
  useEffect(() => {
    if (session === null) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250)
    return () => clearInterval(timer)
  }, [session])

  if (!supported) return null

  const beginMicrophone = async () => {
    setMenuOpen(false)
    try {
      const next = await startRecording()
      sessionRef.current = next
      setStopping(false)
      setSession(next)
    } catch (error) {
      onFailed(
        error instanceof Error && error.message !== ''
          ? `Microphone recording failed: ${error.message}`
          : 'Microphone recording failed.',
      )
    }
  }

  const conclude = () => {
    sessionRef.current = null
    setSession(null)
    setStopping(false)
  }

  const handleStop = async () => {
    if (session === null || stopping) return
    setStopping(true)
    const name = voiceOverName(existingNames, recordingFileExtension(session.mimeType))
    try {
      onRecorded(await session.stop(name))
    } catch (error) {
      onFailed(
        error instanceof Error && error.message !== ''
          ? `Microphone recording failed: ${error.message}`
          : 'Microphone recording failed.',
      )
    }
    conclude()
  }

  const handleCancel = () => {
    session?.cancel()
    conclude()
  }

  return (
    <>
      <div className="record-control">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Record
        </button>
        {menuOpen && (
          <div className="record-menu" role="menu" aria-label="Recording sources">
            <button type="button" role="menuitem" onClick={() => void beginMicrophone()}>
              Microphone
            </button>
          </div>
        )}
      </div>
      {session !== null && (
        <div className="dialog-overlay">
          <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="dialog">
            <h3 id={headingId}>Recording voice-over</h3>
            <p className="record-status">
              <span className="record-indicator" aria-hidden="true" />
              Recording — <span data-testid="record-elapsed">{formatDuration(elapsed)}</span>
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={handleCancel} disabled={stopping}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleStop()} disabled={stopping}>
                Stop recording
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
