import { useEffect, useId, useRef, useState } from 'react'
import {
  isRecordingSupported,
  isScreenRecordingSupported,
  recordingFileExtension,
  screenRecordingName,
  startMicrophoneRecording,
  startScreenRecording,
  videoRecordingFileExtension,
  voiceOverName,
} from '../lib/recording'
import type { RecordingSession } from '../lib/recording'
import { formatDuration } from '../lib/mediaLibrary'
import './dialog.css'
import './RecordControl.css'

type RecordingSource = 'microphone' | 'screen'

/** Per-source wording: the dialog heading, failure prefix, and clip name. */
const SOURCE_LABELS: Record<
  RecordingSource,
  {
    heading: string
    failure: string
    fileName: (existingNames: readonly string[], mimeType: string) => string
  }
> = {
  microphone: {
    heading: 'Recording voice-over',
    failure: 'Microphone recording failed',
    fileName: (names, mimeType) => voiceOverName(names, recordingFileExtension(mimeType)),
  },
  screen: {
    heading: 'Recording screen',
    failure: 'Screen recording failed',
    fileName: (names, mimeType) =>
      screenRecordingName(names, videoRecordingFileExtension(mimeType)),
  },
}

interface RecordControlProps {
  /** The current library clip names — numbers the next recording's name. */
  existingNames: readonly string[]
  /** Receives the finished capture as an ordinary file for the import path. */
  onRecorded: (file: File) => void
  /** Receives a recording failure for the library's failure list (#224). */
  onFailed: (reason: string) => void
  /** Injectable for tests: jsdom has no getUserMedia or MediaRecorder. */
  startRecording?: typeof startMicrophoneRecording
  supported?: boolean
  /** Injectable for tests: jsdom has no getDisplayMedia either (#225). */
  startScreenCapture?: typeof startScreenRecording
  screenSupported?: boolean
}

/**
 * The Record control in the media library header (#224): a source menu —
 * Microphone (#224) and Screen (#225); webcam (#226) extends it — and,
 * while capturing, a small modal dialog with the elapsed time, a recording
 * indicator, a live preview for a video source, and Stop / Cancel. Stop
 * hands the capture to the ordinary import path as `Voice-over N` /
 * `Screen recording N`; Cancel discards it. Each source is hidden where
 * the platform cannot provide it (feature detection, never a crash); a
 * capture failure — permission denied, no device, the user dismissing the
 * browser's screen picker — lands in the library's dismissible failure
 * list exactly like a failed import. The browser's own "stop sharing" UI
 * ends a screen capture cleanly, exactly as the Stop button does.
 */
export function RecordControl({
  existingNames,
  onRecorded,
  onFailed,
  startRecording = startMicrophoneRecording,
  supported = isRecordingSupported(),
  startScreenCapture = startScreenRecording,
  screenSupported = isScreenRecordingSupported(),
}: RecordControlProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [source, setSource] = useState<RecordingSource>('microphone')
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)
  const sessionRef = useRef<RecordingSession | null>(null)
  // The Stop handler, reachable from the screen capture's share-ended hook
  // without a stale closure: the browser's own "stop sharing" must conclude
  // whatever session is current at that moment.
  const stopRef = useRef<() => void>(() => {})
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const headingId = useId()

  // A capture never outlives the control: unmounting cancels it so the
  // microphone/screen is always released.
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

  // The live preview (#225): the dialog's <video> plays the capture stream
  // itself, muted — showing what is recorded without echoing its audio.
  useEffect(() => {
    const preview = previewRef.current
    if (session === null || source !== 'screen' || preview === null) return
    preview.srcObject = session.stream
    // play() rejects (AbortError) when interrupted by teardown — expected.
    preview.play().catch(() => {})
    return () => {
      preview.srcObject = null
    }
  }, [session, source])

  if (!supported && !screenSupported) return null

  const begin = async (
    nextSource: RecordingSource,
    start: () => Promise<RecordingSession>,
  ) => {
    setMenuOpen(false)
    try {
      const next = await start()
      sessionRef.current = next
      setSource(nextSource)
      setStopping(false)
      setSession(next)
    } catch (error) {
      const { failure } = SOURCE_LABELS[nextSource]
      onFailed(
        error instanceof Error && error.message !== ''
          ? `${failure}: ${error.message}`
          : `${failure}.`,
      )
    }
  }

  const conclude = () => {
    sessionRef.current = null
    setSession(null)
    setStopping(false)
  }

  const handleStop = async () => {
    if (sessionRef.current === null || stopping) return
    const current = sessionRef.current
    setStopping(true)
    const labels = SOURCE_LABELS[source]
    try {
      onRecorded(await current.stop(labels.fileName(existingNames, current.mimeType)))
    } catch (error) {
      onFailed(
        error instanceof Error && error.message !== ''
          ? `${labels.failure}: ${error.message}`
          : `${labels.failure}.`,
      )
    }
    conclude()
  }
  stopRef.current = () => void handleStop()

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
            {supported && (
              <button
                type="button"
                role="menuitem"
                onClick={() => void begin('microphone', () => startRecording())}
              >
                Microphone
              </button>
            )}
            {screenSupported && (
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  // The share-ended hook routes through stopRef so the
                  // browser's "stop sharing" concludes the then-current
                  // session exactly as the Stop button would.
                  void begin('screen', () => startScreenCapture(() => stopRef.current()))
                }
              >
                Screen
              </button>
            )}
          </div>
        )}
      </div>
      {session !== null && (
        <div className="dialog-overlay">
          <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="dialog">
            <h3 id={headingId}>{SOURCE_LABELS[source].heading}</h3>
            {source === 'screen' && (
              // Muted live preview of the capture itself (#225) — the user
              // sees what is being recorded without an audio feedback loop.
              <video
                ref={previewRef}
                className="record-preview"
                data-testid="record-preview"
                muted
                playsInline
              />
            )}
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
