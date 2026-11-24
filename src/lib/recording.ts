/**
 * Recording into the media library: microphone capture (#224) and webcam
 * capture (#226) via `getUserMedia`, and screen capture (#225) via
 * `getDisplayMedia` — all through `MediaRecorder`, delivered as an
 * ordinary `File` that the existing import path probes and adds like any
 * picked file — playable, placeable, trimmable, mixable, exportable, with
 * **no special-casing downstream** (the probe already handles
 * MediaRecorder's streamed-WebM Infinity duration). The Record control is
 * the UI surface all three sources share.
 *
 * `RecordingDependencies` is injectable for tests: jsdom has neither
 * `getUserMedia`/`getDisplayMedia` nor `MediaRecorder`.
 */

/**
 * The slice of MediaRecorder this module uses; injectable for tests.
 * `pause` / `resume` (#514) are optional on the slice because their absence
 * is a state the dialog must handle — the Pause button is offered only when
 * the created recorder has them (`RecordingSession.canPause`), per #224's
 * feature-detection rule — even though every browser with `MediaRecorder`
 * ships both.
 */
export interface RecorderLike {
  start(): void
  stop(): void
  pause?(): void
  resume?(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  /** The recorder has actually begun capturing (#801). */
  onstart: (() => void) | null
  onstop: (() => void) | null
  onerror: ((event: unknown) => void) | null
  readonly mimeType: string
}

/**
 * How a capture is started (#514). By default a session's recorder starts
 * inside the `start…Recording` call, as it always has. With `deferStart`
 * the streams are acquired and the recorder created but **not started**
 * until the caller's `begin()` — the countdown's whole mechanism: the
 * permission prompts are behind the user, the previews are live, and the
 * take begins on a later tick. A deferred session that is cancelled before
 * `begin()` releases every track and records nothing.
 */
export interface StartOptions {
  deferStart?: boolean
  /**
   * The bitrate a screen capture asks its recorder for (#853). Read only
   * by the screen sources — Screen, and the screen half of Screen +
   * camera; the microphone and the camera ignore it. Absent means
   * `'standard'`: the browser picks its own rate, as it always did.
   */
  screenQuality?: ScreenRecordingQuality
}

/**
 * How hard a screen capture's recorder is asked to work (#853, from
 * customer feedback #852). `'standard'` requests no bitrate, so the
 * browser chooses: in Chromium that measured the same as asking for
 * 2.5 Mbit/s, which leaves a 1080p screen of small text visibly
 * compressed once it is zoomed or cropped. `'high'` asks for a rate
 * scaled to what is being captured (`screenRecordingBitrate`).
 */
export type ScreenRecordingQuality = 'standard' | 'high'

/** The choices in the order the Settings dialog lists them. */
export const SCREEN_RECORDING_QUALITY_CHOICES: readonly ScreenRecordingQuality[] = ['standard', 'high']

/** How the Settings dialog labels a choice, each with what it costs or buys. */
export function screenRecordingQualityLabel(quality: ScreenRecordingQuality): string {
  return quality === 'high' ? 'High (sharper text)' : 'Standard (smaller files)'
}

/**
 * Bits per pixel per frame a High screen capture asks for (#853). Measured
 * for #853 in Chromium's VP9 recorder on a 1920×1080, 30 fps canvas of
 * dense 13px text with 1 s keyframes: asking for 8 Mbit/s (0.13) left the
 * text's steady-state PSNR where the default had it, about 47.8 dB, while
 * 16 Mbit/s (0.257) lifted it to about 55 dB for 31% more bytes on still
 * text. The browser's recorder is a real-time encoder and its rate control
 * steps rather than slides, so the constant sits at the rate that was seen
 * to help rather than between the two.
 */
export const HIGH_SCREEN_BITS_PER_PIXEL = 0.25

/**
 * The most a High screen capture asks for, in bits per second (#853).
 * 0.25 bits per pixel at 4K and 60 fps would be about 124 Mbit/s — about
 * 0.9 GB a minute in the autosave and in a project file that embeds its
 * media, for an encoder that does not use what it is given on still
 * content anyway (16 Mbit/s produced 7.5 Mbit/s of file for still text).
 * 40 Mbit/s is 2.5 times the measured 1080p30 rate: a 1440p capture at
 * 30 fps (27.6 Mbit/s) gets its full rate, and 4K at 30 fps (62 Mbit/s)
 * gets 0.16 bits per pixel, still above the 0.13 at which 1080p text
 * already held its default quality.
 */
export const MAX_SCREEN_BITRATE = 40_000_000

/**
 * The capture size assumed when the track does not report its own (#853):
 * a full-HD display at the 30 fps the browsers deliver a screen at by
 * default.
 */
const FALLBACK_CAPTURE = { width: 1920, height: 1080, frameRate: 30 }

/** The slice of a track's `getSettings()` the bitrate reads. */
export interface CaptureSize {
  width?: number
  height?: number
  frameRate?: number
}

function usable(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * The `videoBitsPerSecond` a High screen capture asks for (#853): its own
 * width × height × frame rate at `HIGH_SCREEN_BITS_PER_PIXEL`, capped at
 * `MAX_SCREEN_BITRATE` and rounded to a whole bit per second. Each value
 * the track does not report (or reports as zero) falls back on its own to
 * the full-HD, 30 fps assumption.
 */
export function screenRecordingBitrate(size: CaptureSize): number {
  const width = usable(size.width, FALLBACK_CAPTURE.width)
  const height = usable(size.height, FALLBACK_CAPTURE.height)
  const frameRate = usable(size.frameRate, FALLBACK_CAPTURE.frameRate)
  return Math.min(MAX_SCREEN_BITRATE, Math.round(width * height * frameRate * HIGH_SCREEN_BITS_PER_PIXEL))
}

/**
 * The recorder options for a screen capture's stream (#853): the keyframe
 * interval every video capture has (#468), plus a bitrate at High. The size
 * is read from the stream's first video track; a stream with none, or a
 * track without `getSettings`, takes the fallback size.
 */
export function screenRecorderOptions(
  stream: MediaStream,
  quality: ScreenRecordingQuality = 'standard',
): RecorderOptions {
  if (quality !== 'high') return VIDEO_RECORDER_OPTIONS
  const track = stream.getVideoTracks()[0]
  const size: CaptureSize =
    track !== undefined && typeof track.getSettings === 'function' ? track.getSettings() : {}
  return { ...VIDEO_RECORDER_OPTIONS, videoBitsPerSecond: screenRecordingBitrate(size) }
}

/**
 * The recorded-time clock (#514): how much of a take has actually been
 * captured, **excluding paused spans** — which is what the file will be,
 * and not the wall time since the dialog opened. Pure values over a
 * millisecond timestamp (`Date.now()` in the dialog, a number in a test):
 * `banked` is the recorded time of every finished run, `runningSince` the
 * start of the current one, or null while paused.
 */
export interface RecordingClock {
  readonly bankedMs: number
  readonly runningSince: number | null
}

/** A clock that started recording at `now`. */
export function startedClock(now: number): RecordingClock {
  return { bankedMs: 0, runningSince: now }
}

/**
 * A take whose recorder has been told to start but has not started yet
 * (#801): nothing recorded, nothing running. It runs from the recorder's
 * `start` event (`RecordingSession.started`), via `resumedClock`.
 */
export function waitingClock(): RecordingClock {
  return { bankedMs: 0, runningSince: null }
}

/** The clock after a pause at `now`: the current run is banked, and nothing runs. */
export function pausedClock(clock: RecordingClock, now: number): RecordingClock {
  if (clock.runningSince === null) return clock
  return { bankedMs: clock.bankedMs + Math.max(0, now - clock.runningSince), runningSince: null }
}

/** The clock after a resume at `now`: a new run begins; the paused span is simply absent. */
export function resumedClock(clock: RecordingClock, now: number): RecordingClock {
  if (clock.runningSince !== null) return clock
  return { bankedMs: clock.bankedMs, runningSince: now }
}

/** Seconds recorded so far, read at `now`. */
export function recordedSeconds(clock: RecordingClock, now: number): number {
  const running = clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince)
  return (clock.bankedMs + running) / 1000
}

/**
 * What a recorder is asked for. `mimeType` is the container (below);
 * `videoKeyFrameIntervalDuration` is the MediaRecorder spec's request for a
 * keyframe at most this many milliseconds apart (#468). lib.dom does not
 * know the latter yet, so the type is spelled here; a browser that does not
 * implement it ignores an unknown option, which is the whole feature
 * detection needed.
 */
export interface RecorderOptions {
  mimeType?: string
  videoKeyFrameIntervalDuration?: number
  /** The video bitrate asked for; only a High screen capture sets it (#853). */
  videoBitsPerSecond?: number
}

export interface RecordingDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder: (stream: MediaStream, options: RecorderOptions) => RecorderLike
  isTypeSupported: (mimeType: string) => boolean
}

function defaultDependencies(): RecordingDependencies | null {
  if (
    typeof navigator === 'undefined' ||
    navigator.mediaDevices?.getUserMedia === undefined ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null
  }
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    // Structurally sound: only the RecorderLike members are used, and every
    // handler assigned here accepts a superset of what MediaRecorder
    // delivers (a BlobEvent is a { data: Blob }); the assertion only papers
    // over lib.dom's `this`-typed handler declarations.
    createRecorder: (stream, options) =>
      new MediaRecorder(stream, options) as unknown as RecorderLike,
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  }
}

/**
 * Whether this context can record at all: `getUserMedia` exists (browsers
 * expose `navigator.mediaDevices` only in secure contexts, so a non-secure
 * page feature-detects as unsupported, per #224) and `MediaRecorder` is
 * present. Where this is false the Record control is simply not rendered —
 * never a crash.
 */
export function isRecordingSupported(): boolean {
  return defaultDependencies() !== null
}

/**
 * Audio container preference for the capture, first supported wins: WebM
 * Opus is Chromium/Firefox ground truth, Safari records MP4/AAC. An empty
 * answer lets the browser pick its default (`mimeType` omitted).
 */
const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

/**
 * How far apart, at most, the keyframes in a video recording lie (#468).
 *
 * Chromium's MediaRecorder otherwise places them sparsely — one at the start
 * of a 3.5 s test capture and none after — and a seek on the file decodes
 * forward from the last keyframe before the target, so seeking anywhere in
 * such a recording costs the decode of everything since it. Every seek this
 * app makes on its own recordings pays that: the visual editors' scrub and
 * loop (#413, #421, #425), Save frame (#237), the preview. Measured at
 * 1280×720 the latency climbed from 59 ms to 238 ms across the 3.5 s clip
 * with the default, and stayed in a 30–90 ms sawtooth with a keyframe every
 * second, for 1.7% more bytes. One second is the conventional interval for
 * footage that will be edited: any seek decodes at most a second of video.
 * Not applied to audio-only captures, which have no keyframes.
 */
export const RECORDING_KEYFRAME_INTERVAL_MS = 1000

/** The recorder options every video capture adds to its container choice. */
const VIDEO_RECORDER_OPTIONS: RecorderOptions = {
  videoKeyFrameIntervalDuration: RECORDING_KEYFRAME_INTERVAL_MS,
}

/** The extension matching an audio capture MIME type, for the clip's file name. */
export function recordingFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

/** The extension matching a video capture MIME type (#225). */
export function videoRecordingFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4'
  return 'webm'
}

/**
 * The display name for the next recording of a kind: `<prefix> N` with the
 * smallest N greater than every existing number under that prefix, so
 * removing an old recording never re-issues its name for a new one. The
 * prefix is one of this module's literals ("Voice-over", "Screen
 * recording", "Webcam recording"), never user input.
 */
export function recordedClipName(
  prefix: string,
  existingNames: readonly string[],
  extension: string,
): string {
  let highest = 0
  const numbered = new RegExp(`^${prefix} (\\d+)\\b`)
  for (const name of existingNames) {
    const match = numbered.exec(name)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${prefix} ${highest + 1}.${extension}`
}

/**
 * The display name for the next voice-over (#224): `Voice-over N` with the
 * smallest N greater than every existing voice-over number, so removing an
 * old recording never re-issues its name for a new one.
 */
export function voiceOverName(existingNames: readonly string[], extension: string): string {
  return recordedClipName('Voice-over', existingNames, extension)
}

/** The display name for the next screen recording (#225), same numbering rule. */
export function screenRecordingName(existingNames: readonly string[], extension: string): string {
  return recordedClipName('Screen recording', existingNames, extension)
}

/** The display name for the next webcam recording (#226), same numbering rule. */
export function webcamRecordingName(existingNames: readonly string[], extension: string): string {
  return recordedClipName('Webcam recording', existingNames, extension)
}

/** A capture in progress: exactly one of stop/cancel concludes it. */
export interface RecordingSession {
  /** The MIME type the capture records to — names the file's extension
   * (`recordingFileExtension`/`videoRecordingFileExtension`) before `stop`
   * is called. */
  readonly mimeType: string
  /** The live captured stream, for an in-dialog preview (#225). */
  readonly stream: MediaStream
  /** Whether the recorder can pause and resume (#514); false hides the button. */
  readonly canPause: boolean
  /** Starts the recorder, once; a no-op after that. Called for the caller
   * by `start…Recording` unless it asked for `deferStart` (#514). */
  begin(): void
  /**
   * Settles when the recorder has actually begun capturing: its `start`
   * event (#801). Nothing before it reaches the file. Chromium fires it
   * within milliseconds of `begin()`; Firefox fires it when the first media
   * arrives from the track, which its fake microphone in CI delays by up
   * to 2.2 s (#801's measurement). Never settles for a take that never
   * starts, and never rejects.
   */
  readonly started: Promise<void>
  /** Pauses the capture (#514): the paused span is simply absent from the
   * one continuous file. A no-op before `begin`, while paused, after
   * conclusion, or where `canPause` is false. */
  pause(): void
  /** Resumes a paused capture into the same file; a no-op otherwise. */
  resume(): void
  /** Concludes the capture and resolves the recorded bytes as a `File`
   * named `fileName`, ready for the ordinary import path. */
  stop(fileName: string): Promise<File>
  /** Discards the capture entirely — the capture device/surface is released
   * and no file is produced (#224's Cancel). */
  cancel(): void
}

/**
 * Wraps an already-granted capture stream in a RecordingSession: recorder
 * creation against the first supported MIME candidate, chunk collection,
 * stop-to-File, cancel-to-discard, and stream release on every conclusion.
 * The shared half of the microphone (#224) and screen (#225) sources — the
 * two differ only in how their stream is obtained.
 */
function recordStream(
  stream: MediaStream,
  dependencies: Pick<RecordingDependencies, 'createRecorder' | 'isTypeSupported'>,
  mimeCandidates: readonly string[],
  fallbackMimeType: string,
  recorderFailure: string,
  recorderOptions: RecorderOptions = {},
  deferStart = false,
): RecordingSession {
  const releaseStream = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  let recorder: RecorderLike
  const mimeType = mimeCandidates.find((candidate) => dependencies.isTypeSupported(candidate))
  try {
    recorder = dependencies.createRecorder(stream, {
      ...recorderOptions,
      ...(mimeType === undefined ? {} : { mimeType }),
    })
  } catch (error) {
    // The capture was granted but the recorder could not start: release the
    // device/surface before surfacing the failure.
    releaseStream()
    throw error instanceof Error ? error : new Error(recorderFailure)
  }

  const chunks: Blob[] = []
  let failure: Error | null = null
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onerror = () => {
    failure = new Error('The recorder failed while recording.')
  }
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  recorder.onstart = () => markStarted()

  let begun = false
  let paused = false
  let concluded = false
  const canPause = typeof recorder.pause === 'function' && typeof recorder.resume === 'function'
  const sessionMimeType = recorder.mimeType || mimeType || fallbackMimeType
  const session: RecordingSession = {
    mimeType: sessionMimeType,
    stream,
    canPause,
    started,
    begin(): void {
      if (begun || concluded) return
      begun = true
      recorder.start()
    },
    pause(): void {
      // MediaRecorder throws on a pause while inactive or already paused;
      // the guards make every call from the dialog safe to repeat.
      if (!canPause || !begun || paused || concluded) return
      paused = true
      recorder.pause?.()
    },
    resume(): void {
      if (!canPause || !begun || !paused || concluded) return
      paused = false
      recorder.resume?.()
    },
    stop(fileName: string): Promise<File> {
      if (concluded) return Promise.reject(new Error('The recording is already concluded.'))
      concluded = true
      if (!begun) {
        // Nothing was ever captured: releasing is all there is to do, and
        // `MediaRecorder.stop()` on an inactive recorder would throw.
        releaseStream()
        return Promise.reject(new Error('The recording had not started.'))
      }
      return new Promise<File>((resolve, reject) => {
        recorder.onstop = () => {
          releaseStream()
          if (failure !== null) {
            reject(failure)
            return
          }
          resolve(new File(chunks, fileName, { type: recorder.mimeType || sessionMimeType }))
        }
        recorder.stop()
      })
    },
    cancel(): void {
      if (concluded) return
      concluded = true
      // The discard rule (#224): nothing reaches the library, whatever the
      // recorder still delivers after stop.
      recorder.ondataavailable = null
      if (!begun) {
        // Cancelled during the countdown (#514): the recorder never ran, so
        // there is nothing to stop — only devices to release.
        releaseStream()
        return
      }
      recorder.onstop = () => releaseStream()
      recorder.stop()
    },
  }
  if (!deferStart) session.begin()
  return session
}

/**
 * Starts a microphone capture. Rejects exactly like a failed import when
 * the microphone is unavailable (permission denied, no device, insecure
 * context) — the caller routes the message into the library's dismissible
 * failure list. On success the returned session records until `stop` or
 * `cancel`; both release the microphone (every track stopped).
 */
export async function startMicrophoneRecording(
  dependencies: RecordingDependencies | null = defaultDependencies(),
  options: StartOptions = {},
): Promise<RecordingSession> {
  if (dependencies === null) {
    throw new Error('Recording is not supported in this browser or context.')
  }
  const stream = await dependencies.getUserMedia({ audio: true })
  return recordStream(
    stream,
    dependencies,
    AUDIO_MIME_CANDIDATES,
    'audio/webm',
    'The audio recorder could not start.',
    {},
    options.deferStart === true,
  )
}

/**
 * Video container preference for a screen capture (#225), first supported
 * wins — the same codec order the export pipeline prefers (VP9, then VP8,
 * with Opus for whatever tab/system audio the browser grants). An empty
 * answer lets the browser pick its default.
 */
const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
]

/**
 * The same preference for a capture with **no audio track** (#579): no
 * candidate names an audio codec. Firefox's screen capture never carries
 * audio, and a Firefox recorder told `codecs=vp8,opus` for a video-only
 * stream starts and stops without ever delivering data or firing `stop` —
 * no error either — so the take could never conclude. Measured on Firefox
 * 155: `vp8,opus` stalled for 10 s, `video/webm` recorded 33 kB in 1 s.
 * Chromium drops the absent codec on its own, so for it this changes only
 * the type string it is asked for, not what it records.
 */
const VIDEO_ONLY_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

/**
 * The video candidates matching the tracks a capture actually has (#579).
 * What was requested is no guide: `getDisplayMedia({ audio: true })`
 * resolves video-only where the browser grants no audio, and the webcam's
 * fallback is video-only by design (#226).
 */
export function videoMimeCandidates(stream: MediaStream): readonly string[] {
  return stream.getAudioTracks().length > 0 ? VIDEO_MIME_CANDIDATES : VIDEO_ONLY_MIME_CANDIDATES
}

/** The getDisplayMedia slice the screen source uses; injectable for tests. */
export interface ScreenRecordingDependencies {
  getDisplayMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder: RecordingDependencies['createRecorder']
  isTypeSupported: RecordingDependencies['isTypeSupported']
}

function defaultScreenDependencies(): ScreenRecordingDependencies | null {
  if (
    typeof navigator === 'undefined' ||
    navigator.mediaDevices?.getDisplayMedia === undefined ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null
  }
  return {
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    createRecorder: (stream, options) =>
      new MediaRecorder(stream, options) as unknown as RecorderLike,
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  }
}

/**
 * Whether this context can record the screen (#225): `getDisplayMedia`
 * exists (absent on most mobile browsers and in insecure contexts) and
 * `MediaRecorder` is present. Where this is false the Screen source is
 * simply not offered — never a crash.
 */
export function isScreenRecordingSupported(): boolean {
  return defaultScreenDependencies() !== null
}

/**
 * Starts a screen capture (#225): the browser shows its own tab/window/
 * display picker, and the capture records until `stop` or `cancel`. Audio
 * is requested so a tab/system audio track, when the browser grants one,
 * records with the video like any imported clip's sound; browsers that
 * grant none record video-only. Rejects exactly like a failed import when
 * capture is unavailable or the user dismisses the picker — the caller
 * routes the message into the library's failure list.
 *
 * `onShareEnded` fires when the capture surface itself ends the share —
 * the browser's own "stop sharing" UI, or the shared window closing —
 * so the caller can conclude the recording exactly as its Stop button
 * would. It never fires for this module's own stop/cancel teardown.
 */
export async function startScreenRecording(
  onShareEnded: () => void,
  dependencies: ScreenRecordingDependencies | null = defaultScreenDependencies(),
  options: StartOptions = {},
): Promise<RecordingSession> {
  if (dependencies === null) {
    throw new Error('Screen recording is not supported in this browser or context.')
  }
  const stream = await dependencies.getDisplayMedia({ video: true, audio: true })
  const session = recordStream(
    stream,
    dependencies,
    videoMimeCandidates(stream),
    'video/webm',
    'The screen recorder could not start.',
    screenRecorderOptions(stream, options.screenQuality),
    options.deferStart === true,
  )
  // The browser's "stop sharing" control ends the video track outside our
  // dialog; concluding through the session first makes the later hook a
  // no-op (stop() and cancel() both guard against double conclusion, and
  // releaseStream's track.stop() does not fire `ended` on an already-ended
  // track — nor does `onended` fire for programmatic stops at all).
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', onShareEnded)
  }
  return session
}

/** The display name for the next system-audio recording (#878), same numbering rule. */
export function systemAudioRecordingName(existingNames: readonly string[], extension: string): string {
  return recordedClipName('System audio', existingNames, extension)
}

/**
 * Whether this browser can share display audio at all (#878): the
 * capability probe behind Record ▾ › System audio. No API says so outright
 * before the share picker opens, so this reads the one constraint that
 * exists only for display-audio capture, `suppressLocalAudioPlayback`, from
 * `getSupportedConstraints()`. Chromium reports it (measured on #878);
 * Firefox, whose screen capture never carries audio (#579), does not. A
 * capability, not a user-agent check: a browser that adds display audio
 * and the constraint with it gains the source without a change here.
 */
export function canShareDisplayAudio(
  supportedConstraints: () => MediaTrackSupportedConstraints | undefined = () =>
    typeof navigator === 'undefined'
      ? undefined
      : navigator.mediaDevices?.getSupportedConstraints?.(),
): boolean {
  try {
    const supported = supportedConstraints() as Record<string, unknown> | undefined
    return supported?.suppressLocalAudioPlayback === true
  } catch {
    return false
  }
}

/**
 * The failure a system-audio take reports when the share carried no sound
 * (#878): the share-audio box was left unticked, or the platform offers no
 * audio for what was picked. It names the fix, since the picker is the
 * browser's and the app cannot tick the box for the user.
 */
export const NO_SHARED_AUDIO_MESSAGE =
  'no audio was shared. In the browser’s share picker, tick “Share system audio” ' +
  '(or “Share tab audio” for a tab) and try again.'

/** The display-capture slice the system-audio source uses (#878); injectable for tests. */
export interface SystemAudioRecordingDependencies extends ScreenRecordingDependencies {
  /** A stream of just these tracks — `new MediaStream(tracks)`, absent from jsdom. */
  audioStream: (tracks: MediaStreamTrack[]) => MediaStream
}

function defaultSystemAudioDependencies(): SystemAudioRecordingDependencies | null {
  const screen = defaultScreenDependencies()
  if (screen === null || typeof MediaStream === 'undefined') return null
  return { ...screen, audioStream: (tracks) => new MediaStream(tracks) }
}

/**
 * Whether Record ▾ offers System audio (#878): screen capture works and the
 * browser can share display audio (`canShareDisplayAudio`).
 */
export function isSystemAudioRecordingSupported(): boolean {
  return defaultSystemAudioDependencies() !== null && canShareDisplayAudio()
}

/**
 * Starts a system-audio capture (#878, from customer feedback #874): what
 * the computer is playing, recorded straight into an audio clip.
 *
 * Browsers hand a page system audio only through screen sharing, and
 * Chromium refuses a share without a picture (`getDisplayMedia({ video:
 * false, audio: true })` rejects with `NotFoundError`, measured on #878),
 * so the browser's picker still appears and the picture is requested.
 * Its hints favour the whole screen, where Chromium offers *system* audio
 * (a tab offers its own): `displaySurface: 'monitor'` pre-selects that
 * pane and `systemAudio: 'include'` asks for the share-audio box. Only the
 * audio tracks are recorded, through the microphone's audio containers.
 *
 * A share without an audio track — the box left unticked, or a window on
 * a platform that offers it no audio — is released at once and rejects
 * with `NO_SHARED_AUDIO_MESSAGE`, before any countdown, rather than
 * recording a silent clip.
 *
 * The picture track is kept, unrecorded, until the take concludes, and
 * every track's `ended` reports to `onShareEnded`, once for the share.
 * That is the Screen source's proven shape (#225): the browser's "stop
 * sharing" ends the shared surface, and a real share whose picture track
 * is stopped early may end with it, which no headless measurement can
 * settle.
 */
export async function startSystemAudioRecording(
  onShareEnded: () => void,
  dependencies: SystemAudioRecordingDependencies | null = defaultSystemAudioDependencies(),
  options: StartOptions = {},
): Promise<RecordingSession> {
  if (dependencies === null) {
    throw new Error('System audio recording is not supported in this browser or context.')
  }
  const shared = await dependencies.getDisplayMedia({
    video: { displaySurface: 'monitor' },
    audio: true,
    // A DisplayMediaStreamOptions member that lib.dom's
    // MediaStreamConstraints does not declare; Chromium reads it.
    systemAudio: 'include',
  } as MediaStreamConstraints)
  const releaseShare = () => {
    for (const track of shared.getTracks()) track.stop()
  }
  const audioTracks = shared.getAudioTracks()
  if (audioTracks.length === 0) {
    releaseShare()
    throw new Error(NO_SHARED_AUDIO_MESSAGE)
  }
  let session: RecordingSession
  try {
    session = recordStream(
      dependencies.audioStream(audioTracks),
      dependencies,
      AUDIO_MIME_CANDIDATES,
      'audio/webm',
      'The system audio recorder could not start.',
      {},
      options.deferStart === true,
    )
  } catch (error) {
    // recordStream released the audio tracks; the picture is ours to release.
    releaseShare()
    throw error
  }
  // The browser's "stop sharing" ends every shared track, and each fires
  // its own `ended`, possibly in one task, before the dialog has re-rendered
  // from the first. A second report would reach the dialog's Stop with the
  // take still current and conclude it twice, listing "already concluded"
  // as a failure beside the clip. So the share's end is reported once.
  let shareEndReported = false
  const reportShareEnded = () => {
    if (shareEndReported) return
    shareEndReported = true
    onShareEnded()
  }
  for (const track of shared.getTracks()) {
    track.addEventListener('ended', reportShareEnded)
  }
  return {
    ...session,
    // Every conclusion releases the whole share, picture included; the
    // session itself only ever held the audio tracks.
    stop: (fileName) => session.stop(fileName).finally(releaseShare),
    cancel: () => {
      session.cancel()
      releaseShare()
    },
  }
}

/**
 * Both halves of a screen + camera take (#388): one gesture acquired both
 * streams and started both recorders, one Stop / Cancel concludes both. The
 * streams and MIME types are exposed for the dialog's two live previews and
 * the two file names; the paired stop resolves both captures as ordinary
 * `File`s for the import path.
 */
export interface ScreenCameraRecordingSession {
  readonly screenMimeType: string
  readonly cameraMimeType: string
  readonly screenStream: MediaStream
  readonly cameraStream: MediaStream
  /** Whether both recorders can pause (#514); the button needs both. */
  readonly canPause: boolean
  /** Starts both recorders back to back, once — the same gesture, so the
   * two captures stay aligned (#388); a no-op after that. */
  begin(): void
  /** Settles once **both** recorders have begun capturing (#801), as
   * `RecordingSession.started` does for one. */
  readonly started: Promise<void>
  /** Pauses both recorders in the same task (#514), so the paused spans
   * absent from the two files begin on the same tick. */
  pause(): void
  /** Resumes both recorders in the same task. */
  resume(): void
  /** Concludes both captures; both conclude even if one recorder failed
   * (the failure then surfaces after the other resolved). */
  stop(screenFileName: string, cameraFileName: string): Promise<{ screen: File; camera: File }>
  /** Discards both captures — every device/surface released, no files. */
  cancel(): void
}

/** The dependency slice a paired capture needs: both acquisition paths. */
export interface ScreenCameraRecordingDependencies {
  getDisplayMedia: ScreenRecordingDependencies['getDisplayMedia']
  getUserMedia: RecordingDependencies['getUserMedia']
  createRecorder: RecordingDependencies['createRecorder']
  isTypeSupported: RecordingDependencies['isTypeSupported']
}

function defaultScreenCameraDependencies(): ScreenCameraRecordingDependencies | null {
  const screen = defaultScreenDependencies()
  const camera = defaultDependencies()
  if (screen === null || camera === null) return null
  return {
    getDisplayMedia: screen.getDisplayMedia,
    getUserMedia: camera.getUserMedia,
    createRecorder: camera.createRecorder,
    isTypeSupported: camera.isTypeSupported,
  }
}

/**
 * Whether this context can record screen and camera together (#388): exactly
 * the conjunction of the two single-source detections. Where false the
 * "Screen + camera" source is simply not offered — never a crash.
 */
export function isScreenCameraRecordingSupported(): boolean {
  return defaultScreenCameraDependencies() !== null
}

/**
 * Starts a screen + camera capture (#388): the browser's screen picker
 * first (the user chooses the surface, exactly as the Screen source does),
 * then the camera — with #226's fallback, so a camera without a microphone
 * still records video-only. **Either denial cancels the whole start**:
 * every already-granted track is stopped and one rejection surfaces, so a
 * dismissed picker or a camera refusal never leaves a half-recording or a
 * live capture nobody sees. Both recorders start back-to-back from this one
 * call — the same gesture — which is what keeps the two captures aligned;
 * the delivered clips' probed durations agree to within recorder startup
 * skew (asserted in e2e, not assumed).
 *
 * Audio routing is fixed, not configurable: the microphone travels with the
 * camera stream (the narrator's track), and whatever tab/system audio the
 * browser grants stays with the screen stream — two microphones are never
 * captured.
 *
 * `onShareEnded` fires when the capture surface itself ends the share (the
 * browser's "stop sharing" UI), exactly as in `startScreenRecording` — the
 * caller concludes the whole take as its Stop button would.
 */
export async function startScreenCameraRecording(
  onShareEnded: () => void,
  dependencies: ScreenCameraRecordingDependencies | null = defaultScreenCameraDependencies(),
  options: StartOptions = {},
): Promise<ScreenCameraRecordingSession> {
  if (dependencies === null) {
    throw new Error('Screen + camera recording is not supported in this browser or context.')
  }
  const screenStream = await dependencies.getDisplayMedia({ video: true, audio: true })
  const releaseScreen = () => {
    for (const track of screenStream.getTracks()) track.stop()
  }
  let cameraStream: MediaStream
  try {
    try {
      cameraStream = await dependencies.getUserMedia({ video: true, audio: true })
    } catch {
      // #226's rule: a missing microphone costs the sound, never the
      // recording; a genuine camera denial fails both attempts and the
      // second failure is the one that surfaces.
      cameraStream = await dependencies.getUserMedia({ video: true })
    }
  } catch (error) {
    releaseScreen()
    throw error
  }

  // Both recorders are created un-started and begun together below, so
  // the two `start()` calls are adjacent whether the take begins now or
  // after a countdown (#514) — the alignment #388 relies on.
  const screenSession = recordStream(
    screenStream,
    dependencies,
    videoMimeCandidates(screenStream),
    'video/webm',
    'The screen recorder could not start.',
    screenRecorderOptions(screenStream, options.screenQuality),
    true,
  )
  let cameraSession: RecordingSession
  try {
    cameraSession = recordStream(
      cameraStream,
      dependencies,
      videoMimeCandidates(cameraStream),
      'video/webm',
      'The camera recorder could not start.',
      VIDEO_RECORDER_OPTIONS,
      true,
    )
  } catch (error) {
    // recordStream released the camera stream before throwing; the started
    // screen half must not keep recording into a take that no longer exists.
    screenSession.cancel()
    throw error
  }

  for (const track of screenStream.getVideoTracks()) {
    track.addEventListener('ended', onShareEnded)
  }

  let concluded = false
  const pair: ScreenCameraRecordingSession = {
    screenMimeType: screenSession.mimeType,
    cameraMimeType: cameraSession.mimeType,
    screenStream,
    cameraStream,
    canPause: screenSession.canPause && cameraSession.canPause,
    started: Promise.all([screenSession.started, cameraSession.started]).then(() => undefined),
    begin(): void {
      screenSession.begin()
      cameraSession.begin()
    },
    pause(): void {
      if (!pair.canPause) return
      screenSession.pause()
      cameraSession.pause()
    },
    resume(): void {
      if (!pair.canPause) return
      screenSession.resume()
      cameraSession.resume()
    },
    async stop(screenFileName: string, cameraFileName: string) {
      if (concluded) throw new Error('The recording is already concluded.')
      concluded = true
      // Settled, not raced: both halves must conclude (devices released)
      // before any failure surfaces, or one recorder's error would leave
      // the other capturing forever.
      const [screen, camera] = await Promise.allSettled([
        screenSession.stop(screenFileName),
        cameraSession.stop(cameraFileName),
      ])
      if (screen.status === 'rejected') throw screen.reason
      if (camera.status === 'rejected') throw camera.reason
      return { screen: screen.value, camera: camera.value }
    },
    cancel(): void {
      if (concluded) return
      concluded = true
      screenSession.cancel()
      cameraSession.cancel()
    },
  }
  if (options.deferStart !== true) pair.begin()
  return pair
}

/**
 * Starts a webcam capture (#226): camera video plus microphone audio via
 * `getUserMedia`, recorded until `stop` or `cancel` — the third one-line
 * caller of the shared session logic, exactly as #225 anticipated. A camera
 * without a microphone still records: when the combined request fails, a
 * video-only request is tried before giving up, so the missing device costs
 * the sound, never the recording (a genuine denial or missing camera fails
 * both attempts and surfaces the second failure). Rejects exactly like a
 * failed import — the caller routes the message into the library's failure
 * list. Feature detection is `isRecordingSupported`: the webcam source uses
 * the same `getUserMedia` + `MediaRecorder` pair the microphone does.
 */
export async function startWebcamRecording(
  dependencies: RecordingDependencies | null = defaultDependencies(),
  options: StartOptions = {},
): Promise<RecordingSession> {
  if (dependencies === null) {
    throw new Error('Webcam recording is not supported in this browser or context.')
  }
  let stream: MediaStream
  try {
    stream = await dependencies.getUserMedia({ video: true, audio: true })
  } catch {
    stream = await dependencies.getUserMedia({ video: true })
  }
  return recordStream(
    stream,
    dependencies,
    videoMimeCandidates(stream),
    'video/webm',
    'The webcam recorder could not start.',
    VIDEO_RECORDER_OPTIONS,
    options.deferStart === true,
  )
}
