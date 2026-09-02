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

/** The slice of MediaRecorder this module uses; injectable for tests. */
export interface RecorderLike {
  start(): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: unknown) => void) | null
  readonly mimeType: string
}

export interface RecordingDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder: (stream: MediaStream, options: { mimeType?: string }) => RecorderLike
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
): RecordingSession {
  const releaseStream = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  let recorder: RecorderLike
  const mimeType = mimeCandidates.find((candidate) => dependencies.isTypeSupported(candidate))
  try {
    recorder = dependencies.createRecorder(stream, mimeType === undefined ? {} : { mimeType })
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
  recorder.start()

  let concluded = false
  const sessionMimeType = recorder.mimeType || mimeType || fallbackMimeType
  return {
    mimeType: sessionMimeType,
    stream,
    stop(fileName: string): Promise<File> {
      if (concluded) return Promise.reject(new Error('The recording is already concluded.'))
      concluded = true
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
      recorder.onstop = () => releaseStream()
      recorder.stop()
    },
  }
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
): Promise<RecordingSession> {
  if (dependencies === null) {
    throw new Error('Screen recording is not supported in this browser or context.')
  }
  const stream = await dependencies.getDisplayMedia({ video: true, audio: true })
  const session = recordStream(
    stream,
    dependencies,
    VIDEO_MIME_CANDIDATES,
    'video/webm',
    'The screen recorder could not start.',
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
    VIDEO_MIME_CANDIDATES,
    'video/webm',
    'The webcam recorder could not start.',
  )
}
