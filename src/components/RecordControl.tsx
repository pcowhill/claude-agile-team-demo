import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'
import {
  isRecordingSupported,
  isScreenCameraRecordingSupported,
  isScreenRecordingSupported,
  pausedClock,
  recordedSeconds,
  recordingFileExtension,
  resumedClock,
  screenRecordingName,
  startedClock,
  startMicrophoneRecording,
  startScreenCameraRecording,
  startScreenRecording,
  startWebcamRecording,
  videoRecordingFileExtension,
  voiceOverName,
  webcamRecordingName,
} from '../lib/recording'
import type {
  RecordingClock,
  RecordingSession,
  ScreenCameraRecordingSession,
} from '../lib/recording'
import { formatDuration } from '../lib/mediaLibrary'
import { DEFAULT_SETTINGS } from '../lib/settings'
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

/**
 * Where a take is (#514): counting down before the recorder starts, or
 * recording, or paused inside the same file. Concluding (Stop / Cancel)
 * leaves all three.
 */
type Phase = 'countdown' | 'recording' | 'paused'

/** How often the recorded-time readout is refreshed while recording. */
const ELAPSED_TICK_MS = 250

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
  /**
   * Seconds counted down between the sources being granted and the
   * recorder starting (#514); 0 starts at once. The Settings value
   * (`countdownSeconds`) in the app, and its default here so the dialog
   * behaves the same wherever it is rendered.
   */
  countdownSeconds?: number
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
 * (#388) — and, while capturing, a small modal dialog with the recorded
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
 *
 * #514 (from the approved #494) adds two things around the take. A
 * **countdown**: the sources are acquired and the previews go live at
 * once, but the recorder starts only after 3 · 2 · 1 — announced through a
 * live region — so the take never opens on the hand leaving the mouse;
 * **Start now** skips it and Cancel during it records nothing. **Pause /
 * Resume**: `MediaRecorder.pause()` / `resume()` produce one continuous
 * file with the paused span simply absent, so the gap never exists and
 * nothing needs trimming; the readout shows **recorded** time
 * (`RecordingClock`), which is what the file will be, not wall time; Space
 * toggles it while the dialog has focus (the transport is inert under a
 * modal already, #203); and a paired take pauses both recorders on the one
 * button. The button is offered only where the recorder can pause
 * (`canPause`, #224's feature-detection rule).
 *
 * The heading keeps naming the source through the countdown — *Recording
 * screen* — so the dialog's accessible name is stable from the moment it
 * opens; the status line beneath is what says *Starting in 3…*, then
 * *Recording — 0:04*, then *Paused — 0:04*.
 */
export function RecordControl({
  existingNames,
  onRecorded,
  onRecordedPair,
  onFailed,
  countdownSeconds = DEFAULT_SETTINGS.countdownSeconds,
  startRecording = startMicrophoneRecording,
  supported = isRecordingSupported(),
  startScreenCapture = startScreenRecording,
  screenSupported = isScreenRecordingSupported(),
  startWebcamCapture = startWebcamRecording,
  startScreenCameraCapture = startScreenCameraRecording,
  screenCameraSupported = isScreenCameraRecordingSupported(),
}: RecordControlProps) {
  const [capture, setCapture] = useState<ActiveCapture | null>(null)
  const [phase, setPhase] = useState<Phase>('recording')
  const [countdownLeft, setCountdownLeft] = useState(0)
  // The recorded-time clock (#514) and the seconds it currently reads.
  const [clock, setClock] = useState<RecordingClock | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)
  const captureRef = useRef<ActiveCapture | null>(null)
  // The Stop handler, reachable from the screen capture's share-ended hook
  // without a stale closure: the browser's own "stop sharing" must conclude
  // whatever capture is current at that moment.
  const stopRef = useRef<() => void>(() => {})
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null)
  const startNowRef = useRef<HTMLButtonElement | null>(null)
  const pauseRef = useRef<HTMLButtonElement | null>(null)
  const headingId = useId()

  // A capture never outlives the control: unmounting cancels it so the
  // microphone/screen/camera is always released.
  useEffect(
    () => () => {
      captureRef.current?.session.cancel()
    },
    [],
  )

  /** Starts the recorder(s) and the recorded-time clock — the end of the countdown, or Start now. */
  const startTake = useCallback((active: ActiveCapture) => {
    active.session.begin()
    setClock(startedClock(Date.now()))
    setElapsed(0)
    setPhase('recording')
  }, [])

  // The countdown (#514): one number a second, then the take begins. The
  // interval lives for exactly as long as the phase does, so Start now or
  // Cancel mid-count simply unmounts it.
  useEffect(() => {
    if (capture === null || phase !== 'countdown') return
    const timer = setInterval(() => setCountdownLeft((left) => left - 1), 1000)
    return () => clearInterval(timer)
  }, [capture, phase])
  useEffect(() => {
    if (capture === null || phase !== 'countdown' || countdownLeft > 0) return
    startTake(capture)
  }, [capture, phase, countdownLeft, startTake])

  // The recorded-time readout, ticking only while recording: paused, the
  // clock has no running span and the last reading stands (#514).
  useEffect(() => {
    if (capture === null || clock === null) return
    const read = () => setElapsed(recordedSeconds(clock, Date.now()))
    read()
    if (phase !== 'recording') return
    const timer = setInterval(read, ELAPSED_TICK_MS)
    return () => clearInterval(timer)
  }, [capture, clock, phase])

  // Focus follows the phase, so Space reaches the dialog's own handler
  // rather than the menu button that opened it: Start now while counting
  // down, then Pause once recording. Both are the action the phase is for.
  useEffect(() => {
    if (capture === null) return
    if (phase === 'countdown') startNowRef.current?.focus()
    else if (phase === 'recording' && clock !== null && elapsed === 0) pauseRef.current?.focus()
    // `elapsed` is deliberately part of the condition rather than a
    // dependency: the focus move happens once, on the first reading of a
    // fresh take, not on every tick.
  }, [capture, phase, clock])

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
      setClock(null)
      setElapsed(0)
      setCapture(next)
      if (countdownSeconds > 0) {
        setCountdownLeft(countdownSeconds)
        setPhase('countdown')
      } else {
        startTake(next)
      }
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
    setClock(null)
    setPhase('recording')
    setStopping(false)
  }

  const handleCancel = () => {
    captureRef.current?.session.cancel()
    conclude()
  }

  const handleStop = async () => {
    if (captureRef.current === null || stopping) return
    const current = captureRef.current
    // A Stop that arrives during the countdown — the browser's own "stop
    // sharing" — concludes a take that never began: nothing to deliver.
    if (phase === 'countdown') {
      handleCancel()
      return
    }
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

  /** Pause / Resume (#514): the recorder and the clock move together. */
  const togglePause = () => {
    if (capture === null || clock === null || stopping || !capture.session.canPause) return
    if (phase === 'recording') {
      capture.session.pause()
      setClock(pausedClock(clock, Date.now()))
      setPhase('paused')
    } else if (phase === 'paused') {
      capture.session.resume()
      setClock(resumedClock(clock, Date.now()))
      setPhase('recording')
    }
  }

  // Space toggles Pause / Resume anywhere in the dialog (#514). Handled
  // here and defaulted away rather than left to a focused button's native
  // activation, so Space never fires twice on the Pause button and never
  // stops or cancels a take from a focused Stop or Cancel — Enter still
  // activates those. Both key events are caught: a button activates on the
  // key-up of Space, so preventing only the key-down would leave the click.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' || phase === 'countdown') return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) togglePause()
  }
  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' || phase === 'countdown') return
    event.preventDefault()
    event.stopPropagation()
  }

  const heading =
    capture?.kind === 'pair'
      ? PAIR_LABELS.heading
      : SOURCE_LABELS[capture?.source ?? 'microphone'].heading

  // The source menu (#224), on the shared Menu component (#412): each item
  // starts its capture; the menu closes itself on selection and on Escape,
  // and each source is offered only where the platform supports it. Every
  // start defers the recorder (#514): the dialog begins the take itself,
  // after the countdown or at once.
  const deferred = { deferStart: true }
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
            session: await startRecording(undefined, deferred),
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
            session: await startScreenCapture(() => stopRef.current(), undefined, deferred),
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
            session: await startWebcamCapture(undefined, deferred),
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
            session: await startScreenCameraCapture(() => stopRef.current(), undefined, deferred),
          }),
          PAIR_LABELS.failure,
        ),
    })
  }

  const canPause = capture?.session.canPause === true

  return (
    <>
      <Menu label="Record" menuLabel="Recording sources" items={sources} className="record-control" />
      {capture !== null && (
        <div className="dialog-overlay">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="dialog record-dialog"
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
          >
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
            {phase === 'countdown' ? (
              // Assertive, and always in the DOM while counting: each number
              // is announced as it changes, which a status inserted at the
              // moment it has something to say is not reliably.
              <p className="record-status" role="status" aria-live="assertive">
                Starting in{' '}
                <span className="record-countdown" data-testid="record-countdown">
                  {countdownLeft}
                </span>
                …
              </p>
            ) : (
              <p className="record-status" data-testid="record-phase">
                <span
                  className={
                    phase === 'paused'
                      ? 'record-indicator record-indicator-paused'
                      : 'record-indicator'
                  }
                  aria-hidden="true"
                />
                {phase === 'paused' ? 'Paused' : 'Recording'} —{' '}
                <span data-testid="record-elapsed">{formatDuration(elapsed)}</span>
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={handleCancel} disabled={stopping}>
                Cancel
              </button>
              {phase === 'countdown' ? (
                <button
                  type="button"
                  ref={startNowRef}
                  onClick={() => startTake(capture)}
                  title="Skip the countdown and start recording"
                >
                  Start now
                </button>
              ) : (
                <>
                  {canPause && (
                    <button
                      type="button"
                      ref={pauseRef}
                      onClick={togglePause}
                      disabled={stopping}
                      title={
                        phase === 'paused'
                          ? 'Carry on recording into the same clip (Space)'
                          : 'Pause the recording; the paused span is left out of the clip (Space)'
                      }
                    >
                      {phase === 'paused' ? 'Resume recording' : 'Pause recording'}
                    </button>
                  )}
                  <button type="button" onClick={() => void handleStop()} disabled={stopping}>
                    Stop recording
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
