import type { MediaKind } from './mediaLibrary'

export interface ProbedMedia {
  /** Duration in seconds. Finite and > 0. */
  duration: number
  /** Object URL for the file. Owned by the caller once resolved. */
  url: string
  /** What the file was probed as — decides the element and the library kind. */
  kind: MediaKind
}

const PROBE_TIMEOUT_MS = 15_000

/**
 * Extensions probed as audio when the browser supplies no usable MIME type.
 * The MIME check below is the primary signal; this catches files arriving
 * with an empty `File.type` (some platforms report none for less common
 * containers).
 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba']

/**
 * Decides whether a file should be probed as audio or video (#101), from
 * its MIME type first and its extension as fallback. Anything unrecognized
 * is probed as video — the historical path — and fails there with a clear
 * message if it is not decodable.
 */
export function detectMediaKind(file: File): MediaKind {
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return AUDIO_EXTENSIONS.includes(extension) ? 'audio' : 'video'
}

/**
 * Reads media metadata from a File by loading it into an off-DOM element —
 * a <video> for video files, an <audio> for audio files (#101); both are
 * HTMLMediaElements and behave identically for metadata. Resolves with the
 * duration, the detected kind, and an object URL for later playback; the
 * URL is revoked automatically on failure but kept alive on success.
 *
 * `createElement` is injectable for tests (jsdom never fires media events).
 */
export function probeMediaFile(
  file: File,
  createElement: (kind: MediaKind) => HTMLMediaElement = (kind) =>
    document.createElement(kind === 'audio' ? 'audio' : 'video'),
): Promise<ProbedMedia> {
  const kind = detectMediaKind(file)
  const url = URL.createObjectURL(file)
  const media = createElement(kind)

  return new Promise<ProbedMedia>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ProbedMedia | Error) => {
      clearTimeout(timer)
      media.onloadedmetadata = null
      media.ondurationchange = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      if (result instanceof Error) {
        URL.revokeObjectURL(url)
        reject(result)
      } else {
        resolve(result)
      }
    }

    const settleIfKnown = () => {
      const { duration } = media
      if (Number.isFinite(duration) && duration > 0) {
        finish({ duration, url, kind })
        return true
      }
      return false
    }

    media.onloadedmetadata = () => {
      if (settleIfKnown()) return
      // Streamed recordings (e.g. MediaRecorder WebM) report Infinity until
      // the browser is forced to scan to the end: seek far past it, then a
      // durationchange delivers the real value.
      media.ondurationchange = () => settleIfKnown()
      media.currentTime = Number.MAX_SAFE_INTEGER
    }

    media.onerror = () => {
      finish(
        new Error(
          kind === 'audio'
            ? `"${file.name}" is not an audio file this browser can decode.`
            : `"${file.name}" is not a video this browser can decode.`,
        ),
      )
    }

    timer = setTimeout(() => {
      finish(new Error(`Timed out reading media metadata from "${file.name}".`))
    }, PROBE_TIMEOUT_MS)

    media.preload = 'metadata'
    media.muted = true
    media.src = url
  })
}
