import { useEffect, useId, useRef, useState } from 'react'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'
import {
  isRecordingSupported,
  isScreenCameraRecordingSupported,
  isScreenRecordingSupported,
  recordingFileExtension,
  screenRecordingName,
  startMicrophoneRecording,
  startScreenCameraRecording,
  startScreenRecording,
  startWebcamRecording,
  videoRecordingFileExtension,
  voiceOverName,
  webcamRecordingName,
} from '../lib/recording'
import type { RecordingSession, ScreenCameraRecordingSession } from '../lib/recording'
import { formatDuration } from '../lib/mediaLibrary'
import './dialog.css'
import './RecordControl.css'

type RecordingSource = 'microphone' | 'screen' | 'webcam'

/** Per-source wording — dialog heading, failure prefix, clip name — plus
 * whether the dialog shows the live capture preview (video sources only). */
const SOURCE_LABELS: Record<
  RecordingSource,
  {
    heading: string
    failure: string
    preview: boolean
    fileName: (existingNames: readonly string[], mimeType: string) => string
  }
> = {
  microphone: {
    heading: 'Recording voice-over',
    failure: 'Microphone recording failed',
    preview: false,
    fileName: (names, mimeType) => voiceOverName(names, recordingFileExtension(mimeType)),
  },
  screen: {
    heading: 'Recording screen',
    failure: 'Screen recording failed',
    preview: true,
    fileName: (names, mimeType) =>
      screenRecordingName(names, videoRecordingFileExtension(mimeType)),
  },
  webcam: {
    heading: 'Recording webcam',
    failure: 'Webcam recording failed',
    preview: true,
    fileName: (names, mimeType) =>
      webcamRecordingName(names, videoRecordingFileExtension(mimeType)),
  },
}

/** The paired take's wording (#388), beside SOURCE_LABELS' single sources. */
const PAIR_LABELS = {
  heading: 'Recording screen + camera',
  failure: 'Screen + camera recording failed',
}

/**
 * What is capturing right now: one of the three single sources, or the
 * paired screen + camera take (#388). One shape so the dialog's elapsed
 * readout, Stop, and Cancel treat every capture alike — only the previews
 * and the delivery differ by kind.
 */
type ActiveCapture =
  | { kind: 'single'; source: RecordingSource; session: RecordingSession }
  | { kind: 'pair'; session: ScreenCameraRecordingSession }

interface RecordControlProps {
  /** The current library clip names — numbers the next recording's name. */
  existingNames: readonly string[]
  /** Receives the finished capture as an ordinary file for the import path. */
  onRecorded: (file: File) => void
  /**
   * Receives a finished screen + camera take (#388) — both files together,
   * so the caller can import both and place them as one arrival. The
   * "Screen + camera" source is offered only when this is wired.
   */
  onRecordedPair?: (files: { screen: File; camera: File }) => void
  /** Receives a recording failure for the library's failure list (#224). */
  onFailed: (reason: string) => void
  /** Injectable for tests: jsdom has no getUserMedia or MediaRecorder. */
  startRecording?: typeof startMicrophoneRecording
  supported?: boolean
  /** Injectable for tests: jsdom has no getDisplayMedia either (#225). */
  startScreenCapture?: typeof startScreenRecording
  screenSupported?: boolean
  /** Injectable for tests (#226); availability rides `supported`, since the
   * webcam uses the same getUserMedia + MediaRecorder pair the mic does. */
  startWebcamCapture?: typeof startWebcamRecording
  /** Injectable for tests (#388). */
  startScreenCameraCapture?: typeof startScreenCameraRecording
  screenCameraSupported?: boolean
}

/**
 * The Record control in the media library header (#224): a source menu —
 * Microphone (#224), Screen (#225), Webcam (#226), and Screen + camera
 * (#388) — and, while capturing, a small modal dialog with the elapsed
 * time, a recording indicator, live preview(s) for video sources (the
 * capture itself for the screen, a self-view for the webcam, both for the
 * paired take), and Stop / Cancel. Stop hands the capture to the ordinary
 * import path as `Voice-over N` / `Screen recording N` /
 * `Webcam recording N`; a paired take delivers both files together so the
 * caller can place them as one arrival. Cancel discards the capture. Each
 * source is hidden where the platform cannot provide it (feature
 * detection, never a crash); a capture failure — permission denied, no
 * device, the user dismissing the browser's screen picker — lands in the
 * library's dismissible failure list exactly like a failed import. The
 * browser's own "stop sharing" UI ends a screen or paired capture cleanly,
 * exactly as the Stop button does.
 */
export function RecordControl({
  existingNames,
  onRecorded,
  onRecordedPair,
  onFailed,
  startRecording = startMicrophoneRecording,
  supported = isRecordingSupported(),
  startScreenCapture = startScreenRecording,
  screenSupported = isScreenRecordingSupported(),
  startWebcamCapture = startWebcamRecording,
  startScreenCameraCapture = startScreenCameraRecording,
  screenCameraSupported = isScreenCameraRecordingSupported(),
}: RecordControlProps) {
  const [capture, setCapture] = useState<ActiveCapture | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)
  const captureRef = useRef<ActiveCapture | null>(null)
  // The Stop handler, reachable from the screen capture's share-ended hook
  // without a stale closure: the browser's own "stop sharing" must conclude
  // whatever capture is current at that moment.
  const stopRef = useRef<() => void>(() => {})
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null)
  const headingId = useId()

  // A capture never outlives the control: unmounting cancels it so the
  // microphone/screen/camera is always released.
  useEffect(
    () => () => {
      captureRef.current?.session.cancel()
    },
    [],
  )

  // The dialog's elapsed readout, ticking only while recording.
  useEffect(() => {
    if (capture === null) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250)
    return () => clearInterval(timer)
  }, [capture])

  // The live previews (#225/#226/#388): the dialog's <video> elements play
  // the capture streams themselves, muted — what is recorded (screen) or a
  // self-view (camera), without echoing the captured audio. A paired take
  // wires both elements.
  useEffect(() => {
    if (capture === null) return
    const wired: HTMLVideoElement[] = []
    const wire = (element: HTMLVideoElement | null, stream: MediaStream) => {
      if (element === null) return
      element.srcObject = stream
      // play() rejects (AbortError) when interrupted by teardown — expected.
      element.play().catch(() => {})
      wired.push(element)
    }
    if (capture.kind === 'pair') {
      wire(previewRef.current, capture.session.screenStream)
      wire(cameraPreviewRef.current, capture.session.cameraStream)
    } else if (SOURCE_LABELS[capture.source].preview) {
      wire(previewRef.current, capture.session.stream)
    }
    return () => {
      for (const element of wired) element.srcObject = null
    }
  }, [capture])

  if (!supported && !screenSupported) return null

  const begin = async (start: () => Promise<ActiveCapture>, failure: string) => {
    try {
      const next = await start()
      captureRef.current = next
      setStopping(false)
      setCapture(next)
    } catch (error) {
      onFailed(
        error instanceof Error && error.message !== ''
          ? `${failure}: ${error.message}`
          : `${failure}.`,
      )
    }
  }

  const conclude = () => {
    captureRef.current = null
    setCapture(null)
    setStopping(false)
  }

  const handleStop = async () => {
    if (captureRef.current === null || stopping) return
    const current = captureRef.current
    setStopping(true)
    if (current.kind === 'pair') {
      try {
        onRecordedPair?.(
          await current.session.stop(
            screenRecordingName(
              existingNames,
              videoRecordingFileExtension(current.session.screenMimeType),
            ),
            webcamRecordingName(
              existingNames,
              videoRecordingFileExtension(current.session.cameraMimeType),
            ),
          ),
        )
      } catch (error) {
        onFailed(
          error instanceof Error && error.message !== ''
            ? `${PAIR_LABELS.failure}: ${error.message}`
            : `${PAIR_LABELS.failure}.`,
        )
      }
      conclude()
      return
    }
    const labels = SOURCE_LABELS[current.source]
    try {
      onRecorded(
        await current.session.stop(labels.fileName(existingNames, current.session.mimeType)),
      )
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
    capture?.session.cancel()
    conclude()
  }

  const heading =
    capture?.kind === 'pair'
      ? PAIR_LABELS.heading
      : SOURCE_LABELS[capture?.source ?? 'microphone'].heading

  // The source menu (#224), on the shared Menu component (#412): each item
  // starts its capture; the menu closes itself on selection and on Escape,
  // and each source is offered only where the platform supports it.
  const sources: MenuItem[] = []
  if (supported) {
    sources.push({
      kind: 'action',
      label: 'Microphone',
      onSelect: () =>
        void begin(
          async () => ({
            kind: 'single',
            source: 'microphone',
            session: await startRecording(),
          }),
          SOURCE_LABELS.microphone.failure,
        ),
    })
  }
  if (screenSupported) {
    sources.push({
      kind: 'action',
      label: 'Screen',
      onSelect: () =>
        // The share-ended hook routes through stopRef so the browser's
        // "stop sharing" concludes the then-current capture exactly as the
        // Stop button would.
        void begin(
          async () => ({
            kind: 'single',
            source: 'screen',
            session: await startScreenCapture(() => stopRef.current()),
          }),
          SOURCE_LABELS.screen.failure,
        ),
    })
  }
  if (supported) {
    sources.push({
      kind: 'action',
      label: 'Webcam',
      onSelect: () =>
        void begin(
          async () => ({
            kind: 'single',
            source: 'webcam',
            session: await startWebcamCapture(),
          }),
          SOURCE_LABELS.webcam.failure,
        ),
    })
  }
  if (screenCameraSupported && onRecordedPair !== undefined) {
    sources.push({
      kind: 'action',
      label: 'Screen + camera',
      onSelect: () =>
        void begin(
          async () => ({
            kind: 'pair',
            session: await startScreenCameraCapture(() => stopRef.current()),
          }),
          PAIR_LABELS.failure,
        ),
    })
  }

  return (
    <>
      <Menu label="Record" menuLabel="Recording sources" items={sources} className="record-control" />
      {capture !== null && (
        <div className="dialog-overlay">
          <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="dialog">
            <h3 id={headingId}>{heading}</h3>
            {(capture.kind === 'pair' || SOURCE_LABELS[capture.source].preview) && (
              // Muted live preview of the capture itself (#225/#226) — the
              // user sees what records without an audio feedback loop. For a
              // paired take this is the screen half.
              <video
                ref={previewRef}
                className="record-preview"
                data-testid="record-preview"
                muted
                playsInline
              />
            )}
            {capture.kind === 'pair' && (
              <>
                {/* The camera self-view (#388), beside-under the screen. */}
                <video
                  ref={cameraPreviewRef}
                  className="record-preview record-preview-camera"
                  data-testid="record-preview-camera"
                  muted
                  playsInline
                />
                <p className="record-note">
                  The microphone records with the camera clip; any tab or system audio stays with
                  the screen clip. Stopping places the screen on the timeline with the camera as a
                  corner overlay.
                </p>
              </>
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
