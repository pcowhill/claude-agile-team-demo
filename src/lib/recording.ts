/**
 * Microphone recording into the media library (#224): capture via
 * `getUserMedia({ audio: true })` + `MediaRecorder`, delivered as an
 * ordinary `File` that the existing import path probes and adds like any
 * picked audio file — playable, placeable on audio tracks, trimmable,
 * mixable, exportable, with **no special-casing downstream** (the probe
 * already handles MediaRecorder's streamed-WebM Infinity duration). The
 * Record control is the UI surface the other recording sources (screen
 * #225, webcam #226) extend.
 *
 * `RecordingDependencies` is injectable for tests: jsdom has neither
 * `getUserMedia` nor `MediaRecorder`.
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

/** The extension matching a capture MIME type, for the clip's file name. */
export function recordingFileExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * The display name for the next voice-over (#224): `Voice-over N` with the
 * smallest N greater than every existing voice-over number, so removing an
 * old recording never re-issues its name for a new one.
 */
export function voiceOverName(existingNames: readonly string[], extension: string): string {
  let highest = 0
  for (const name of existingNames) {
    const match = /^Voice-over (\d+)\b/.exec(name)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `Voice-over ${highest + 1}.${extension}`
}

/** A capture in progress: exactly one of stop/cancel concludes it. */
export interface RecordingSession {
  /** The MIME type the capture records to — names the file's extension
   * (`recordingFileExtension`) before `stop` is called. */
  readonly mimeType: string
  /** Concludes the capture and resolves the recorded bytes as a `File`
   * named `fileName`, ready for the ordinary import path. */
  stop(fileName: string): Promise<File>
  /** Discards the capture entirely — the microphone is released and no
   * file is produced (#224's Cancel). */
  cancel(): void
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
  const releaseStream = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  let recorder: RecorderLike
  const mimeType = AUDIO_MIME_CANDIDATES.find((candidate) =>
    dependencies.isTypeSupported(candidate),
  )
  try {
    recorder = dependencies.createRecorder(stream, mimeType === undefined ? {} : { mimeType })
  } catch (error) {
    // The microphone was granted but the recorder could not start: release
    // the device before surfacing the failure.
    releaseStream()
    throw error instanceof Error ? error : new Error('The audio recorder could not start.')
  }

  const chunks: Blob[] = []
  let failure: Error | null = null
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onerror = () => {
    failure = new Error('The audio recorder failed while recording.')
  }
  recorder.start()

  let concluded = false
  const sessionMimeType = recorder.mimeType || mimeType || 'audio/webm'
  return {
    mimeType: sessionMimeType,
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
